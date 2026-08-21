#!/usr/bin/env node
// Runs every claim in docs/plural-forms-always-show-the-same-string.md against a
// real Godot 4 binary.
//
//   node docs/verify_plurals.js /path/to/Godot_v4.7-stable_linux.x86_64
//   node docs/verify_plurals.js /path/to/godot --selftest
//
// WHY THIS FILE EXISTS AT ALL
// ---------------------------
// Plural support for CSV translations landed in Godot 4.6 (godot#112073, merged
// 2025-10-27) after three earlier attempts were closed. The format that every
// page currently on the first page of a search describes -- a `_PluralRule` row
// plus the key repeated once per form -- is the syntax of one of the attempts
// that did NOT ship (godot#101471). It parses, it imports without an error, and
// it does nothing.
//
// So the point of this harness is not to quote the changelog. It imports each
// CSV shape with the real importer, registers the result, and asks the engine
// what tr_n() actually returns for each n -- including the numbers a developer
// does not test with. The claim ids below are the ids in the doc.
//
// The version gate is real, not decorative: cases 3-6 describe behaviour that
// only exists in 4.6+, and on an older binary the same bytes produce a
// translation file named `t.?plural.translation` (P14), which is asserted too.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GODOT = process.argv[2];
const SELFTEST = process.argv.includes('--selftest');
if (!GODOT || !fs.existsSync(GODOT)) {
  console.error('usage: node docs/verify_plurals.js /path/to/godot-binary [--selftest]');
  process.exit(2);
}

// The probe is deliberately generic: it takes a list of queries and prints one
// marked line per answer, so every expectation lives here in one table instead
// of being spread across a .gd file that would have to be kept in sync.
const PROBE_GD = `extends SceneTree

func _init():
	var raw := FileAccess.get_file_as_string("res://queries.json")
	var q = JSON.parse_string(raw)
	print("##V#", Engine.get_version_info().string)
	print("##L#", ",".join(TranslationServer.get_loaded_locales()))
	for item in q:
		var loc: String = item["locale"]
		TranslationServer.set_locale(loc)
		var t := TranslationServer.get_translation_object(loc)
		print("##C#", item["id"], "#", ("NULL" if t == null else t.get_class()))
		if item.has("n"):
			print("##R#", item["id"], "#", tr_n(item["s"], item["p"], int(item["n"])))
		else:
			print("##R#", item["id"], "#", tr(item["s"]))
	quit(0)
`;

// The exact string the engine prints when a plural index resolves to a form the
// table does not have. It is the only runtime signal any of these defects give,
// and it goes to stderr -- which is nowhere, in a shipped game.
const PLURAL_ERR = 'Plural index returned or number of plural translations is not valid.';

// ---------------------------------------------------------------------------
// The CSV shapes
// ---------------------------------------------------------------------------
// Marker values (RU_ONE, RU_FEW, ...) instead of real words on purpose: every
// assertion below then names the *form* that reached the screen, so a failure
// reads as "the many-form was served for n=1" rather than as two similar
// Russian strings.

// What the web teaches. No `?plural` column, so no plural row is ever enabled;
// `_PluralRule` sits in the KEY column, and only a leading underscore in a
// COLUMN HEADER is ignored by the importer.
const CSV_WEB_ADVICE = `keys,en,ru
_PluralRule,EN_RULE_TEXT,RU_RULE_TEXT
COIN,EN_ONE,RU_ONE
COIN,EN_MANY,RU_FEW
COIN,,RU_MANY
PLAIN,EN_PLAIN,RU_PLAIN
`;

// The format that shipped. `?plural` holds the source plural; the continuation
// rows leave the key column and every special column empty. `_Comment` is
// dropped because its header starts with an underscore.
const CSV_CORRECT = `en,?plural,fr,ru,_Comment
?pluralrule,,nplurals=2; plural=(n >= 2);,,rule for french only
ONE_APPLE,MANY_APPLES,FR_ONE,RU_ONE,c1
,,FR_MANY,RU_FEW,c2
,,,RU_MANY,c3
`;

// The mistake anyone carrying the old advice forward will make: repeat the key
// instead of leaving it blank. Each row then overwrites the previous one.
const CSV_KEY_REPEATED = `en,?plural,fr,ru
ONE_APPLE,MANY_APPLES,FR_ONE,RU_ONE
ONE_APPLE,,FR_MANY,RU_FEW
ONE_APPLE,,,RU_MANY
`;

