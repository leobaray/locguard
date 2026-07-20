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
($12) adds an in-editor Godot dock (lint without leaving the editor, click a
finding to jump to the line), ready-made CI presets, per-locale overflow budgets,
Godot 4.6 plural-CSV support, and report export. → (store link)

## License
MIT (CLI). See LICENSE.
