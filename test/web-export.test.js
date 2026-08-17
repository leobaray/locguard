// Tests the SHIPPED /godot-translations-missing-in-export/ page, from the file
// that is on the site.
//
// This page differs from its neighbours: it does not run src/core.js, because
// the failure it explains is not in the translation table at all. It reads two
// Godot config files — export_presets.cfg and project.godot — and tells a
// stranger which of the measured causes their preset has. That makes the
// parser the whole product: a preset misread as safe is a page that says
// "nothing here drops your tables" to someone whose build ships in English.
//
// Stage 1 drives the real page in chromium the way a visitor does.
// Stage 2 pulls the shipped <script> out of the shipped HTML and exercises
// analyse() directly over the cases a visitor cannot be asked to reproduce:
// every export mode, both filter directions, and the config shapes that must
// NOT be flagged.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/sistemas/blobsmith/tools/node_modules/playwright');

const SITE = process.env.LG_SITE || '/sistemas/blobsmith/site/godot-translations-missing-in-export';
const PAGE = 'file://' + path.join(SITE, 'index.html');
const HTML = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');

let pass = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { console.log('  FAIL ' + name + (extra === undefined ? '' : ' — ' + JSON.stringify(extra))); process.exitCode = 1; throw new Error('failed: ' + name); }
}

// The claim ids printed on the page must exist in the harness that measured
// them, or the page is citing evidence that is not there.
function stage0() {
  console.log('# stage 0 — every claim id on the page exists in the verify script');
  const script = fs.readFileSync(path.join(__dirname, '..', 'docs', 'verify_export_translations.sh'), 'utf8');
  const ids = new Set((HTML.match(/\bE[1-7][a-e]\b/g) || []));
  assert(ids.size >= 15, 'expected the page to cite many claim ids, got ' + ids.size);
  const missing = [...ids].filter(id => !new RegExp('check ' + id + '\\b').test(script));
  ok(ids.size + ' cited claim ids are all asserted in verify_export_translations.sh', missing.length === 0, missing);
}

const DEMO_PROJ = [
  'config_version=5', '', '[internationalization]', '',
  'locale/translations=PackedStringArray("res://localization/strings.en.translation", "res://localization/strings.pt.translation")',
  'locale/fallback="en"', ''
].join('\n');

async function stage1() {
  console.log('# stage 1 — the page in a browser');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await page.goto(PAGE);

    // The example button is the path most visitors take first.
    await page.click('#demo');
    const verdict = (await page.textContent('#verdict')).trim();
    const rules = await page.$$eval('#findings li', els => els.map(e => e.getAttribute('data-sev') + ':' + e.querySelector('.rule').textContent));
    ok('the example yields a red verdict', (await page.getAttribute('#verdict', 'class')).includes('bad'), verdict);
    ok('the example names X1 (selective export)', rules.includes('error:X1'), rules);
    // The example project registers three locales, all inside localization/,
    // which the example's exclude_filter sweeps: one X2 per table.
    ok('the example names X2 once per table', rules.filter(r => r === 'error:X2').length === 3, rules);
    ok('the example calls the *.csv include filter a no-op', rules.includes('info:M3'), rules);
    ok('the example admits X3 is not checkable here', rules.includes('info:X3'), rules);

    // A correct preset must come out green, or the page cries wolf.
    await page.fill('#preset', '[preset.0]\n\nname="Windows Desktop"\nplatform="Windows Desktop"\nexport_filter="all_resources"\nexport_files=PackedStringArray()\ninclude_filter=""\nexclude_filter="*.csv"\n');
    await page.fill('#proj', DEMO_PROJ);
    await page.click('#check');
    const cls = await page.getAttribute('#verdict', 'class');
    const rules2 = await page.$$eval('#findings li', els => els.map(e => e.getAttribute('data-sev') + ':' + e.querySelector('.rule').textContent));
    ok('a correct preset is not reported as broken', !cls.includes('bad'), [cls, rules2]);
    ok('and it still carries the X3 caveat', rules2.includes('info:X3'), rules2);

    await page.click('#clear');
    ok('clear hides the verdict', !(await page.getAttribute('#verdict', 'class')).includes('show'));

    await page.click('#check');
    ok('checking with both boxes empty asks for input', (await page.textContent('#verdict')).indexOf('Paste at least one') === 0);

    ok('no page errors', errors.length === 0, errors);
  } finally {
    await browser.close();
  }
}

// Pull analyse() out of the shipped page: the test must judge the file that is
// served, not a copy kept next to the test.
function loadShipped() {
  const m = HTML.match(/<script>\n([\s\S]*?)<\/script>/);
  assert(m, 'no inline <script> found in the shipped page');
  const stub = { value: '', className: '', textContent: '', innerHTML: '', addEventListener() {} };
  const doc = { getElementById: () => Object.create(stub) };
  return new Function('document', 'return (function(){' + m[1] + '\nreturn {analyse:analyse};})()')(doc);
}

