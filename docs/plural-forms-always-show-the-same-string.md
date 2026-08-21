# Godot 4: every plural shows the same string — what your translation CSV actually does

You wrote `tr_n("COIN", "COINS", n)`. Russian is fully translated. A player with
one coin, two coins and five coins reads the **same word** every time — and the
importer never printed a thing.

The reason is worth stating before anything else, because it makes most of what
you will find while searching actively harmful:

> **The CSV plural format described on page 1 of this question — a
> `_PluralRule` row plus the key repeated once per form — is the syntax of a
> pull request that was never merged**
> ([godot#101471](https://github.com/godotengine/godot/pull/101471), closed;
> that row shape is verbatim from its description). It imports without an
> error. It produces `.translation` files. It does nothing.

Plural support for CSV translations landed in **Godot 4.6**
([godot#112073](https://github.com/godotengine/godot/pull/112073), merged
2025-10-27), after earlier attempts were closed. The shape that shipped is not
the shape the web teaches:

```csv
en,?plural,fr,ru,_Comment
?pluralrule,,nplurals=2; plural=(n >= 2);,,rule for french only
ONE_APPLE,MANY_APPLES,FR_ONE,RU_ONE,c1
,,FR_MANY,RU_FEW,c2
,,,RU_MANY,c3
```

Three things carry the whole format, and each one is a silent failure when you
get it wrong:

1. A **`?plural` column** holds the source plural — the second argument you pass
   to `tr_n()`. Without that column no row is ever a plural row (`P5`).
2. **Continuation rows leave the key column empty.** Repeating the key is the
   habit the old advice teaches, and each repeat *overwrites* the previous form
   (`P3`, `P11`).
3. **One continuation row per form the language needs** — three for Russian,
   six for Arabic — not two because English has two (`P12`).

**Everything below is measured, not remembered.** Each claim carries an id, and
`docs/verify_plurals.js` re-runs all of them against a real engine: it writes
each CSV, imports it with the actual importer, and asks a running Godot what
`tr_n()` returns for each `n`. Measured 2026-08-20 on the official Linux builds
of **4.7.stable** (63 assertions), **4.4.stable** (18) and **4.2.stable** (18) —
99 assertions, 0 failed.

---

## What the format the web teaches actually does (4.6+)

The table under test is the one every tutorial shows: a `keys,en,ru` header, a
`_PluralRule` row, and `COIN` repeated three times.

| id | claim | measured |
|----|-------|----------|
| `P1` | The import **succeeds**. `t.en.translation` and `t.ru.translation` are both written. | true / true |
| `P2` | `_PluralRule` is not special in the **key** column — only a leading `_` in a **column header** is dropped. The rule row becomes an ordinary translatable message. | `tr("_PluralRule")` in ru → `RU_RULE_TEXT` |
| `P3` | Repeated keys overwrite. The table keeps the last row that had a value. | `tr("COIN")` in ru → `RU_MANY` |
| `P4` | An *empty* cell in a later row does not overwrite an earlier value, which is why en and ru end up on different rows of the same table. | `tr("COIN")` in en → `EN_MANY` |
| `P5` | One stored form is served for **every** `n`, with nothing printed anywhere. | `tr_n(COIN, COINS, 1 / 2 / 5 / 21)` in ru → `RU_MANY` ×4, no engine error |

`P5` is the bug as the player meets it: not a crash, not a missing translation —
a Russian player holding one coin reads the many-form wording, forever.

### The same bytes fail differently with compression off

`Compress` in the import dock is on by default. Turn it off and the identical
CSV changes symptom:

| id | claim | measured |
|----|-------|----------|
| `P6` | Only plural index 0 resolves. For Russian that index is n = 1, 21, 31… — so the two numbers you are most likely to test with look **correct**. Every other n falls through to the untranslated source plural, and the engine *does* print the plural error here. | n=1 → `RU_MANY`, n=21 → `RU_MANY`, n=2 → `COINS`, n=5 → `COINS`, n=11 → `COINS` |

Same file on disk, same engine, opposite diagnosis depending on an import
setting. This is why "it works on my machine, it broke in the build" is a common
shape of this report.

---

## What the format that shipped does

| id | claim | measured |
|----|-------|----------|
| `P9` | `?plural` and `_Comment` are not locales and produce **no** `.translation` file; `fr` and `ru` do. | true, true / false, false |
| `P10` | With `compress = Auto` the result is a plain `Translation`, **not** an `OptimizedTranslation` — the importer falls back whenever a table carries plural forms or contexts. | class for fr → `Translation` |
| `P7` | The `?pluralrule` row wins over Godot's built-in rule for that language. The row above declares `n >= 2` for French, so **0 takes the singular** — not the usual gettext French rule. | n=0 → `FR_ONE`, n=1 → `FR_ONE`, n=2 → `FR_MANY`, n=5 → `FR_MANY` |
| `P8` | Russian with all three forms selects correctly across the whole range, including the numbers that trip naive rules. | 1 → `RU_ONE`, 2/3 → `RU_FEW`, 5/11 → `RU_MANY`, 21 → `RU_ONE`, 22 → `RU_FEW`, 0 → `RU_MANY`, no error |

---

## The three ways a correct-looking table is still wrong

| id | what it looks like | what the player gets |
|----|--------------------|----------------------|
| `P11` | Right header, but the key is repeated on the continuation rows instead of left blank. | Each row overwrites the last: n=1 → `RU_MANY`, and **n=2, n=5 → `MANY_APPLES`**, the literal source plural out of your GDScript. Engine prints the plural error. |
| `P12` | Right header, right blank keys — Russian given **two** forms because English has two. | Correct for every number anyone tests with (1 → `RU_ONE`, 2, 3, 22 → `RU_FEW`) and wrong at **n=5, n=11, n=0**, which fall through to `MANY_APPLES`. |
| `P13` | A locale column named `_ru` (a leftover from marking it "not ready"). | The importer drops the column. No `t.ru.translation`, `get_translation_object("ru")` is **null**, and `tr_n()` returns the raw key `ONE_APPLE`. Nothing anywhere says the language is gone. |

`P12` is the one that survives code review. It is *right* for n=1 and n=2. The
form it is missing is Russian's third, which the engine first selects at
**n=0** and, among quantities anyone would actually type, at **n=5** — so the
bug needs five of something to appear. Romanian's third form starts at
**n=20**; Maltese's fourth at **n=11**; Arabic has six forms, the last one
first selected at **n=100**. None of those is a number you test with.

---

## Which Godot versions this applies to

"Old Godot doesn't support it" is not a behaviour, so it is asserted rather than
described:

| id | engine | what happens |
|----|--------|--------------|
| `P15` | 4.3 – 4.5, web-taught format | The trailing empty cell **blanks the English entry** — `tr("COIN")` in en returns the key `COIN`. From 4.6 on the empty cell is ignored (`P4`). A project that upgrades gets a different bug, not a fix. |
| `P14` | 4.3 – 4.5, the 4.6 format | There is no `?plural` column yet, so the header is read as a **locale name** and the importer writes a bogus `t.?plural.translation`. `tr_n()` returns `RU_ONE` for every n. |
| `P18` | 4.2, either format | The plural lookup never reaches the table: both shapes put the untranslated **source** strings on screen (`COIN` / `COINS`, `ONE_APPLE` / `MANY_APPLES`). |

## The answer that works on every version: use a `.po`

| id | claim | measured |
|----|-------|----------|
| `P16` | The same table as gettext `.po` selects all three Russian forms correctly, **on 4.2, 4.4 and 4.7 alike**, with no engine error. | 1 → `RU_ONE`, 2 → `RU_FEW`, 5 → `RU_MANY`, 11 → `RU_MANY`, 21 → `RU_ONE`, 22 → `RU_FEW` |
| `P17` | A `.po` is loaded as a **resource**, not imported: no `.po.import`, no `.translation` file. What was measured is the `.po` listed directly in Project Settings → Localization (`locale/translations`), the same place a `.translation` goes. | false / false |

If you are on 4.5 or earlier and need plurals, this is the whole answer. If you
are on 4.6+, CSV plurals work — provided the table has the three properties at
the top of this page.

---

## Find it in your own table

`docs/check_plural_csv.js` reads your CSVs and reports what is decidable from
the table itself. Zero dependencies, reads only `.csv`, writes nothing, exits 1
on findings:

```bash
node docs/check_plural_csv.js /path/to/your/godot/project
node docs/check_plural_csv.js translations.csv --json
```

| rule | fires when | claim |
|------|-----------|-------|
| `plural-legacy-rule-row` | a `_PluralRule` row — the format that never shipped | `P2` |
| `plural-column-missing` | plural rows without a `?plural` column | `P3` |
| `plural-key-repeated` | the key repeated instead of an empty continuation row | `P11` |
| `plural-missing-form` | fewer forms than the language needs, naming the **smallest n that reproduces it** | `P12` |
| `plural-rule-arity` | a `?pluralrule` declaring an `nplurals` that disagrees with Godot's built-in rule for that language | — |
| `underscore-locale` | a locale column whose header starts with `_` | `P13` |

```
✖ [plural-missing-form] short.csv:2 — key "ONE_APPLE" gives ru 2 plural forms,
  and ru needs 3. n=0 selects a form that is not there, so the player reads the
  untranslated source plural "MANY_APPLES" (P12).
```

The per-language form counts and the first `n` that selects each form are
**derived from the engine**, not copied from gettext: `docs/dump_plural_rules.js`
imports one CSV that gives every locale six distinct forms and calls `tr_n()`
for n = 0…200, one locale at a time. Godot ships its own table, and it is the
engine's rule that decides what the player sees. The 48 locales carried by the
scanner were re-derived on 4.7.stable on 2026-08-20 and matched, form count and
first-n, on all 48. When a release changes a rule this is a re-run and a diff,
not a rewrite.

Run against the official `godotengine/godot-demo-projects`, the scanner reports
**1 translation CSV, no plural defect, exit 0** — the demos carry a translation
table and no plurals at all. A clean result is a statement about your *table*:
whether the game calls `tr_n()` at all, and with which key, is a question about
your source that no table can answer.

---

## Why this is not one of LocGuard's rules

[LocGuard](../README.md) is a linter over your **translation table**: missing
keys, empty translations, placeholder drift, unbalanced BBCode. Every one of
those is decidable from the CSV plus the keys your project uses, and every one
of them is about a single string.

Plural forms are a different kind of claim. `P12` — Russian carrying two of the
three forms it needs — is a table where every key exists, every cell is filled
and no placeholder drifted. The linter is right to call it clean, because the
question "does this language have enough forms, and which n proves it" is
answered by the engine's plural rule and not by the table. That is why it ships
as the standalone scanner above rather than as a rule that would answer from the
wrong evidence.

[LocGuard](../README.md) is the free MIT CLI for the table half, so those checks
land in CI instead of in a review. [LocGuard
Pro](https://blobsmith.itch.io/locguard) adds the in-editor dock and ready-made
CI presets. Neither one carries the plural check on this page today — the
scanner above is the tool that answers this question.

> Different symptom? The raw key on screen in every language is
> **[the complete checklist](missing-translations-checklist.md)**; a string
> frozen in the language it was built in is **[what actually
> froze](locale-switch-does-not-update-ui.md)**; boxes instead of letters is
> **[the glyph question](font-glyphs-missing-in-translations.md)**.

---

*Measured on Godot 4.7.stable, 4.4.stable and 4.2.stable (official Linux
builds), 2026-08-20 — 99 assertions, 0 failed. Re-run every claim yourself with
`node docs/verify_plurals.js <godot-binary>`; if a future engine build changes an
answer, the script says which id and how.*
