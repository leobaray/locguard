# Godot 4: the player changes language and half the UI doesn't — what actually froze

You call `TranslationServer.set_locale("es")`. Some labels switch to Spanish.
Others keep the old language forever. No error, no warning, nothing in the
debugger — and the ones that break are usually the ones you were proudest of,
because they are the ones you built from code.

The cause is almost never the one people go looking for. Every node in the tree
*was* told the locale changed (`S4` below). The fix is not a notification
handler, not a `queue_redraw()`, and not a scene reload.

**Godot re-translates the string a node is holding, every time the locale
changes. So the node has to be holding the key.** The moment you store the
*result* of `tr()` in `text`, you have thrown the key away, and there is nothing
left to re-translate.

```gdscript
label.text = tr("MENU_START")   # frozen at whatever locale was active right here
label.text = "MENU_START"       # follows the locale, forever
```

Both lines look identical on screen until someone changes language. The first
one is the bug.

> Different symptom — the raw key (`MENU_START`) on screen from the very first
> frame, in every language? That is a different failure with different causes:
> **[Godot 4 shows the raw key instead of the translation — the complete
> checklist](missing-translations-checklist.md)**.

**Everything here is measured, not remembered.** Each claim carries an id like
`S3` that maps to an assertion in
[`verify_locale_switch.gd`](verify_locale_switch.gd), run against Godot
**4.7.stable.official.5b4e0cb0f**:

```
docs/verify_locale_switch.sh /path/to/Godot_v4.7-stable_linux.x86_64
# ### pass 1 — default project (fallback locale = en)
# RESULT: 13 passed, 0 failed
# ### pass 2 — fallback locale cleared
# RESULT: 13 passed, 0 failed
```

The probe builds its tables in memory, so you can drop that one `.gd` file into
your own project and run it against your engine build.

---

## 30-second triage

Run this on a node that is not updating, right after a locale change:

```gdscript
print(JSON.stringify(label.text))          # 1. is the node still holding the key?
print(JSON.stringify(label.atr(label.text)))  # 2. what will it draw?
print(TranslationServer.get_locale())      # 3. which locale is actually active?
```

