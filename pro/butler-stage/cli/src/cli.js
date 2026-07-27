#!/usr/bin/env node
// LocGuard CLI — scan a Godot 4 project for localization defects. Exits non-zero
// when errors are found, so it works as a pre-commit hook or CI gate.
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./core.js');

function walk(dir, exts, out = [], root = dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git' || name === '.godot' || name === 'node_modules') continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, exts, out, root);
    else if (exts.includes(path.extname(name))) out.push(full);
  }
  return out;
}

function parseArgs(argv) {
  const args = { _: [], format: 'human', locales: null, source: null, overflow: {}, translations: null, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.format = 'json';
    else if (a === '--strict') args.strict = true; // warnings also fail the build
    else if (a === '--source') args.source = argv[++i];
    else if (a === '--locales') args.locales = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--translations') args.translations = argv[++i];
    else if (a === '--overflow') { const [loc, mult] = argv[++i].split(':'); args.overflow[loc] = parseFloat(mult); }
    else if (a === '-h' || a === '--help') args.help = true;
    else args._.push(a);
  }
  return args;
}

const HELP = `LocGuard — Godot 4 localization QA linter

Usage: locguard <project-dir> [options]

Options:
  --translations <file>   translation CSV or .po (default: auto-detect *.csv/*.po)
  --source <locale>       source locale to compare against (default: first column)
  --locales <a,b,c>       locales to require (default: those in the table)
  --overflow <loc:mult>   flag translations longer than mult× the source (repeatable)
  --strict                warnings also cause a non-zero exit
  --json                  machine-readable output
  -h, --help

Exit codes: 0 = clean, 1 = errors found (or warnings with --strict), 2 = usage error.`;

function autoFindTable(dir) {
  const csvs = walk(dir, ['.csv'], []).filter((f) => {
    const head = fs.readFileSync(f, 'utf8').slice(0, 200).split('\n')[0];
    return /^keys?\s*,/i.test(head); // Godot translation CSVs start with a keys column
  });
  if (csvs.length) return { file: csvs[0], kind: 'csv' };
  const pos = walk(dir, ['.po'], []);
  if (pos.length) return { file: pos[0], kind: 'po' };
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args._.length) { console.log(HELP); process.exit(args.help ? 0 : 2); }
  const dir = args._[0];
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`LocGuard: not a directory: ${dir}`); process.exit(2);
  }

  // 1. extract used keys
  const usedKeys = [];
  for (const f of walk(dir, ['.gd'], [])) usedKeys.push(...C.extractFromGDScript(fs.readFileSync(f, 'utf8'), path.relative(dir, f)));
  for (const f of walk(dir, ['.cs'], [])) usedKeys.push(...C.extractFromCSharp(fs.readFileSync(f, 'utf8'), path.relative(dir, f)));
  for (const f of walk(dir, ['.tscn', '.tres'], [])) usedKeys.push(...C.extractFromScene(fs.readFileSync(f, 'utf8'), path.relative(dir, f)));

  // 2. load translation table
  let tableInfo = args.translations ? { file: args.translations, kind: args.translations.endsWith('.po') ? 'po' : 'csv' } : autoFindTable(dir);
  if (!tableInfo) { console.error('LocGuard: no translation CSV/PO found (use --translations).'); process.exit(2); }
  const raw = fs.readFileSync(tableInfo.file, 'utf8');
  let table;
  if (tableInfo.kind === 'po') {
    const po = C.parsePo(raw);
    const loc = args.source || 'translation';
    table = { locales: [loc], rows: new Map([...po.entries].map(([k, v]) => [k, { [loc]: v }])) };
  } else {
    table = C.parseCsv(raw);
  }

  // 3. lint
  const project = { usedKeys, table };
  const result = C.lint(project, { locales: args.locales, sourceLocale: args.source, overflowBudget: args.overflow });

  // 4. report
  if (args.format === 'json') {
    console.log(JSON.stringify({
      project: dir, translations: tableInfo.file,
      scannedKeys: usedKeys.length, tableKeys: table.rows.size,
      ...result,
    }, null, 2));
  } else {
    const icon = { error: '✖', warning: '▲', info: '·' };
    if (!result.findings.length) console.log('✔ LocGuard: no localization issues found.');
    for (const f of result.findings) {
      const loc = f.file ? ` (${f.file}:${f.line})` : (f.key ? '' : '');
      console.log(`${icon[f.severity]} [${f.rule}] ${f.message}${loc}`);
    }
    const c = result.counts;
    console.log(`\n${c.error || 0} error(s), ${c.warning || 0} warning(s) · ${usedKeys.length} keys used, ${table.rows.size} in table.`);
  }

  const fail = !result.ok || (args.strict && (result.counts.warning || 0) > 0);
  process.exit(fail ? 1 : 0);
}

main();
