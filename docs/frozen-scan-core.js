// The scanning engine behind docs/find_frozen_translations.js — the pure half,
// with no filesystem and no process in it, so the exact same bytes can run in
// the CLI and in a browser.
//
// It exists as its own file because of a promise made on the web page at
// https://blobsmith.lbwma.com/godot-locale-not-updating/ : "this is the same
// scanner the command line runs, byte for byte". A copy of THIS file is served
// under that page, and test/web-frozen.test.js refuses to run if the two
// differ. Duplicating the regexes into the page instead would make that
// sentence unverifiable and let the two drift apart silently — which is the
// exact failure mode the page is about.
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

// The one legitimate reason to write label.text = tr(...): the node has been
// taken out of the auto-translation path and the author re-translates by hand on
// NOTIFICATION_TRANSLATION_CHANGED (S7). We cannot resolve which node a given
// line refers to, so we report the file-level signal instead of guessing.
function fileHandlesItself(text) {
  return /AUTO_TRANSLATE_MODE_DISABLED|NOTIFICATION_TRANSLATION_CHANGED/.test(text);
}

// One file's worth of source, already read. `rel` is only carried through to the
// finding so the caller decides what a "file name" means (a path on disk, or
// "pasted" in the browser, where there is no file at all).
function scanText(text, ext, rel) {
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

// The sentence a reader gets for a finding. It lives here, next to the rule that
// produced it, so the terminal and the web page cannot end up explaining the
// same finding differently.
function why(finding) {
  return finding.formatted
    ? 'formatted at assignment — the runtime value is baked in, so switching back does not repair it (S6)'
    : 'frozen at the locale that was active when this ran (S3); if the value collides with a key it is translated again into a third string (S5)';
}

const MANUAL_NOTE = 'this file mentions AUTO_TRANSLATE_MODE_DISABLED or NOTIFICATION_TRANSLATION_CHANGED — ' +
  'if THIS node is the one being handled by hand, the line is correct (S7).';

const API = { PROPS, METHODS, stripComment, fileHandlesItself, scanText, why, MANUAL_NOTE };

// Node (CLI + tests) and the browser (the page) load the same bytes.
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else if (typeof window !== 'undefined') window.FrozenScan = API;
