# What Godot 4's `Generate POT` picks up — and the strings it silently leaves out

You listed your scenes and scripts under **Project Settings → Localization →
POT Generation**, pressed **Generate**, sent the `.pot` to a translator, and
some of the game came back in English anyway. Nothing warned you. The button
reported no failure, the `.pot` was written, and the strings that were never in
it are simply not translated at runtime — where a failed lookup returns the key
verbatim, with no error and no `push_warning`.

This page is the catalogue: for each construct, whether it reaches the `.pot`,
why, and what to do instead.

**Everything here is measured against Godot 4.7.stable.official.5b4e0cb0f, not
remembered.** That matters more than usual on this topic, because POT
generation has no command-line entry point — [godot-proposals#10986](https://github.com/godotengine/godot-proposals/issues/10986)
is still open — so essentially every page written about it is quoting the issue
tracker rather than a run. Several of the omissions people still cite are fixed:
`OptionButton` and `MenuButton` popup items ([godot#95160](https://github.com/godotengine/godot/issues/95160),
[godot#88017](https://github.com/godotengine/godot/issues/88017)) **do** land in
the `.pot` in 4.7. Others, like [godot#73565](https://github.com/godotengine/godot/issues/73565)
(`.tres`), open since February 2023, are exactly as broken as advertised.

Reproduce the whole page in one command:

```
git clone https://github.com/leobaray/locguard
cd locguard
node docs/verify_pot_generation.js /path/to/Godot_v4.7-stable_linux.x86_64
# 61/61 claims
```

### How it is measured, since there is no CLI

`Generate POT` is an editor button with no scripting API. The harness therefore
**presses the button**: it boots the editor headless with a throwaway
`EditorPlugin` that walks the editor's own control tree, finds the `Generate`
button inside Project Settings → Localization → POT Generation, emits its
`pressed` signal, and answers the `EditorFileDialog` that opens with a
`file_selected` signal. The `.pot` that lands on disk is the same bytes a human
gets from the same click, and every claim below is an assertion against those
bytes. `--selftest` flips two expectations on purpose and requires the run to go
red, because a harness that cannot fail is not evidence.

---

## The short version

| You wrote | In the `.pot`? |
|---|---|
| `tr("KEY")`, `atr()`, `tr_n()`, with or without context | ✅ |
| `tr(SOME_CONST)` where the const is a string literal | ✅ — resolved to its **value** |
| `tr("A" + "B")` | ✅ — folded to `AB`, which is what the engine looks up too |
| `tr(some_variable)` | ❌ |
| `tr(dict["key"])` | ❌ |
| `TranslationServer.translate("KEY")` | ❌ |
| `label.text = "Hello"` in GDScript | ✅ |
| `window.title = "Hello"` in GDScript | ❌ (but `title =` in a **scene** is ✅) |
| `text` / `tooltip_text` / `placeholder_text` / `title` / `dialog_text` / `ok_button_text` in a `.tscn` | ✅ |
| `OptionButton` / `MenuButton` / `PopupMenu` / `ItemList` item text in a `.tscn` | ✅ |
| `TabBar` tab titles (`tab_0/title`) | ❌ |
| a `TabContainer` child's **node name** | ✅ — the node name becomes a msgid |
| `@export var s := "Hello"`, and its per-node override in a scene | ❌ |
| anything in a scene not itself listed in `translations_pot_files` | ❌ |
| anything in a `.tres`, `.json`, or any non-`.gd`/`.tscn` file | ❌ |
| your project name | ✅ — always, with no source reference |

---

## 1. The four ways a whole file disappears

These cost the most and are the hardest to notice, because the `.pot` still gets
written and the button still reports success. The only trace is in the editor
log, which nobody reads after a click that appeared to work:

```
ERROR: Cannot parse file 'res://data.tres': unrecognized file extension. Skipping.
ERROR: Cannot parse file 'res://strings.json': unrecognized file extension. Skipping.
ERROR: Cannot parse file 'res://sub': unrecognized file extension. Skipping.
ERROR: Cannot open file 'res://ghost.tscn'.
```

**1a. `.tres` and any other resource file.** [godot#73565](https://github.com/godotengine/godot/issues/73565),
open since 2023. Custom `Resource` scripts are where dialogue, item names and
quest text usually live, and the generator refuses them **by extension, before
looking at the contents**. Nothing you can put in a `.tres` will be picked up.

**1b. `.json`, `.csv`, `.txt`, and every other data file.** Same rejection.
The supported route is to write an
[`EditorTranslationParserPlugin`](https://docs.godotengine.org/en/stable/classes/class_editortranslationparserplugin.html)
that teaches the editor your format. Until you do, listing the file changes
nothing except adding a line to the log.

**1c. A folder.** `res://sub` is refused with the same "unrecognized file
extension" message. `translations_pot_files` is a list of individual files:
adding a directory does not recurse into it, and adding a new scene to a folder
you already listed does not add its strings.

**1d. A file that no longer exists.** A renamed or deleted scene stays in the
list, errors, and is skipped. Generation continues and reports success.

> **Consequence.** The list is manual and silent in both directions. Every new
> scene must be added by hand, and a scene *instanced* by a listed scene is not
> covered by it — only the property overrides written into the parent scene are.
> A sub-scene's own `text` values are absent unless that sub-scene is listed
> itself.

## 2. `auto_translate_mode` silently removes a subtree

Setting **auto_translate_mode = Disabled** on a node — the documented way to
stop *one* label from being translated — also removes it from the POT, which is
reasonable. What is easy to miss is that the mode is **inherited**: the default
on every node is `Inherit`, so disabling it on a container, a panel, or the
scene's root node removes **every descendant string in that scene** from the
`.pot`, with no warning.

Measured: a root with `auto_translate_mode = 2` produced a `.pot` containing
none of its scene's strings. A child that opts back in with
`auto_translate_mode = 1` (Always) reappears.

```
# is a scene contributing anything at all?
grep -c 'my_scene.tscn' generated.pot
```

## 3. GDScript: expressions the parser cannot follow

The parser reads source text, so it can only see keys it can resolve statically.

| Construct | Result |
|---|---|
| `tr(some_var)` | ❌ — even when the variable is assigned a literal one line above |
| `tr(dict["key"])` | ❌ — subscripts, [godot#85848](https://github.com/godotengine/godot/issues/85848) |
| `tr(SOME_CONST)` | ✅ — constants **are** resolved, to the value, not the identifier |
| `tr("A" + "B")` | ✅ — folded to `AB`; this matches the runtime key, so it is correct |
| `{"k": tr("KEY")}` / `[tr("KEY")]` | ✅ — `tr()` inside dictionary and array literals is found |
| `tr("He said \"hi\"")` | ✅ — escaped correctly in the `.pot` ([godot#80004](https://github.com/godotengine/godot/issues/80004) is fixed) |

The one that costs real money:

**`TranslationServer.translate("KEY")` is not extracted.** Nor is
`TranslationServer.translate_plural()`. This is the documented API for
translating with an explicit locale or outside a `Node`, it takes a plain string
literal the parser could trivially read, and every key that goes through it is
missing from the `.pot`. If you have a localization singleton wrapping
`TranslationServer`, **none** of your keys are in your template.

## 4. GDScript: assignments the parser *does* follow, including one it shouldn't

`label.text = "Hello"`, `.tooltip_text`, `.placeholder_text` — assignments to
known translatable property names are extracted, which is more than most people
expect.

Two inconsistencies fall out of that:

- **`window.title = "Hello"` is not extracted**, although `title =` written in a
  `.tscn` is. Same property, same class, different answer depending on where you
  set it.
- **`some_dictionary["text"] = "Hello"` *is* extracted.** The match is on the
  property *name*, not on the type of what is being assigned to, so an ordinary
  dictionary with a `"text"` key injects junk msgids into your template for a
  translator to translate. Harmless but confusing, and a reason your `.pot`
  contains strings you cannot find on screen.

## 5. Two smaller surprises

- **A `TabContainer` child's node name becomes a msgid.** `TabContainer` uses
  child node names as tab labels, so the generator extracts them. Renaming a
  node therefore silently changes a translation key. A `TabBar`, whose titles
  live in `tab_0/title`, gets **nothing** — same widget to the player, opposite
  outcome.
- **Your project name is always in the `.pot`**, emitted with no `#:` source
  comment, because it is what the OS shows as the window title. It is not a bug;
  it is just the one msgid every Godot POT has, and it confuses people who diff
  templates.

---

## What a linter can and cannot add

[LocGuard](../README.md) reads the project directly instead of a file list, so
it covers some of the above and not others. Measured on the same probe project
by the same script, so this table cannot drift from the code:

| | POT generator | LocGuard |
|---|---|---|
| scene not listed in `translations_pot_files` | ❌ | ✅ (it scans the tree) |
| `TabBar` tab titles | ❌ | ✅ |
| `.tres` under a property nobody lists (`metadata/blurb`) | ❌ | ❌ |
| `TranslationServer.translate("KEY")` | ❌ | ❌ |
| `@export` string set on a node in a scene | ❌ | ❌ |
| `tr(SOME_CONST)` | ✅ | ❌ (no constant resolution) |
| `dialog_text` / `ok_button_text` | ✅ | ❌ |
| `label.text = "..."` in GDScript | ✅ | ❌ |
| `TabContainer` child node name | ✅ | ❌ |
| `tr("A" + "B")` | ✅ folded key | ❌ reports `A`, which is **the wrong key** |
| a string excluded via `auto_translate_mode` | ❌ correctly | ⚠️ reported anyway |

Neither tool is a superset of the other, and the two rows at the bottom are
LocGuard's own defects, listed here because the alternative is a table that
flatters us. The honest summary: run `Generate POT` for the template, and use a
linter for the classes of string the template structurally cannot contain —
above all the `.tres` and unlisted-scene cases, which are the ones that ship.

---

## Reproduce all of it

```
node docs/verify_pot_generation.js /path/to/Godot_v4.7-stable_linux.x86_64
node docs/verify_pot_generation.js /path/to/Godot_v4.7-stable_linux.x86_64 --selftest
```

The script builds a throwaway project holding one construct per claim, drives
the editor headlessly to press `Generate`, and asserts 61 claims against the
resulting `.pot`, against the editor log, and against LocGuard's own extraction.
It exits non-zero if any claim stops holding — which is how it is meant to be
used against a newer Godot: if 4.8 fixes `.tres` or breaks constant resolution,
the script names the claim that moved.

Related: **[Godot 4 shows the raw key instead of the translation — the complete
checklist](missing-translations-checklist.md)**, for when the string *is* in
your table and still comes out raw.

---

[LocGuard](../README.md) is a free MIT CLI that scans a Godot 4 project and
exits non-zero on missing keys, placeholder drift and unbalanced BBCode — the
CI gate for the classes of string above that a `.pot` cannot hold.
[LocGuard Pro](https://blobsmith.itch.io/locguard) adds the in-editor dock and
ready-made CI presets.
