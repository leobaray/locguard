#!/usr/bin/env node
// Finds the defect docs/locale-switch-does-not-update-ui.md is about: a translated
// VALUE stored where Godot expects a KEY, so the node stops following the locale.
//
//   node docs/find_frozen_translations.js /path/to/your/godot/project
//   node docs/find_frozen_translations.js /path/to/project --json
//
// Zero dependencies, reads only .gd and .cs files, writes nothing. This is a
// standalone reader tool, NOT part of the LocGuard rule set — the linter's rules
// all work from the translation table, and this one works from your source.
//
// The matching itself lives in ./frozen-scan-core.js, which has no filesystem in
// it so the identical bytes also run in the browser, on the page that offers this
// scanner to people without a terminal:
// https://blobsmith.lbwma.com/godot-locale-not-updating/
// This file is the part that a web page cannot have: walking a directory.
'use strict';
const fs = require('fs');
const path = require('path');
const SCAN = require('./frozen-scan-core.js');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git' || name === '.godot' || name === 'node_modules' || name === 'addons') continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (['.gd', '.cs'].includes(path.extname(name))) out.push(full);
  }
  return out;
}

function scanFile(full, rel) {
  return SCAN.scanText(fs.readFileSync(full, 'utf8'), path.extname(full), rel);
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const dir = argv.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.log('usage: node find_frozen_translations.js <godot-project-dir> [--json]');
    process.exit(2);
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`not a directory: ${dir}`);
    process.exit(2);
  }

  const files = walk(dir);
  const findings = [];
  for (const f of files) findings.push(...scanFile(f, path.relative(dir, f)));

  if (json) {
    console.log(JSON.stringify({ project: dir, scannedFiles: files.length, findings }, null, 2));
    process.exit(findings.length ? 1 : 0);
  }

  if (!findings.length) {
    console.log(`✔ no frozen translations: ${files.length} .gd/.cs file(s) scanned, no tr() result stored in an auto-translated property.`);
    process.exit(0);
  }
  for (const f of findings) {
    console.log(`▲ [frozen-translation] ${f.file}:${f.line} — ${f.target} holds a translated value: ${SCAN.why(f)}`);
    console.log(`    ${f.source}`);
    if (f.manual) {
      console.log('    note: this file mentions AUTO_TRANSLATE_MODE_DISABLED or NOTIFICATION_TRANSLATION_CHANGED —');
      console.log('          if THIS node is the one being handled by hand, the line is correct (S7).');
    }
  }
  console.log(`\n${findings.length} frozen translation(s) in ${files.length} file(s) scanned.`);
  console.log('Fix: store the key and let the node translate — label.text = "MENU_START" (S2b).');
  process.exit(1);
}

main();
