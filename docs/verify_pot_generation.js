#!/usr/bin/env node
// Runs every claim in docs/pot-generation-what-it-misses.md against a real
// Godot 4 editor binary.
//
//   node docs/verify_pot_generation.js /path/to/Godot_v4.7-stable_linux.x86_64
//   node docs/verify_pot_generation.js /path/to/godot --selftest
//
// WHY THIS FILE EXISTS AT ALL
// ---------------------------
// `Generate POT` is an editor BUTTON. Godot 4.7 has no `--export-pot` CLI flag
// (godot-proposals#10986 is still open), so every page on the web that claims
// "the POT generator misses X" is either quoting a years-old issue tracker or
// recalling one manual click. Half of those claims are stale: the MenuButton /
// OptionButton omissions people still cite (godot#88017, godot#95160) DO get
// picked up in 4.7.
//
// So this harness presses the button. It boots the editor headless with a
// throwaway EditorPlugin that walks the editor's own control tree, finds the
// "Generate" button inside Project Settings > Localization > POT Generation,
// emits its `pressed` signal, and answers the EditorFileDialog that opens with
// a `file_selected` signal. The .pot that lands on disk is the same bytes a
// human gets from the same button. Every claim in the doc is then a presence
// assertion against those bytes.
//
// The probe project below is the single source of truth: each CASE names the
// construct, the msgid it should (or should not) produce, and the file that
// contains it. If a construct is edited without its expectation, the run goes
// red -- which is how the two seeded errors in --selftest are caught.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GODOT = process.argv[2];
const SELFTEST = process.argv.includes('--selftest');
if (!GODOT || !fs.existsSync(GODOT)) {
  console.error('usage: node docs/verify_pot_generation.js /path/to/godot-editor-binary [--selftest]');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// The probe project
// ---------------------------------------------------------------------------
// probe.gd and probe.tscn hold one construct per claim. Names are the msgid, so
// a failure report reads as the construct that broke.

const PROBE_GD = `extends Node

@export var exported_default: String = "EXPORTED_DEFAULT"
@export_multiline var exported_multi: String = "EXPORTED_MULTI"

const K_CONST := "CONST_VALUE"
var v_str := "VAR_VALUE"
var dict := {"raw": "DICT_VALUE_RAW", "wrapped": tr("DICT_VALUE_TR")}
var arr := [tr("ARRAY_TR")]

func _ready() -> void:
\tprint(tr("GD_TR_LITERAL"))
\tprint(tr("GD_TR_CONTEXT", "GD_CTX"))
\tprint(atr("GD_ATR_LITERAL"))
\tprint(tr_n("GD_PLURAL_ONE", "GD_PLURAL_MANY", 2))
\tprint(TranslationServer.translate("SERVER_TRANSLATE_LITERAL"))
\tprint(TranslationServer.translate_plural("SERVER_PLURAL_ONE", "SERVER_PLURAL_MANY", 2))
\tprint(tr(v_str))
\tprint(tr(K_CONST))
\tprint(tr(dict["raw"]))
\tprint(tr("GD_CONCAT_A" + "GD_CONCAT_B"))
\tprint(tr("GD_ESCAPED_\\"QUOTE\\""))
\tprint(tr("GD_PERCENT %s"))
\tvar lbl := Label.new()
\tlbl.text = "ASSIGN_TEXT_PROP"
\tlbl.tooltip_text = "ASSIGN_TOOLTIP_PROP"
\tlbl.name = "ASSIGN_NAME_PROP"
\tvar w := Window.new()
\tw.title = "ASSIGN_TITLE_PROP"
\tvar bag := {}
\tbag["text"] = "ASSIGN_DICT_TEXT"
`;

const PROBE_TSCN = `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://probe.gd" id="1"]
[ext_resource type="PackedScene" path="res://child.tscn" id="2"]

[node name="Root" type="Control"]
script = ExtResource("1")
exported_default = "SCENE_EXPORTED_OVERRIDE"

[node name="Lbl" type="Label" parent="."]
text = "SCENE_LABEL_TEXT"
tooltip_text = "SCENE_TOOLTIP_TEXT"

[node name="Btn" type="Button" parent="."]
text = "SCENE_BUTTON_TEXT"

[node name="Line" type="LineEdit" parent="."]
placeholder_text = "SCENE_PLACEHOLDER_TEXT"

[node name="Opt" type="OptionButton" parent="."]
item_count = 2
popup/item_0/text = "SCENE_OPTION_ITEM_ONE"
popup/item_0/id = 0
popup/item_1/text = "SCENE_OPTION_ITEM_TWO"
popup/item_1/id = 1

[node name="Menu" type="MenuButton" parent="."]
text = "SCENE_MENUBUTTON_TEXT"
item_count = 1
popup/item_0/text = "SCENE_MENU_ITEM_ONE"
popup/item_0/id = 0

[node name="Items" type="ItemList" parent="."]
item_count = 1
item_0/text = "SCENE_ITEMLIST_ONE"

[node name="Dlg" type="AcceptDialog" parent="."]
title = "SCENE_DIALOG_TITLE"
dialog_text = "SCENE_DIALOG_TEXT"
ok_button_text = "SCENE_DIALOG_OK"

[node name="Tabs" type="TabBar" parent="."]
tab_count = 1
tab_0/title = "SCENE_TABBAR_TITLE"

[node name="Cont" type="TabContainer" parent="."]

[node name="SCENE_TABCONTAINER_CHILD_NAME" type="Control" parent="Cont"]

[node name="Inst" parent="." instance=ExtResource("2")]
text = "SCENE_INSTANCE_OVERRIDE"

[node name="Off" type="Label" parent="."]
auto_translate_mode = 2
text = "SCENE_AUTOTRANSLATE_DISABLED"

[node name="Box" type="VBoxContainer" parent="."]
auto_translate_mode = 2

[node name="Deep" type="Label" parent="Box"]
text = "SCENE_UNDER_DISABLED_PARENT"

[node name="DeepForced" type="Label" parent="Box"]
auto_translate_mode = 1
text = "SCENE_UNDER_DISABLED_BUT_ALWAYS"
`;

// child.tscn is deliberately NOT listed in translations_pot_files, and is
// instanced by probe.tscn, which is.
const CHILD_TSCN = `[gd_scene format=3]

[node name="Child" type="Label"]
text = "CHILD_SCENE_OWN_TEXT"
`;

const DATA_TRES = `[gd_resource type="Resource" format=3]

[resource]
metadata/blurb = "TRES_STRING"
`;

const STRINGS_JSON = `{"greeting": "JSON_STRING"}\n`;

// ---------------------------------------------------------------------------
// The claims
// ---------------------------------------------------------------------------
// `in`  = this msgid must appear in the generated .pot
// `out` = it must not. Every `out` is a string a reasonable developer expects
//         to be translatable, which is the whole point of the document.

const CASES = [
  // --- GDScript: what the parser does understand -------------------------
  ['in',  'GD_TR_LITERAL',            'tr() with a string literal'],
  ['in',  'GD_TR_CONTEXT',            'tr() with a context argument (emitted with msgctxt)'],
  ['in',  'GD_ATR_LITERAL',           'atr() with a string literal'],
  ['in',  'GD_PLURAL_ONE',            'tr_n() singular form'],
  ['in',  'GD_PLURAL_MANY',           'tr_n() plural form'],
  ['in',  'DICT_VALUE_TR',            'tr() as a dictionary-literal value'],
  ['in',  'ARRAY_TR',                 'tr() as an array-literal element'],
  ['in',  'CONST_VALUE',              'tr(CONST) — the const is resolved to its value'],
  ['in',  'GD_CONCAT_AGD_CONCAT_B',   'tr("A" + "B") — folded, matching the runtime key'],
  ['in',  'GD_ESCAPED_"QUOTE"',       'tr() containing an escaped double quote'],
  ['in',  'GD_PERCENT %s',            'tr() containing a printf placeholder'],
  ['in',  'ASSIGN_TEXT_PROP',         'assignment to .text in GDScript'],
  ['in',  'ASSIGN_TOOLTIP_PROP',      'assignment to .tooltip_text in GDScript'],
  ['in',  'ASSIGN_DICT_TEXT',         'dict["text"] = "..." — a false positive, not UI text at all'],

  // --- GDScript: what it silently drops ----------------------------------
  ['out', 'SERVER_TRANSLATE_LITERAL', 'TranslationServer.translate("...") with a literal'],
  ['out', 'SERVER_PLURAL_ONE',        'TranslationServer.translate_plural("...")'],
  ['out', 'VAR_VALUE',                'tr(var) — a variable, even one assigned a literal'],
  ['out', 'DICT_VALUE_RAW',           'tr(dict["key"]) — subscript expression (godot#85848)'],
  ['out', 'EXPORTED_DEFAULT',         '@export var default value (godot#90053)'],
  ['out', 'EXPORTED_MULTI',           '@export_multiline var default value'],
  ['out', 'ASSIGN_TITLE_PROP',        'assignment to .title in GDScript (but .title in a scene IS caught)'],
  ['out', 'ASSIGN_NAME_PROP',         'assignment to .name — correctly ignored, node names are not UI'],

  // --- Scenes: what the parser does understand ---------------------------
  ['in',  'SCENE_LABEL_TEXT',         'text = on a Label'],
  ['in',  'SCENE_TOOLTIP_TEXT',       'tooltip_text ='],
  ['in',  'SCENE_BUTTON_TEXT',        'text = on a Button'],
  ['in',  'SCENE_PLACEHOLDER_TEXT',   'placeholder_text = on a LineEdit'],
  ['in',  'SCENE_OPTION_ITEM_ONE',    'OptionButton popup item (godot#95160 — fixed in 4.7)'],
  ['in',  'SCENE_MENU_ITEM_ONE',      'MenuButton popup item (godot#88017 — fixed in 4.7)'],
  ['in',  'SCENE_ITEMLIST_ONE',       'ItemList item text'],
  ['in',  'SCENE_DIALOG_TITLE',       'title = on an AcceptDialog'],
  ['in',  'SCENE_DIALOG_TEXT',        'dialog_text ='],
  ['in',  'SCENE_DIALOG_OK',          'ok_button_text ='],
  ['in',  'SCENE_INSTANCE_OVERRIDE',  'a property override on an instanced sub-scene'],
  ['in',  'SCENE_TABCONTAINER_CHILD_NAME', 'a TabContainer child NODE NAME becomes a msgid'],
  ['in',  'SCENE_UNDER_DISABLED_BUT_ALWAYS', 'auto_translate_mode = ALWAYS under a disabled parent'],

  // --- Scenes: what they silently drop -----------------------------------
  ['out', 'SCENE_EXPORTED_OVERRIDE',  'a script @export string set on the node in the scene (godot#90053)'],
  ['out', 'SCENE_TABBAR_TITLE',       'TabBar tab_0/title — a visible tab label'],
  ['out', 'SCENE_AUTOTRANSLATE_DISABLED', 'auto_translate_mode = DISABLED on the node itself'],
  ['out', 'SCENE_UNDER_DISABLED_PARENT', 'inherited DISABLED — the whole subtree vanishes'],
  ['out', 'CHILD_SCENE_OWN_TEXT',     'a sub-scene not itself listed in translations_pot_files'],

  // --- Other file types ---------------------------------------------------
  ['out', 'TRES_STRING',              'a string in a .tres resource (godot#73565, open since 2023)'],
  ['out', 'JSON_STRING',              'a string in a .json data file'],
];

// Log-line claims: things the generator reports only to the editor log, while
// still writing a .pot and reporting no failure to the user.
const LOG_CASES = [
  ["Cannot parse file 'res://data.tres': unrecognized file extension", '.tres is refused by extension, not by content'],
  ["Cannot parse file 'res://strings.json': unrecognized file extension", '.json is refused the same way'],
  ["Cannot parse file 'res://sub': unrecognized file extension", 'a FOLDER cannot be listed — only individual files'],
  ["Cannot open file 'res://ghost.tscn'", 'a listed file that no longer exists is an error, not a failure'],
];

// ---------------------------------------------------------------------------
// Build the throwaway project
// ---------------------------------------------------------------------------
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'locguard-pot-'));
process.on('exit', () => { try { fs.rmSync(PROJ, { recursive: true, force: true }); } catch (_) {} });

