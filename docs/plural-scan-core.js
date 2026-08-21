// The scanning engine behind docs/check_plural_csv.js — the pure half, with no
// filesystem and no process in it, so the exact same bytes can run in the CLI and
// in a browser.
//
// It reads a Godot 4 translation CSV and reports the plural defects that are
// visible in the table itself. Every one of them imports without an error and
// most of them look right for the numbers a developer types while testing; see
// docs/plural-forms-always-show-the-same-string.md, where each claim id (P3, P11,
// P12, P13) is asserted against a real engine by docs/verify_plurals.js.
//
// Deliberately narrow: this reads the CSV, not the project. Whether the game
// calls tr_n() at all, and with which key, is a source question and not one a
// table can answer — so a clean result here means "the table can carry plurals",
// never "the plurals work".
'use strict';

// How many plural forms each language has, and the smallest n that selects each
// one, as measured FROM THE ENGINE by docs/dump_plural_rules.js — not copied from
// gettext. Godot ships its own table, and it is the engine's rule that decides
// whether a player sees a translation or the raw source string. A Godot release
// that changes a rule makes this a re-run and a diff, not a rewrite.
//
// The second number matters as much as the first: it is the example that makes a
// missing form reproducible. Russian's third form is first selected at n=0 and
// then at n=5, Romanian's third at n=20, Maltese's fourth at n=11 — none of
// which is a number anyone tests with.
const FIRST_N = {
  // 1 form -- first n that selects each: [0]
  "th": [0], "vi": [0], "id": [0], "ms": [0], "ja": [0], "ko": [0], "zh": [0], "zh_CN": [0], "zh_TW": [0],
  // 2 forms -- first n that selects each: [1, 0]
  "en": [1, 0], "de": [1, 0], "es": [1, 0], "pt": [1, 0], "it": [1, 0], "nl": [1, 0], "sv": [1, 0], "da": [1, 0], "nb": [1, 0], "fi": [1, 0], "bg": [1, 0], "el": [1, 0], "hu": [1, 0], "tr": [1, 0], "he": [1, 0], "ca": [1, 0], "eu": [1, 0], "gl": [1, 0], "et": [1, 0],
  // 2 forms -- first n that selects each: [2, 0]
  "fa": [2, 0], "hi": [2, 0],
  // 2 forms -- first n that selects each: [0, 2]
  "fr": [0, 2], "pt_BR": [0, 2],
  // 2 forms -- first n that selects each: [0, 1]
  "is": [0, 1],
  // 3 forms -- first n that selects each: [1, 2, 0]
  "pl": [1, 2, 0], "ru": [1, 2, 0], "uk": [1, 2, 0], "cs": [1, 2, 0], "sk": [1, 2, 0], "hr": [1, 2, 0], "sr": [1, 2, 0], "lt": [1, 2, 0], "lv": [1, 2, 0], "ga": [1, 2, 0],
  // 3 forms -- first n that selects each: [1, 0, 20]
  "ro": [1, 0, 20],
  // 4 forms -- first n that selects each: [1, 2, 3, 0]
  "sl": [1, 2, 3, 0],
  // 5 forms -- first n that selects each: [1, 2, 0, 11, 20]
  "mt": [1, 2, 0, 11, 20],
  // 6 forms -- first n that selects each: [0, 1, 2, 3, 11, 100]
  "ar": [0, 1, 2, 3, 11, 100],
  // 6 forms -- first n that selects each: [0, 1, 2, 3, 6, 4]
  "cy": [0, 1, 2, 3, 6, 4],
};

const nplurals = (locale) => (FIRST_N[locale] ? FIRST_N[locale].length : null);

// Godot normalizes a locale before matching, so `pt-br` and `pt_BR` are the same
// column to the importer. Match the same way rather than missing a real defect
// over a dash.
function normalizeLocale(raw) {
  const s = String(raw).trim().replace(/-/g, '_');
  const parts = s.split('_');
  if (parts.length === 1) return parts[0].toLowerCase();
  return parts[0].toLowerCase() + '_' + parts.slice(1).join('_').toUpperCase();
}

// A column header only counts as a locale if we can recognise it as one; anything
// else is left alone, because a header this file does not understand is not
// evidence of a defect.
function knownLocale(header) {
  const n = normalizeLocale(header);
  if (FIRST_N[n]) return n;
  const base = n.split('_')[0];
  return FIRST_N[base] ? base : null;
}

// Godot reads the file with FileAccess.get_csv_line: double quotes group a field,
// "" is a literal quote. Nothing else is special — a backslash is a backslash.
function parseCsv(text, delimiter) {
  const d = delimiter || ',';
  const rows = [];
  let row = [], field = '', quoted = false, started = false, i = 0;
  const pushField = () => { row.push(field); field = ''; quoted = false; started = false; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && !started) { quoted = true; started = true; i++; continue; }
    if (c === d) { pushField(); i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { pushRow(); i++; continue; }
    field += c; started = true; i++;
  }
  if (field !== '' || row.length) pushRow();
  return rows;
}

