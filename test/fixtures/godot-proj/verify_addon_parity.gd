extends SceneTree
# Parity check: the GDScript addon must find the same defects as the Node CLI.
func _initialize() -> void:
	var res: Dictionary = LocGuardCore.scan_project("res://")
	if res.has("error"):
		print("FAIL  scan error: ", res.error); quit(1); return
	var rules := {}
	for f in res.findings:
		rules[f.rule] = rules.get(f.rule, 0) + 1
	print("RULES: ", JSON.stringify(rules))
	var fails := 0
	var expect := {
		"missing-key": 4,          # MISSING_ONE + PLAY_LABEL + OPT_EASY + OPT_HARD
		"empty-translation": 1,    # EMPTY_ES
		"orphan-key": 1,           # ORPHAN_KEY
		"placeholder-printf": 1,   # SCORE_FMT %d vs %s
		"bbcode-imbalance": 1,     # TIP_BOLD unclosed [b]
	}
	for rule in expect:
		if rules.get(rule, 0) != expect[rule]:
			print("FAIL  %s: expected %d got %d" % [rule, expect[rule], rules.get(rule, 0)])
			fails += 1
		else:
			print("PASS  %s = %d" % [rule, expect[rule]])
	print("PARITY: " + ("ALL PASS" if fails == 0 else "%d FAIL" % fails))
	quit(1 if fails > 0 else 0)