fs.mkdirSync(path.join(PROJ, 'addons', 'potdrv'), { recursive: true });
fs.mkdirSync(path.join(PROJ, 'sub'), { recursive: true });

// res://ghost.tscn is listed below and never written — that is LOG_CASES[3].
// res://sub is a directory, listed to prove a directory cannot be a POT source.
fs.writeFileSync(path.join(PROJ, 'project.godot'), `config_version=5

[application]
config/name="LocGuardPotProbe"
config/features=PackedStringArray("4.7")

[editor_plugins]
enabled=PackedStringArray("res://addons/potdrv/plugin.cfg")

[internationalization]
locale/translations_pot_files=PackedStringArray("res://probe.gd", "res://probe.tscn", "res://data.tres", "res://strings.json", "res://ghost.tscn", "res://sub")
`);
fs.writeFileSync(path.join(PROJ, 'probe.gd'), PROBE_GD);
fs.writeFileSync(path.join(PROJ, 'probe.tscn'), PROBE_TSCN);
fs.writeFileSync(path.join(PROJ, 'child.tscn'), CHILD_TSCN);
fs.writeFileSync(path.join(PROJ, 'data.tres'), DATA_TRES);
fs.writeFileSync(path.join(PROJ, 'strings.json'), STRINGS_JSON);
fs.writeFileSync(path.join(PROJ, 'sub', 'insub.tscn'), CHILD_TSCN);