| What you see | What it means |
|---|---|
| step 1 prints the **translation** (`"Comenzar"`), not the key | [the frozen assignment](#the-frozen-assignment) — this page |
| step 1 prints the key, step 2 prints the key too | the key is missing from the new locale's table → [the raw-key checklist](missing-translations-checklist.md) |
| step 1 prints the key, step 2 prints the right text, screen still wrong | `auto_translate_mode` is off on that node or a parent ([S7](#s7-auto_translate_mode-turns-off-atr-not-tr)) |
| step 3 prints something other than what you passed to `set_locale()` | [S9](#s9-the-locale-string-you-set-is-not-the-one-you-get-back) — locale standardization |
| step 3 prints your locale but nothing is translated | [S10](#s10-a-locale-with-no-table-is-not-an-error) — no table for it, falling back silently |

Quoting with `JSON.stringify` in step 1 is not decoration: on a Spanish build
`"Comenzar"` and `"Comenzar"` are the same pixels whether the node is holding a
key or a value. The quotes are how you tell which.

---

## The frozen assignment

### S3. A property that was given a value stops following the locale

Two `Label`s, built the two ways, side by side. Locale is `es` when both are
built; then it changes to `en`.

| | `keyed.text = "MENU_START"` | `frozen.text = tr("MENU_START")` |
|---|---|---|
| stored in `text` | `"MENU_START"` | `"Comenzar"` |
| drawn while `es` | `Comenzar` | `Comenzar` |
| drawn after `set_locale("en")` | `Start` | **`Comenzar`** |

- **Symptom:** the string is stuck in the language that was active when that
  line of code ran — often the language you develop in, which is why this
  survives your own testing (`S2b`/`S3`).
- **Test:** `print(JSON.stringify(node.text))` — if it prints a sentence instead
  of a key, it is frozen.
- **Fix:** store the key. `label.text = "MENU_START"`. Godot translates on draw,
  every time, for free.

### S4. The node was notified. It just had nothing to do about it

This is the part that sends people down the wrong path for a day. Both nodes in
the table above received `NOTIFICATION_TRANSLATION_CHANGED` when the locale
changed — the frozen one included. Godot did its job; the node re-translated the
string it was holding, and the string it was holding was already Spanish.

So if you are about to write this:

```gdscript
func _notification(what: int) -> void:
	if what == NOTIFICATION_TRANSLATION_CHANGED:
		label.text = tr("MENU_START")   # re-freezing it on every change
```

…you are building a hand-cranked version of something the engine already does,
and you now have to remember every string forever. It works, and it is the wrong
amount of work. It is only the right answer when the node is deliberately out of
the auto-translation path (`S7`).

### S5. A frozen value is not inert — it gets translated *again*

This is the failure that makes the bug report unreadable, because the player
does not see the old language. They see a third string that was never the
translation of anything they asked for.

The node holds `"Start"` (frozen while the game was in English). The locale
changes to Spanish. Godot looks `"Start"` up in the Spanish table — and if your
table happens to contain a key called `Start`, it finds it:

```
frozen.text            == "Start"      # frozen English value
frozen.atr(frozen.text) == "ARRANQUE"  # the es translation of the KEY "Start"
```

Measured as `S5`. Collisions like this are not exotic once a table has a few
hundred short UI strings in it — `Start`, `Back`, `Close`, `Level`, `Score` are
all plausible as both a key and an English value. The symptom is a string that
is in the right language and completely wrong.

### S6. A formatted string cannot even be repaired by switching back

```gdscript
score_label.text = tr("SCORE_FMT") % 7    # -> "Puntos: 7"
```

`text` now holds `"Puntos: 7"`. There is no key `Puntos: 7` and there never will
be one, because the `7` came from the game. Switching back to Spanish does not
fix this one either — unlike `S3`, where the original locale at least renders
correctly by accident.

Formatted strings are the case where you *do* have to re-run the format on
locale change. Keep the key and the arguments, and rebuild:

```gdscript
var score := 0

func _notification(what: int) -> void:
	if what == NOTIFICATION_TRANSLATION_CHANGED:
		_refresh()

func _refresh() -> void:
	score_label.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED  # S7
	score_label.text = tr("SCORE_FMT") % score
```

The `auto_translate_mode` line is what stops `S5` from happening to the result.

### S8. `OptionButton`, `ItemList` and `TabBar` items split the same way

Items added from code are stored strings like any other, and they are
auto-translated on draw:

```gdscript
opt.add_item("OPT_ONE")          # follows the locale -> "One"
opt.add_item(tr("OPT_ONE"))      # frozen             -> "Uno"
```

Measured as `S8`. Same rule, same fix: add the key.

Items typed into the **editor** (the `items` array in the `.tscn`) are stored as
keys already, so they are the correct form by default — which is exactly why
"it works in the scene I built by hand and breaks in the one I populate from
code" is such a common shape for this bug.

---

## What is *not* the cause

Three things that look guilty and are not. Each is measured, so you can stop
suspecting them.

### S7. `auto_translate_mode` turns off `atr()`, not `tr()`

```
off.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
off.atr("MENU_START")  == "MENU_START"   # auto-translation is off
off.tr("MENU_START")   == "Comenzar"     # explicit translation still works
```

So a node with auto-translation disabled shows raw keys, in every language, from
the first frame — a *different* symptom from the one this page is about. If you
disabled it to stop `S5`, you have taken on re-translating that node yourself.

### S9. The locale string you set is not the one you get back

`TranslationServer.standardize_locale("pt-BR")` returns `"pt_BR"`, and after
`set_locale("pt-BR")`, `get_locale()` returns `"pt_BR"` (`S9a`/`S9b`). Godot
normalizes it for you, so the hyphen form is safe to pass in — but a string
comparison against what you passed in (`if TranslationServer.get_locale() ==
"pt-BR"`) is false, and any dictionary you key by the raw locale string will
miss.

### S10. A locale with no table is not an error

`set_locale("ja")` on a project with no Japanese table succeeds. `get_locale()`
returns `"ja"`. Nothing is logged. What the player sees depends on
`internationalization/locale/fallback`:

| fallback setting | `tr("MENU_START")` returns |
|---|---|
| `en` (Godot's default) | `Start` — the English text, silently |
| cleared | `MENU_START` — the raw key |

Both measured as `S10`, which is why `verify_locale_switch.sh` runs twice. The
default is the dangerous one: a language button that appears to do nothing at
all is usually this, not a broken table.

### S11. The scene tree is not what does the translating

A `Label` that was never added to the tree still translates its key correctly
(`S11`). "I built it before adding it as a child" does not explain a stale
string.

---

## Find every frozen assignment in your project

The defect has one shape, and it is greppable. This repo ships a standalone
scanner — no dependencies, reads only `.gd`/`.cs`, writes nothing:

```
node docs/find_frozen_translations.js /path/to/your/godot/project
```

```
▲ [frozen-translation] ui/hud.gd:6 — label.text holds a translated value: frozen at
  the locale that was active when this ran (S3); if the value collides with a key it
  is translated again into a third string (S5)
    label.text = tr("MENU_START")
▲ [frozen-translation] ui/hud.gd:7 — $Score.text holds a translated value: formatted
  at assignment — the runtime value is baked in, so switching back does not repair it (S6)
    $Score.text = tr("SCORE_FMT") % 7

2 frozen translation(s) in 1 file(s) scanned.
Fix: store the key and let the node translate — label.text = "MENU_START" (S2b).
```

It covers assignments into the properties Godot auto-translates (`text`,
`tooltip_text`, `placeholder_text`, `title`, `dialog_text`, …) and the methods
that store one (`add_item`, `set_item_text`, `add_tab`, `set_tab_title`, …), in
both the GDScript and the C# spelling. `--json` gives you the same findings with
the claim id per line, for a CI gate.

**What it deliberately cannot tell you:** whether a given line is the legitimate
`S7` case — a node you took out of the auto-translation path on purpose and
re-translate by hand. Nothing in a single line of source says which node
`text` belongs to. When a file mentions `AUTO_TRANSLATE_MODE_DISABLED` or
`NOTIFICATION_TRANSLATION_CHANGED`, the scanner says so under the finding and
leaves the judgement to you. It also does not follow a value through a variable:
`var s := tr("K")` on one line and `label.text = s` on the next is the same bug
and is not reported.

---

## Why this is not one of LocGuard's rules

[LocGuard](../README.md) is a linter over your **translation table** — it can
prove a key is missing, that a placeholder drifted between locales, that a cell
is empty, that BBCode is unbalanced. Every one of those is decidable from the
CSV and the keys your project uses.

The defect on this page is not visible in the table at all. `label.text =
tr("MENU_START")` uses a key that exists, in a locale that exists, with no
placeholder drift — a perfectly clean table, and the string still freezes. It is
a property of the *source*, which is why it ships as the separate scanner above
rather than as a rule that would answer from the wrong evidence.

So if you run the linter and it says your project is clean, that verdict is
about your table and does not contradict this page. The two tools answer
different questions, and the scanner above is the one that answers this one.

[LocGuard](../README.md) is the free MIT CLI for the table half: it exits
non-zero on missing keys, empty translations, placeholder drift and unbalanced
BBCode, so those land in CI instead of in a review. [LocGuard
Pro](https://blobsmith.itch.io/locguard) adds the in-editor dock and ready-made
CI presets. Neither one carries the frozen-translation check on this page today.

---

*Measured on Godot 4.7.stable.official.5b4e0cb0f, 2026-08-15. Re-run the claims
yourself with `docs/verify_locale_switch.sh <godot-binary>`; if a future engine
build changes an answer, the script says which id and how.*
