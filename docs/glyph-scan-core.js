// The engine behind docs/scan_translation_glyphs.js — the pure half, with no
// filesystem and no process in it, so the exact same bytes run in the CLI and
// in a browser.
//
// It answers one question: which characters in your translation table is Godot
// NOT guaranteed to be able to draw?
//
// The table below is not a guess or a copy of Open Sans' spec sheet. It is the
// output of docs/verify_font_glyphs.sh, which asks the engine itself —
// `ThemeDB.fallback_font.has_char(cp)` for every codepoint in the BMP, the
// emoji planes and CJK Ext-B — and dumps the answer as ranges. Re-run it after
// a Godot upgrade and diff.
//
//   engine:  4.7-stable (official)
//   font:    Open Sans SemiBold (SemiBold)
//   covered: 1010 codepoints in 92 ranges
//
// Anything outside those ranges still usually appears on your screen, because
// Godot borrows a font from the operating system at shaping time (claims
// S1-S3 in docs/font-glyphs-missing-in-translations.md). That borrowed file is
// not in your export. On a machine that does not have it, the same string is
// drawn as hex boxes (S4). So this scanner does not report "broken" — it
// reports "depends on the player's machine", which is the thing you cannot see
// by running the game on your own.
//
// A copy of THIS file is served under
// https://blobsmith.lbwma.com/godot-missing-characters-in-translation/ and
// test/web-glyph.test.js refuses to run if the two differ by a byte.
'use strict';

const COVERAGE = {
  engine: "4.7-stable (official)",
  font: "Open Sans SemiBold",
  style: "SemiBold",
  count: 1010,
  ranges: [
  [0,0],[13,13],[32,126],[160,383],[402,402],[416,417],[431,432],[490,493],[496,496],
  [506,511],[536,539],[567,567],[601,601],[700,700],[710,711],[713,713],[728,733],[755,755],
  [768,772],[774,780],[783,783],[786,786],[803,803],[806,808],[900,906],[908,908],[910,929],
  [931,974],[977,978],[982,982],[1024,1158],[1160,1299],[1456,1470],[1473,1474],[1479,1479],
  [1488,1514],[7680,7681],[7742,7743],[7808,7813],[7838,7838],[7840,7929],[8013,8013],
  [8158,8158],[8192,8203],[8211,8213],[8215,8222],[8224,8226],[8230,8230],[8240,8240],
  [8242,8243],[8249,8250],[8252,8252],[8260,8260],[8304,8304],[8308,8314],[8316,8330],
  [8332,8334],[8341,8348],[8355,8356],[8359,8359],[8362,8364],[8453,8453],[8467,8467],
  [8470,8470],[8480,8480],[8482,8482],[8486,8486],[8494,8494],[8539,8542],[8706,8706],
  [8710,8710],[8719,8719],[8721,8722],[8725,8725],[8730,8730],[8734,8734],[8747,8747],
  [8776,8776],[8800,8800],[8804,8805],[9674,9674],[42931,42933],[43859,43859],[64256,64260],
  [64298,64310],[64312,64316],[64318,64318],[64320,64321],[64323,64324],[64326,64331],
  [65279,65279],[65532,65533]
  ],
};