// Correct shape, but Russian needs three forms and only two rows exist. This is
// the one that survives review: it is right for every number a developer types.
const CSV_SHORT_FORMS = `en,?plural,fr,ru
ONE_APPLE,MANY_APPLES,FR_ONE,RU_ONE
,,FR_MANY,RU_FEW
`;

// A locale column whose header starts with an underscore. The importer drops the
// column; nothing anywhere says the language is gone.
const CSV_UNDERSCORE_LOCALE = `en,?plural,fr,_ru
ONE_APPLE,MANY_APPLES,FR_ONE,RU_ONE
,,FR_MANY,RU_FEW
`;

const PO_RU = `msgid ""
msgstr ""
"Language: ru\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=3; plural=n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2;\\n"

msgid "ONE_APPLE"
msgid_plural "MANY_APPLES"
msgstr[0] "RU_ONE"
msgstr[1] "RU_FEW"
msgstr[2] "RU_MANY"
`;

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------
// `expect` is a list of [claimId, what, expected]. `what` is either
// {locale, s}                -> tr(s)
// {locale, s, p, n}          -> tr_n(s, p, n)
// {file: 'name'}             -> that file exists after import (true/false)
// {stderr: true}             -> the engine printed PLURAL_ERR at least once
// {class: 'locale'}          -> the class name of the translation object

const CASES = [];

CASES.push({
  name: 'the format the web teaches (compress = Auto, the default)',
  minor: 6,
  files: { 't.csv': CSV_WEB_ADVICE },
  expect: [
    ['P1', { file: 't.en.translation' }, true],
    ['P1', { file: 't.ru.translation' }, true],
    // Only a column header starting with "_" is ignored. A KEY starting with
    // "_" is just a key, so the rule row becomes a translatable message.
    ['P2', { locale: 'ru', s: '_PluralRule' }, 'RU_RULE_TEXT'],
    // Repeated keys overwrite: the table keeps the last row that had a value.
    ['P3', { locale: 'ru', s: 'COIN' }, 'RU_MANY'],
    // ...but an EMPTY cell in a later row does not overwrite an earlier value,
    // which is why en keeps row 2 while ru keeps row 3.
    ['P4', { locale: 'en', s: 'COIN' }, 'EN_MANY'],
    // One stored form, served for every n, with no error anywhere: a Russian
    // player reading "1" gets the many-form wording.
    ['P5', { locale: 'ru', s: 'COIN', p: 'COINS', n: 1 }, 'RU_MANY'],
    ['P5', { locale: 'ru', s: 'COIN', p: 'COINS', n: 2 }, 'RU_MANY'],
    ['P5', { locale: 'ru', s: 'COIN', p: 'COINS', n: 5 }, 'RU_MANY'],
    ['P5', { locale: 'ru', s: 'COIN', p: 'COINS', n: 21 }, 'RU_MANY'],
    ['P5', { stderr: true }, false],
  ],
});

CASES.push({
  name: 'the same CSV with compression disabled',
  minor: 6,
  files: { 't.csv': CSV_WEB_ADVICE },
  compress: 0,
  expect: [
    // Same bytes on disk, different failure: only plural index 0 resolves.
    // Russian index 0 is n = 1, 21, 31... -- so those two numbers look fine.
    ['P6', { locale: 'ru', s: 'COIN', p: 'COINS', n: 1 }, 'RU_MANY'],
    ['P6', { locale: 'ru', s: 'COIN', p: 'COINS', n: 21 }, 'RU_MANY'],
    // Every other index falls through to the untranslated source plural, so the
    // literal msgid_plural from the source code is what the player reads.
    ['P6', { locale: 'ru', s: 'COIN', p: 'COINS', n: 2 }, 'COINS'],
    ['P6', { locale: 'ru', s: 'COIN', p: 'COINS', n: 5 }, 'COINS'],
    ['P6', { locale: 'ru', s: 'COIN', p: 'COINS', n: 11 }, 'COINS'],
    ['P6', { stderr: true }, true],
  ],
});

