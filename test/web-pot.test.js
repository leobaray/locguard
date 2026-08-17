// Tests the SHIPPED /godot-generate-pot-missing-strings/ page, in a real
// browser, from the files that are on the site.
//
// The page makes two promises to a stranger, and the stranger has no way to
// check either one:
//
//   1. "this runs src/core.js, the same file the CLI runs, byte for byte" —
//      false the moment the copy under the page drifts, and invisible to the
//      CLI's own suite, which never looks at the site;
//   2. "these are the strings your project uses that your .pot does not
//      contain" — a claim about YOUR file, so a wiring bug (wrong extractor for
//      the file type, a key silently dropped, a missing key rendered as
//      present) reads as a clean bill of health.
//
// So this loads the page in chromium, drives it like a visitor, and re-derives
// every rendered line from the Node module as an independent judge. Stage 0 is
// the byte-identity gate: if it goes red, nothing below is worth reading.
//
// The page also carries six "blind spot" hints, which are NOT engine findings —
// they are the constructs the doc measured as invisible to the extractor, and
// they exist so a clean result cannot be read as "the template is complete".
// Those are page-local rules, so the test asserts them by construction: one
// pasted file per hint, each expected to appear exactly when its construct is
// present and the file type matches.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CORE = require('../src/core.js');
const { chromium } = require('/sistemas/blobsmith/tools/node_modules/playwright');

const SITE = process.env.LG_SITE || '/sistemas/blobsmith/site/godot-generate-pot-missing-strings';
const PAGE = 'file://' + path.join(SITE, 'index.html');

let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

// What the page drew, read back off the DOM.
const readFindings = (page) => page.$$eval('#flist li', (lis) => lis.map((li) => ({
  sev: li.getAttribute('data-sev'),
  rule: li.querySelector('.rule').textContent,
  msg: li.querySelector('.msg').textContent,
  why: li.querySelector('.why') ? li.querySelector('.why').textContent : null,
})));

const verdict = (page) => page.$eval('#verdict', (e) => ({ text: e.textContent, cls: e.className }));

const run = async (page, { pot, src, kind }) => {
  await page.selectOption('#kind', kind);
  await page.fill('#pot', pot);
  await page.fill('#src', src);
  await page.click('#check');
  return { findings: await readFindings(page), v: await verdict(page) };
};

// The judge: which keys does the engine pull out of this file, and which of
// them is the pasted .pot missing? Computed here from the Node module, never
// read off the page.
const judge = (src, kind, pot) => {
  const ex = kind === '.gd' ? CORE.extractFromGDScript(src, 'x' + kind)
    : kind === '.cs' ? CORE.extractFromCSharp(src, 'x' + kind)
      : CORE.extractFromScene(src, 'x' + kind);
  const keys = [];
  const seen = new Set();
  for (const k of ex) { if (!seen.has(k.key)) { seen.add(k.key); keys.push(k); } }
  const entries = CORE.parsePo(pot).entries;
  return { keys, missing: keys.filter((k) => !entries.has(k.key)) };
};

const POT = [
  'msgid ""', 'msgstr ""', '"Content-Type: text/plain; charset=UTF-8\\n"', '',
  '#: scenes/menu.tscn', 'msgid "MENU_TITLE"', 'msgstr ""', '',
  '#: scenes/menu.tscn', 'msgid "MENU_START"', 'msgstr ""', '',
].join('\n');

