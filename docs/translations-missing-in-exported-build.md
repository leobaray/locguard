# It translates in the editor and ships in English — what the export does to your translations

Your game speaks four languages when you press Play. You export it, hand the
build to a tester, and the menus are English again — or worse, the tester sees
`MENU_START`. Nothing failed: the export dialog said success, the log said
success, and the `.pck` is right there.

The reason is that **the editor and the export read your translations through
two completely different paths**. In the editor the engine loads whatever is on
disk. In an export it loads whatever the export preset decided to pack, and the
preset has three separate ways to leave your translation tables out — none of
which produces an error.

Everything below is measured, not remembered. Each claim carries an id like
`E3b`, and every id is an assertion in
[`verify_export_translations.sh`](verify_export_translations.sh), run against
Godot **4.7.stable.official.5b4e0cb0f**:

```
docs/verify_export_translations.sh /path/to/Godot_v4.7-stable_linux.x86_64
# engine: 4.7.stable.official.5b4e0cb0f
# RESULT: 26 passed, 0 failed
```

The harness needs no export templates and no CI account: `--export-pack` writes
a `.pck` without them (`E1a`), and the same binary *runs* that `.pck` with
`--main-pack`, which is the code path a real exported game takes. So every claim
here is the answer of an actual exported build, not of the editor pretending.

**Rather paste your export preset than read?**
<https://blobsmith.lbwma.com/godot-translations-missing-in-export/> is this
checklist with a checker in the page: drop in your `export_presets.cfg` and your
`project.godot` and it names which of the causes below your preset has, by
translation path. Nothing is uploaded.

---

## 60-second triage

You need the *exported* game to answer, not the editor. Put this in your main
scene, export, and run the build from a terminal so you can see stdout:

```gdscript
func _ready() -> void:
	print("locales: ", TranslationServer.get_loaded_locales())
	print("active:  ", TranslationServer.get_locale())
	print("sample:  ", tr("MENU_START"))
```

