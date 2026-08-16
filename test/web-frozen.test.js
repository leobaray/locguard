// Tests the SHIPPED /godot-locale-not-updating/ page, in a real browser, from
// the files that are on the site.
//
// The page makes a specific promise to a stranger: "this runs the same file,
// byte for byte, that the command-line scanner runs." Two things can make that
// a lie, and neither is visible to the CLI's own suite:
//
//   1. the copy of docs/frozen-scan-core.js under the page drifts from the
//      original, so the browser and CI disagree about what is frozen;
//   2. the page's own wiring (the language select, the verdict line, the S7
//      note, the rendered claim id) reports something the scanner did not say —
//      or drops something it did.
//
// So this loads the page in chromium, drives it like a visitor, and re-derives
// every rendered finding from the Node module as an independent judge. Stage 0
// is the byte-identity gate: if it goes red, nothing below is worth reading.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SCAN = require('../docs/frozen-scan-core.js');
const { chromium } = require('/sistemas/blobsmith/tools/node_modules/playwright');

const SITE = process.env.LG_SITE || '/sistemas/blobsmith/site/godot-locale-not-updating';
const PAGE = 'file://' + path.join(SITE, 'index.html');

let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

// The findings the page drew, read back off the DOM.
const readFindings = (page) => page.$$eval('#flist li', (lis) => lis.map((li) => {
  const spans = li.querySelectorAll('.why');
  return {
    rule: li.querySelector('.rule').textContent,
    message: li.querySelector('.msg').textContent,
    source: spans[0] ? spans[0].textContent : null,
    note: spans[1] ? spans[1].textContent : null,
  };
}));

const verdict = (page) => page.$eval('#verdict', (e) => ({ text: e.textContent, cls: e.className }));

