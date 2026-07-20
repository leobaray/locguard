extends SceneTree
# Proves LocGuard's findings correspond to REAL Godot 4.7 runtime behavior.
var fails := 0
func check(name, cond):
	print(("PASS  " if cond else "FAIL  ") + name)
	if not cond: fails += 1
func _initialize() -> void:
	TranslationServer.set_locale("es")
	# 1. MISSING_ONE has no translation anywhere -> Godot returns the key verbatim
	check("missing key returns itself (LocGuard: missing-key)", tr("MISSING_ONE") == "MISSING_ONE")
	# 2. EMPTY_ES empty in es -> es players get the untranslated English source
	check("empty es shows untranslated source (LocGuard: empty-translation)", tr("EMPTY_ES") == "Hello there")
	# 3. control: a real es translation resolves, and LocGuard stays silent on it
	check("valid key translates (no false positive)", tr("MENU_START") == "Comenzar")
	# 4. SCORE_FMT es carries %s while code does `% 10` -> the drift LocGuard flags
	check("es carries mismatched placeholder (LocGuard: placeholder-printf)", tr("SCORE_FMT").find("%s") != -1)
	print("---")
	print("RUNTIME VERIFY: " + ("ALL PASS" if fails == 0 else "%d FAIL" % fails))
	quit(1 if fails > 0 else 0)
