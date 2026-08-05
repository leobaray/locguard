extends SceneTree
# ---------------------------------------------------------------------------
# Proves every runtime claim in docs/missing-translations-checklist.md against a
# real Godot engine. No LocGuard code involved — this only interrogates Godot.
#
#   godot --headless --path <any Godot 4 project> --script verify_translation_behavior.gd
#
# The CSV-importer claims (C1-C6) need a project whose CSV has been imported;
# verify_translation_behavior.sh builds a throwaway project and runs them. When
# run standalone those claims report SKIP instead of silently passing.
#
# Measured on Godot v4.7.stable.official.5b4e0cb0f (2026-08-05).
# ---------------------------------------------------------------------------

var pass_count := 0
var fail_count := 0
var skip_count := 0
# Snapshot taken before this script adds any Translation of its own — C1 asks
# what the project loaded on its own, so it has to read the untouched state.
var locales_at_startup: PackedStringArray = PackedStringArray()

func check(id: String, desc: String, actual, expected) -> void:
	if actual == expected:
		pass_count += 1
		print("PASS  %s  %s" % [id, desc])
	else:
		fail_count += 1
		print("FAIL  %s  %s\n        expected %s\n        actual   %s"
			% [id, desc, JSON.stringify(expected), JSON.stringify(actual)])

func skip(id: String, desc: String, why: String) -> void:
	skip_count += 1
	print("SKIP  %s  %s  (%s)" % [id, desc, why])

func _initialize() -> void:
	locales_at_startup = TranslationServer.get_loaded_locales()
	print("Godot ", Engine.get_version_info().string)
	print("locales loaded by the project itself = ", locales_at_startup)
	print("fallback locale setting = ", JSON.stringify(str(
		ProjectSettings.get_setting("internationalization/locale/fallback", "<unset>"))))
	print("---")
	_runtime_claims()
	print("---")
	_importer_claims()
	print("---")
	print("RESULT: %d passed, %d failed, %d skipped" % [pass_count, fail_count, skip_count])
	quit(1 if fail_count > 0 else 0)

# ---------------------------------------------------------------------------
# R1-R14 — lookup and fallback behavior, built from Translation resources so the
# script needs nothing on disk.
# ---------------------------------------------------------------------------
func _runtime_claims() -> void:
	var es := Translation.new()
	es.locale = "es"
	es.add_message("MENU_START", "Comenzar")
	es.add_message("menu_start", "minuscula")
	es.add_message("EMPTY_ES", "")
	es.add_message("ONLY_ES_GONE", "")
	TranslationServer.add_translation(es)

	var en := Translation.new()
	en.locale = "en"
	en.add_message("MENU_START", "Start")
	en.add_message("EMPTY_ES", "Hello there")
	en.add_message("ONLY_EN", "English only")
	TranslationServer.add_translation(en)

	var pt_br := Translation.new()
	pt_br.locale = "pt_BR"
	pt_br.add_message("MENU_START", "Comecar")
	TranslationServer.add_translation(pt_br)

	TranslationServer.set_locale("es")
	check("R0", "control: a key present in the current locale translates",
		tr("MENU_START"), "Comenzar")
	check("R1", "a key absent from every table comes back verbatim, no error",
		tr("NO_SUCH_KEY"), "NO_SUCH_KEY")
	check("R2", "lookup is byte-exact: one trailing space is a different key",
		tr("MENU_START "), "MENU_START ")
	check("R3", "lookup is case-sensitive: menu_start is a different key",
		tr("menu_start"), "minuscula")
	check("R3b", "...and a case variant nobody declared comes back verbatim",
		tr("Menu_Start"), "Menu_Start")
	check("R4", "a key holding a real newline never resolves",
		tr("MENU\nSTART"), "MENU\nSTART")
	check("R14", "a StringName key behaves exactly like a String key",
		tr(&"MENU_START"), "Comenzar")

	var fallback := str(ProjectSettings.get_setting("internationalization/locale/fallback", ""))
	if fallback == "en":
		check("R5", "an EMPTY translation is not 'blank on screen': the fallback locale answers",
			tr("EMPTY_ES"), "Hello there")
		check("R6", "a key present ONLY in the fallback locale resolves silently under es",
			tr("ONLY_EN"), "English only")
		TranslationServer.set_locale("fr")
		check("R7", "an unknown locale returns the FALLBACK text, not the key",
			tr("MENU_START"), "Start")
	elif fallback == "":
		# Second pass of verify_translation_behavior.sh: same tables, fallback
		# switched off in project.godot. Now the masking stops and the raw key
		# surfaces — the whole point of clearing it.
		check("R5e", "fallback OFF: an empty translation surfaces as the raw key",
			tr("EMPTY_ES"), "EMPTY_ES")
		check("R6e", "fallback OFF: a key only in en no longer answers under es",
			tr("ONLY_EN"), "ONLY_EN")
		TranslationServer.set_locale("fr")
		check("R7e", "fallback OFF: an unknown locale returns the raw key",
			tr("MENU_START"), "MENU_START")
	else:
		skip("R5", "empty translation falls through to the fallback locale",
			"project fallback is %s, neither en nor empty" % JSON.stringify(fallback))
		skip("R6", "key only in the fallback locale resolves silently", "same")
		skip("R7", "unknown locale returns the fallback text", "same")

	TranslationServer.set_locale("es_MX")
	check("R8", "es_MX resolves against an es-only table (partial locale match)",
		tr("MENU_START"), "Comenzar")
	TranslationServer.set_locale("pt")
	check("R9", "pt resolves against a pt_BR-only table (partial locale match)",
		tr("MENU_START"), "Comecar")
	check("R9b", "compare_locales scores a language-only match above zero",
		TranslationServer.compare_locales("es", "es_MX") > 0, true)
	check("R9c", "...and scores two unrelated languages at zero",
		TranslationServer.compare_locales("en", "fr"), 0)

	check("R10a", "standardize_locale DROPS a country that is the language default",
		[TranslationServer.standardize_locale("pt-br"), TranslationServer.standardize_locale("en_us")],
		["pt", "en"])
	check("R10b", "...but keeps a non-default country",
		TranslationServer.standardize_locale("es-MX"), "es_MX")
	check("R10c", "...and is case-sensitive: an uppercased language is left alone",
		TranslationServer.standardize_locale("PT_BR"), "PT_BR")

	TranslationServer.set_locale("es")
	var node := Node.new()
	root.add_child(node)
	check("R11a", "default node: tr() and atr() agree",
		[node.tr("MENU_START"), node.atr("MENU_START"), node.can_auto_translate()],
		["Comenzar", "Comenzar", true])
	node.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	check("R11b", "auto-translate OFF: tr() still translates but atr() returns the raw key",
		[node.tr("MENU_START"), node.atr("MENU_START"), node.can_auto_translate()],
		["Comenzar", "MENU_START", false])

	var child := Node.new()
	node.add_child(child)
	check("R12", "a child on INHERIT under a disabled parent is disabled too",
		[child.auto_translate_mode, child.can_auto_translate(), child.atr("MENU_START")],
		[Node.AUTO_TRANSLATE_MODE_INHERIT, false, "MENU_START"])

	var label := Label.new()
	root.add_child(label)
	label.text = "MENU_START"
	label.tooltip_text = "MENU_START"
	check("R13a", "a Control keeps the raw key in .text — translation happens on the way out",
		label.text, "MENU_START")
	check("R13b", "...and that outbound call (atr) resolves text and tooltip",
		[label.atr(label.text), label.atr(label.tooltip_text)], ["Comenzar", "Comenzar"])
	var option := OptionButton.new()
	root.add_child(option)
	option.add_item("MENU_START")
	check("R13c", "OptionButton items take the same route",
		[option.get_item_text(0), option.atr(option.get_item_text(0))], ["MENU_START", "Comenzar"])

