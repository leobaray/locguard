#!/usr/bin/env node
// Reports which characters your Godot 4 project puts on screen that the
// engine's built-in font cannot draw — reading the project itself, not a
// translation table.
//
//   node docs/scan_project_glyphs.js path/to/godot/project
//   node docs/scan_project_glyphs.js path/to/hud.tscn path/to/menu.gd
//   node docs/scan_project_glyphs.js path/to/project --json
//   node docs/scan_project_glyphs.js path/to/project --all      (include .csv tables)
//
// Why this exists next to docs/scan_translation_glyphs.js, which answers the
// same question about a .csv: the finding is not about translation. The built-in
// font has no arrows (U+2190-21FF) and no dingbats (U+2600-27BF), so a project
// written entirely in English is already exposed the day someone types
// `Continue ->` into a Button — and that project has no CSV to scan. This one
// reads .tscn/.tres properties and .gd/.cs assignments instead.
//
// What it reports is not "broken". Those characters are drawn today, by a font
// Godot borrowed from the machine at shaping time; that file is not inside your
// export (claims S1-S4 of docs/font-glyphs-missing-in-translations.md). What
// this prints is the list of strings whose appearance depends on the player's
// computer — the thing running the game yourself cannot show you.
//
// Deliberately narrow: only text a player can SEE. `res://` paths, node paths,
// comments and printed debug lines are skipped even when they hold the same
// character, because a report nobody trusts is a report nobody acts on.
//
// Exit 0 when everything is inside the built-in font, 1 when something is not,
// 2 on a usage error. Zero dependencies, writes nothing. Like its sibling this
// is a standalone reader, NOT a LocGuard rule: the linter's rules answer "is
// this table complete and consistent", and this answers "can the engine draw
// it", which has a different fix (bundle a font).
//
// The matching and the coverage table live in ./glyph-scan-core.js, the same
// bytes the browser runs on
// https://blobsmith.lbwma.com/godot-missing-characters-in-translation/
// The measurement behind the table is docs/verify_font_glyphs.sh (35 claims).
'use strict';
const fs = require('fs');
const path = require('path');
const SCAN = require('./glyph-scan-core.js');

const SOURCE_EXT = /\.(tscn|tres|escn|gd|cs)$/i;

const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

function walk(dir, pattern, out = []) {
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return out; }
  for (const name of names) {
    if (name === '.git' || name === '.godot' || name === '.import' || name === 'node_modules') continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(full); } catch (e) { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(full, pattern, out);
    else if (pattern.test(name)) out.push(full);
  }
  return out;
}

function main(argv) {
  const asJson = argv.includes('--json');
  const withTables = argv.includes('--all');
  const targets = argv.filter((a) => !a.startsWith('--'));
  if (!targets.length) {
    console.error('usage: node scan_project_glyphs.js <project-dir|file.tscn|file.gd> [--json] [--all]');
    return 2;
  }
  const pattern = withTables ? /\.(tscn|tres|escn|gd|cs|csv)$/i : SOURCE_EXT;

  const files = [];
  for (const t of targets) {
    let st;
    try { st = fs.statSync(t); } catch (e) { console.error('cannot read ' + t); return 2; }
    if (st.isDirectory()) files.push(...walk(t, pattern));
    else files.push(t);
  }
  if (!files.length) {
    console.error('no .tscn/.tres/.gd/.cs file found under ' + targets.join(', '));
    return 2;
  }
  files.sort();

  const report = [];
  let flagged = 0, drawn = 0;
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    const result = SCAN.scanAny(text, { name: f });
    drawn += result.rowsRead || 0;
    flagged += result.totalFlagged || 0;
    if (result.totalFlagged) report.push({ file: f, result });
  }

  if (asJson) {
    console.log(JSON.stringify({
      engine: SCAN.COVERAGE.engine,
      font: SCAN.COVERAGE.font,
      coveredCodepoints: SCAN.COVERAGE.count,
      filesRead: files.length,
      stringsRead: drawn,
      totalFlagged: flagged,
      files: report.map(({ file, result }) => ({
        file, kind: result.kind, strings: result.rowsRead,
        chars: result.locales[0].chars.map((c) => ({
          hex: c.hex, char: c.char, block: c.block, count: c.count,
          line: c.line, prop: c.prop, sample: c.sample, where: c.keys, advice: c.advice,
        })),
      })),
    }, null, 2));
    return flagged ? 1 : 0;
  }

  console.log('engine ' + SCAN.COVERAGE.engine + ' — built-in font ' + SCAN.COVERAGE.font +
    ' draws ' + SCAN.COVERAGE.count + ' codepoints');
  console.log(plural(files.length, 'file') + ' read, ' + plural(drawn, 'string') + ' a player can see');
  if (!flagged) {
    console.log('');
    console.log('Every one of them is inside the built-in font. Nothing in this project ' +
      'depends on the player having a font installed.');
    return 0;
  }
  for (const { file, result } of report) {
    console.log('');
    console.log(file + '  (' + result.kind + ', ' + plural(result.rowsRead, 'string') + ')');
    for (const c of result.locales[0].chars.slice(0, 12)) {
      console.log('  ' + String(c.line).padStart(5) + ':  ' + c.hex.padEnd(8) +
        JSON.stringify(c.char).padEnd(10) + c.block + ' ×' + c.count +
        (c.prop ? '  in ' + c.prop : ''));
      console.log('         ' + JSON.stringify(c.sample));
    }
    const more = result.locales[0].chars.length - 12;
    if (more > 0) console.log('  ... and ' + plural(more, 'more character') + ' in this file');
    for (const a of [...new Set(result.locales[0].chars.map((c) => c.advice))]) console.log('  → ' + a);
  }
  console.log('');
  const one = flagged === 1;
  console.log(plural(flagged, 'character occurrence') + ' across ' + plural(report.length, 'file') +
    (one ? ' is' : ' are') + ' outside the built-in font. ' + (one ? 'It renders' : 'They render') +
    ' today because Godot borrows a font from the machine it runs on; that font is not in your export.');
  return 1;
}

process.exit(main(process.argv.slice(2)));