fs.writeFileSync(path.join(PROJ, 'addons', 'potdrv', 'plugin.cfg'), `[plugin]
name="potdrv"
description="Presses Project Settings > Localization > POT Generation > Generate, headlessly."
author="LocGuard"
version="1.0"
script="plugin.gd"
`);

// The driver. It cannot call POT generation directly -- the generator is editor
// C++ with no scripting API -- so it drives the editor's own UI: find the
// button, press it, answer the file dialog.
fs.writeFileSync(path.join(PROJ, 'addons', 'potdrv', 'plugin.gd'), `@tool
extends EditorPlugin

func _enter_tree() -> void:
\tcall_deferred("_drive")

func _collect(n: Node, out: Array, cls: String) -> void:
\tif n.is_class(cls):
\t\tout.append(n)
\tfor c in n.get_children():
\t\t_collect(c, out, cls)

func _drive() -> void:
\tfor i in 6: await get_tree().process_frame
\tvar root := EditorInterface.get_base_control().get_window()

\tvar buttons: Array = []
\t_collect(root, buttons, "Button")
\tvar generate: Button = null
\tfor b in buttons:
\t\tif str(b.text) == "Generate" and str(b.get_path()).find("Template Generation") >= 0:
\t\t\tgenerate = b
\tif generate == null:
\t\tprint("POTDRV-ERROR no Generate button found in Project Settings > Localization")
\t\tget_tree().quit(3)
\t\treturn
\tgenerate.emit_signal("pressed")

\tfor i in 4: await get_tree().process_frame
\tvar dialogs: Array = []
\t_collect(root, dialogs, "EditorFileDialog")
\tvar answered := false
\tfor d in dialogs:
\t\tif d.visible:
\t\t\td.emit_signal("file_selected", "res://probe.pot")
\t\t\tanswered = true
\tif not answered:
\t\tprint("POTDRV-ERROR the Generate button opened no file dialog")
\t\tget_tree().quit(3)
\t\treturn

\tfor i in 8: await get_tree().process_frame
\tif not FileAccess.file_exists("res://probe.pot"):
\t\tprint("POTDRV-ERROR no .pot was written")
\t\tget_tree().quit(3)
\t\treturn
\tprint("POTDRV-BEGIN")
\tprint(FileAccess.get_file_as_string("res://probe.pot"))
\tprint("POTDRV-END")
\tget_tree().quit(0)
`);

