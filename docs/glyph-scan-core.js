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
  if (!result.totalFlagged) {
    return 'Every character in this table is inside the ' + COVERAGE.count +
      ' codepoints the built-in font owns. Nothing here depends on the player having a font installed.';
  }
  const risky = result.locales.filter((l) => l.flagged).map((l) => l.locale).join(', ');
  return result.totalFlagged + ' distinct characters (' + risky + ') are outside the built-in font. ' +
    'They render today because Godot borrows a font from the machine it runs on; that font is not in your export.';
}

const API = { COVERAGE, isCovered, blockOf, parseCsv, scan, verdict, BLOCKS };

// Node (CLI + tests) and the browser (the page) load the same bytes.
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else if (typeof window !== 'undefined') window.GlyphScan = API;
