#!/usr/bin/env node
// Derives Godot's BUILT-IN plural rules -- how many forms each language has and
// which n selects which form -- by asking the engine, one locale at a time.
//
//   node docs/dump_plural_rules.js /path/to/Godot_v4.7-stable_linux.x86_64
//   node docs/dump_plural_rules.js /path/to/godot --json > rules.json
//
// The table this prints is what docs/plural-scan-core.js carries. It is derived
// rather than copied from gettext on purpose: what decides whether a player sees
// a real translation or the raw source string is the rule the ENGINE applies, and
// Godot ships its own table. When a Godot release changes one, this is a re-run
// and a diff, not a rewrite.
//
// Method: import one CSV that gives every locale six distinct plural forms
// (F0..F5), then call tr_n() for n = 0..200 and record which form comes back.
// The number of distinct forms a locale ever returns is its plural count, and the
// smallest n that reaches each form is what makes a missing form findable.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GODOT = process.argv[2];
const JSON_OUT = process.argv.includes('--json');
if (!GODOT || !fs.existsSync(GODOT)) {
  console.error('usage: node docs/dump_plural_rules.js /path/to/godot-binary [--json]');
  process.exit(2);
}

// Locales worth knowing about for a game: the ones itch.io and Steam ship most,
// plus the high-form Slavic and Arabic cases that are the whole reason this
// check exists.
const LOCALES = [
  'en', 'fr', 'de', 'es', 'pt', 'pt_BR', 'it', 'nl', 'sv', 'da', 'nb', 'fi',
  'pl', 'ru', 'uk', 'cs', 'sk', 'sl', 'hr', 'sr', 'lt', 'lv', 'ro', 'bg', 'el',
  'hu', 'tr', 'he', 'ar', 'fa', 'hi', 'th', 'vi', 'id', 'ms', 'ja', 'ko',
  'zh', 'zh_CN', 'zh_TW', 'ca', 'eu', 'gl', 'et', 'is', 'ga', 'cy', 'mt',
];
const FORMS = 6;
const MAX_N = 200;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgrules-'));
fs.writeFileSync(path.join(dir, 'project.godot'),
  'config_version=5\n\n[application]\nconfig/name="LocGuardPluralRules"\n');

// Header: key column, the source plural column, then one column per locale.
const header = ['en', '?plural', ...LOCALES].join(',');
const rows = [header, ['ONE', 'MANY', ...LOCALES.map(() => 'F0')].join(',')];
for (let f = 1; f < FORMS; f++) rows.push(['', '', ...LOCALES.map(() => 'F' + f)].join(','));
fs.writeFileSync(path.join(dir, 't.csv'), rows.join('\n') + '\n');

spawnSync(GODOT, ['--headless', '--path', dir, '--import'], { encoding: 'utf8' });
const produced = fs.readdirSync(dir).filter((f) => f.endsWith('.translation'));
fs.appendFileSync(path.join(dir, 'project.godot'),
  '\n[internationalization]\n\nlocale/translations=PackedStringArray(' +
  produced.map((f) => JSON.stringify('res://' + f)).join(', ') + ')\n');

fs.writeFileSync(path.join(dir, 'probe.gd'), `extends SceneTree

func _init():
	var locales: Array = JSON.parse_string(FileAccess.get_file_as_string("res://locales.json"))
	for loc in locales:
		TranslationServer.set_locale(loc)
		# The locale the server actually settled on can differ from the request
		# (pt_BR, zh_CN); print it so an unmatched locale is visible, not guessed.
		var got := TranslationServer.get_locale()
		var seq := PackedStringArray()
		for n in range(${MAX_N} + 1):
			seq.append(tr_n("ONE", "MANY", n))
		print("##L#", loc, "#", got, "#", ",".join(seq))
	quit(0)
`);
fs.writeFileSync(path.join(dir, 'locales.json'), JSON.stringify(LOCALES));

const run = spawnSync(GODOT, ['--headless', '--path', dir, '--script', 'probe.gd'], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});

const table = {};
const detail = {};
for (const line of (run.stdout || '').split('\n')) {
  const m = /^##L#([^#]*)#([^#]*)#(.*)$/.exec(line.trimEnd());
  if (!m) continue;
  const [, want, got, csv] = m;
  const seq = csv.split(',');
  // A locale Godot did not load at all answers with the untranslated source.
  if (seq.every((v) => v === 'ONE' || v === 'MANY')) { detail[want] = { got, unmatched: true }; continue; }
  const firstN = {};
  for (let n = 0; n < seq.length; n++) if (!(seq[n] in firstN)) firstN[seq[n]] = n;
  const forms = Object.keys(firstN).filter((f) => /^F\d$/.test(f)).sort();
  table[want] = forms.length;
  detail[want] = { got, nplurals: forms.length, firstN };
}

fs.rmSync(dir, { recursive: true, force: true });

if (JSON_OUT) { console.log(JSON.stringify({ table, detail }, null, 2)); process.exit(0); }
for (const loc of LOCALES) {
  const d = detail[loc];
  if (!d) { console.log(loc.padEnd(6) + ' (no answer)'); continue; }
  if (d.unmatched) { console.log(loc.padEnd(6) + ' locale not loaded (server reports "' + d.got + '")'); continue; }
  const ex = Object.entries(d.firstN).filter(([f]) => /^F\d$/.test(f))
    .sort().map(([f, n]) => f + '@n=' + n).join(' ');
  console.log(loc.padEnd(6) + ' nplurals=' + d.nplurals + '  ' + ex);
}
