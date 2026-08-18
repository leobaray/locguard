// What docs/scan_project_glyphs.js promises a stranger with a Godot project and
// no translation table: "point this at your project and it lists the text you
// ship that the engine cannot draw on its own — and nothing else."
//
// Two halves of that promise can break independently:
//
//   1. recall — a string the player sees that the extractor never looked at
//      (the multi-line Label is the case a line-by-line regex silently loses);
//   2. precision — a `res://` path, a node path, a comment or a debug print
//      reported as if it were on screen. Noise is what makes a report ignorable,
//      so the "not reported" assertions below matter as much as the others.
//
// The fixtures here are seeded, but they are not invented: every shape is one
// that turned up in godotengine/godot-demo-projects when the scanner was run
// over its 1028 scene and script files (see the CORPUS stage at the end, which
// re-runs that measurement when the corpus is on disk).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('../docs/glyph-scan-core.js');
const CORE = require('../src/core.js');

let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const CLI = path.join(__dirname, '..', 'docs', 'scan_project_glyphs.js');

const cps = (r) => r.locales[0].chars.map((c) => c.cp);
const seen = (r) => r.strings.map((s) => s.value);

// --- stage 0: the two extractors are not allowed to drift -------------------
// src/core.js extracts scene text for the linter; this scanner extracts scene
// text for the font check. They are separate distributables on purpose (the
// page ships one file, the CLI ships the other), so the only thing keeping them
// honest is this assertion: every property the linter treats as player-visible
// must also be one this scanner reads.
{
  const linterProps = ['text', 'title', 'tooltip_text', 'placeholder_text', 'hint_tooltip', 'window_title'];
  for (const p of linterProps) {
    ok(S.UI_TEXT_PROPS.includes(p), 'the glyph scanner reads "' + p + '", which the linter treats as UI text');
  }
  const scene = '[gd_scene format=3]\n[node name="B" type="Button"]\ntext = "Play"\ntooltip_text = "Start the game"\nitem_0/text = "Easy"\n';
  const mine = S.extractSceneStrings(scene).map((s) => s.value);
  for (const k of CORE.extractFromScene(scene, 'x.tscn').map((e) => e.key)) {
    ok(mine.includes(k), 'a string the linter extracts ("' + k + '") is also read by the glyph scanner');
  }
}

// --- stage 1: scenes, including the value that spans lines ------------------
{
  const scene = [
    '[gd_scene load_steps=2 format=3 uid="uid://cx8v2n"]',
    '[ext_resource type="Texture2D" path="res://art/arrow→.png" id="1"]',
    '[node name="Next" type="Button" parent="."]',
    'text = "Continue → Next"',
    'tooltip_text = "Saved ✓"',
    'placeholder_text = "type here…"',
    'script = ExtResource("1")',
    '[node name="Choice" type="OptionButton"]',
    'popup/item_0/text = "Easy ★"',
    'item_1/text = "Hard"',
    'tab_0/title = "Stats ♪"',
    '[node name="Blurb" type="Label"]',
    'text = "First line',
    'second line',
    'third line ↔"',
    'horizontal_alignment = 1',
  ].join('\n');
  const r = S.scanAny(scene, { name: 'hud.tscn' });
  ok(r.mode === 'source' && r.kind === 'scene', 'a .tscn is read as a scene, not as a CSV');

  const values = seen(r);
  ok(values.includes('Continue → Next'), 'a text property is read');
  ok(values.includes('Saved ✓'), 'a tooltip_text property is read');
  ok(values.includes('type here…'), 'a placeholder_text property is read');
  ok(values.includes('Easy ★'), 'an OptionButton popup item is read');
  ok(values.includes('Stats ♪'), 'a TabBar tab title is read');
  ok(values.includes('First line\nsecond line\nthird line ↔'),
    'a value that spans lines is read to its closing quote, not to the end of the first line');
  ok(!values.some((v) => v.includes('res://')), 'a res:// path is not a string the player reads');
  ok(!values.some((v) => v.includes('uid://')), 'a uid:// reference is not a string the player reads');
  ok(!values.some((v) => v.indexOf('ExtResource') === 0), 'a script assignment is not player-visible text');

  const found = cps(r);
  ok(found.includes(0x2192), 'U+2192 in a Button label is reported');
  ok(found.includes(0x2713), 'U+2713 in a tooltip is reported');
  ok(found.includes(0x2605), 'U+2605 in a dropdown item is reported');
  ok(found.includes(0x266A), 'U+266A in a tab title is reported');
  ok(found.includes(0x2194), 'U+2194 on the third line of a multi-line label is reported');
  ok(!found.includes(0x2026), 'U+2026 (…) is NOT reported — the built-in font has it');
  const arrow = r.locales[0].chars.find((c) => c.cp === 0x2192);
  ok(arrow.line === 4 && arrow.prop === 'text', 'the arrow is reported at its line and property');
  ok(arrow.keys[0] === 'line 4 (text)', 'the place is printed as line + property');
  const wide = r.locales[0].chars.find((c) => c.cp === 0x2194);
  ok(wide.line === 13, 'the multi-line value is reported at the line the property starts on');
  ok(r.locales[0].locale === 'scene strings', 'the group is named after what was read');
}

