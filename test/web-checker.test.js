// Tests the SHIPPED /godot-translation-not-working/ page, in a real browser,
// from the files that are on the site.
//
// The page's claim to a stranger is specific: "this runs LocGuard's engine — the
// same file, byte for byte, that the command line runs." Two things can make
// that a lie, and neither is visible to the CLI's own suite:
//
//   1. the copy of src/core.js under the page drifts from the original, so the
//      browser and CI disagree about what is broken;
//   2. the page's own wiring (the table-only rules, the orphan-key filter, the
//      source-locale select, the verdict line) reports something the engine did
//      not say — or drops something it did.
//
// So this loads the page in chromium, drives it like a visitor, and re-derives
// every rendered finding from the Node engine as an independent judge. Stage 0
// is the byte-identity gate: if it goes red, nothing below is worth reading.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CORE = require('../src/core.js');
const { chromium } = require('/sistemas/blobsmith/tools/node_modules/playwright');

const SITE = process.env.LG_SITE || '/sistemas/blobsmith/site/godot-translation-not-working';
const PAGE = 'file://' + path.join(SITE, 'index.html');

let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

// The findings the page drew, read back off the DOM.
const readFindings = (page) => page.$$eval('#flist li', (lis) => lis.map((li) => ({
  severity: li.getAttribute('data-sev'),
  rule: li.querySelector('.rule').textContent.replace(/^[✖▲]\s*/, ''),
  message: li.querySelector('.msg').textContent,
})));

const verdict = (page) => page.$eval('#verdict', (e) => ({ text: e.textContent, cls: e.className }));

// What the shipped engine says about a table with no project attached — the
// page's contract, expressed in Node. orphan-key is excluded because with no
// used keys every key is an orphan.
function engineFindings(csv, source, overflow) {
  const table = CORE.parseCsv(csv);
  const opts = { sourceLocale: source || table.locales[0] };
  if (overflow) {
    opts.overflowBudget = {};
    table.locales.forEach((l) => { if (l !== opts.sourceLocale) opts.overflowBudget[l] = 1.6; });
  }
  return CORE.lint({ usedKeys: [], table }, opts).findings.filter((f) => f.rule !== 'orphan-key');
}