CASES.push({
  name: 'the format that shipped in 4.6',
  minor: 6,
  files: { 't.csv': CSV_CORRECT },
  expect: [
    // `?plural` and `_Comment` are not locales and produce no file.
    ['P9', { file: 't.fr.translation' }, true],
    ['P9', { file: 't.ru.translation' }, true],
    ['P9', { file: 't.?plural.translation' }, false],
    ['P9', { file: 't._Comment.translation' }, false],
    // compress=Auto, yet not an OptimizedTranslation: the importer falls back to
    // Translation whenever a table carries plural forms or contexts.
    ['P10', { class: 'fr' }, 'Translation'],
    // French here uses the rule supplied in the ?pluralrule row, n >= 2, which
    // is NOT the usual gettext French rule -- 0 takes the singular.
    ['P7', { locale: 'fr', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 0 }, 'FR_ONE'],
    ['P7', { locale: 'fr', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 1 }, 'FR_ONE'],
    ['P7', { locale: 'fr', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 2 }, 'FR_MANY'],
    ['P7', { locale: 'fr', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 5 }, 'FR_MANY'],
    // Russian was given NO rule and still selects all three forms correctly:
    // Godot ships built-in plural rules per language.
    ['P8', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 1 }, 'RU_ONE'],
    ['P8', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 2 }, 'RU_FEW'],
    ['P8', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 3 }, 'RU_FEW'],
    ['P8', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 5 }, 'RU_MANY'],
    ['P8', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 11 }, 'RU_MANY'],
    ['P8', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 21 }, 'RU_ONE'],
    ['P8', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 22 }, 'RU_FEW'],
    ['P8', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 0 }, 'RU_MANY'],
    ['P8', { stderr: true }, false],
  ],
});

CASES.push({
  name: 'the key repeated on the continuation rows',
  minor: 6,
  files: { 't.csv': CSV_KEY_REPEATED },
  expect: [
    // Every repeat overwrites, so the table declares three forms and holds one.
    ['P11', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 1 }, 'RU_MANY'],
    ['P11', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 2 }, 'MANY_APPLES'],
    ['P11', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 5 }, 'MANY_APPLES'],
    ['P11', { locale: 'fr', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 1 }, 'FR_MANY'],
    ['P11', { locale: 'fr', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 2 }, 'MANY_APPLES'],
    ['P11', { stderr: true }, true],
  ],
});

CASES.push({
  name: 'Russian given two of the three forms its rule asks for',
  minor: 6,
  files: { 't.csv': CSV_SHORT_FORMS },
  expect: [
    // 1, 2 and 3 are right. This is what testing usually covers.
    ['P12', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 1 }, 'RU_ONE'],
    ['P12', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 2 }, 'RU_FEW'],
    ['P12', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 3 }, 'RU_FEW'],
    ['P12', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 22 }, 'RU_FEW'],
    // 5, 11 and 0 take the third form, which is not there.
    ['P12', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 5 }, 'MANY_APPLES'],
    ['P12', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 11 }, 'MANY_APPLES'],
    ['P12', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 0 }, 'MANY_APPLES'],
    // French only needs two, and French is fine -- which is how this ships.
    ['P12', { locale: 'fr', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 5 }, 'FR_MANY'],
    ['P12', { stderr: true }, true],
  ],
});

CASES.push({
  name: 'a locale column named _ru',
  minor: 6,
  files: { 't.csv': CSV_UNDERSCORE_LOCALE },
  expect: [
    ['P13', { file: 't.fr.translation' }, true],
    ['P13', { file: 't.ru.translation' }, false],
    ['P13', { file: 't._ru.translation' }, false],
    // The language is not merely untranslated, it does not exist.
    ['P13', { class: 'ru' }, 'NULL'],
    ['P13', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 1 }, 'ONE_APPLE'],
  ],
});

CASES.push({
  name: 'the same table as a .po file',
  minor: 0,
  files: { 'ru.po': PO_RU },
  register: ['res://ru.po'],
  expect: [
    // A .po is loaded as a resource, not imported: no .import, no .translation.
    ['P17', { file: 'ru.po.import' }, false],
    ['P17', { file: 'ru.translation' }, false],
    // ...and it selects all three Russian forms, on every version tested.
    ['P16', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 1 }, 'RU_ONE'],
    ['P16', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 2 }, 'RU_FEW'],
    ['P16', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 5 }, 'RU_MANY'],
    ['P16', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 11 }, 'RU_MANY'],
    ['P16', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 21 }, 'RU_ONE'],
    ['P16', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 22 }, 'RU_FEW'],
    ['P16', { stderr: true }, false],
  ],
});

