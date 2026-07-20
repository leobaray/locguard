'use strict';
const assert = require('assert');
const C = require('../src/core.js');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); passed++; };

// --- extraction: GDScript ---
const gd = `
extends Node
func _ready():
    var a = tr("MENU_START")
    $Label.text = tr('SCORE_FMT') % score
    push_warning(tr(&"HUD_LIVES"))
    var n = tr_n("APPLE_ONE", "APPLE_MANY", count)
    # tr("COMMENTED_OUT") should still parse (naive) — acceptable
`;
const gdKeys = C.extractFromGDScript(gd, 'main.gd').map((x) => x.key);
ok(gdKeys.includes('MENU_START'), 'tr double-quote');
ok(gdKeys.includes('SCORE_FMT'), 'tr single-quote');
ok(gdKeys.includes('HUD_LIVES'), 'tr StringName &"..."');
ok(gdKeys.includes('APPLE_ONE') && gdKeys.includes('APPLE_MANY'), 'tr_n both keys');

// --- extraction: scene (.tscn) — the props Godot's POT misses ---
const tscn = `
[node name="Btn" type="Button"]
text = "PLAY_LABEL"
tooltip_text = "PLAY_TIP"
[node name="Opt" type="OptionButton"]
items = ["OPT_EASY", null, false, 0, "OPT_HARD", null, false, 1]
`;
const scKeys = C.extractFromScene(tscn, 'ui.tscn').map((x) => x.key);
ok(scKeys.includes('PLAY_LABEL'), 'scene text prop');
ok(scKeys.includes('PLAY_TIP'), 'scene tooltip prop');
ok(scKeys.includes('OPT_EASY') && scKeys.includes('OPT_HARD'), 'OptionButton items (Godot POT misses these)');

// --- CSV parsing incl. quoted commas/newlines ---
const csv = 'keys,en,es\nMENU_START,Start,Comenzar\nSCORE_FMT,"Score: %d","Puntos: %d"\nWITH_COMMA,"a, b","x, y"\n';
const table = C.parseCsv(csv);
eq(table.locales, ['en', 'es'], 'csv locales');
eq(table.rows.get('WITH_COMMA').es, 'x, y', 'csv quoted comma');
eq(table.rows.get('SCORE_FMT').en, 'Score: %d', 'csv quoted value');

// --- PO parsing ---
const po = 'msgid ""\nmsgstr ""\n\nmsgid "MENU_START"\nmsgstr "Comenzar"\n\nmsgid "SCORE_FMT"\nmsgstr "Puntos: %d"\n';
const poT = C.parsePo(po);
eq(poT.entries.get('MENU_START'), 'Comenzar', 'po entry');
ok(!poT.entries.has(''), 'po header skipped');

// --- placeholders ---
eq(C.placeholders('Score: %d and {0} plus {name}'), { positional: ['{0}'], named: ['{name}'], printf: ['%d'] }, 'placeholder extraction');

// --- bbcode balance ---
eq(C.bbcodeImbalance('[b]hi[/b]'), [], 'balanced bbcode');
ok(C.bbcodeImbalance('[b]hi').length === 1, 'unclosed bbcode');
ok(C.bbcodeImbalance('[b]hi[/i]').length >= 1, 'mismatched bbcode');
eq(C.bbcodeImbalance('[color=red]x[/color]'), [], 'bbcode with attribute');

// --- lint: the whole engine on a seeded project ---
const project = {
  usedKeys: [
    { key: 'MENU_START', file: 'main.gd', line: 4 },
    { key: 'SCORE_FMT', file: 'main.gd', line: 5 },
    { key: 'MISSING_ONE', file: 'main.gd', line: 9 }, // not in table -> error
    { key: 'BROKEN\nKEY', file: 'main.gd', line: 12 }, // newline key -> error
  ],
  table: C.parseCsv(
    'keys,en,es\n' +
    'MENU_START,Start,Comenzar\n' +
    'SCORE_FMT,"Score: %d","Puntos: %s"\n' + // printf drift %d -> %s : error
    'TIP_BOLD,"[b]Hi[/b]","[b]Hola"\n' +      // bbcode imbalance in es : error (and orphan)
    'ORPHAN_KEY,Unused,SinUso\n' +            // orphan : warn
    'EMPTY_ES,Hello,\n'                       // empty es : warn (and orphan)
  ),
};
// TIP_BOLD / EMPTY_ES / ORPHAN_KEY aren't "used", so also orphan-flagged
const res = C.lint(project, { sourceLocale: 'en', overflowBudget: { es: 1.6 } });
const rules = res.findings.map((f) => f.rule);
ok(rules.includes('newline-key'), 'catches newline key');
ok(rules.includes('missing-key'), 'catches missing key');
ok(rules.includes('placeholder-printf'), 'catches printf drift');
ok(rules.includes('bbcode-imbalance'), 'catches bbcode imbalance');
ok(rules.includes('empty-translation'), 'catches empty translation');
ok(rules.includes('orphan-key'), 'catches orphan key');
ok(!res.ok, 'project with errors is not ok (CI exit non-zero)');
eq(res.counts.error >= 3, true, 'at least the 3+ seeded errors present');

// clean project must pass
const clean = {
  usedKeys: [{ key: 'A', file: 'x.gd', line: 1 }],
  table: C.parseCsv('keys,en,es\nA,Hi,Hola\n'),
};
ok(C.lint(clean, { sourceLocale: 'en' }).ok, 'clean project is ok');

console.log(`OK — ${passed} assertions passed`);