// Binary search over the measured ranges.
function isCovered(cp) {
  const r = COVERAGE.ranges;
  let lo = 0, hi = r.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < r[mid][0]) hi = mid - 1;
    else if (cp > r[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

// Which writing system a codepoint belongs to, and what a project has to ship
// to be sure of drawing it. Only the blocks a translation table realistically
// contains; everything else falls through to "other".
const BLOCKS = [
  [0x0370, 0x03FF, 'Greek', 'covered by the built-in font'],
  [0x0400, 0x052F, 'Cyrillic', 'covered by the built-in font'],
  [0x0530, 0x058F, 'Armenian', 'bundle a font with Armenian'],
  [0x0590, 0x05FF, 'Hebrew', 'covered by the built-in font'],
  [0x0600, 0x06FF, 'Arabic', 'bundle a font with Arabic (and check RTL shaping)'],
  [0x0700, 0x074F, 'Syriac', 'bundle a font with Syriac'],
  [0x0900, 0x097F, 'Devanagari', 'bundle a font with Devanagari'],
  [0x0980, 0x09FF, 'Bengali', 'bundle a font with Bengali'],
  [0x0A80, 0x0AFF, 'Gujarati', 'bundle a font with Gujarati'],
  [0x0B80, 0x0BFF, 'Tamil', 'bundle a font with Tamil'],
  [0x0E00, 0x0E7F, 'Thai', 'bundle a font with Thai'],
  [0x10A0, 0x10FF, 'Georgian', 'bundle a font with Georgian'],
  [0x1E00, 0x1EFF, 'Latin Extended Additional', 'covered by the built-in font'],
  [0x2000, 0x206F, 'General Punctuation', 'partly covered - check the character'],
  [0x2190, 0x21FF, 'Arrows', 'NOT in the built-in font, even though the text around it is ASCII'],
  [0x2200, 0x22FF, 'Mathematical Operators', 'partly covered - check the character'],
  [0x2500, 0x257F, 'Box Drawing', 'bundle a font with box drawing'],
  [0x2580, 0x259F, 'Block Elements', 'bundle a font with block elements'],
  [0x25A0, 0x25FF, 'Geometric Shapes', 'bundle a font with geometric shapes'],
  [0x2600, 0x27BF, 'Symbols and Dingbats', 'NOT in the built-in font: check marks, stars, hearts, music notes'],
  [0x2E80, 0x2FDF, 'CJK Radicals', 'bundle a CJK font'],
  [0x3000, 0x303F, 'CJK Symbols and Punctuation', 'bundle a CJK font'],
  [0x3040, 0x309F, 'Hiragana', 'bundle a Japanese font'],
  [0x30A0, 0x30FF, 'Katakana', 'bundle a Japanese font'],
  [0x3130, 0x318F, 'Hangul Compatibility Jamo', 'bundle a Korean font'],
  [0x3400, 0x4DBF, 'CJK Extension A', 'bundle a CJK font'],
  [0x4E00, 0x9FFF, 'CJK Unified Ideographs', 'bundle a Chinese/Japanese font'],
  [0xA960, 0xA97F, 'Hangul Jamo Extended-A', 'bundle a Korean font'],
  [0xAC00, 0xD7AF, 'Hangul Syllables', 'bundle a Korean font'],
  [0xF900, 0xFAFF, 'CJK Compatibility Ideographs', 'bundle a CJK font'],
  [0xFE00, 0xFE0F, 'Variation Selectors', 'invisible - usually an emoji presentation selector'],
  [0xFF00, 0xFFEF, 'Halfwidth and Fullwidth Forms', 'bundle a CJK font'],
  [0x1F000, 0x1FAFF, 'Emoji', 'NOT in the built-in font: bundle an emoji font or drop the emoji'],
  [0x20000, 0x2A6DF, 'CJK Extension B', 'bundle a CJK font'],
];

function blockOf(cp) {
  // Two answers that are not "bundle a font", and that only turned up when this
  // scanner was pointed at real projects instead of translation tables.
  // A control byte is not a missing glyph, it is a typo in the string
  // (godot-demo-projects' tileset_edit.tscn ships fourteen U+0010 inside a
  // Label); and a Private Use codepoint is normal when an icon font is bundled,
  // which is exactly what 3d_labels_and_texts.tscn does.
  if (cp <= 0x001F || (cp >= 0x007F && cp <= 0x009F)) {
    return { name: 'Control character', advice: 'not a glyph at all - a stray control byte in the string; delete it' };
  }
  if ((cp >= 0xE000 && cp <= 0xF8FF) || (cp >= 0xF0000 && cp <= 0x10FFFD)) {
    return { name: 'Private Use Area', advice: 'an icon-font codepoint - fine IF that font is in the export and set on this control, nothing otherwise' };
  }
  for (const [lo, hi, name, advice] of BLOCKS) {
    if (cp >= lo && cp <= hi) return { name, advice };
  }
  if (cp < 0x0250) return { name: 'Latin', advice: 'covered by the built-in font' };
  return { name: 'other', advice: 'bundle a font that has it, or remove it' };
}

// Control characters and the ASCII/Latin core are never interesting to report.
function isIgnorable(cp) {
  return cp === 0x09 || cp === 0x0A || cp === 0x0D;
}

// --- CSV, the way Godot reads a translation table ------------------------
function parseCsv(text, delimiter) {
  const d = delimiter || ',';
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === d) { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// --- the scan ------------------------------------------------------------
// Accepts a Godot translation CSV (first column = keys, header = locales) or,
// if there is no usable header, treats the whole input as one blob of text.
function scan(text, opts) {
  const o = opts || {};
  const rows = parseCsv(text, o.delimiter);
  const out = { locales: [], rowsRead: 0, mode: 'csv', engine: COVERAGE.engine, font: COVERAGE.font };
  if (!rows.length) return Object.assign(out, { mode: 'empty' });

  const header = rows[0];
  const looksLikeTable = header.length >= 2 && rows.length >= 2;
  const columns = looksLikeTable
    ? header.slice(1).map((h, idx) => ({ locale: (h || '').trim() || ('column ' + (idx + 2)), col: idx + 1 }))
    : [{ locale: 'text', col: 0 }];
  if (!looksLikeTable) out.mode = 'text';

  const body = looksLikeTable ? rows.slice(1) : rows;
  out.rowsRead = body.length;

  for (const c of columns) {
    const found = new Map();
    let cells = 0;
    for (const r of body) {
      const value = looksLikeTable ? (r[c.col] || '') : r.join(' ');
      if (!value) continue;
      cells++;
      const key = looksLikeTable ? (r[0] || '') : '';
      for (const ch of value) {
        const cp = ch.codePointAt(0);
        if (isIgnorable(cp) || isCovered(cp)) continue;
        const prev = found.get(cp);
        if (prev) { prev.count++; if (prev.keys.length < 3 && !prev.keys.includes(key)) prev.keys.push(key); continue; }
        const b = blockOf(cp);
        found.set(cp, {
          cp,
          char: ch,
          hex: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'),
          block: b.name,
          advice: b.advice,
          count: 1,
          keys: key ? [key] : [],
          sample: value.length > 60 ? value.slice(0, 57) + '...' : value,
        });
      }
    }
    const chars = [...found.values()].sort((a, b) => b.count - a.count || a.cp - b.cp);
    const blocks = [...new Set(chars.map((c2) => c2.block))];
    out.locales.push({ locale: c.locale, cells, chars, blocks, flagged: chars.length });
  }
  out.totalFlagged = out.locales.reduce((s, l) => s + l.flagged, 0);
  return out;
}

function verdict(result) {
  if (result.mode === 'empty') return 'Nothing to read.';
  const source = result.mode === 'source';
  if (source && !result.rowsRead) {
    return 'No text a player can see was found in this ' + (KIND_LABEL[result.kind] || 'file') +
      '. That is an answer, not a failure: nothing here is drawn.';
  }
  if (!result.totalFlagged) {
    return 'Every character in this ' + (source ? (KIND_LABEL[result.kind] || 'file') : 'table') +
      ' is inside the ' + COVERAGE.count +
      ' codepoints the built-in font owns. Nothing here depends on the player having a font installed.';
  }
  const risky = result.locales.filter((l) => l.flagged).map((l) => l.locale).join(', ');
  return result.totalFlagged + ' distinct characters (' + risky + ') are outside the built-in font. ' +
    'They render today because Godot borrows a font from the machine it runs on; that font is not in your export.';
}

// --- source files, for the project that has no translation table ---------
//
// The finding this scanner exists for is not about translation: the built-in
// font is missing `->` `<-` `check` `star` `heart` `note` (U+2190-21FF, U+2600-27BF),
// so a project written entirely in English already depends on the player's
// machine the day someone types `Continue ->` into a button. Those projects have
// no CSV to paste. Their strings live in `.tscn`/`.tres` properties and in
// `.gd`/`.cs` assignments, so we read those directly.
//
// The rule is deliberately narrow: only text a player can SEE. A `res://` path,
// a node path, a signal name, a printed debug line and a comment are all skipped
// even when they contain the same character, because flagging them would make
// the report noise and the noise is what stops people acting on it.

// Properties whose value the engine draws. The first six are the set
// src/core.js already extracts for the linter (test/project-glyph.test.js
// asserts this list stays a superset of that one, so the two cannot drift);
// the rest are drawn too but are not translation keys, which is why the linter
// does not care about them and this scanner does.
const UI_TEXT_PROPS = [
  'text', 'title', 'tooltip_text', 'placeholder_text', 'hint_tooltip', 'window_title',
  'dialog_text', 'bbcode_text', 'ok_button_text', 'cancel_button_text', 'dialog_autowrap_text',
];

// Per-item properties of the list-shaped controls, in both the Godot 4 form and
// the legacy Godot 3 `items = [...]` array.
const UI_ITEM_RE = /^\s*(?:items|popup\/item_\d+\/text|item_\d+\/text|tab_\d+\/title)\s*=\s*(.+)$/;

// Methods that put a string on screen. Same principle: a method that stores or
// prints is not here, only one that draws.
const UI_CALLS_GD = ['add_item', 'add_check_item', 'add_radio_check_item', 'add_separator',
  'set_item_text', 'set_text', 'add_tab', 'set_tab_title', 'set_tooltip_text', 'set_placeholder',
  'append_text', 'push_text', 'add_text', 'set_title', 'tr', 'atr', 'tr_n'];
const UI_CALLS_CS = ['AddItem', 'AddCheckItem', 'AddRadioCheckItem', 'AddSeparator',
  'SetItemText', 'SetText', 'AddTab', 'SetTabTitle', 'AppendText', 'PushText', 'AddText',
  'SetTitle', 'Tr', 'Translate'];

// A value that is an address, not a sentence.
function isAddress(v) {
  return /^(res|user|uid):\/\//.test(v) || /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/.test(v);
}

function pushString(out, value, line, prop) {
  const v = unescapeSource(value);
  if (!v.trim() || isAddress(v)) return;
  out.push({ value: v, line, prop });
}

function unescapeSource(s) {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"')
    .replace(/\\'/g, "'").replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\\/g, '\\');
}

// Every double-quoted literal on a line, with the escapes already resolved.
function quotedOnLine(rest) {
  const out = [];
  const re = /"((?:\\.|[^"])*)"/g;
  let m;
  while ((m = re.exec(rest)) !== null) out.push(m[1]);
  return out;
}

// Index of the first quote that actually ends the value, skipping escapes.
function closingQuote(s) {
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\') { k++; continue; }
    if (s[k] === '"') return k;
  }
  return -1;
}