function stage2() {
  console.log('# stage 2 — analyse() over the shapes a visitor cannot be asked to reproduce');
  const { analyse } = loadShipped();
  const rulesOf = r => r.findings.map(f => f.rule + ':' + f.sev);
  const errs = r => r.findings.filter(f => f.sev === 'error');

  ok('both boxes empty returns nothing to say', analyse('', '') === null);

  ok('a preset section with no [preset.N] header is called out',
    rulesOf(analyse('export_filter="resources"\n', DEMO_PROJ)).includes('P0:warning'));

  // [preset.0.options] carries binary_format/* keys and no filters; parsing it
  // as another preset would invent a second, filterless preset.
  const twoSections = '[preset.0]\n\nname="L"\nexport_filter="all_resources"\nexclude_filter=""\n\n[preset.0.options]\n\nbinary_format/embed_pck=false\n';
  ok('the [preset.N.options] section is not counted as a preset',
    analyse(twoSections, DEMO_PROJ).presets.length === 1);

  // Selective export, both directions.
  const selective = files => '[preset.0]\nname="L"\nexport_filter="resources"\nexport_files=PackedStringArray(' + files + ')\ninclude_filter=""\nexclude_filter=""\n';
  ok('selective export that omits the tables is an error',
    errs(analyse(selective('"res://main.tscn"'), DEMO_PROJ)).some(f => f.rule === 'X1'));
  ok('selective export that ticks every table is clean',
    errs(analyse(selective('"res://main.tscn","res://localization/strings.en.translation","res://localization/strings.pt.translation"'), DEMO_PROJ)).length === 0);
  ok('the "customized" mode is judged like the selective one',
    errs(analyse('[preset.0]\nname="L"\nexport_filter="customized"\ncustomized_files=PackedStringArray("res://main.tscn")\n', DEMO_PROJ)).some(f => f.rule === 'X1'));
  ok('the "exclude" mode is inverted: listing a table is the error',
    errs(analyse('[preset.0]\nname="L"\nexport_filter="exclude"\nexport_files=PackedStringArray("res://localization/strings.pt.translation")\n', DEMO_PROJ)).some(f => f.rule === 'X1'));

  // Filters.
  const withExclude = pat => '[preset.0]\nname="L"\nexport_filter="all_resources"\nexclude_filter="' + pat + '"\n';
  ok('exclude_filter=*.translation is flagged once per table',
    analyse(withExclude('*.translation'), DEMO_PROJ).findings.filter(f => f.rule === 'X2').length === 2);
  ok('a folder pattern over the localization folder is flagged',
    analyse(withExclude('localization/*'), DEMO_PROJ).findings.filter(f => f.rule === 'X2').length === 2);
  ok('an unrelated folder pattern is not flagged',
    !rulesOf(analyse(withExclude('assets/raw/*'), DEMO_PROJ)).some(r => r.startsWith('X2')));
  ok('a comma-separated filter list is split',
    analyse(withExclude('*.png, *.translation , *.txt'), DEMO_PROJ).findings.filter(f => f.rule === 'X2').length === 2);
  ok('excluding the .csv is called harmless, not a cause',
    rulesOf(analyse(withExclude('*.csv'), DEMO_PROJ)).includes('M2:info'));

  // project.godot shapes.
  const okPreset = withExclude('');
  ok('no locale/translations key at all is A1',
    errs(analyse(okPreset, 'config_version=5\n\n[application]\nconfig/name="x"\n')).some(f => f.rule === 'A1'));
  ok('an empty PackedStringArray is A1 too',
    errs(analyse(okPreset, '[internationalization]\nlocale/translations=PackedStringArray()\n')).some(f => f.rule === 'A1'));
  ok('a .csv registered as a translation is a warning, not an error',
    analyse(okPreset, '[internationalization]\nlocale/translations=PackedStringArray("res://t.csv")\n')
      .findings.some(f => f.rule === 'S1' && f.sev === 'warning'));

  // Several presets: only the broken one is blamed.
  const multi = '[preset.0]\nname="Linux"\nexport_filter="resources"\nexport_files=PackedStringArray("res://main.tscn")\n\n[preset.1]\nname="Web"\nexport_filter="all_resources"\nexclude_filter=""\n';
  const r = analyse(multi, DEMO_PROJ);
  ok('two presets are parsed', r.presets.length === 2, r.presets.map(p => p.name));
  ok('only the broken preset produces the X1 error', errs(r).filter(f => f.rule === 'X1').length === 1, rulesOf(r));
  ok('the finding names the preset it belongs to', errs(r)[0].msg.indexOf('Linux') === 0, errs(r)[0].msg);

  // The X3 caveat has to state the number the reader should assert on.
  ok('the X3 note carries the expected locale count',
    analyse(okPreset, DEMO_PROJ).findings.find(f => f.rule === 'X3').why.indexOf('size() == 2') > -1);
}

(async () => {
  stage0();
  await stage1();
  stage2();
  console.log('\n' + pass + ' checks passed');
})().catch(e => { console.error(e.message); process.exit(1); });