// --- stage 2: GDScript, where the string is assigned, not authored ----------
{
  const gd = [
    'extends Control',
    '# TODO: replace the → placeholder art  ✓',
    'const SAVE_PATH := "user://save✓.cfg"',
    'var hint := "unused ★"',
    'func _ready() -> void:',
    '\t$Label.text = "Score → %d" % score',
    '\t$Panel/Tip.tooltip_text = "Autosaved ✓"',
    '\tprint("debug: reached ✓ checkpoint")',
    '\t%Menu.add_item("New game ★")',
    '\tget_node("Path/To/♥Node").show()',
    '\t$Title.text = tr("MENU_HEADER ♪")',
    '\tlabel.text += " ↔"',
  ].join('\n');
  const r = S.scanAny(gd, { name: 'menu.gd' });
  ok(r.kind === 'gdscript', 'a .gd file is read as GDScript');
  const values = seen(r);
  ok(values.includes('Score → %d'), 'an assignment to .text is read');
  ok(values.includes('Autosaved ✓'), 'an assignment to .tooltip_text is read');
  ok(values.includes('New game ★'), 'add_item() is read');
  ok(values.includes('MENU_HEADER ♪'), 'the key inside tr() is read — untranslated, it is what gets drawn');
  ok(values.includes(' ↔'), 'a += onto .text is read');
  ok(!values.some((v) => v.includes('TODO')), 'a comment is not shipped to a player');
  ok(!values.some((v) => v.includes('user://')), 'a user:// path is not player-visible text');
  ok(!values.includes('unused ★'), 'a bare var initialiser is not assumed to reach the screen');
  ok(!values.some((v) => v.indexOf('debug:') === 0), 'print() is not the screen');
  ok(!values.some((v) => v.includes('Path/To/')), 'a node path is not player-visible text');
  const found = cps(r);
  ok(found.includes(0x2192) && found.includes(0x2713) && found.includes(0x2605) &&
    found.includes(0x266A) && found.includes(0x2194), 'every drawn character is reported');
  ok(r.totalFlagged === 5, 'and nothing else is: exactly 5 distinct characters (' +
    r.locales[0].chars.map((c) => c.hex).join(',') + ')');
}

// --- stage 3: C# says the same things with different spelling ---------------
{
  const cs = [
    'using Godot;',
    'public partial class Hud : Control {',
    '    // arrow → in a comment',
    '    public override void _Ready() {',
    '        GetNode<Label>("Score").Text = "Score → 0";',
    '        _menu.AddItem("New game ★");',
    '        GD.Print("debug ✓");',
    '    }',
    '}',
  ].join('\n');
  const r = S.scanAny(cs, { name: 'Hud.cs' });
  ok(r.kind === 'csharp', 'a .cs file is read as C#');
  const values = seen(r);
  ok(values.includes('Score → 0'), 'an assignment to .Text is read');
  ok(values.includes('New game ★'), 'AddItem() is read');
  ok(!values.some((v) => v.includes('comment')), 'a // comment is not shipped to a player');
  ok(!values.some((v) => v.indexOf('debug') === 0), 'GD.Print() is not the screen');
  ok(cps(r).length === 2, 'two characters reported, from the two drawn strings');
}