// .tscn / .tres — the properties, plus the per-item forms.
//
// The value is read across lines on purpose. Godot serialises a multi-line
// Label as a quoted value with real newline bytes inside it, so the closing
// quote can be five lines below the property name. A line-by-line regex reads
// the first line and stops. This is not hypothetical: running this scanner over
// the 1028 scene/script files of godotengine/godot-demo-projects found exactly
// one file it had missed, loading/runtime_save_load/runtime_save_load.tscn, and
// what was hiding on the last line of that string was a U+2194 arrow — the very
// character class this scanner exists to report.
function extractSceneStrings(text) {
  const out = [];
  const lines = text.split('\n');
  const startRe = new RegExp('^\\s*(' + UI_TEXT_PROPS.join('|') + ')\\s*=\\s*"');
  for (let i = 0; i < lines.length; i++) {
    const sm = startRe.exec(lines[i]);
    if (sm) {
      let rest = lines[i].slice(sm[0].length);
      let acc = '', j = i, closed = false;
      for (;;) {
        const end = closingQuote(rest);
        if (end >= 0) { acc += rest.slice(0, end); closed = true; break; }
        acc += rest + '\n';
        if (++j >= lines.length) break;
        rest = lines[j];
      }
      // An unterminated value means the file is truncated or not a scene; drop
      // it rather than report the rest of the file as one string.
      if (closed) { pushString(out, acc, i + 1, sm[1]); i = j; }
      continue;
    }
    const im = UI_ITEM_RE.exec(lines[i]);
    if (im) for (const q of quotedOnLine(im[1])) pushString(out, q, i + 1, 'items');
  }
  return out;
}

