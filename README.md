# LocGuard — Godot 4 localization QA linter

**Catch untranslated strings before your players do.** LocGuard scans a Godot 4
project and fails your build when localization is broken — the check Godot's own
tools don't do.

Godot ships untranslated text silently: `tr()` returns the raw key when a
translation is missing, and the built-in POT generator misses strings in
`.tscn`/`.tres`, `OptionButton` items, and more. LocGuard finds what actually
breaks, and exits non-zero so it works as a pre-commit hook or CI gate.

```
$ locguard my-game/ --source en --overflow es:1.6
✖ [missing-key] Key used in project but not in translation table: "MISSING_ONE" (ui/hud.gd:42)
✖ [placeholder-printf] printf placeholder mismatch in es for "SCORE_FMT": source [%d] vs [%s]
✖ [bbcode-imbalance] Unbalanced BBCode in de for "TIP_BOLD" (unclosed [b])
▲ [empty-translation] Empty fr translation for "MENU_QUIT" — fr players will see the untranslated source text at runtime
▲ [orphan-key] Key in translation table is never used in the project: "OLD_KEY"

3 error(s), 2 warning(s) · 214 keys used, 210 in table.
$ echo $?
1
```

## What it checks

| Rule | Severity | Why it matters |
|------|----------|----------------|
| `missing-key` | error | key used in code/scenes but absent from the CSV/PO → shows the raw key at runtime |
| `newline-key` | error | a key containing a newline never resolves (Godot returns it verbatim) |
| `placeholder-printf` / `-index` / `-named` | error | `%d`↔`%s`, `{0}`, `{name}` drift between source and translation → runtime format errors or wrong output |
| `bbcode-imbalance` | error | unbalanced `[b]…[/b]` etc. in a `RichTextLabel` string → broken formatting |
| `empty-translation` | warning | a declared locale is blank → players see the untranslated source |
| `orphan-key` | warning | key in the table nobody uses → dead weight / typo signal |
| `overflow` | warning | translation far longer than the source → UI clipping risk (opt-in budget) |

Extraction covers what Godot's POT generator misses: `tr()`/`tr_n()`/`atr()` in
GDScript, `Tr()`/`Translate()` in C#, and text/tooltip/title properties **plus
`OptionButton`/`ItemList` items** in `.tscn`/`.tres`.

## Reference

**[Godot 4 shows the raw key instead of the translation — the complete checklist](docs/missing-translations-checklist.md)**
— every cause we could reproduce (tables never registered, byte-exact key
matching, the CSV `\n` asymmetry between keys and values, `auto_translate_mode`
inheritance, fallback-locale masking), each with a one-line test, a fix, and
whether a linter can see it at all. Every claim is asserted by
`docs/verify_translation_behavior.sh <godot-binary>`, which builds a throwaway
project, imports a booby-trapped CSV with the real engine and checks 32 claims
against it — twice.

The same checklist is a page, and the linter runs inside it:
**<https://blobsmith.lbwma.com/godot-translation-not-working/>**. Paste your
translation CSV and it reports the defects a table alone can prove — a key with
padding that will never match, the `\n` that is an escape in a value and two
literal characters in a key, a duplicate row the import drops silently, an empty
cell your fallback locale is covering for, placeholder drift between locales,
unbalanced BBCode. It runs `src/core.js` from this repo, unmodified: the page's
copy is compared byte-for-byte with this file before its tests are allowed to
run. Nothing is uploaded — the check happens in your browser.

**[The player changes language and half the UI doesn't — what actually
froze](docs/locale-switch-does-not-update-ui.md)** — the other half of the
problem: not a raw key on screen, but a string stuck in the language it was
built in. One cause (`label.text = tr("KEY")` stores the value where Godot
expects the key), plus what happens next — the frozen string is re-translated on
the following switch and, if it collides with a key, becomes a third string
nobody wrote. 13 claims, each asserted by
`docs/verify_locale_switch.sh <godot-binary>` against the real engine, twice
(default fallback locale and cleared). Ships with
`docs/find_frozen_translations.js`, a dependency-free scanner you point at your
own project:

```
node docs/find_frozen_translations.js /path/to/your/godot/project
▲ [frozen-translation] ui/hud.gd:6 — label.text holds a translated value: frozen at
  the locale that was active when this ran (S3) …
```