// --- stage 4: the two answers that are not "bundle a font" ------------------
{
  const ctrl = S.scanAny('[gd_scene format=3]\ntext = "Broken\\u0010string"\n', { name: 'a.tscn' });
  const c = ctrl.locales[0].chars[0];
  ok(c.cp === 0x10 && c.block === 'Control character', 'a stray control byte is named as one, not as Latin');
  ok(/delete it/.test(c.advice), 'and the advice is to delete it, not to bundle a font');
  ok(!/covered by the built-in font/.test(c.advice),
    'the advice never contradicts the fact that the character was flagged');

  const pua = S.scanAny('[gd_scene format=3]\ntext = "\\uE804 Settings"\n', { name: 'a.tscn' });
  const p = pua.locales[0].chars[0];
  ok(p.block === 'Private Use Area', 'an icon-font codepoint is named as Private Use');
  ok(/icon-font/.test(p.advice), 'and the advice says what makes it fine or not');
}

// --- stage 5: the clean project has to say so, and the CSV path is untouched -
{
  const clean = S.scanAny('[gd_scene format=3]\ntext = "Play"\ntooltip_text = "Start"\n', { name: 'a.tscn' });
  ok(clean.totalFlagged === 0, 'an ASCII scene is clean');
  ok(/inside the 1010 codepoints/.test(S.verdict(clean)), 'and the verdict says what "inside" means');
  const nothing = S.scanAny('[gd_scene format=3]\nposition = Vector2(0, 0)\n', { name: 'a.tscn' });
  ok(nothing.rowsRead === 0 && /nothing here is drawn/.test(S.verdict(nothing)),
    'a scene with no visible text says so instead of pretending it passed a check');

  const csv = 'keys,en,zh\nMENU_START,Start,开始\nHUD,"Continue →","继续"\n';
  const viaAny = S.scanAny(csv, { name: 'translations.csv' });
  const direct = S.scan(csv);
  ok(viaAny.kind === 'csv' && viaAny.mode === 'csv', 'a .csv still goes to the table scanner');
  ok(JSON.stringify(viaAny.locales) === JSON.stringify(direct.locales),
    'and comes back with exactly what scan() returned before this file existed');
  ok(S.detectKind('', '[gd_scene format=3]\n') === 'scene', 'pasted text with no filename is recognised by shape');
  ok(S.detectKind('', 'extends Node\nfunc _ready():\n\tpass\n') === 'gdscript', 'pasted GDScript is recognised by shape');
  ok(S.detectKind('', 'keys,en\nA,B\n') === 'csv', 'pasted CSV is recognised by shape');
}