(async () => {
  // --- stage 0: the engine under the page IS the engine the CLI runs
  const original = fs.readFileSync(path.join(__dirname, '../src/core.js'));
  const shipped = fs.readFileSync(path.join(SITE, 'locguard-core.js'));
  assert(original.equals(shipped),
    `locguard-core.js under the page has drifted from src/core.js ` +
    `(${original.length} vs ${shipped.length} bytes). Re-copy it: the page tells the reader they are the same file.`);
  ok(true, `served engine is byte-identical to src/core.js (${original.length} bytes)`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(PAGE);

  // --- the example the page ships must demonstrate the defect it claims
  await page.click('#demo');
  let v = await verdict(page);
  let f = await readFindings(page);
  const demoSrc = await page.$eval('#src', (e) => e.value);
  const demoPot = await page.$eval('#pot', (e) => e.value);
  let j = judge(demoSrc, '.tscn', demoPot);
  ok(j.missing.length > 0, 'the shipped example is a file whose .pot is genuinely incomplete');
  const drawnMissing = f.filter((x) => x.sev === 'error').map((x) => x.msg);
  ok(JSON.stringify(drawnMissing.slice().sort()) === JSON.stringify(j.missing.map((k) => k.key).sort()),
    `the drawn missing keys are exactly the engine's (drew ${JSON.stringify(drawnMissing)}, engine says ${JSON.stringify(j.missing.map((k) => k.key))})`);
  ok(v.cls.includes('bad'), 'a template with holes in it does not render as an ok verdict');
  ok(v.text.includes(String(j.missing.length)) && v.text.includes(String(j.keys.length)),
    `the verdict counts both numbers the reader needs (got "${v.text}")`);
  ok(drawnMissing.includes('SCENE_TABBAR_TITLE'),
    'the example surfaces the TabBar title — the measured omission this page exists for');
  ok(f.every((x) => x.sev !== 'error' || /line \d+/.test(x.rule)),
    'every missing-string finding carries the line it was used on');

  // --- a .pot that has everything: clean, but never claims completeness
  const fullPot = POT + '\nmsgid "MENU_START_TIP"\nmsgstr ""\n\nmsgid "SCENE_TABBAR_TITLE"\nmsgstr ""\n';
  ({ findings: f, v } = await run(page, { pot: fullPot, src: demoSrc, kind: '.tscn' }));
  j = judge(demoSrc, '.tscn', fullPot);
  ok(j.missing.length === 0, 'the judge agrees the full template covers the example');
  ok(f.filter((x) => x.sev === 'error').length === 0, 'a complete template draws no missing-string findings');
  ok(v.cls.includes('ok'), 'the complete case is the ok state');
  ok(/\.tres|@export|TranslationServer/.test(v.text),
    `the clean verdict names what it did NOT check instead of implying completeness (got "${v.text}")`);

  // --- the file type drives which extractor runs. A scene parsed as GDScript
  //     silently finds nothing, which would render as "all present".
  const gd = 'extends Node\n\nfunc _ready() -> void:\n\tprint(tr("MENU_TITLE"))\n\tprint(tr("HUD_SCORE"))\n';
  ({ findings: f, v } = await run(page, { pot: POT, src: gd, kind: '.gd' }));
  j = judge(gd, '.gd', POT);
  ok(j.keys.length === 2 && j.missing.length === 1, 'judge: the GDScript file uses 2 keys, 1 of them missing');
  ok(f.filter((x) => x.sev === 'error').map((x) => x.msg).join() === 'HUD_SCORE',
    'the GDScript extractor ran and named exactly the key the template lacks');

  // The same file under the wrong selector must NOT come out looking clean:
  // zero extracted keys is the shape a false green would take.
  ({ findings: f, v } = await run(page, { pot: POT, src: gd, kind: '.tscn' }));
  const asScene = judge(gd, '.tscn', POT);
  ok(asScene.keys.length === 0, 'a .gd read as a scene yields no keys — which is why the selector exists');
  ok(f.filter((x) => x.sev === 'error').length === 0 && !v.cls.includes('ok'),
    'the wrong extractor finds nothing and the page refuses to call that a pass');

  const cs = 'using Godot;\npublic partial class Hud : Control {\n  public override void _Ready() {\n    GD.Print(Tr("MENU_TITLE"));\n    GD.Print(Tr("CS_ONLY_KEY"));\n  }\n}\n';
  ({ findings: f } = await run(page, { pot: POT, src: cs, kind: '.cs' }));
  ok(f.filter((x) => x.sev === 'error').map((x) => x.msg).join() === 'CS_ONLY_KEY',
    'the C# extractor runs on .cs and finds Tr() literals');

  // --- a file with no translatable string is not a green light
  ({ findings: f, v } = await run(page, { pot: POT, src: 'extends Node\n\nfunc _ready() -> void:\n\tpass\n', kind: '.gd' }));
  ok(!v.cls.includes('ok'), 'a file the extractor finds nothing in does not render as "all present"');
  ok(/\.tres|@export|runtime/.test(v.text), `the empty-extraction verdict explains itself (got "${v.text}")`);

  // --- blind spots: present exactly when the construct is, per file type
  const BLIND_CASES = [
    ['server-translate', '.gd', 'extends Node\nfunc _ready():\n\tprint(TranslationServer.translate("SINGLETON_KEY"))\n', true],
    ['server-translate', '.gd', 'extends Node\nfunc _ready():\n\tprint(tr("MENU_TITLE"))\n', false],
    ['dynamic-key', '.gd', 'extends Node\nconst K := "X"\nfunc _ready():\n\tprint(tr(K))\n', true],
    ['folded-concat', '.gd', 'extends Node\nfunc _ready():\n\tprint(tr("GD_CONCAT_A" + "GD_CONCAT_B"))\n', true],
    ['export-string', '.gd', 'extends Node\n@export var blurb := "HELLO"\n', true],
    ['autotranslate-off', '.tscn', '[node name="Root" type="Control"]\nauto_translate_mode = 2\ntext = "MENU_TITLE"\n', true],
    ['dialog-props', '.tscn', '[node name="D" type="AcceptDialog"]\ndialog_text = "ARE_YOU_SURE"\n', true],
    ['autotranslate-off', '.tscn', '[node name="Root" type="Control"]\ntext = "MENU_TITLE"\n', false],
  ];
  for (const [id, kind, src, expected] of BLIND_CASES) {
    ({ findings: f } = await run(page, { pot: POT, src, kind }));
    const hit = f.some((x) => x.sev === 'info' && x.rule.includes(id));
    ok(hit === expected, `blind-spot ${id} ${expected ? 'fires' : 'stays quiet'} on ${JSON.stringify(src.slice(0, 48))}`);
  }
  // A blind spot belongs to its file type: a scene rule must not fire on a script.
  ({ findings: f } = await run(page, { pot: POT, src: 'extends Node\nvar d = {"dialog_text": 1}\nfunc _ready():\n\tprint(tr("MENU_TITLE"))\n', kind: '.gd' }));
  ok(!f.some((x) => x.rule.includes('dialog-props')), 'a .tscn-only blind spot does not fire on a .gd file');

  // The most expensive case in the write-up: a localization singleton means the
  // template is empty and the checker CANNOT say so from findings alone.
  ({ findings: f, v } = await run(page, {
    pot: POT,
    src: 'extends Node\nfunc t(k: String) -> String:\n\treturn TranslationServer.translate("SINGLETON_KEY")\n',
    kind: '.gd',
  }));
  ok(f.some((x) => x.sev === 'info' && /TranslationServer/.test(x.msg)),
    'the singleton case is stated as a blind spot rather than passing silently');
  ok(!v.cls.includes('ok'), 'a file whose only keys are invisible does not get an ok verdict');

  // --- refusals: neither box may be assumed
  await page.fill('#pot', '');
  await page.fill('#src', gd);
  await page.click('#check');
  v = await verdict(page);
  ok(v.cls.includes('bad'), 'a missing .pot is refused, not treated as an empty template where everything looks absent');
  ok(/paste/i.test(v.text), 'the refusal says what to do');
  await page.fill('#pot', POT);
  await page.fill('#src', '   \n  ');
  await page.click('#check');
  v = await verdict(page);
  ok(v.cls.includes('bad'), 'an empty source box is refused');

  // --- the page's outbound claims resolve to things that exist
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  ok(html.includes('src="locguard-core.js"'), 'loads the served engine, not an inline copy');
  ok(html.includes('blobsmith.lbwma.com/godot-generate-pot-missing-strings/'), 'canonical/og:url name this page');
  ok(html.includes('docs/pot-generation-what-it-misses.md'), 'points at the measured write-up');
  ok(html.includes('blob/master/src/core.js'), 'points at the engine it claims to run, on the branch that exists');
  ok(html.includes('href="/godot-translation-not-working/"') && html.includes('href="/godot-locale-not-updating/"'),
    'links both neighbouring symptoms, so a reader on the wrong page can leave');
  ok(html.includes('https://blobsmith.itch.io/locguard'), 'the product is named on the page the traffic lands on');
  ok(!/extractFromScene\s*\(/.test(html.split('<script src=')[1].split('function extract')[1].split('function blindSpots')[0].replace(/CORE\.\w+/g, '')),
    'the page carries no second copy of the extraction rules — it only calls CORE');
  ok(/61\/61 claims/.test(html), 'the page states the claim count the harness prints');

  ok(errors.length === 0, `no page errors (got: ${errors.join(' | ')})`);

  await browser.close();
  console.log(`web-pot: ${n} assertions passed`);
})().catch((e) => { console.error('web-pot FAILED:', e.message); process.exit(1); });
