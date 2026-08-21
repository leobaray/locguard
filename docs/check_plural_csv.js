#!/usr/bin/env node
// Finds the defects docs/plural-forms-always-show-the-same-string.md is about:
// a Godot 4 translation CSV whose plural forms do not survive the importer.
//
//   node docs/check_plural_csv.js /path/to/your/godot/project
//   node docs/check_plural_csv.js translations.csv --json   # exit 1 on findings
//
// Zero dependencies, reads only .csv, writes nothing. Like the frozen-translation
// and glyph scanners this is a standalone reader tool, NOT part of the LocGuard
// rule set: the linter's rules all answer "is this key translated", and these
// answer "will the plural forms in this table reach the engine at all".
//
// The matching itself lives in ./plural-scan-core.js, which has no filesystem in
// it so the identical bytes can also run in a browser. This file is the part a
// web page cannot have: walking a directory.
'use strict';
const fs = require('fs');
const path = require('path');
const SCAN = require('./plural-scan-core.js');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git' || name === '.godot' || name === 'node_modules') continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (path.extname(name).toLowerCase() === '.csv') out.push(full);
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const target = argv.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error('usage: node docs/check_plural_csv.js <project-dir|file.csv> [--json]');
    process.exit(2);
  }
  let st;
  try { st = fs.statSync(target); } catch {
    console.error('not found: ' + target);
    process.exit(2);
  }

  const files = st.isDirectory() ? walk(target) : [target];
  const findings = [];
  let scanned = 0;
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const rel = st.isDirectory() ? path.relative(target, f) : path.basename(f);
    const res = SCAN.scanCsv(text, { file: rel });
    // A CSV that is not a translation table has no locale columns we recognise;
    // saying nothing about it is the point, not a gap.
    if (!res.locales.some((l) => SCAN.nplurals(l))) continue;
    scanned++;
    findings.push(...res.findings);
  }

  if (json) {
    console.log(JSON.stringify({ scanned, findings }, null, 2));
  } else if (!scanned) {
    console.log('No Godot translation CSV found in ' + target + '.');
  } else if (!findings.length) {
    console.log('✔ ' + scanned + ' translation CSV file(s): no plural defect readable from the table.');
    console.log('  This does not mean the plurals work — whether the game calls tr_n() at all,');
    console.log('  and with which key, is a question about your source, not about this table.');
  } else {
    for (const f of findings) {
      console.log('✖ [' + f.rule + '] ' + f.file + ':' + f.line + ' — ' + f.message);
    }
    console.log('\n' + findings.length + ' finding(s) in ' + scanned + ' translation CSV file(s).');
  }
  process.exit(findings.length ? 1 : 0);
}

main();