(async () => {
  // --- stage 0: the scanner under the page IS the scanner the CLI runs
  const original = fs.readFileSync(path.join(__dirname, '../docs/frozen-scan-core.js'));
  const shipped = fs.readFileSync(path.join(SITE, 'frozen-scan-core.js'));
  assert(original.equals(shipped),
    `frozen-scan-core.js under the page has drifted from docs/frozen-scan-core.js ` +
    `(${original.length} vs ${shipped.length} bytes). Re-copy it: the page tells the reader they are the same file.`);
  ok(true, `served scanner is byte-identical to docs/frozen-scan-core.js (${original.length} bytes)`);

  // The CLI must be loading that same module, or "byte for byte" is true of a
  // file nobody runs.
  const cli = fs.readFileSync(path.join(__dirname, '../docs/find_frozen_translations.js'), 'utf8');
  ok(/require\('\.\/frozen-scan-core\.js'\)/.test(cli),
    'find_frozen_translations.js requires ./frozen-scan-core.js (the page claims the CLI runs this file)');
  ok(!/const propRe|const methodRe/.test(cli),
    'the CLI does not carry its own copy of the match rules — they live only in the shared core');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE);

  // --- the seeded GDScript example: every shape the page claims must appear
  await page.click('#demo');
  const gd = await page.$eval('#src', (e) => e.value);
  ok(gd.startsWith('extends Control'), 'the GDScript example is a Godot script');

  const judgeGd = SCAN.scanText(gd, '.gd', 'pasted');
  let drawn = await readFindings(page);
  ok(drawn.length === judgeGd.length,
    `page drew ${drawn.length} findings, the scanner says ${judgeGd.length}`);
  ok(judgeGd.length === 3, `the example carries exactly 3 frozen assignments (got ${judgeGd.length})`);

  // Every drawn finding re-derived from the module: line, claim id, sentence, source.
  judgeGd.forEach((f, i) => {
    ok(drawn[i].rule.includes('line ' + f.line),
      `finding ${i + 1} names line ${f.line} (drew "${drawn[i].rule}")`);
    ok(drawn[i].rule.includes(f.claim),
      `finding ${i + 1} carries claim id ${f.claim}, the id the doc and the CLI use`);
    ok(drawn[i].message === `${f.target} holds a translated value: ${SCAN.why(f)}`,
      `finding ${i + 1} says exactly what the terminal says for the same line`);
    ok(drawn[i].source === f.source, `finding ${i + 1} quotes the offending line verbatim`);
  });

  // The claim split the page teaches: a plain assignment is S3, a formatted one S6.
  const claims = judgeGd.map((f) => f.claim);
  ok(claims.filter((c) => c === 'S3').length === 2, 'two S3 (plain frozen assignment + the add_item)');
  ok(claims.filter((c) => c === 'S6').length === 1, 'one S6 (the % 7 format, which switching back cannot repair)');

  // The two lines the example includes precisely so they are NOT flagged.
  const flaggedLines = judgeGd.map((f) => f.source);
  ok(!flaggedLines.some((s) => s.includes('var greeting')),
    'a plain variable holding tr() is not flagged — the bug is storing it in an auto-translated property');
  ok(!flaggedLines.some((s) => s.includes('tooltip_text = "TIP_START"')),
    'storing the KEY in tooltip_text is the correct form and is not flagged');
  ok(flaggedLines.some((s) => s.includes('add_item')),
    'add_item(tr(...)) IS flagged — S8, items freeze the same way');

  let v = await verdict(page);
  ok(v.cls.includes('warn') && v.cls.includes('show'), 'verdict is shown and is the warning state');
  ok(v.text.includes('3 frozen translation'), `verdict counts 3 (got "${v.text}")`);
  ok(v.text.includes('label.text = "MENU_START"'), 'verdict states the fix, as the CLI does');

  // --- C#: the same defect in the other spelling
  await page.selectOption('#lang', '.cs');
  const cs = await page.$eval('#src', (e) => e.value);
  ok(cs.includes('public partial class'), 'switching to C# re-seeded the example as C#');

  const judgeCs = SCAN.scanText(cs, '.cs', 'pasted');
  drawn = await readFindings(page);
  ok(drawn.length === judgeCs.length, `C#: page drew ${drawn.length}, scanner says ${judgeCs.length}`);
  ok(judgeCs.length === 2, `the C# example carries exactly 2 frozen assignments (got ${judgeCs.length})`);
  ok(judgeCs.some((f) => /GetNode<Label>\("Title"\)\.Text/.test(f.target)),
    'the C# receiver GetNode<Label>("Title").Text is matched, not just the bare property');
  ok(!judgeCs.some((f) => f.source.includes('COMMENTED')),
    'a // comment in C# is stripped before matching — the commented Tr() is not a finding');
  judgeCs.forEach((f, i) => {
    ok(drawn[i].message === `${f.target} holds a translated value: ${SCAN.why(f)}`,
      `C# finding ${i + 1} says exactly what the terminal says`);
  });

  // --- the S7 note: the one case the scanner refuses to decide
  const s7 = [
    'extends Control',
    'var score := 0',
    'func _notification(what: int) -> void:',
    '\tif what == NOTIFICATION_TRANSLATION_CHANGED:',
    '\t\t_refresh()',
    'func _refresh() -> void:',
    '\t$Score.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED',
    '\t$Score.text = tr("SCORE_FMT") % score',
  ].join('\n');
  await page.selectOption('#lang', '.gd');
  await page.fill('#src', s7);
  await page.click('#scan');
  drawn = await readFindings(page);
  const judgeS7 = SCAN.scanText(s7, '.gd', 'pasted');
  ok(drawn.length === 1 && judgeS7.length === 1, 'the hand-managed file still produces the finding');
  ok(drawn[0].note && drawn[0].note.includes('AUTO_TRANSLATE_MODE_DISABLED'),
    'the page prints the S7 note under it — the scanner cannot tell which node this line refers to');
  ok(drawn[0].note.includes('(S7)'), 'the note points at the claim that decides it');

  // --- a clean file: the page must be able to say "nothing here"
  const clean = 'extends Control\n\nfunc _ready() -> void:\n\t$Title.text = "MENU_START"\n\t$Opt.add_item("OPT_ONE")\n';
  await page.fill('#src', clean);
  await page.click('#scan');
  ok(SCAN.scanText(clean, '.gd', 'pasted').length === 0, 'the correct form produces no findings in the module');
  drawn = await readFindings(page);
  ok(drawn.length === 0, 'and none are drawn');
  v = await verdict(page);
  ok(v.cls.includes('ok'), 'the clean verdict is the ok state');
  ok(/No frozen translations/i.test(v.text), `the clean verdict says so plainly (got "${v.text}")`);
  // The honest limit, stated on the page rather than implied by a green box.
  const body = await page.$eval('body', (e) => e.textContent);
  ok(/does not follow a value through a variable/.test(body),
    'the page states that var s := tr("K") then label.text = s is the same bug and is NOT reported');

  // --- empty input is a refusal, not a false green
  await page.fill('#src', '   \n  ');
  await page.click('#scan');
  v = await verdict(page);
  ok(v.cls.includes('bad'), 'empty input does not render as "no problems found"');

  // --- the page's outbound claims resolve to files that exist
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  ok(html.includes('href="/godot-translation-not-working/"'),
    'links the raw-key checklist — the other symptom, so a reader on the wrong page can leave');
  ok(html.includes('blobsmith.lbwma.com/godot-locale-not-updating/'),
    'canonical/og:url name this page');
  ok(html.includes('docs/frozen-scan-core.js'), 'points at the engine it claims to run');
  ok(html.includes('docs/locale-switch-does-not-update-ui.md'), 'points at the measured write-up');
  ok(html.includes('src="frozen-scan-core.js"'), 'loads the served engine, not an inline copy');
  ok(!/propRe|methodRe|const PROPS/.test(html.split('<script src=')[1] || ''),
    'the page carries no second copy of the match rules');

  ok(errors.length === 0, `no page errors (got: ${errors.join(' | ')})`);

  await browser.close();
  console.log(`web-frozen: ${n} assertions passed`);
})().catch((e) => { console.error('web-frozen FAILED:', e.message); process.exit(1); });
