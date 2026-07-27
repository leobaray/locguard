// LocGuard core — pure logic, no DOM, no deps. Scans a Godot 4 project for
// localization defects that ship silently. Loaded by the CLI and by node tests.
'use strict';

// ---------------------------------------------------------------------------
// String extraction
// ---------------------------------------------------------------------------

// Pull tr("..."), tr('...'), atr("..."), and RPC-free tr(&"...") from GDScript.
// Also tr_n("one","many", n). Returns [{ key, file, line }].
function extractFromGDScript(text, file) {
  const out = [];
  const lines = text.split('\n');
  // tr / tr_n / atr with a string literal as the first argument. tr_n also takes
  // a plural msgid as its second argument — both are translatable keys.
  const re = /\b(tr|tr_n|atr)\s*\(\s*(&?)(["'])((?:\\.|(?!\3).)*)\3\s*(?:,\s*(&?)(["'])((?:\\.|(?!\6).)*)\6)?/g;
  lines.forEach((line, i) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      out.push({ key: unescapeGd(m[4]), file, line: i + 1, fn: m[1] });
      if (m[1] === 'tr_n' && m[7] !== undefined) {
        out.push({ key: unescapeGd(m[7]), file, line: i + 1, fn: 'tr_n' });
      }
    }
  });
  return out;
}

// C# equivalent: Tr("..."), TranslationServer.Translate("...")
function extractFromCSharp(text, file) {
  const out = [];
  const lines = text.split('\n');
  const re = /\b(?:Tr|Translate)\s*\(\s*(@?)("(?:\\.|[^"])*")/g;
  lines.forEach((line, i) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      out.push({ key: JSON.parse(m[2].replace(/^@/, '')), file, line: i + 1, fn: 'Tr' });
    }
  });
  return out;
}

// Scene/resource files (.tscn/.tres) store translatable UI text as string
// properties. Godot's own POT generator misses many of these (issues #73565,
// #95160, #85848). We surface the high-signal ones: text=, title=, tooltip_text=,
// placeholder_text=, hint_tooltip=, and PackedStringArray items on OptionButton /
// ItemList / TabBar (popup/items).
const TSCN_TEXT_PROPS = ['text', 'title', 'tooltip_text', 'placeholder_text', 'hint_tooltip', 'window_title'];
function extractFromScene(text, file) {
  const out = [];
  const lines = text.split('\n');
  const propRe = new RegExp('^\\s*(' + TSCN_TEXT_PROPS.join('|') + ')\\s*=\\s*"((?:\\\\.|[^"])*)"');
  // OptionButton / ItemList items: `items = ["A", null, false, ...]` or popup/items
  const itemsRe = /^\s*(?:items|popup\/item_\d+\/text)\s*=\s*(.+)$/;
  lines.forEach((line, i) => {
    const pm = propRe.exec(line);
    if (pm && pm[2].trim() !== '') {
      out.push({ key: unescapeGd(pm[2]), file, line: i + 1, prop: pm[1] });
      return;
    }
    const im = itemsRe.exec(line);
    if (im) {
      // extract quoted strings from the array; OptionButton items are every
      // element in position 0,4,8,... but surfacing all quoted strings is safe
      const strRe = /"((?:\\.|[^"])*)"/g;
      let s;
      while ((s = strRe.exec(im[1])) !== null) {
        if (s[1].trim() !== '') out.push({ key: unescapeGd(s[1]), file, line: i + 1, prop: 'items' });
      }
    }
  });
  return out;
}

function unescapeGd(s) {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

// ---------------------------------------------------------------------------
// Translation table parsing (CSV + gettext PO)
// ---------------------------------------------------------------------------

// Godot translation CSV: first column "keys", remaining columns are locales.
// Supports quoted fields with embedded commas/newlines/quotes (RFC-4180-ish),
// which Godot's importer accepts. Returns { locales: [..], rows: Map(key -> {locale: value}) }.
function parseCsv(text) {
  const records = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); records.push(row); field = ''; row = []; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); records.push(row); }
  if (!records.length) return { locales: [], rows: new Map(), delimiter: ',' };

  const header = records[0];
  const locales = header.slice(1).map((h) => h.trim()).filter(Boolean);
  const rows = new Map();
  const order = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.length === 1 && rec[0] === '') continue; // blank line
    const key = rec[0];
    if (key === '') continue;
    const values = {};
    locales.forEach((loc, li) => { values[loc] = rec[li + 1] !== undefined ? rec[li + 1] : ''; });
    rows.set(key, values);
    order.push(key);
  }
  return { locales, rows, order };
}