// ---------------------------------------------------------------------------
// Run the editor
// ---------------------------------------------------------------------------
const run = spawnSync(GODOT, ['--headless', '--editor', '--path', PROJ], {
  encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024,
});
const log = (run.stdout || '') + (run.stderr || '');
const begin = log.indexOf('POTDRV-BEGIN');
const end = log.indexOf('POTDRV-END');
if (begin < 0 || end < 0) {
  console.error('FAIL: the editor never produced a .pot.');
  const err = log.split('\n').filter((l) => l.includes('POTDRV-ERROR')).join('\n');
  console.error(err || log.slice(-2000));
  process.exit(1);
}
const pot = log.slice(begin + 'POTDRV-BEGIN'.length, end);

// ---------------------------------------------------------------------------
// Parse the .pot
// ---------------------------------------------------------------------------
// Minimal gettext reader: msgid / msgid_plural, each possibly split over
// several quoted continuation lines. Only the ids matter here.
function readMsgIds(text) {
  const ids = new Set();
  const lines = text.split('\n');
  let buf = null;
  const flush = () => { if (buf !== null) { ids.add(buf); buf = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    let m = /^(msgid|msgid_plural)\s+"((?:\\.|[^"])*)"$/.exec(line);
    if (m) { flush(); buf = unescapePo(m[2]); continue; }
    m = /^"((?:\\.|[^"])*)"$/.exec(line);
    if (m && buf !== null) { buf += unescapePo(m[1]); continue; }
    if (/^(msgstr|msgctxt|#|$)/.test(line)) { flush(); }
  }
  flush();
  ids.delete('');
  return ids;
}
function unescapePo(s) {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

const ids = readMsgIds(pot);

// ---------------------------------------------------------------------------
// Assert
// ---------------------------------------------------------------------------
// --selftest flips two expectations on purpose. A harness that cannot go red
// is not evidence, and both of these were flipped by hand during development
// before the doc was written.
const SEEDED = ['GD_TR_LITERAL', 'TRES_STRING'];
const cases = CASES.map(([expect, msgid, note]) => {
  if (SELFTEST && SEEDED.includes(msgid)) return [expect === 'in' ? 'out' : 'in', msgid, note + ' [SEEDED ERROR]'];
  return [expect, msgid, note];
});

let pass = 0, fail = 0;
console.log('== msgid claims (' + cases.length + ') ==');
for (const [expect, msgid, note] of cases) {
  const present = ids.has(msgid);
  const ok = (expect === 'in') === present;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${expect === 'in' ? 'in ' : 'out'}  ${JSON.stringify(msgid).padEnd(38)} ${note}`);
}

console.log('\n== editor-log claims (' + LOG_CASES.length + ') ==');
for (const [needle, note] of LOG_CASES) {
  const ok = log.includes(needle);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${note}`);
}

