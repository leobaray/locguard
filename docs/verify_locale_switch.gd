extends SceneTree
# ---------------------------------------------------------------------------
# Proves every claim in docs/locale-switch-does-not-update-ui.md against a real
# Godot engine. No LocGuard code involved — this only interrogates Godot.
#
#   godot --headless --path <any Godot 4 project> --script verify_locale_switch.gd
#
# Every table used here is built in memory with Translation.new(), so the script
# needs nothing on disk and can be dropped into any project — including yours.
#
# Measured on Godot v4.7.stable.official.5b4e0cb0f (2026-08-15).
# ---------------------------------------------------------------------------

var pass_count := 0
var fail_count := 0

# A Label that counts the translation-changed notifications it receives, so S4
# can separate "the node was never told" from "the node was told and could not
# act on it". Those two have the same symptom and opposite fixes.
class Spy extends Label:
	var notes := 0
	func _notification(what: int) -> void:
		if what == NOTIFICATION_TRANSLATION_CHANGED:
			notes += 1

func check(id: String, desc: String, actual, expected) -> void:
	if actual == expected:
		pass_count += 1
		print("PASS  %s  %s" % [id, desc])
	else:
		fail_count += 1
		print("FAIL  %s  %s\n        expected %s\n        actual   %s"
			% [id, desc, JSON.stringify(expected), JSON.stringify(actual)])

func _initialize() -> void:
	print("Godot ", Engine.get_version_info().string)
	print("fallback locale setting = ", JSON.stringify(str(
		ProjectSettings.get_setting("internationalization/locale/fallback", "<unset>"))))
	print("---")

	var es := Translation.new()
	es.locale = "es"
	es.add_message("MENU_START", "Comenzar")
	es.add_message("SCORE_FMT", "Puntos: %d")
	es.add_message("OPT_ONE", "Uno")
	# Deliberate collision: "Start" is the ENGLISH VALUE of MENU_START and also a
	# KEY in this table. That is what makes S5 possible.
	es.add_message("Start", "ARRANQUE")
	TranslationServer.add_translation(es)

	var en := Translation.new()
	en.locale = "en"
	en.add_message("MENU_START", "Start")
	en.add_message("SCORE_FMT", "Score: %d")
	en.add_message("OPT_ONE", "One")
	TranslationServer.add_translation(en)

	_switch_claims()
	print("---")
	_locale_claims()
	print("---")
	print("RESULT: %d passed, %d failed" % [pass_count, fail_count])
	quit(1 if fail_count > 0 else 0)

# ---------------------------------------------------------------------------
# S1-S8 — what actually happens to a node when the locale changes underneath it
# ---------------------------------------------------------------------------
func _switch_claims() -> void:
	TranslationServer.set_locale("es")
	check("S1", "set_locale() takes effect immediately for tr()",
		[TranslationServer.get_locale(), str(TranslationServer.translate("MENU_START"))],
		["es", "Comenzar"])

	# The two ways to put a translated string on a Label, side by side.
	var keyed := Spy.new()
	var frozen := Spy.new()
	root.add_child(keyed)
	root.add_child(frozen)
	keyed.text = "MENU_START"            # the key itself — the node translates on draw
	frozen.text = frozen.tr("MENU_START") # the VALUE — translated once, right here

	check("S2a", "before the switch both look identical on screen",
		[keyed.atr(keyed.text), frozen.atr(frozen.text)], ["Comenzar", "Comenzar"])

	TranslationServer.set_locale("en")

	check("S2b", "the node holding the KEY follows the locale",
		[keyed.text, keyed.atr(keyed.text)], ["MENU_START", "Start"])
	check("S3", "the node holding the pre-translated VALUE keeps the old language",
		[frozen.text, frozen.atr(frozen.text)], ["Comenzar", "Comenzar"])
	check("S4", "both nodes DID get NOTIFICATION_TRANSLATION_CHANGED — the notification is not the problem",
		[keyed.notes > 0, frozen.notes > 0], [true, true])

	# S5: the frozen value is not inert. It goes through the table again, and if
	# it collides with a key there, the player gets a third string that was never
	# the translation of anything they asked for.
	var collide := Label.new()
	root.add_child(collide)
	collide.text = collide.tr("MENU_START")   # locale is en here -> "Start"
	TranslationServer.set_locale("es")
	check("S5", "a frozen value that collides with a key is translated AGAIN into a different string",
		[collide.text, collide.atr(collide.text)], ["Start", "ARRANQUE"])

	# S6: formatting bakes the runtime value into the stored text, so the string
	# can never match a key again even if the locale comes back.
	var fmt := Label.new()
	root.add_child(fmt)
	fmt.text = fmt.tr("SCORE_FMT") % 7
	TranslationServer.set_locale("en")
	check("S6", "a formatted string freezes with the number baked in and matches nothing",
		[fmt.text, fmt.atr(fmt.text)], ["Puntos: 7", "Puntos: 7"])

	# S7/S8: the two mechanisms people reach for when they hit this.
	TranslationServer.set_locale("es")
	var off := Label.new()
	root.add_child(off)
	off.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	off.text = "MENU_START"
	check("S7", "auto_translate_mode DISABLED stops atr() only — tr() still translates",
		[off.atr(off.text), off.tr(off.text)], ["MENU_START", "Comenzar"])

	var ob := OptionButton.new()
	root.add_child(ob)
	ob.add_item("OPT_ONE")             # key
	ob.add_item(ob.tr("OPT_ONE"))      # pre-translated value
	TranslationServer.set_locale("en")
	check("S8", "the same split applies to OptionButton items added from code",
		[ob.atr(ob.get_item_text(0)), ob.atr(ob.get_item_text(1))], ["One", "Uno"])

# ---------------------------------------------------------------------------
# S9-S11 — the locale string itself, and where translation actually happens
# ---------------------------------------------------------------------------
func _locale_claims() -> void:
	check("S9a", "a hyphenated locale is standardized to the underscore form",
		TranslationServer.standardize_locale("pt-BR"), "pt_BR")
	TranslationServer.set_locale("pt-BR")
	check("S9b", "...so get_locale() does not return the string you passed in",
		TranslationServer.get_locale(), "pt_BR")

	# S10: switching to a locale nobody translated is not an error. It is silent,
	# which is why "the button did nothing" is the bug report you get. WHAT the
	# player sees instead depends on the fallback locale, so the expectation is
	# read from the project setting rather than hardcoded — pass 2 of
	# verify_locale_switch.sh clears it and the same claim must still hold.
	var fallback := str(ProjectSettings.get_setting("internationalization/locale/fallback", ""))
	var expected_ja := "Start" if fallback == "en" else "MENU_START"
	TranslationServer.set_locale("ja")
	check("S10", "switching to a locale with no table succeeds silently (fallback=%s -> %s)"
			% [JSON.stringify(fallback), JSON.stringify(expected_ja)],
		[TranslationServer.get_locale(), str(TranslationServer.translate("MENU_START"))],
		["ja", expected_ja])

	# S11: translation is a property of the node, not of the tree. A node that was
	# never added still translates — so "I forgot to add it to the tree" is not
	# the explanation for a stale string.
	TranslationServer.set_locale("es")
	var orphan := Label.new()
	orphan.text = "MENU_START"
	check("S11", "a node outside the scene tree still translates its key",
		orphan.atr(orphan.text), "Comenzar")
	orphan.free()
