# Godot 4 shows the raw key instead of the translation — the complete checklist

You wrote `tr("MENU_START")`, you filled in the CSV, and the game prints
`MENU_START`. Godot will not warn you: a failed lookup returns the key
verbatim, with no error, no push_warning, nothing in the debugger. Same for a
`Label` whose `text` is a key, and same in an exported build.

This page lists every cause we could reproduce, each with the symptom, a
one-line test you can paste, and the fix. It also says which ones a linter can
catch and which ones it structurally cannot.

**Everything here is measured, not remembered.** Each claim carries an id like
`R2` or `C4a` that maps to an assertion in
[`verify_translation_behavior.gd`](verify_translation_behavior.gd), run against
Godot **4.7.stable.official.5b4e0cb0f**:

```
docs/verify_translation_behavior.sh /path/to/Godot_v4.7-stable_linux.x86_64
# ### pass 1 — default project (fallback locale = en)
# RESULT: 32 passed, 0 failed, 0 skipped
# ### pass 2 — same tables, fallback locale cleared
# RESULT: 32 passed, 0 failed, 0 skipped
```

Three claims are marked *cited, not measured* — they are the ones that live in
the editor, which has no headless entry point. They say so where they appear.

---

## 60-second triage

Run these three in order before reading anything else. They split the problem
space in one pass.

```gdscript
print(TranslationServer.get_loaded_locales())   # 1. is anything loaded at all?
print(TranslationServer.get_locale())           # 2. which locale is actually active?
print(JSON.stringify(tr("MENU_START")))         # 3. what comes back, quoted?
```