| What the exported build prints | Cause |
|---|---|
| `locales: []` | the tables are not in the pack — [X1](#x1-the-preset-exports-selected-resources-and-nothing-selects-a-translation), [X2](#x2-an-exclude-filter-ate-the-translation-files) |
| locales listed, your locale missing, text in English | [X3](#x3-a-path-in-localetranslations-that-no-longer-exists) — the entry for that locale points at a file that is not there |
| locales listed, raw keys on screen | not an export problem: the table loaded and the key did not match — see [the key-instead-of-translation checklist](missing-translations-checklist.md) |
| translates in the terminal, not on screen | not an export problem — see [the frozen-translation page](locale-switch-does-not-update-ui.md) |

Run it from the `.pck` if you want the fastest loop, no export templates
required:

```
godot --headless --path . --export-pack "Linux" /tmp/game.pck
godot --headless --main-pack /tmp/game.pck
```

---

## The baseline: what a correct export actually contains

With the default preset (`export_filter="all_resources"`), the exported build
loads both locales (`E1d`) and `tr()` returns the translation (`E1e`). The pack
holds exactly this (`E2c`):

```
main.gd.remap  main.gdc  main.tscn.remap  project.binary
t.csv.import   t.en.translation   t.pt.translation
```

Note what is **not** there: `t.csv`. Your source spreadsheet is not shipped
(`E2b`, `E2c`) — and it was never what the engine read. The CSV is an *import
source*; the editor compiles it into one binary `.translation` per column, and
those are the files that ship and the files `project.godot` points at.

This single fact kills the most common advice on the forums, measured below in
[myth 3](#myth-3-add-csv-to-the-include-filter): filters over `*.csv` cannot fix
a translation problem, because no `*.csv` is involved at runtime.

---

## X1 — the preset exports "selected resources", and nothing selects a translation

**Symptom:** `get_loaded_locales()` returns `[]` in the build, everything is raw
keys, and the same project translates fine in the editor.

**Cause:** in the export dialog's *Resources* tab, the mode is *Export selected
resources (and dependencies)*. Godot then walks the dependency graph from the
scenes you ticked. Your `.translation` files are referenced by
`project.godot` — by a **setting**, not by a scene — so nothing in that graph
ever points at them, and they are dropped.

Measured with a preset whose only selected file is `res://main.tscn`:

| id | claim |
|---|---|
| `E3a` | the export reports success |
| `E3b` | no `.translation` file is in the pack |
| `E3c` | the exported game loads zero locales |
| `E3d` | `tr("MENU_START")` returns `MENU_START` |

**Fix:** either switch the mode back to *Export all resources in the project*,
or tick the `.translation` files themselves in the resource tree. In
`export_presets.cfg` that is:

```ini
export_filter="all_resources"
# or, keeping the selective mode:
export_filter="resources"
export_files=PackedStringArray("res://main.tscn", "res://t.en.translation", "res://t.pt.translation")
```

This is the cause that hits teams who turned on selective export to shrink a
build, months before anyone noticed the translations were gone.

---

## X2 — an exclude filter ate the translation files

**Symptom:** identical to X1 — zero locales, raw keys, success reported.

**Cause:** *Filters to exclude files/folders from project* matches your tables.
`*.translation` is the obvious one; the realistic one is a folder pattern like
`localization/*` or `assets/text/*` added to keep source material out of the
build, which also removes the compiled tables sitting in that folder.

| id | claim |
|---|---|
| `E4a` | exporting with `exclude_filter="*.translation"` reports success |
| `E4b` | the tables are not in the pack |
| `E4c` | the exported game prints the raw key |

**Fix:** narrow the pattern to the sources (`*.csv`, `*.po`, `*.xlsx`) and never
to `*.translation`. If you keep tables and sources in one folder, exclude by
extension, not by folder.

---

## X3 — a path in `locale/translations` that no longer exists

**Symptom:** the sneakiest of the three, because **nobody sees keys**. The build
shows correct English to a player who chose Portuguese. Testers report "the
language button does nothing", QA closes it as cosmetic.

**Cause:** `project.godot` lists a `.translation` path that is not there — the
CSV was renamed, a locale column was removed, the file moved folders. The
setting keeps the stale path.

| id | claim |
|---|---|
| `E6a` | a nonexistent path in `locale/translations` does not fail the export |
| `E6b` | the missing table is skipped; the remaining locales still load |
| `E6c` | `tr()` under that locale returns **English**, not the key |

The English comes from `internationalization/locale/fallback`, which defaults to
`en`. The fallback is doing its job — that is exactly why the failure is
invisible: a missing table looks like a translator who did not finish.

**Fix:** after any rename, re-open *Project Settings → Localization → Translations*
and re-add the file. To catch it in CI, assert the count you expect:

```gdscript
assert(TranslationServer.get_loaded_locales().size() == 4)
```

---

## Three myths this harness kills

### Myth 1 — "CI must run an import pass before exporting"

The advice is to run `godot --headless --editor --quit` first, because
`--export-pack` on a fresh clone (no `.godot/`, no `.import` sidecars, no
`.translation` files — all correctly gitignored) supposedly produces a build
with no translations.

Measured on 4.7: it does not. The export imports the project itself.

| id | claim |
|---|---|
| `E5a` | `--export-pack` on a never-imported project succeeds |
| `E5b` | it prints `ERROR: Cannot open file 'res://t.en.translation'` while doing so |
| `E5c` | the tables are in the pack anyway |
| `E5d` | the exported build translates |

`E5b` is why the myth survives: the log is full of red errors naming the exact
files you are worried about, printed *before* the importer builds them. If your
CI log shows those lines and the build works, the lines are noise. Check the
build, not the log.

### Myth 2 — "the CSV has to be in the export"

It is not, and never was, in a working build (`E2b`, `E2c`). If some code of
yours reads `res://translations.csv` at runtime, that code works in the editor
and breaks only in the export (`E2a` vs `E2b`) — a real bug, but a different one
from a missing translation.

### Myth 3 — "add `*.csv` to the include filter"

| id | claim |
|---|---|
| `E7a`/`E7b` | with `exclude_filter="*.csv"`, the exported build still translates |
| `E7c` | with `include_filter="*.csv"`, the `.csv` **still** does not reach the pack |
| `E7d` | translation works in both cases |

`E7c` is worth pausing on: the include filter is documented as a way to ship
non-resource files, and a CSV that Godot imports as a translation is a
*resource*, so the filter does not apply to it. The advice is not merely
unnecessary — it cannot do the thing it promises.

---

## What a linter can and cannot see here

LocGuard reads your translation **table** — it finds missing keys, placeholder
drift, unbalanced BBCode, empty strings. None of the three causes above is in
the table: X1 and X2 live in `export_presets.cfg`, X3 lives in `project.godot`.
A table linter is structurally blind to all three, and saying so is more useful
than pretending otherwise.

What *can* be checked without running the game is the pair of config files, and
that is what the page does:

- <https://blobsmith.lbwma.com/godot-translations-missing-in-export/> — paste
  `export_presets.cfg` and `project.godot`, get the causes named per translation
  path, in the browser, nothing uploaded.

And what the linter is for, once the tables actually ship:

- **[LocGuard CLI](https://github.com/leobaray/locguard)** — free, MIT, no
  dependencies: `node cli.js /path/to/project --csv translations.csv`, non-zero
  exit on findings, made for the CI job that runs right before the export.
- **[LocGuard Pro](https://blobsmith.itch.io/locguard)** — the same rules in an
  in-editor dock: scan, double-click a finding, land on the line.

Neighbouring failures, each with its own measured checklist:

- [the raw key on screen in every language](missing-translations-checklist.md)
  — the table loaded, the key did not match.
- [the player switches language and half the UI doesn't](locale-switch-does-not-update-ui.md)
  — `label.text = tr("KEY")` stored the value where the engine expects the key.
- [Generate POT left strings out](pot-generation-what-it-misses.md) — the
  strings never reached the translator at all.

---

## Reproducing this

```
docs/verify_export_translations.sh /path/to/Godot_v4.7-stable_linux.x86_64
```

The script builds six throwaway projects in `/tmp`, exports each one, runs the
resulting `.pck`, and prints one `PASS`/`FAIL` line per claim id used on this
page. If a future engine build changes an answer, the failing line names the
claim that moved, and this page is wrong until it is updated.