function parseNpluralsFromRule(rule) {
  const m = /nplurals\s*=\s*(\d+)/.exec(String(rule));
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// scanCsv(text, opts) -> { findings, locales, hasPluralColumn, rows }
// ---------------------------------------------------------------------------
function scanCsv(text, opts = {}) {
  const file = opts.file || 'translations.csv';
  const rows = parseCsv(text.replace(/^﻿/, ''), opts.delimiter);
  const findings = [];
  const add = (rule, line, message, extra = {}) =>
    findings.push({ rule, file, line, message, ...extra });

  if (!rows.length || rows[0].length < 2) {
    return { findings, locales: [], hasPluralColumn: false, rows: rows.length };
  }

  const header = rows[0];
  let pluralCol = -1, contextCol = -1;
  const localeCols = [];      // [{index, header, locale}]
  for (let c = 1; c < header.length; c++) {
    const h = header[c].trim();
    if (h.toLowerCase() === '?plural') { pluralCol = c; continue; }
    if (h.toLowerCase() === '?context') { contextCol = c; continue; }
    if (h.startsWith('_')) {
      // The importer drops these columns. That is intended for a notes column and
      // silent data loss for a language.
      const asLocale = knownLocale(h.slice(1));
      if (asLocale) {
        add('underscore-locale', 1,
          'column "' + h + '" is dropped by the importer because its header starts with "_", ' +
          'so locale ' + asLocale + ' produces no .translation file at all and every string in it ' +
          'falls back. Rename the column to "' + h.slice(1) + '".',
          { locale: asLocale, column: h });
      }
      continue;
    }
    localeCols.push({ index: c, header: h, locale: knownLocale(h) });
  }

  // Group the body into entries: a row with a non-empty key starts one, and rows
  // with an empty key continue it. That is exactly the importer's own rule.
  const entries = [];
  const declaredRules = {};   // column index -> nplurals from a ?pluralrule row
  let cur = null;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.length || row.every((v) => v.trim() === '')) continue;
    const key = (row[0] || '').trim();
    const line = r + 1;

    if (key.toLowerCase() === '?pluralrule') {
      if (pluralCol === -1) {
        add('plural-column-missing', line,
          'a "?pluralrule" row is present but the header has no "?plural" column, so no plural ' +
          'row is ever enabled and every extra row is discarded or overwrites the key.');
      }
      for (const lc of localeCols) {
        const declared = parseNpluralsFromRule(row[lc.index] || '');
        if (declared === null) continue;
        declaredRules[lc.index] = declared;
        if (!lc.locale) continue;
        const builtin = nplurals(lc.locale);
        if (builtin !== null && declared !== builtin) {
          add('plural-rule-arity', line,
            'the ?pluralrule for ' + lc.header + ' declares nplurals=' + declared +
            ', while Godot\'s built-in rule for ' + lc.locale + ' has ' + builtin +
            '. The declared rule wins, so every row count below is checked against ' + declared + '.',
            { locale: lc.locale, declared, builtin });
        }
      }
      // A rule row is not a continuation of anything.
      cur = null;
      continue;
    }

    // The superseded syntax that is still the top answer on the web.
    if (/^_?pluralrule$/i.test(key)) {
      add('plural-legacy-rule-row', line,
        'the key "' + key + '" is not special to the importer — only a COLUMN header starting with ' +
        '"_" is ignored, so this row becomes an ordinary translatable message (P2). The syntax that ' +
        'shipped is a "?pluralrule" row plus a "?plural" column.');
      continue;
    }

    if (key !== '') {
      cur = { key, line, rows: [row], forms: 1 };
      entries.push(cur);
    } else if (cur) {
      cur.rows.push(row);
      cur.forms++;
      if (pluralCol === -1) {
        add('plural-column-missing', line,
          'this row continues "' + cur.key + '" but the header has no "?plural" column, so the ' +
          'importer never enables plural rows for it.', { key: cur.key });
      }
    }
  }

  // A key repeated on consecutive rows is the shape the old advice teaches. With
  // a ?plural column it declares plural forms and then overwrites them (P11);
  // without one it silently keeps only the last value (P3).
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].key && entries[i].key === entries[i - 1].key) {
      add(pluralCol === -1 ? 'plural-column-missing' : 'plural-key-repeated', entries[i].line,
        'key "' + entries[i].key + '" is repeated instead of leaving the first column empty. ' +
        (pluralCol === -1
          ? 'Each repeat overwrites the one before it, so the table keeps a single value (P3).'
          : 'A continuation row must have an empty key column; as written each row overwrites the ' +
            'previous form, leaving one form for a key that declares several — every other n then ' +
            'shows the untranslated source plural (P11).'),
        { key: entries[i].key });
    }
  }

  // The one that survives review: enough forms for the numbers you test with.
  if (pluralCol !== -1) {
    for (const e of entries) {
      const sourcePlural = (e.rows[0][pluralCol] || '').trim();
      if (!sourcePlural) continue;              // not a plural entry at all
      for (const lc of localeCols) {
        if (!lc.locale) continue;
        const want = declaredRules[lc.index] || nplurals(lc.locale);
        if (!want) continue;
        const filled = e.rows.filter((row) => (row[lc.index] || '').trim() !== '').length;
        if (filled === 0) continue;             // untranslated language, a different rule's job
        if (filled < want) {
          const firstN = FIRST_N[lc.locale] || [];
          const missing = firstN.slice(filled).filter((n) => n !== undefined);
          add('plural-missing-form', e.line,
            'key "' + e.key + '" gives ' + lc.header + ' ' + filled + ' plural form' +
            (filled === 1 ? '' : 's') + ', and ' + lc.locale + ' needs ' + want + '. ' +
            (missing.length
              ? 'n=' + missing.join(', n=') + ' select' + (missing.length === 1 ? 's' : '') +
                ' a form that is not there, so the player reads the untranslated source plural ' +
                '"' + sourcePlural + '" (P12).'
              : 'The missing forms fall back to the untranslated source plural (P12).'),
            { key: e.key, locale: lc.locale, have: filled, want, exampleN: missing });
        }
      }
    }
  }

  return {
    findings,
    locales: localeCols.map((c) => c.locale || c.header),
    hasPluralColumn: pluralCol !== -1,
    hasContextColumn: contextCol !== -1,
    rows: rows.length,
  };
}

const API = { scanCsv, parseCsv, normalizeLocale, knownLocale, nplurals, FIRST_N };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.LocGuardPluralScan = API;