// gettext PO: msgid/msgstr pairs. Returns { entries: Map(msgid -> msgstr) }.
function parsePo(text) {
  const entries = new Map();
  const blocks = text.split(/\n\s*\n/);
  for (const block of blocks) {
    let id = null, str = null, mode = null, idBuf = [], strBuf = [];
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('#') || line === '') continue;
      let m;
      if ((m = /^msgid\s+"((?:\\.|[^"])*)"/.exec(line))) { mode = 'id'; idBuf = [m[1]]; }
      else if ((m = /^msgstr\s+"((?:\\.|[^"])*)"/.exec(line))) { mode = 'str'; strBuf = [m[1]]; }
      else if ((m = /^"((?:\\.|[^"])*)"/.exec(line))) { (mode === 'id' ? idBuf : strBuf).push(m[1]); }
    }
    id = idBuf.join(''); str = strBuf.join('');
    if (id !== null && id !== '') entries.set(unescapePo(id), unescapePo(str));
  }
  return { entries };
}
function unescapePo(s) {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

// ---------------------------------------------------------------------------
// Validators — the value nobody else provides
// ---------------------------------------------------------------------------

// printf-style (%s %d %.2f), Godot format ({0} {1}), and named ({name}) tokens.
function placeholders(s) {
  const set = { positional: [], named: [], printf: [] };
  let m;
  const printfRe = /%(?:\d+\$)?[-+ 0#]*\d*(?:\.\d+)?[diouxXeEfFgGsc%]/g;
  while ((m = printfRe.exec(s)) !== null) if (m[0] !== '%%') set.printf.push(m[0]);
  const posRe = /\{(\d+)\}/g;
  while ((m = posRe.exec(s)) !== null) set.positional.push(m[0]);
  const namedRe = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  while ((m = namedRe.exec(s)) !== null) set.named.push(m[0]);
  return set;
}

function multisetEqual(a, b) {
  if (a.length !== b.length) return false;
  const count = {};
  a.forEach((x) => { count[x] = (count[x] || 0) + 1; });
  for (const x of b) { if (!count[x]) return false; count[x]--; }
  return true;
}

// BBCode tag balance for RichTextLabel strings ([b]..[/b], [color=..]..[/color]).
const BBCODE_PAIRED = ['b', 'i', 'u', 's', 'code', 'color', 'bgcolor', 'fgcolor', 'url', 'font', 'font_size', 'outline_size', 'center', 'right', 'left', 'fill', 'indent', 'wave', 'shake', 'rainbow', 'tornado', 'cell', 'table'];
function bbcodeImbalance(s) {
  const stack = [];
  const re = /\[(\/?)([a-zA-Z_]+)(?:=[^\]]*)?\]/g;
  let m;
  const problems = [];
  while ((m = re.exec(s)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (!BBCODE_PAIRED.includes(tag)) continue; // img, br, etc. are self-contained
    if (!closing) stack.push(tag);
    else {
      if (!stack.length) { problems.push(`stray [/${tag}]`); }
      else if (stack[stack.length - 1] !== tag) { problems.push(`mismatched [/${tag}] (open [${stack[stack.length - 1]}])`); }
      else stack.pop();
    }
  }
  stack.forEach((t) => problems.push(`unclosed [${t}]`));
  return problems;
}

// ---------------------------------------------------------------------------
// The lint engine
// ---------------------------------------------------------------------------

const SEV = { ERROR: 'error', WARN: 'warning', INFO: 'info' };

// options: { locales?: [...], overflowBudget?: {locale: maxLenMultiplier}, sourceLocale?: 'en' }
// project: { usedKeys: [{key,file,line}], table: {locales, rows} }
function lint(project, options = {}) {
  const findings = [];
  const add = (severity, rule, message, extra) => findings.push({ severity, rule, message, ...extra });

  const { usedKeys, table } = project;
  const rows = table.rows;
  const locales = options.locales || table.locales;
  const source = options.sourceLocale || locales[0];

  // dedup used keys, keep first location
  const usedSet = new Map();
  for (const u of usedKeys) if (!usedSet.has(u.key)) usedSet.set(u.key, u);

  // 1. Newline-in-key trap: a key containing a real newline is silently untranslated
  for (const [key, u] of usedSet) {
    if (key.includes('\n')) add(SEV.ERROR, 'newline-key', `Key contains a newline and will never resolve at runtime (Godot returns it verbatim): ${JSON.stringify(key)}`, { file: u.file, line: u.line });
  }

  // 2. Missing key: used in code/scene but absent from the translation table
  for (const [key, u] of usedSet) {
    if (key.includes('\n')) continue;
    if (!rows.has(key)) add(SEV.ERROR, 'missing-key', `Key used in project but not in translation table: ${JSON.stringify(key)}`, { file: u.file, line: u.line });
  }

  // 3. Empty translation for a declared locale -> ships as the key
  for (const [key, values] of rows) {
    for (const loc of locales) {
      if (loc === source) continue;
      const v = values[loc];
      if (v === undefined || v === '') add(SEV.WARN, 'empty-translation', `Empty ${loc} translation for ${JSON.stringify(key)} — ${loc} players will see the untranslated source text at runtime (verified against Godot 4.7)`, { key, locale: loc });
    }
  }

  // 4. Orphan key: in the table but never used in the project
  for (const key of rows.keys()) {
    if (!usedSet.has(key)) add(SEV.WARN, 'orphan-key', `Key in translation table is never used in the project: ${JSON.stringify(key)}`, { key });
  }

  // 5 & 6. Placeholder drift + BBCode imbalance, per translation vs its source
  for (const [key, values] of rows) {
    const src = values[source] !== undefined && values[source] !== '' ? values[source] : key;
    const srcPh = placeholders(src);
    const srcBb = bbcodeImbalance(src);
    if (srcBb.length) add(SEV.WARN, 'bbcode-source', `Source string has unbalanced BBCode (${srcBb.join('; ')}): ${JSON.stringify(key)}`, { key, locale: source });
    for (const loc of locales) {
      if (loc === source) continue;
      const v = values[loc];
      if (v === undefined || v === '') continue; // already flagged empty
      const ph = placeholders(v);
      if (!multisetEqual(srcPh.printf, ph.printf))
        add(SEV.ERROR, 'placeholder-printf', `printf placeholder mismatch in ${loc} for ${JSON.stringify(key)}: source [${srcPh.printf.join(' ')}] vs [${ph.printf.join(' ')}]`, { key, locale: loc });
      if (!multisetEqual(srcPh.positional, ph.positional))
        add(SEV.ERROR, 'placeholder-index', `{n} placeholder mismatch in ${loc} for ${JSON.stringify(key)}: source [${srcPh.positional.join(' ')}] vs [${ph.positional.join(' ')}]`, { key, locale: loc });
      if (!multisetEqual(srcPh.named.filter((n) => !srcPh.positional.includes(n)), ph.named.filter((n) => !ph.positional.includes(n))))
        add(SEV.ERROR, 'placeholder-named', `{name} placeholder mismatch in ${loc} for ${JSON.stringify(key)}: source [${srcPh.named.join(' ')}] vs [${ph.named.join(' ')}]`, { key, locale: loc });
      const bb = bbcodeImbalance(v);
      if (bb.length) add(SEV.ERROR, 'bbcode-imbalance', `Unbalanced BBCode in ${loc} for ${JSON.stringify(key)} (${bb.join('; ')})`, { key, locale: loc });
    }
  }

  // 7. Overflow budget: a translation longer than budget * source length risks UI clipping
  const budget = options.overflowBudget || {};
  for (const [key, values] of rows) {
    const src = values[source] !== undefined && values[source] !== '' ? values[source] : key;
    for (const loc of locales) {
      if (loc === source || budget[loc] === undefined) continue;
      const v = values[loc];
      if (!v) continue;
      if (v.length > budget[loc] * src.length && src.length >= 4)
        add(SEV.WARN, 'overflow', `${loc} translation for ${JSON.stringify(key)} is ${v.length} chars vs source ${src.length} (budget ×${budget[loc]}) — risks UI overflow`, { key, locale: loc });
    }
  }

  const counts = findings.reduce((a, f) => (a[f.severity] = (a[f.severity] || 0) + 1, a), {});
  return { findings, counts, ok: (counts[SEV.ERROR] || 0) === 0 };
}

const CORE = {
  extractFromGDScript, extractFromCSharp, extractFromScene,
  parseCsv, parsePo, placeholders, bbcodeImbalance, multisetEqual, lint, SEV,
  TSCN_TEXT_PROPS,
};
if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