// Before 4.6 the web-advice shape fails in yet another way, and more quietly:
// there are no built-in plural rules to disagree with, so nothing is ever
// printed and every n takes the one stored form -- in both compression modes.
CASES.push({
  name: 'the format the web teaches, on an older engine',
  minor: 3,
  maxMinor: 5,
  files: { 't.csv': CSV_WEB_ADVICE },
  expect: [
    // The difference that bites a project upgrading TO 4.6: here the empty cell
    // in the last repeated row blanks the English entry, so tr() returns the key.
    // From 4.6 on, the empty cell is ignored and the earlier value survives (P4).
    ['P15', { locale: 'en', s: 'COIN' }, 'COIN'],
    ['P15', { locale: 'ru', s: 'COIN', p: 'COINS', n: 1 }, 'RU_MANY'],
    ['P15', { locale: 'ru', s: 'COIN', p: 'COINS', n: 2 }, 'RU_MANY'],
    ['P15', { locale: 'ru', s: 'COIN', p: 'COINS', n: 5 }, 'RU_MANY'],
    ['P15', { stderr: true }, false],
  ],
});

// Before 4.6 there is no ?plural column, so the header is read as a locale name
// and the importer writes a file for it.
CASES.push({
  name: 'the 4.6 format on an older engine',
  minor: 3,
  maxMinor: 5,
  files: { 't.csv': CSV_CORRECT },
  expect: [
    ['P14', { file: 't.?plural.translation' }, true],
    ['P14', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 1 }, 'RU_ONE'],
    ['P14', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 2 }, 'RU_ONE'],
    ['P14', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 5 }, 'RU_ONE'],
  ],
});

// 4.2 is the floor of the range this repo supports, and it answers differently
// from 4.3-4.5 again: the plural lookup does not reach the table at all, so both
// CSV shapes put the untranslated source strings on screen. Asserted rather than
// described, because "old Godot" is not a behaviour.
CASES.push({
  name: 'the format the web teaches, on 4.2',
  maxMinor: 2,
  files: { 't.csv': CSV_WEB_ADVICE },
  expect: [
    ['P18', { locale: 'en', s: 'COIN' }, 'COIN'],
    ['P18', { locale: 'ru', s: 'COIN', p: 'COINS', n: 1 }, 'COIN'],
    ['P18', { locale: 'ru', s: 'COIN', p: 'COINS', n: 2 }, 'COINS'],
    ['P18', { locale: 'ru', s: 'COIN', p: 'COINS', n: 5 }, 'COINS'],
    ['P18', { stderr: true }, false],
  ],
});

CASES.push({
  name: 'the 4.6 format on 4.2',
  maxMinor: 2,
  files: { 't.csv': CSV_CORRECT },
  expect: [
    // 4.4 writes a bogus `t.?plural.translation` here (P14); 4.2 writes nothing
    // and the source strings reach the player either way.
    ['P18', { file: 't.?plural.translation' }, false],
    ['P18', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 1 }, 'ONE_APPLE'],
    ['P18', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 2 }, 'MANY_APPLES'],
    ['P18', { locale: 'ru', s: 'ONE_APPLE', p: 'MANY_APPLES', n: 5 }, 'MANY_APPLES'],
  ],
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function godotMinor() {
  const out = spawnSync(GODOT, ['--version'], { encoding: 'utf8' });
  const m = /^(\d+)\.(\d+)/m.exec((out.stdout || '') + (out.stderr || ''));
  if (!m) throw new Error('could not read a version out of ' + GODOT + ' --version');
  return { major: Number(m[1]), minor: Number(m[2]), text: m[0] };
}

