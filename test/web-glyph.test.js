// Tests the SHIPPED /godot-missing-characters-in-translation/ page, in a real
// browser, from the files that are on the site.
//
// The page makes a specific promise to a stranger: "the scanner this page runs
// is byte for byte the file the command line uses", and it prints a number —
// 1010 codepoints — that came out of a measurement nobody visiting can repeat.
// Two things can quietly turn that into a lie:
//
//   1. the copy of docs/glyph-scan-core.js under the page drifts from the
//      original, so the browser and CI disagree about what the engine can draw;
//   2. the page's own wiring reports a character the scanner did not flag, or
//      drops one it did.
//
// So this loads the page in chromium, drives it like a visitor, and re-derives
// every rendered row from the Node module as an independent judge. Stage 0 is
// the byte-identity gate: if it goes red, nothing below is worth reading.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SCAN = require('../docs/glyph-scan-core.js');
const { chromium } = require('/sistemas/blobsmith/tools/node_modules/playwright');

const SITE = process.env.LG_SITE || '/sistemas/blobsmith/site/godot-missing-characters-in-translation';
const PAGE = 'file://' + path.join(SITE, 'index.html');

let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

const readRows = (page) => page.$$eval('#flist li', (lis) => lis.map((li) => ({
  locale: li.getAttribute('data-locale'),
  cp: Number(li.getAttribute('data-cp')),
  hex: li.querySelector('.rule').textContent,
  glyph: li.querySelector('.gl').textContent,
  msg: li.querySelector('.msg').textContent,
  advice: li.querySelector('.why').textContent,
})));

const readSummary = (page) => page.$$eval('#summary tr[data-locale]', (trs) => trs.map((tr) => {
  const td = tr.querySelectorAll('td');
  return { locale: tr.getAttribute('data-locale'), cells: Number(td[1].textContent), flagged: Number(td[2].textContent), blocks: td[3].textContent };
}));

