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
// What it looks for is one shape: the result of tr()/atr()/Tr() being assigned
// into a property (or passed to a method) that Godot re-translates on its own.
//
//   label.text = tr("MENU_START")     # flagged — frozen at the current locale (S3)
//   label.text = "MENU_START"         # correct — the node translates on draw (S2b)
//
// Both look identical on screen until the player changes language. See S3/S5/S6
// in docs/locale-switch-does-not-update-ui.md for what each one does at runtime,
// each measured by docs/verify_locale_switch.sh against Godot 4.7.
'use strict';
const fs = require('fs');
const path = require('path');

// Properties Godot auto-translates for you (Node.atr on draw). Storing an
// already-translated string in one of these is what freezes it.
const PROPS = [
  'text', 'tooltip_text', 'placeholder_text', 'title', 'window_title',
  'hint_tooltip', 'dialog_text', 'ok_button_text', 'cancel_button_text',
  'dialog_autowrap_text',
];
// Methods that store a string the owning control will auto-translate later.
const METHODS = [
  'add_item', 'add_check_item', 'add_radio_check_item', 'add_separator',
  'set_item_text', 'add_tab', 'set_tab_title', 'set_text', 'set_tooltip_text',
  'add_icon_item', 'add_submenu_item',
];
const TR_CALL = String.raw`(?:\w+\.)?(?:tr_n|tr|atr|Tr|Translate)\s*\(`;

// C# spells the same members in PascalCase (label.Text = Tr("K"), AddItem(...)),
// so every name is matched in both forms rather than only the GDScript one.
const pascal = (s) => s.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const both = (names) => [...new Set([...names, ...names.map(pascal)])].join('|');

// The receiver can be almost anything that ends in a dot: `label`, `$Score`,
// `%HUD/Label`, `get_node("x")`, `GetNode<Label>("Title")`. The leading boundary
// is what keeps `my_text = tr(...)` (a plain variable) from matching `text`.
const RECEIVER = String.raw`[\w\.\[\]\(\)<>"'$%@/]+\.`;
const propRe = new RegExp(String.raw`(^|[\s;])((?:${RECEIVER})?(?:${both(PROPS)}))\s*=\s*(${TR_CALL})`);
const methodRe = new RegExp(String.raw`\.(${both(METHODS)})\s*\(\s*(${TR_CALL})`);

// Strip a trailing line comment, but not a # that lives inside a string literal.
function stripComment(line, ext) {
  const marker = ext === '.cs' ? '//' : '#';
  let inS = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inS) {
      if (c === '\\') i++;
      else if (c === inS) inS = null;
    } else if (c === '"' || c === "'") inS = c;
    else if (line.startsWith(marker, i)) return line.slice(0, i);
  }
  return line;
}

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

// The one legitimate reason to write label.text = tr(...): the node has been
// taken out of the auto-translation path and the author re-translates by hand on
// NOTIFICATION_TRANSLATION_CHANGED (S7). We cannot resolve which node a given
// line refers to, so we report the file-level signal instead of guessing.
function fileHandlesItself(text) {
  return /AUTO_TRANSLATE_MODE_DISABLED|NOTIFICATION_TRANSLATION_CHANGED/.test(text);
}

function scanFile(full, rel) {
  const text = fs.readFileSync(full, 'utf8');
  const ext = path.extname(full);
  const manual = fileHandlesItself(text);
  const out = [];
  text.split('\n').forEach((raw, i) => {
    const line = stripComment(raw, ext);
    const pm = propRe.exec(line);
    const mm = pm ? null : methodRe.exec(line);
    if (!pm && !mm) return;
    const target = pm ? pm[2] : `.${mm[1]}()`;
    // A formatted or concatenated result cannot be recovered by switching back:
    // the runtime value is baked into the stored string (S6).
    const rest = line.slice((pm || mm).index);
    const formatted = /\)\s*(%|\+)/.test(rest);
    out.push({
      file: rel, line: i + 1, target, formatted, manual,
      source: raw.trim(),
      claim: formatted ? 'S6' : 'S3',
    });
  });
  return out;
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
    const why = f.formatted
      ? 'formatted at assignment — the runtime value is baked in, so switching back does not repair it (S6)'
      : 'frozen at the locale that was active when this ran (S3); if the value collides with a key it is translated again into a third string (S5)';
    console.log(`▲ [frozen-translation] ${f.file}:${f.line} — ${f.target} holds a translated value: ${why}`);
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