function runCase(c) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgplural-'));
  fs.writeFileSync(path.join(dir, 'project.godot'),
    'config_version=5\n\n[application]\nconfig/name="LocGuardPluralCheck"\n');
  for (const [name, body] of Object.entries(c.files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }

  // Pass 1: import. The CSV importer only runs inside the editor, so this is a
  // real editor boot; .po needs no import at all and simply survives it.
  spawnSync(GODOT, ['--headless', '--path', dir, '--import'], { encoding: 'utf8' });

  // compress is an import option, so it is set after the .import file exists and
  // the table is then re-imported.
  if (c.compress !== undefined) {
    const imp = path.join(dir, 't.csv.import');
    fs.writeFileSync(imp, fs.readFileSync(imp, 'utf8').replace(/^compress=.*$/m, 'compress=' + c.compress));
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.translation')) fs.unlinkSync(path.join(dir, f));
    }
    spawnSync(GODOT, ['--headless', '--path', dir, '--import'], { encoding: 'utf8' });
  }

  const produced = fs.readdirSync(dir).filter((f) => f.endsWith('.translation'));
  const register = c.register || produced.map((f) => 'res://' + f);
  fs.appendFileSync(path.join(dir, 'project.godot'),
    '\n[internationalization]\n\nlocale/translations=PackedStringArray(' +
    register.map((r) => JSON.stringify(r)).join(', ') + ')\n');

  // One query per expectation that needs the engine, in order.
  const queries = [];
  for (const [id, what] of c.expect) {
    if (what.locale) queries.push({ id, locale: what.locale, s: what.s, p: what.p || '', ...(what.n !== undefined ? { n: what.n } : {}) });
    else if (what.class) queries.push({ id, locale: what.class, s: '__class_probe__' });
  }
  fs.writeFileSync(path.join(dir, 'queries.json'), JSON.stringify(queries));
  fs.writeFileSync(path.join(dir, 'probe.gd'), PROBE_GD);

  const run = spawnSync(GODOT, ['--headless', '--path', dir, '--script', 'probe.gd'], { encoding: 'utf8' });
  const stdout = run.stdout || '';
  const stderr = (run.stderr || '') + stdout;

  const answers = [];
  const classes = [];
  for (const line of stdout.split('\n')) {
    let m = /^##R#([^#]*)#([\s\S]*)$/.exec(line.trimEnd());
    if (m) { answers.push(m[2]); continue; }
    m = /^##C#([^#]*)#([\s\S]*)$/.exec(line.trimEnd());
    if (m) classes.push(m[2]);
  }

  const files = fs.readdirSync(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return { files, produced, answers, classes, sawPluralErr: stderr.includes(PLURAL_ERR) };
}

function main() {
  const v = godotMinor();
  console.log('# engine: ' + v.text + '  (' + GODOT + ')');
  let pass = 0;
  let ranCases = 0;
  const failures = [];

  for (const c of CASES) {
    if (c.minor !== undefined && v.minor < c.minor) { console.log('- skip (needs 4.' + c.minor + '+): ' + c.name); continue; }
    if (c.maxMinor !== undefined && v.minor > c.maxMinor) { console.log('- skip (only 4.' + c.maxMinor + ' and older): ' + c.name); continue; }

    const r = runCase(c);
    ranCases++;
    console.log('\n## ' + c.name);
    let qi = 0;
    for (let i = 0; i < c.expect.length; i++) {
      const [id, what, expectedRaw] = c.expect[i];
      // --selftest seeds two wrong expectations and requires the run to go red.
      const seeded = SELFTEST && i === 0 && ranCases <= 2;
      const expected = seeded ? '__seeded_wrong__' : expectedRaw;

      let actual;
      if (what.file !== undefined) actual = r.files.includes(what.file);
      else if (what.stderr !== undefined) actual = r.sawPluralErr;
      else if (what.class !== undefined) actual = r.classes[qi++];
      else actual = r.answers[qi++];

      const ok = String(actual) === String(expected);
      const label = what.file !== undefined ? 'file ' + what.file
        : what.stderr !== undefined ? 'engine printed the plural error'
        : what.class !== undefined ? 'translation object class for ' + what.class
        : what.n !== undefined ? 'tr_n(' + what.s + ', ' + what.p + ', ' + what.n + ') in ' + what.locale
        : 'tr(' + what.s + ') in ' + what.locale;
      console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + id + '  ' + label + ' -> ' + JSON.stringify(String(actual)) +
        (ok ? '' : '   expected ' + JSON.stringify(String(expected))));
      if (ok) pass++; else failures.push(id + ' ' + label);
    }
  }

  console.log('\nRESULT: ' + pass + ' passed, ' + failures.length + ' failed');
  if (SELFTEST) {
    if (failures.length === 0) { console.log('SELFTEST FAILED: seeded expectations did not go red'); process.exit(1); }
    console.log('SELFTEST OK: ' + failures.length + ' seeded failure(s) detected');
    process.exit(0);
  }
  process.exit(failures.length ? 1 : 0);
}

main();