// .gd / .cs — assignment to a drawn property, or a call that draws.
// Comments are dropped whole: a `->` inside `# TODO` is not shipped to anyone.
function extractScriptStrings(text, lang) {
  const cs = lang === 'cs';
  const props = cs
    ? ['Text', 'Title', 'TooltipText', 'PlaceholderText', 'HintTooltip', 'WindowTitle', 'DialogText', 'BbcodeText', 'OkButtonText', 'CancelButtonText']
    : UI_TEXT_PROPS;
  const calls = cs ? UI_CALLS_CS : UI_CALLS_GD;
  const assignRe = new RegExp('(?:^|[^A-Za-z0-9_.])(?:[A-Za-z0-9_\\]\\[().]*\\.)?(' + props.join('|') + ')\\s*\\+?=\\s*(.*)$');
  // A method is normally reached through a node (`$Menu.add_item(...)`), so a
  // dot may precede the name; what must NOT precede it is another identifier
  // character, or `reset_text(` would read as `set_text(`.
  const callRe = new RegExp('(?:^|[^A-Za-z0-9_])(' + calls.join('|') + ')\\s*\\(([^\\n]*)$');
  const out = [];
  text.split('\n').forEach((line, i) => {
    const code = cs ? line.replace(/\/\/.*$/, '') : line.replace(/(^|\s)#.*$/, '');
    if (!code.trim()) return;
    const am = assignRe.exec(code);
    if (am) {
      const q = quotedOnLine(am[2]);
      if (q.length) { for (const v of q) pushString(out, v, i + 1, am[1]); return; }
    }
    let m;
    const re = new RegExp(callRe.source, 'g');
    while ((m = re.exec(code)) !== null) {
      for (const v of quotedOnLine(m[2])) pushString(out, v, i + 1, m[1] + '()');
    }
  });
  return out;
}

// What kind of file is this? By name when there is one, by shape when the text
// was pasted into a page and there is no name to go on.
function detectKind(name, text) {
  const n = (name || '').toLowerCase();
  if (/\.(tscn|tres|escn)$/.test(n)) return 'scene';
  if (/\.gd$/.test(n)) return 'gdscript';
  if (/\.cs$/.test(n)) return 'csharp';
  if (/\.csv$/.test(n)) return 'csv';
  const head = (text || '').slice(0, 4000);
  if (/^\s*\[gd_(scene|resource)\b/m.test(head) || /^\s*\[node\b/m.test(head)) return 'scene';
  if (/^\s*(extends|class_name|@tool|@onready)\b/m.test(head) || /^\s*func\s+\w+\s*\(/m.test(head)) return 'gdscript';
  if (/\busing\s+Godot\b/.test(head) || /\bpublic\s+partial\s+class\b/.test(head)) return 'csharp';
  return 'csv';
}

const KIND_LABEL = { scene: 'scene', gdscript: 'GDScript', csharp: 'C#' };

// Same output shape as scan(), so every consumer — the CLI printer, the page
// renderer, verdict() — works on both without a second code path. A source file
// has no locale columns, so it reports as a single group named after the kind.
function scanSource(text, opts) {
  const o = opts || {};
  const kind = o.kind || detectKind(o.name, text);
  const strings = kind === 'scene'
    ? extractSceneStrings(text)
    : extractScriptStrings(text, kind === 'csharp' ? 'cs' : 'gd');
  const out = {
    mode: 'source', kind, engine: COVERAGE.engine, font: COVERAGE.font,
    rowsRead: strings.length, locales: [],
  };
  const found = new Map();
  for (const s of strings) {
    for (const ch of s.value) {
      const cp = ch.codePointAt(0);
      if (isIgnorable(cp) || isCovered(cp)) continue;
      const where = 'line ' + s.line + (s.prop ? ' (' + s.prop + ')' : '');
      const prev = found.get(cp);
      if (prev) { prev.count++; if (prev.keys.length < 3 && !prev.keys.includes(where)) prev.keys.push(where); continue; }
      const b = blockOf(cp);
      found.set(cp, {
        cp, char: ch, hex: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'),
        block: b.name, advice: b.advice, count: 1, keys: [where],
        sample: s.value.length > 60 ? s.value.slice(0, 57) + '...' : s.value,
        line: s.line, prop: s.prop,
      });
    }
  }
  const chars = [...found.values()].sort((a, b) => b.count - a.count || a.cp - b.cp);
  out.locales.push({
    locale: (KIND_LABEL[kind] || kind) + ' strings',
    cells: strings.length, chars, blocks: [...new Set(chars.map((c) => c.block))], flagged: chars.length,
  });
  out.totalFlagged = chars.length;
  out.strings = strings;
  return out;
}

// One entry point for "here is a file, tell me what is wrong with it".
function scanAny(text, opts) {
  const o = opts || {};
  const kind = o.kind || detectKind(o.name, text);
  return kind === 'csv' ? Object.assign(scan(text, o), { kind: 'csv' }) : scanSource(text, Object.assign({}, o, { kind }));
}

const API = { COVERAGE, isCovered, blockOf, parseCsv, scan, verdict, BLOCKS,
  UI_TEXT_PROPS, extractSceneStrings, extractScriptStrings, detectKind, scanSource, scanAny };

// Node (CLI + tests) and the browser (the page) load the same bytes.
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else if (typeof window !== 'undefined') window.GlyphScan = API;
