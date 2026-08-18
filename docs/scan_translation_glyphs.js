#!/usr/bin/env node
// Reports which characters in your Godot translation tables are outside the
// 1010 codepoints the engine's built-in font can draw — i.e. the ones that are
// currently being rendered with a font borrowed from whatever machine the game
// is running on, and that are not in your export.
//
//   node docs/scan_translation_glyphs.js path/to/translations.csv
//   node docs/scan_translation_glyphs.js path/to/godot/project
//   node docs/scan_translation_glyphs.js path/to/project --json
//
// Exit 0 when everything is inside the built-in font, 1 when something is not.
// Zero dependencies, reads only .csv files, writes nothing. This is a standalone
// reader tool, NOT part of the LocGuard rule set: the linter's rules all answer
// "is this table complete and consistent", and this one answers "can the engine
// draw it", which is a different question with a different fix (bundle a font).
//
// The coverage table and the matching live in ./glyph-scan-core.js, which has no
// filesystem in it so the identical bytes also run in the browser, on the page
// that offers this scanner to people without a terminal:
// https://blobsmith.lbwma.com/godot-missing-characters-in-translation/
// The measurement behind the table is docs/verify_font_glyphs.sh (35 claims).
'use strict';
const fs = require('fs');
const path = require('path');
const SCAN = require('./glyph-scan-core.js');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git' || name === '.godot' || name === 'node_modules') continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.csv$/i.test(name)) out.push(full);
  }
  return out;
}

function main(argv) {
  const asJson = argv.includes('--json');
  const targets = argv.filter((a) => !a.startsWith('--'));
  if (!targets.length) {
    console.error('usage: node scan_translation_glyphs.js <file.csv|project-dir> [--json]');
    return 2;
  }

  const files = [];
  for (const t of targets) {
    let st;
    try { st = fs.statSync(t); } catch (e) { console.error('cannot read ' + t); return 2; }
    if (st.isDirectory()) files.push(...walk(t));
    else files.push(t);
  }
  if (!files.length) {
    console.error('no .csv translation table found under ' + targets.join(', '));
    return 2;
  }

  const report = [];
  let flagged = 0;
  for (const f of files) {
    const result = SCAN.scan(fs.readFileSync(f, 'utf8'));
    flagged += result.totalFlagged || 0;
    report.push({ file: f, result });
  }

  if (asJson) {
    console.log(JSON.stringify({
      engine: SCAN.COVERAGE.engine,
      font: SCAN.COVERAGE.font,
      coveredCodepoints: SCAN.COVERAGE.count,
      totalFlagged: flagged,
      files: report.map(({ file, result }) => ({
        file,
        mode: result.mode,
        rows: result.rowsRead,
        locales: result.locales.map((l) => ({
          locale: l.locale, flagged: l.flagged, blocks: l.blocks,
          chars: l.chars.map((c) => ({ hex: c.hex, char: c.char, block: c.block, count: c.count, keys: c.keys, advice: c.advice })),
        })),
      })),
    }, null, 2));
    return flagged ? 1 : 0;
  }

  console.log('engine ' + SCAN.COVERAGE.engine + ' — built-in font ' + SCAN.COVERAGE.font +
    ' draws ' + SCAN.COVERAGE.count + ' codepoints');
  for (const { file, result } of report) {
    console.log('');
    console.log(file + '  (' + result.rowsRead + ' rows)');
    if (!result.totalFlagged) { console.log('  all inside the built-in font'); continue; }
    for (const l of result.locales) {
      if (!l.flagged) { console.log('  [' + l.locale + '] all inside the built-in font'); continue; }
      console.log('  [' + l.locale + '] ' + l.flagged + ' characters the built-in font cannot draw — ' + l.blocks.join(', '));
      for (const c of l.chars.slice(0, 12)) {
        const where = c.keys.length ? '  in ' + c.keys.join(', ') + (c.count > c.keys.length ? ' (+more)' : '') : '';
        console.log('      ' + c.hex.padEnd(8) + JSON.stringify(c.char).padEnd(10) + c.block + ' ×' + c.count + where);
      }
      if (l.chars.length > 12) console.log('      ... and ' + (l.chars.length - 12) + ' more');
      for (const a of [...new Set(l.chars.map((c) => c.advice))]) console.log('      → ' + a);
    }
  }
  console.log('');
  console.log(SCAN.verdict({ mode: 'csv', totalFlagged: flagged, locales: report.flatMap((r) => r.result.locales) }));
  return flagged ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