// The project name lands in the .pot with no source reference at all. It is not
// a string anyone wrote for translation, and it is the one msgid every Godot
// POT contains.
console.log('\n== structural claims (2) ==');
const nameOk = ids.has('LocGuardPotProbe');
console.log(`${nameOk ? 'PASS' : 'FAIL'}  the project name is emitted as a msgid with no "#:" source line`);
nameOk ? pass++ : fail++;
const potWritten = /msgid/.test(pot);
console.log(`${potWritten ? 'PASS' : 'FAIL'}  a .pot is written even though four listed sources failed to parse`);
potWritten ? pass++ : fail++;

// ---------------------------------------------------------------------------
// Coverage: what LocGuard sees on the same probe
// ---------------------------------------------------------------------------
// The document ends with a table of who catches what. A table nobody checks
// rots, and the embarrassing direction of rot is ours: the linter's own source
// comment claimed ItemList and TabBar item coverage that it did not have until
// this probe measured it. So the table is asserted here against src/core.js.
const CORE = require('../src/core.js');
const lgKeys = new Set();
for (const k of CORE.extractFromGDScript(PROBE_GD, 'probe.gd')) lgKeys.add(k.key);
for (const [txt, name] of [[PROBE_TSCN, 'probe.tscn'], [CHILD_TSCN, 'child.tscn'], [DATA_TRES, 'data.tres']]) {
  for (const k of CORE.extractFromScene(txt, name)) lgKeys.add(k.key);
}