// --- stage 6: the CLI, which is what a stranger actually runs ---------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glyphproj-'));
  fs.mkdirSync(path.join(dir, 'ui'));
  fs.mkdirSync(path.join(dir, '.godot'));
  fs.writeFileSync(path.join(dir, 'project.godot'), 'config_version=5\n');
  fs.writeFileSync(path.join(dir, 'ui', 'hud.tscn'), '[gd_scene format=3]\ntext = "Continue → Next"\n');
  fs.writeFileSync(path.join(dir, 'ui', 'menu.gd'), 'extends Control\nfunc _ready():\n\t$L.text = "Saved ✓"\n');
  fs.writeFileSync(path.join(dir, '.godot', 'cache.tscn'), '[gd_scene format=3]\ntext = "ignored ★"\n');

  let out = '', code = 0;
  try { out = execFileSync('node', [CLI, dir], { encoding: 'utf8' }); }
  catch (e) { out = e.stdout; code = e.status; }
  ok(code === 1, 'the CLI exits 1 when the project ships a character the engine cannot draw');
  ok(out.includes('hud.tscn') && out.includes('U+2192'), 'it names the file and the codepoint');
  ok(out.includes('menu.gd') && out.includes('U+2713'), 'it reads scripts as well as scenes');
  ok(!out.includes('ignored'), 'it does not walk into .godot/, which is a build cache');
  ok(out.includes('1010'), 'it states the coverage it is measuring against');

  // --json still exits 1 when it found something, so the output comes back on
  // the error object; a run that exits 0 here would mean the finding was lost.
  let jraw = '', jcode = 0;
  try { jraw = execFileSync('node', [CLI, path.join(dir, 'ui', 'hud.tscn'), '--json'], { encoding: 'utf8' }); }
  catch (e) { jraw = e.stdout; jcode = e.status; }
  ok(jcode === 1, '--json keeps the exit code, so it works as a CI gate');
  const json = JSON.parse(jraw);
  ok(json.totalFlagged === 1 && json.files[0].chars[0].hex === 'U+2192', '--json carries the same finding');
  ok(json.files[0].chars[0].line === 2, '--json carries the line number');
  ok(json.coveredCodepoints === S.COVERAGE.count, '--json states the coverage it used');

  fs.writeFileSync(path.join(dir, 'ui', 'hud.tscn'), '[gd_scene format=3]\ntext = "Continue"\n');
  fs.writeFileSync(path.join(dir, 'ui', 'menu.gd'), 'extends Control\n');
  const cleanOut = execFileSync('node', [CLI, dir], { encoding: 'utf8' });
  ok(/Every one of them is inside the built-in font/.test(cleanOut), 'a clean project gets a clean answer');

  let usage = 0;
  try { execFileSync('node', [CLI], { encoding: 'utf8', stdio: 'pipe' }); }
  catch (e) { usage = e.status; }
  ok(usage === 2, 'no argument is a usage error (exit 2), not a pass');
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- stage 7: the measurement against a project that is not ours ------------
// Everything above is a fixture we wrote, so it can only prove the scanner does
// what we already believed. This stage runs it over godotengine/godot-demo-projects
// — 1028 scene and script files nobody here wrote — and pins the result. Run:
//   curl -sSL -o /tmp/d.tar.gz https://codeload.github.com/godotengine/godot-demo-projects/tar.gz/34fc99545fc41520a958248f607101e7d0b95b05
//   mkdir -p /tmp/gdemos && tar xzf /tmp/d.tar.gz -C /tmp/gdemos --wildcards '*.tscn' '*.gd' '*.cs' '*.tres'
//   LG_CORPUS=/tmp/gdemos node test/project-glyph.test.js
const CORPUS = process.env.LG_CORPUS;
if (CORPUS && fs.existsSync(CORPUS)) {
  let raw = '';
  try { raw = execFileSync('node', [CLI, CORPUS, '--json'], { encoding: 'utf8', maxBuffer: 1 << 28 }); }
  catch (e) { raw = e.stdout; }
  const j = JSON.parse(raw);
  ok(j.filesRead >= 1000, 'the corpus run read ' + j.filesRead + ' files nobody here wrote');
  ok(j.stringsRead >= 1700, 'and found ' + j.stringsRead + ' strings a player can see');
  const flaggedFiles = j.files.map((f) => f.file.split('godot-demo-projects-master/').pop()).sort();
  assert.deepStrictEqual(flaggedFiles, [
    '2d/physics_platformer/tileset_edit.tscn',
    '3d/labels_and_texts/3d_labels_and_texts.tscn',
    'gui/bidi_and_font_features/bidi.tscn',
    'gui/ui_mirroring/ui_mirroring.tscn',
    'loading/runtime_save_load/runtime_save_load.tscn',
  ], 'exactly these five files are reported out of ' + j.filesRead);
  n++;
  // Recall, independently derived: walk every byte of every file, not just the
  // strings the extractor chose, and demand that every uncovered codepoint is
  // either inside something we reported or inside something no player sees.
  const walk = (d, o = []) => {
    for (const name of fs.readdirSync(d)) {
      const f = path.join(d, name);
      const st = fs.lstatSync(f);
      if (st.isDirectory()) walk(f, o);
      else if (/\.(tscn|tres|gd|cs)$/.test(name)) o.push(f);
    }
    return o;
  };
  const reported = new Set(j.files.map((f) => f.file));
  const unexplained = [];
  for (const f of walk(CORPUS)) {
    if (reported.has(f)) continue;
    const t = fs.readFileSync(f, 'utf8');
    for (const ch of t) {
      const cp = ch.codePointAt(0);
      if (cp > 127 && !S.isCovered(cp)) { unexplained.push(f + ' ' + ch); break; }
    }
  }
  // The single survivor is real and correctly silent: os_test.gd passes 你好 to
  // OS.get_system_font_path_for_text() — an argument to a font-probing API, not
  // a string on screen. It is the same API claim S3 of the doc is about.
  ok(unexplained.length === 1 && /os_test\.gd/.test(unexplained[0]),
    'every uncovered codepoint in the corpus is either reported or provably not drawn (' +
    unexplained.join(', ') + ')');
  console.log('project-glyph: corpus stage ran over ' + j.filesRead + ' third-party files');
}

console.log('project-glyph: ' + n + ' assertions passed');