(async () => {
  // -- stage 0: the promise on the page ------------------------------------
  const shipped = fs.readFileSync(path.join(SITE, 'glyph-scan-core.js'));
  const original = fs.readFileSync(path.join(__dirname, '..', 'docs', 'glyph-scan-core.js'));
  assert(shipped.equals(original),
    'the copy of glyph-scan-core.js served under the page is NOT byte-identical to docs/glyph-scan-core.js — ' +
    'the page claims it is. Re-copy it before anything else in this file means anything.');
  n++;

  // The number the page prints in prose has to be the number in the data.
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  ok(SCAN.COVERAGE.count === 1010, 'the measured coverage is still 1010 codepoints');
  ok(SCAN.COVERAGE.ranges.length === 92, 'the measured coverage is still 92 ranges');
  ok(html.includes('1010 codepoints'), 'the page prose states the coverage count it scans against');
  ok(html.includes('35 passed / 0 failed'), 'the page states the verification result it is derived from');
  ok(html.includes('verify_font_glyphs.sh'), 'the page names the script that produced the number');

  // -- the coverage table itself, against the engine's answer --------------
  // Spot the claims the page renders as a table. These are the same codepoints
  // verify_font_glyphs.gd asserts against Godot; here they gate the shipped data.
  const COVERED = [0x41, 0xE9, 0xE3, 0xE7, 0x142, 0x161, 0x11F, 0x1EA1, 0x416, 0x3B1, 0x5D0,
    0x2014, 0x2026, 0x2022, 0x201C, 0x2019, 0x20AC];
  const MISSING = [0x628, 0x4F60, 0x6211, 0x3042, 0x30A2, 0xAC00, 0xE01, 0x915, 0x1F600,
    0x2190, 0x2191, 0x2192, 0x2193, 0x2713, 0x2605, 0x2665, 0x266A];
  for (const cp of COVERED) ok(SCAN.isCovered(cp), 'U+' + cp.toString(16) + ' is covered, as the page table says');
  for (const cp of MISSING) ok(!SCAN.isCovered(cp), 'U+' + cp.toString(16) + ' is NOT covered, as the page table says');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });

  // -- stage 1: the translated-game example --------------------------------
  await page.click('#ex1');
  await page.waitForSelector('#findings.show');
  const csv1 = await page.$eval('#csv', (el) => el.value);
  const expect1 = SCAN.scan(csv1);
  const rows1 = await readRows(page);
  const expectedRows1 = [];
  expect1.locales.forEach((l) => l.chars.forEach((c) => expectedRows1.push({ locale: l.locale, cp: c.cp, hex: c.hex, glyph: c.char, block: c.block, advice: c.advice, count: c.count })));

  ok(rows1.length === expectedRows1.length,
    'the page drew one row per flagged character (' + rows1.length + ' vs ' + expectedRows1.length + ')');
  for (let i = 0; i < expectedRows1.length; i++) {
    const e = expectedRows1[i], a = rows1[i];
    ok(a.locale === e.locale && a.cp === e.cp, 'row ' + i + ' is ' + e.locale + '/' + e.hex);
    ok(a.hex === e.hex, 'row ' + i + ' prints the codepoint the scanner reported');
    ok(a.glyph === e.glyph, 'row ' + i + ' prints the character itself');
    ok(a.msg.includes(e.block) && a.msg.includes(String(e.count)), 'row ' + i + ' names the block and the count');
    ok(a.advice === e.advice, 'row ' + i + ' carries the scanner advice verbatim');
  }

  // The en column of a fully translated game must still be clean here...
  const sum1 = await readSummary(page);
  ok(sum1.length === expect1.locales.length, 'the summary has one line per locale column');
  for (const l of expect1.locales) {
    const s = sum1.find((x) => x.locale === l.locale);
    ok(s && s.flagged === l.flagged, 'summary for ' + l.locale + ' reports ' + l.flagged);
    ok(s && s.cells === l.cells, 'summary for ' + l.locale + ' counts ' + l.cells + ' non-empty cells');
  }
  ok(expect1.locales.find((l) => l.locale === 'zh').flagged > 0, 'the zh column of example 1 is flagged');
  ok(expect1.locales.find((l) => l.locale === 'ja').flagged > 0, 'the ja column of example 1 is flagged');

  // -- stage 2: the English-only UI ----------------------------------------
  // The point of the page: a project with no translation at all still ships
  // characters the engine cannot draw.
  await page.click('#ex2');
  await page.waitForSelector('#findings.show');
  const csv2 = await page.$eval('#csv', (el) => el.value);
  const expect2 = SCAN.scan(csv2);
  const rows2 = await readRows(page);
  ok(expect2.locales.length === 1 && expect2.locales[0].locale === 'en',
    'example 2 is a single English column');
  const cps2 = rows2.map((r) => r.cp);
  ok(cps2.includes(0x2192), 'the arrow U+2192 is flagged in an all-English table');
  ok(cps2.includes(0x2713), 'the check mark U+2713 is flagged in an all-English table');
  ok(cps2.includes(0x2605), 'the star U+2605 is flagged in an all-English table');
  ok(!cps2.includes(0x2014), 'the em dash U+2014 is NOT flagged — the rule is not "non-ASCII"');
  ok(!cps2.includes(0x20AC), 'the euro sign U+20AC is NOT flagged — the rule is not "non-ASCII"');
  ok(rows2.length === expect2.totalFlagged, 'every flagged character in example 2 reached the DOM');

  // -- stage 3: the clean table has to say so -------------------------------
  await page.fill('#csv', 'keys,en,pt\nMENU_START,Start,Iniciar\nMENU_QUIT,Quit,Sair\n');
  await page.click('#run');
  await page.waitForSelector('#verdict.show');
  const verdictText = await page.$eval('#verdict', (el) => el.textContent);
  const verdictClass = await page.$eval('#verdict', (el) => el.className);
  ok(verdictClass.includes('ok'), 'a table inside the built-in font gets the ok verdict');
  ok(verdictText.includes('1010'), 'the ok verdict states what "inside" means');
  ok((await readRows(page)).length === 0, 'a clean table draws no rows');
  ok(!(await page.$eval('#findings', (el) => el.className)).includes('show'), 'the findings list is hidden for a clean table');

  // -- stage 4: nothing is uploaded ----------------------------------------
  ok(!/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(html),
    'the page makes no network call — it claims nothing is uploaded');
  ok(errors.length === 0, 'no uncaught page errors: ' + errors.join(' | '));

  await browser.close();
  console.log('web-glyph: ' + n + ' assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