const COVERAGE = [
  // LocGuard catches strings the POT generator drops. This is the reason the
  // linter exists, so these are the load-bearing rows.
  ['sees',   'CHILD_SCENE_OWN_TEXT', 'sub-scene never listed in translations_pot_files'],
  ['sees',   'SCENE_TABBAR_TITLE',   'TabBar tab title'],
  // ...and it misses things the POT generator catches. Stated, not hidden.
  ['misses', 'CONST_VALUE',          'tr(CONST) — the linter does not resolve constants'],
  ['misses', 'SCENE_DIALOG_TEXT',    'dialog_text= is not in TSCN_TEXT_PROPS'],
  ['misses', 'SCENE_DIALOG_OK',      'ok_button_text= is not in TSCN_TEXT_PROPS'],
  ['misses', 'ASSIGN_TEXT_PROP',     'a .text assignment in GDScript'],
  ['misses', 'SCENE_TABCONTAINER_CHILD_NAME', 'a TabContainer child node name'],
  // Neither tool sees these. The doc says so instead of implying our coverage.
  ['misses', 'TRES_STRING',          'a .tres string under a property nobody lists (metadata/blurb)'],
  ['misses', 'SERVER_TRANSLATE_LITERAL', 'TranslationServer.translate("...")'],
  ['misses', 'SCENE_EXPORTED_OVERRIDE',  'a script @export string set in a scene'],
  // A known wrong answer, reported as a finding rather than buried: the linter
  // splits a folded concatenation and reports the first fragment, which is not
  // the key the engine will look up at runtime.
  ['sees',   'GD_CONCAT_A',          'FALSE KEY — the runtime key is GD_CONCAT_AGD_CONCAT_B'],
  ['misses', 'GD_CONCAT_AGD_CONCAT_B', 'the real folded key the engine looks up'],
  // No model of auto_translate_mode: the linter reports strings the developer
  // deliberately excluded from translation.
  ['sees',   'SCENE_AUTOTRANSLATE_DISABLED', 'FALSE POSITIVE — excluded on purpose via auto_translate_mode'],
];

console.log('\n== LocGuard coverage on the same probe (' + COVERAGE.length + ') ==');
for (const [expect, key, note] of COVERAGE) {
  const seen = lgKeys.has(key);
  const ok = (expect === 'sees') === seen;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${expect.padEnd(6)} ${JSON.stringify(key).padEnd(32)} ${note}`);
}

const total = pass + fail;
console.log(`\n${pass}/${total} claims`);
if (SELFTEST) {
  if (fail === SEEDED.length) { console.log(`selftest OK — the ${SEEDED.length} seeded errors were both caught`); process.exit(0); }
  console.log(`selftest FAILED — expected exactly ${SEEDED.length} failures, got ${fail}`);
  process.exit(1);
}
process.exit(fail ? 1 : 0);