(async () => {
  // --- stage 0: the engine under the page IS the engine the CLI runs
  const original = fs.readFileSync(path.join(__dirname, '../src/core.js'));
  const shipped = fs.readFileSync(path.join(SITE, 'locguard-core.js'));
  ok(original.equals(shipped),
    `locguard-core.js under the page has drifted from src/core.js (${original.length} vs ${shipped.length} bytes). ` +
    'Re-copy it: the page tells the reader they are the same file.');
  n--; // counted below with a message the reader sees
  ok(true, `served engine is byte-identical to src/core.js (${original.length} bytes)`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE);

  // --- the seeded example: every trap the page claims to catch must appear
  await page.click('#demo');
  const csv = await page.$eval('#csv', (e) => e.value);
  ok(csv.split('\n')[0].startsWith('keys,'), 'the example is a Godot translation CSV (keys header)');

  const table = CORE.parseCsv(csv);
  ok(table.locales.join(',') === 'en,es,de', `example declares en,es,de (got ${table.locales.join(',')})`);

  const source = await page.$eval('#source', (e) => e.value);
  ok(source === 'en', `source locale defaulted to the first column, en (got ${source})`);
  const options = await page.$$eval('#source option', (os) => os.map((o) => o.value));
  ok(options.join(',') === 'en,es,de', 'the source select was populated from the header the visitor pasted');

  let drawn = await readFindings(page);

  // Every trap the page's own coverage table promises, by rule id.
  for (const rule of ['duplicate-key', 'key-padding', 'key-escape-n',
                      'empty-translation', 'placeholder-printf', 'placeholder-index',
                      'placeholder-named', 'bbcode-imbalance']) {
    ok(drawn.some((f) => f.rule === rule), `the example produces a ${rule} finding`);
  }

  // Each table-only rule names the key it is about, and that key really has the
  // defect in the CSV the visitor is looking at.
  const keyOf = (msg) => { const m = /"((?:\\.|[^"])*)"/.exec(msg); return m ? JSON.parse(`"${m[1]}"`) : null; };

  const padded = drawn.filter((f) => f.rule === 'key-padding');
  ok(padded.length === 1, `exactly one key-padding finding (got ${padded.length})`);
  ok(keyOf(padded[0].message) !== keyOf(padded[0].message).trim(),
    'the key-padding finding names a key that really has padding');
  ok(table.rows.has(keyOf(padded[0].message)), 'that padded key really is in the parsed table');

  const escn = drawn.filter((f) => f.rule === 'key-escape-n');
  ok(escn.length === 1, `exactly one key-escape-n finding (got ${escn.length})`);
  ok(keyOf(escn[0].message).includes('\\n') && !keyOf(escn[0].message).includes('\n'),
    'the key-escape-n finding names a key holding a literal backslash-n, not a newline — the C4a asymmetry');

  const dup = drawn.filter((f) => f.rule === 'duplicate-key');
  ok(dup.length === 1, `exactly one duplicate-key finding (got ${dup.length})`);
  const dupKey = keyOf(dup[0].message);
  const rowsWithKey = csv.split('\n').filter((l) => l.split(',')[0] === dupKey).length;
  ok(rowsWithKey === 2, `${JSON.stringify(dupKey)} really appears in 2 rows of the CSV (counted ${rowsWithKey})`);
  ok(table.rows.size < csv.trim().split('\n').length - 1,
    'the parse really did drop a row — which is the defect being reported');

  // --- the page reports exactly what the engine reports, no more, no less
  const compare = (drawnList, expected, label) => {
    const fromCore = expected.filter((f) => !['duplicate-key', 'key-padding', 'key-escape-n', 'newline-key', 'no-locales'].includes(f.rule));
    const drawnCore = drawnList.filter((f) => !['duplicate-key', 'key-padding', 'key-escape-n', 'newline-key', 'no-locales'].includes(f.rule));
    ok(drawnCore.length === fromCore.length,
      `${label}: page drew ${drawnCore.length} engine findings, engine produced ${fromCore.length}`);
    for (const f of fromCore) {
      const hit = drawnCore.find((d) => d.rule === f.rule && d.message === f.message);
      ok(!!hit, `${label}: page drew the engine's ${f.rule} verbatim — ${f.message.slice(0, 60)}`);
      ok(hit.severity === f.severity, `${label}: ${f.rule} kept severity ${f.severity}`);
    }
    ok(!drawnCore.some((d) => d.rule === 'orphan-key'),
      `${label}: no orphan-key noise (there is no project, so every key would be one)`);
  };
  compare(drawn, engineFindings(csv, 'en', false), 'source=en');

  // --- the overflow budget is opt-in, and turning it on changes the answer
  const before = drawn.filter((f) => f.rule === 'overflow').length;
  ok(before === 0, 'overflow is off by default — no overflow findings unasked');
  await page.check('#overflow');
  drawn = await readFindings(page);
  ok(drawn.some((f) => f.rule === 'overflow'), 'ticking the box surfaces the over-long translation');
  compare(drawn, engineFindings(csv, 'en', true), 'source=en +overflow');
  await page.uncheck('#overflow');

  // --- switching the source locale re-runs against the new source
  await page.selectOption('#source', 'es');
  drawn = await readFindings(page);
  compare(drawn, engineFindings(csv, 'es', false), 'source=es');
  ok(drawn.some((f) => f.rule === 'empty-translation' && f.message.includes('Empty en')) ||
     drawn.some((f) => f.message.includes(' en ')),
    'with es as the source, the findings are about the other locales, not es');
  await page.selectOption('#source', 'en');

  // --- a clean table gets a clean verdict, and the verdict says what a clean
  //     table does NOT prove — the whole point of sections A and C
  const CLEAN = 'keys,en,es\nMENU_START,Start,Comenzar\nMENU_QUIT,Quit,Salir\n';
  await page.fill('#csv', CLEAN);
  await page.click('#check');
  drawn = await readFindings(page);
  ok(drawn.length === 0, `a clean table produces no findings (got ${drawn.length}: ${drawn.map((f) => f.rule).join(',')})`);
  ok(engineFindings(CLEAN, 'en', false).length === 0, 'and the engine agrees the clean table is clean');
  let v = verdict(page) && await verdict(page);
  ok(v.cls.includes('ok'), 'clean table gets the ok verdict style');
  ok(/2 keys/.test(v.text), `the verdict counts the keys it read (got: ${v.text})`);
  ok(/sections A and C|no table can answer/.test(v.text),
    'a clean verdict still tells the reader what a table cannot answer — otherwise it reads as "your game is fine"');

  // --- garbage in: the page must not claim a clean bill of health
  await page.fill('#csv', 'this is not a csv');
  await page.click('#check');
  v = await verdict(page);
  ok(v.cls.includes('bad'), 'a file with no rows is not reported as clean');
  ok(/No rows read/.test(v.text), `and it says why (got: ${v.text})`);

  // --- a header with no locale columns
  await page.fill('#csv', 'keys\nMENU_START\n');
  await page.click('#check');
  drawn = await readFindings(page);
  ok(drawn.some((f) => f.rule === 'no-locales'), 'a header with no locale column is reported, not silently accepted');

  // --- a key with a REAL newline (quoted multi-line CSV field) — core's own rule
  const NL = 'keys,en,es\n"LINE\nBREAK",Two lines,Dos lineas\nMENU_START,Start,Comenzar\n';
  await page.fill('#csv', NL);
  await page.click('#check');
  drawn = await readFindings(page);
  ok(drawn.some((f) => f.rule === 'newline-key'), 'a key holding a real newline is an error (R4)');

  ok(errors.length === 0, `no uncaught JS errors in the page (${errors.join(' | ')})`);

  await browser.close();
  console.log(`web-checker: ${n} asserts passed`);
})().catch((e) => { console.error(e); process.exit(1); });