| What you see | Go to |
|---|---|
| `[]` — empty array | [A1](#a1-the-translation-files-were-never-registered) — nothing is loaded; the keys are irrelevant |
| locale list looks right, but your locale is missing from it | [A2](#a2-the-active-locale-has-no-table-and-nothing-catches-it) |
| step 3 prints the key with a **space, different case, or `\n` inside** | [B](#b--the-table-is-loaded-but-your-key-does-not-match) |
| step 3 prints the key exactly, and the key *is* in the CSV | [B5](#b5-the-key-is-in-the-csv-under-a-different-byte-sequence), then [A1](#a1-the-translation-files-were-never-registered) |
| step 3 prints the **translation**, but the screen still shows the key | [C](#c--it-translates-in-code-but-not-on-screen) |
| everything looks fine in your language and breaks for players | [D](#d--why-your-own-testing-missed-it) |

Quoting with `JSON.stringify` in step 3 is not decoration: `"MENU_START "` and
`"MENU_START"` are visually identical in the output panel and are different
keys (`R2`).

---

## A — nothing is loaded

### A1. The translation files were never registered

Importing a CSV produces the `.translation` files but does **not** add them to
the project. We ran `godot --headless --path proj --import` on a project with a
valid `loc.csv`: `loc.en.translation` and `loc.es.translation` appeared on disk,
and `internationalization/locale/translations` stayed an empty array. At
runtime `get_loaded_locales()` returned `[]` and every `tr()` returned its key
(`C1`).

The files existing is not the same as the files being loaded. This is the one
cause where the CSV, the keys and the code are all correct and nothing works.

- **Symptom:** every string is a raw key, in every locale, all at once.
- **Test:** `print(TranslationServer.get_loaded_locales())` → `[]`.
- **Fix:** Project Settings → Localization → Translations → add each
  `.translation` file. It writes
  `internationalization/locale/translations=PackedStringArray(...)` into
  `project.godot` — check that line into git and verify it after any merge.
- **Linter:** not detected. LocGuard reads your CSV and your code; it does not
  read `locale/translations`. Measured on a project with this exact defect: 0
  findings, exit 0.

### A2. The active locale has no table, and nothing catches it

With `locale/fallback` at its default `"en"`, setting an unsupported locale
does *not* give you raw keys — it silently gives you English (`R7`). With the
fallback cleared, the same call returns the key (`R7e`).

- **Symptom:** one locale shows raw keys (fallback off) or silently shows the
  source language (fallback on).
- **Test:** `print(TranslationServer.get_locale(), TranslationServer.get_loaded_locales())`
  — is the active locale in the list, or matched by [A3](#a3-locale-matching-is-more-generous-than-you-think)?
- **Fix:** ship a table for it, or set the locale to one you have.
- **Linter:** conditional. LocGuard only knows the locales in your CSV header
  unless you pass `--locales en,es,fr`; with the missing locale named, every
  key is reported as an `empty-translation` warning for it. Measured: 4 → 10
  warnings on the same project once `fr` was declared.

### A3. Locale matching is more generous than you think

Worth knowing so you stop suspecting it. A partial match resolves:

- `set_locale("es_MX")` against an `es`-only table → translates (`R8`).
- `set_locale("pt")` against a `pt_BR`-only table → translates (`R9`).
- `compare_locales("es", "es_MX")` > 0, `compare_locales("en", "fr")` == 0 (`R9b`, `R9c`).

What *is* brittle is case. `standardize_locale()` drops a country code that is
the language's default (`"pt-br"` → `"pt"`, `"en_us"` → `"en"`), keeps a
non-default one (`"es-MX"` → `"es_MX"`), and leaves an uppercased language
string untouched (`"PT_BR"` → `"PT_BR"`) (`R10a`, `R10b`, `R10c`). If you build
locale strings from a save file, a URL parameter or a filename, normalize the
case yourself before handing them to `set_locale()`.

---

## B — the table is loaded, but your key does not match

Lookup is an exact byte comparison. No trimming, no case folding, no
normalization. Five ways that bites:

### B1. A trailing or leading space

`tr("MENU_START ")` returns `"MENU_START "` while `MENU_START` sits right there
in the table (`R2`). A space at the end of a `.tscn` `text =` property or a CSV
cell is invisible in every editor you will look at it in.

- **Test:** `print(JSON.stringify(tr("YOUR_KEY")))` — the quotes expose it.
- **Fix:** strip it in the CSV and in the scene.
- **Linter:** detected, as a *pair*: `missing-key` for `"MENU_START "` plus
  `orphan-key` for `"MENU_START"`. That pair — same key, one used, one
  orphaned — is the signature of every cause in section B.

### B2. Different case

`MENU_START`, `menu_start` and `Menu_Start` are three keys (`R3`, `R3b`).

- **Fix:** pick one convention (`SCREAMING_SNAKE` is the common one) and make
  it a review rule.
- **Linter:** detected, same `missing-key` + `orphan-key` pair.

### B3. A newline inside the key — and the `\n` asymmetry behind it

This one is a genuine trap, because the CSV importer treats keys and values
differently. Its default parameters are `unescape_keys=false` and
`unescape_translations=true`, and we measured both halves:

- A key written `LINE\nBREAK` in the CSV imports as **eleven characters with a
  literal backslash and n** (`C4a`).
- The same `\n` in a *value* imports as a real newline (`C4c`).
- So `tr("LINE\nBREAK")` in GDScript — where `\n` *is* a newline — looks up a
  key that does not exist and returns itself (`C4b`, `R4`).

You cannot fix this by writing the key more carefully in GDScript: the two
representations can never meet as long as `unescape_keys` is off.

- **Test:** `print(JSON.stringify(tr("LINE\nBREAK")))` → prints the key with a
  `\n` in it.
- **Fix:** never put `\n` in a key. Keys are identifiers; put the line break in
  the translation, where it is unescaped for you.
- **Linter:** detected as a `newline-key` **error** — the one rule that exists
  precisely because the engine cannot resolve such a key under any table.

### B4. Padding inside quotes in the CSV

`" QUOTED_PAD "` imports with its spaces intact; `"QUOTED_PAD"` does not find
it (`C2b`). Quoting a CSV field protects the padding, it does not trim it.

- **Fix:** only quote fields that need it (embedded commas, quotes, newlines).
  A comma inside a quoted key does survive the round trip correctly (`C3`).
- **Linter:** detected, `missing-key` + `orphan-key` pair.

### B5. The key is in the CSV under a different byte sequence

If B1–B4 all look clean, dump what actually got imported instead of reading the
CSV again:

```gdscript
var t := load("res://loc.es.translation") as Translation
print(JSON.stringify(str(t.get_message("MENU_START"))))   # "" means: not that key
```

An empty string means the key is not in that table under that exact spelling —
regardless of what the spreadsheet shows you.

---

## C — it translates in code, but not on screen

`tr()` and `atr()` are not the same call, and Godot's automatic translation of
UI properties goes through `atr()`.

### C1. Auto-translation is off on the node

With `auto_translate_mode = AUTO_TRANSLATE_MODE_DISABLED`, `tr("MENU_START")`
on that same node still returns `"Comenzar"` while `atr("MENU_START")` returns
`"MENU_START"` (`R11b`). So your `print(tr(...))` debugging says the
translation works, and the screen keeps showing the key.

- **Test:** `print(node.can_auto_translate(), node.atr(node.text))`.
- **Fix:** set `auto_translate_mode` back to `INHERIT`/`ALWAYS` on that node.
- **Linter:** not detected. It is a scene/runtime property, not a table defect.

### C2. An ancestor turned it off

`AUTO_TRANSLATE_MODE_INHERIT` is the default, and it inherits the *disabled*
state: a child under a disabled parent reports `can_auto_translate() == false`
and returns raw keys from `atr()` (`R12`). One `auto_translate_mode = 2` on a
container silently un-translates the whole subtree under it.

- **Test:** walk up from the node printing `can_auto_translate()` until it flips.
- **Fix:** set the child to `ALWAYS`, or fix the ancestor.
- **Linter:** not detected.

### C3. What actually goes through auto-translation

A `Control` stores the raw key: `label.text` stays `"MENU_START"` and the
translation happens on the way out (`R13a`). We confirmed the outbound call
resolves `text` and `tooltip_text` (`R13b`) and `OptionButton` item text
(`R13c`). Consequence: **reading `label.text` back tells you nothing** about
whether the player sees a translation. Test with `atr()`, not with `text`.

---

## D — why your own testing missed it

The fallback locale masks exactly the defects you are looking for.

- A key with an **empty** cell for the active locale does not render blank and
  does not render the key — the fallback locale answers, so you see English
  (`R5`). Clear the fallback and the raw key appears (`R5e`).
- A key present **only** in the fallback locale resolves silently under any
  other locale (`R6`); with the fallback off it returns the key (`R6e`).

If your source language is `en` and the default fallback is `en`, an untested
build can look complete in every locale while every missing string quietly
serves English. That is not a bug in Godot — it is the intended safety net —
but it means *manual testing cannot find missing translations*. Either check
the table statically, or temporarily clear `internationalization/locale/fallback`
and play through in a target locale.

- **Linter:** detected. An empty cell for a declared locale is an
  `empty-translation` warning, which is the entire reason the rule is a warning
  and not silence.

---

## E — the extraction gap (cited, not measured)

The three claims below could not be exercised headlessly, because POT
generation lives in the editor: Godot 4.7's `--help` lists no POT-related
command-line option, so there is no way to run it (or gate it in CI) from a
script. Treat them as documented rather than proven here.

- Godot's built-in POT generator misses translatable strings in `.tres`
  resources — engine issue
  [#73565](https://github.com/godotengine/godot/issues/73565), open since 2023.
- It also misses various scene-side strings, which is why projects end up
  maintaining a hand-written key list.
- Because there is no CLI, "the POT is up to date" cannot be a build gate; it
  is a button somebody has to remember to press.

What *is* measured: a linter that parses `.tscn`/`.tres` itself does see these.
On our fixture, `text = "SCENE_LABEL"` inside a `.tscn` was picked up as a used
key and correctly matched against the table.

---

## Coverage summary

| Cause | Claim | Caught by a table linter? |
|---|---|---|
| A1 files never registered | `C1` | **no** — needs `project.godot` |
| A2 locale with no table | `R7`, `R7e` | only if the locale is declared (`--locales`) |
| B1 trailing/leading space | `R2`, `C2a` | yes — `missing-key` + `orphan-key` |
| B2 case mismatch | `R3`, `R3b` | yes — same pair |
| B3 newline / `\n` in key | `R4`, `C4a-c` | yes — `newline-key` (error) |
| B4 padding inside quotes | `C2b` | yes — same pair |
| C1 auto-translate off on node | `R11b` | **no** — scene property |
| C2 ancestor disabled it | `R12` | **no** — scene property |
| D empty cell masked by fallback | `R5`, `R5e` | yes — `empty-translation` |
| D key only in fallback locale | `R6`, `R6e` | yes — `empty-translation` |
| E POT misses `.tres` | cited | n/a — extraction, not validation |

Two of the eleven are outside what any translation-table linter can see: they
live in `project.godot` and in your scene tree. Knowing which half of the
problem you are in is most of the debugging.

---

## Debunked while measuring this

- **"Strip the UTF-8 BOM from your CSV."** A BOM on the header row does not
  corrupt the import in 4.7 — it lands on the ignored `keys` header cell, and
  locales and keys import correctly (`C5`). Ours was written with a BOM on
  purpose. If your CSV is broken, the BOM is not why.
- **"An empty translation shows a blank string."** It shows the fallback
  locale's text (`R5`).
- **"A missing locale falls back to raw keys."** Only with the fallback
  cleared (`R7` vs `R7e`).

---

## Reproduce all of it

```
git clone https://github.com/leobaray/locguard
cd locguard
docs/verify_translation_behavior.sh /path/to/Godot_v4.7-stable_linux.x86_64
```

The script builds a throwaway project, writes a CSV seeded with every trap
above (BOM, trailing space, quoted padding, comma in key, `\n` in key and in
value, empty cell), imports it with the real engine, and asserts each claim
twice — once with the default fallback locale and once with it cleared. It
exits non-zero if any claim stops holding, which is how it is meant to be used
against a newer Godot: if 4.8 changes one of these behaviors, the script tells
you which one.

---

Sections B and D are what [LocGuard](../README.md) checks automatically — it is
a free MIT CLI that scans a Godot 4 project and exits non-zero on missing keys,
placeholder drift and unbalanced BBCode, so the pair-signature above shows up
in CI instead of in a review. [LocGuard
Pro](https://blobsmith.itch.io/locguard) adds the in-editor dock and ready-made
CI presets. Sections A and C are not covered by either, and this page will keep
saying so.