That checklist is also a page, with the scanner running inside it:
**<https://blobsmith.lbwma.com/godot-locale-not-updating/>**. Paste a `.gd` or
`.cs` and it reports each frozen assignment with the line and the claim id — no
clone, no Node, nothing uploaded. The matching lives in
[`docs/frozen-scan-core.js`](docs/frozen-scan-core.js), which the CLI requires
and the page serves; the two are compared byte-for-byte before the page's tests
are allowed to run.

This one is **not** a LocGuard rule and deliberately so: the defect is invisible
in the translation table, so it ships as a source scanner instead of a rule that
would answer from the wrong evidence.

**[What Godot 4's `Generate POT` picks up — and the strings it silently leaves
out](docs/pot-generation-what-it-misses.md)** — the failure one step earlier:
the string never reaches the translator, because the template it was supposed to
be in was written without it and the button still reported success. The four
ways a whole file disappears (`.tres` and every non-`.gd`/`.tscn` file, a folder,
a deleted file, a scene nobody listed), `auto_translate_mode` removing an entire
subtree, the expressions the parser cannot follow, and the one that costs most —
`TranslationServer.translate("KEY")` is never extracted, so a localization
singleton means an empty template. 61 claims, and they are measured rather than
quoted: `Generate POT` has no CLI
([godot-proposals#10986](https://github.com/godotengine/godot-proposals/issues/10986)),
so `docs/verify_pot_generation.js` boots the editor headless with a throwaway
`EditorPlugin`, **presses the button**, and asserts against the bytes that land
on disk. `--selftest` seeds two wrong expectations and requires the run to go
red.

```
node docs/verify_pot_generation.js /path/to/Godot_v4.7-stable_linux.x86_64
# 61/61 claims
```

That catalogue is a page too, and it answers the question about *your* project:
**<https://blobsmith.lbwma.com/godot-generate-pot-missing-strings/>**. Paste the
`.pot` Godot generated and one scene or script, and it names the strings your
file uses that your template does not contain — plus the constructs neither tool
can see, so a clean result is never read as a complete template. It runs
`src/core.js` from this repo, unmodified, compared byte-for-byte before the
page's tests may run.

## Install & use

```
# no dependencies — just Node 18+
node src/cli.js <project-dir> [--translations file.csv] [--source en]
                              [--locales en,es,de] [--overflow es:1.6] [--strict] [--json]
```

Exit codes: `0` clean · `1` errors (or warnings with `--strict`) · `2` usage error.

### As a CI gate (GitHub Actions)
```yaml
- uses: actions/setup-node@v4
- run: node locguard/src/cli.js . --source en --strict
```

## Verified against the real engine

LocGuard's rules aren't guesses. The test suite (`test/verify.sh`) builds a Godot
4.7 project seeded with each defect, runs the linter, **and runs Godot 4.7 headless
to prove those defects genuinely break at runtime** (e.g. a missing key returns
itself; an empty translation shows the untranslated source). If a rule can't be
demonstrated in the real engine, it doesn't ship.

## Free vs Pro

This CLI is **free and MIT-licensed** — the complete linter. **LocGuard Pro**
($12, launch sale $9) adds the in-editor Godot dock (scan without leaving the
editor, double-click a finding to open the file), ready-made CI presets and a
commercial license — and funds development.
**→ https://blobsmith.itch.io/locguard**

## License
MIT (CLI). See LICENSE.


## More from the studio

- **[Blobsmith](https://blobsmith.itch.io/blobsmith)** — draw 6 tiles, get a full 47-blob autotile sheet + a wired Godot 4 TileSet ([free in-browser version](https://blobsmith.itch.io/blobsmith-lite))
- **[LocGuard](https://github.com/leobaray/locguard)** — localization QA linter for Godot 4: missing keys, placeholder drift, broken BBCode ([Pro: in-editor dock + CI gate](https://blobsmith.itch.io/locguard))
- **[Blobsmith Autotile Wirer](https://github.com/leobaray/blobsmith-autotile-wirer)** — free addon that wires a 47-blob sheet into a TileSet inside the editor
- **[blobsmith.lbwma.com](https://blobsmith.lbwma.com/)** — the studio site: every release in one place, plus free browser tools (nonogram solver, puzzle generators) and printable PDFs