# ---------------------------------------------------------------------------
# C1-C6 — what the CSV importer does to your keys. Needs the fixture project
# built by verify_translation_behavior.sh.
# ---------------------------------------------------------------------------
func _importer_claims() -> void:
	if not ResourceLoader.exists("res://lgcheck.es.translation"):
		for id in ["C1", "C2", "C3", "C4", "C5", "C6"]:
			skip(id, "CSV importer claim", "run via verify_translation_behavior.sh")
		return

	var imported: Translation = load("res://lgcheck.es.translation")
	check("C5", "a UTF-8 BOM on the header row does NOT corrupt the import",
		[imported.locale, str(imported.get_message("MENU_START"))], ["es", "Comenzar"])
	check("C2a", "a trailing space in a CSV key is kept, byte for byte",
		[str(imported.get_message("TRAIL_SPACE ")), str(imported.get_message("TRAIL_SPACE"))],
		["Trailing es", ""])
	check("C2b", "padding inside quotes is part of the key, not trimmed",
		[str(imported.get_message(" QUOTED_PAD ")), str(imported.get_message("QUOTED_PAD"))],
		["Rellenado", ""])
	check("C3", "a comma inside a quoted key survives the import",
		str(imported.get_message("WITH,COMMA")), "Coma")
	check("C4a", "keys are NOT unescaped: backslash-n stays two literal characters",
		str(imported.get_message("LINE\\nBREAK")), "Salto")
	check("C4b", "...so the real newline a GDScript literal produces never matches",
		str(imported.get_message("LINE\nBREAK")), "")
	check("C4c", "values ARE unescaped: the same backslash-n becomes a newline",
		str(imported.get_message("ESC_VAL")), "Linea\nUno")
	check("C6", "an empty CSV cell imports as an empty message (see R5)",
		str(imported.get_message("EMPTY_ES")), "")

	var registered: Array = Array(ProjectSettings.get_setting(
		"internationalization/locale/translations", PackedStringArray()))
	check("C1", "importing a CSV does not register it: locale/translations stays empty, so nothing loads",
		[registered.size(), Array(locales_at_startup).has("es")], [0, false])
