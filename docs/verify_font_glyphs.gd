# Measures what Godot 4's BUILT-IN font can and cannot draw, and what the engine
# does with a codepoint it has no glyph for. Every claim in
# docs/font-glyphs-missing-in-translations.md carries an id printed here.
#
# Run through docs/verify_font_glyphs.sh, which builds a throwaway project.
extends SceneTree

var pass_n := 0
var fail_n := 0

func check(id: String, expected, actual, desc: String) -> void:
	if str(expected) == str(actual):
		print("PASS %-5s %s" % [id, desc])
		pass_n += 1
	else:
		print("FAIL %-5s %s" % [id, desc])
		print("       expected: %s" % str(expected))
		print("       actual:   %s" % str(actual))
		fail_n += 1

# --- coverage enumeration -------------------------------------------------
func covered_ranges(f: Font) -> Array:
	var ranges := []
	var start := -1
	var prev := -1
	var planes := []
	for cp in range(0x0000, 0xD800):
		planes.append(cp)
	for cp in range(0xE000, 0x10000):
		planes.append(cp)
	for cp in range(0x1F000, 0x1FB00):
		planes.append(cp)
	for cp in range(0x20000, 0x2A700):
		planes.append(cp)
	for cp in planes:
		if f.has_char(cp):
			if start == -1:
				start = cp
			elif cp != prev + 1:
				ranges.append([start, prev])
				start = cp
			prev = cp
	if start != -1:
		ranges.append([start, prev])
	return ranges

func shape_glyphs(f: Font, s: String) -> Array:
	var ts := TextServerManager.get_primary_interface()
	var rid := ts.create_shaped_text()
	ts.shaped_text_add_string(rid, s, f.get_rids(), 16)
	ts.shaped_text_shape(rid)
	var out := []
	for g in ts.shaped_text_get_glyphs(rid):
		out.append(g)
	ts.free_rid(rid)
	return out

# A codepoint no font can draw does NOT come back as glyph index 0. Godot marks
# it with an INVALID font_rid and puts the codepoint itself in `index`, which is
# what the renderer turns into a hex box. That is the signature we count.
func notdef_count(f: Font, s: String) -> int:
	var n := 0
	for g in shape_glyphs(f, s):
		if not (g["font_rid"] as RID).is_valid():
			n += 1
	return n

func _init() -> void:
	var f: Font = ThemeDB.fallback_font
	print("engine: %s" % Engine.get_version_info()["string"])
	print("font:   %s (%s), class %s" % [f.get_font_name(), f.get_font_style_name(), f.get_class()])

	# ---------------------------------------------------------------- G ---
	# What the built-in font covers. G1 is the whole enumeration; G2..G16 are
	# the individual codepoints a translator is most likely to hand you.
	var ranges := covered_ranges(f)
	var total := 0
	for r in ranges:
		total += r[1] - r[0] + 1
	check("G1", "Open Sans SemiBold/1010/92", "%s/%d/%d" % [f.get_font_name(), total, ranges.size()],
		"the built-in font is Open Sans SemiBold and draws exactly 1010 codepoints in 92 ranges")

	var ascii_ok := true
	for cp in range(0x20, 0x7F):
		if not f.has_char(cp):
			ascii_ok = false
	check("G2", true, ascii_ok, "every printable ASCII codepoint 0x20-0x7E is covered")
	check("G3", true, f.has_char(0xE9) and f.has_char(0xE3) and f.has_char(0xE7),
		"Latin-1 accents used by fr/pt/es (e-acute, a-tilde, c-cedilla) are covered")
	check("G4", true, f.has_char(0x142) and f.has_char(0x161) and f.has_char(0x11F),
		"Latin Extended-A for pl/cs/tr (l-stroke, s-caron, g-breve) is covered")
	check("G5", true, f.has_char(0x1EA1), "Vietnamese a-with-dot-below (U+1EA1) is covered")
	check("G6", true, f.has_char(0x416), "Cyrillic ZHE (U+0416) is covered")
	check("G7", true, f.has_char(0x3B1), "Greek alpha (U+03B1) is covered")
	check("G8", true, f.has_char(0x5D0), "Hebrew alef (U+05D0) is covered")
	check("G9", false, f.has_char(0x628), "Arabic beh (U+0628) is NOT covered")
	check("G10", false, f.has_char(0x4F60) or f.has_char(0x6211),
		"CJK ideographs (U+4F60, U+6211) are NOT covered")
	check("G11", false, f.has_char(0x3042) or f.has_char(0x30A2),
		"Hiragana and Katakana (U+3042, U+30A2) are NOT covered")
	check("G12", false, f.has_char(0xAC00), "Hangul (U+AC00) is NOT covered")
	check("G13", false, f.has_char(0xE01), "Thai (U+0E01) is NOT covered")
	check("G14", false, f.has_char(0x915), "Devanagari (U+0915) is NOT covered")
	check("G15", false, f.has_char(0x1F600), "emoji (U+1F600) is NOT covered")
	# The one that bites projects with no translation at all:
	check("G16", false, f.has_char(0x2190) or f.has_char(0x2191) or f.has_char(0x2192) or f.has_char(0x2193),
		"the four plain arrows (U+2190..U+2193) are NOT covered")
	check("G17", true, f.has_char(0x2014) and f.has_char(0x2026) and f.has_char(0x2022)
		and f.has_char(0x201C) and f.has_char(0x2019) and f.has_char(0x20AC),
		"em dash, ellipsis, bullet, curly quotes and euro ARE covered - the gap is not 'anything non-ASCII'")
	check("G18", false, f.has_char(0x2713) or f.has_char(0x2605) or f.has_char(0x2665) or f.has_char(0x266A),
		"check mark, star, heart and music note (U+2713, U+2605, U+2665, U+266A) are NOT covered")

	# ---------------------------------------------------------------- S ---
	# What actually draws the codepoints the built-in font does not own.
	# The answer is not "nothing". It is "a font file belonging to the machine
	# the game happens to be running on".
	var builtin_rid: RID = f.get_rids()[0]

	var g_cjk := shape_glyphs(f, "你好")
	check("S1", 2, g_cjk.size(), "shaping \"你好\" with the built-in font still produces 2 glyphs")
	var borrowed := g_cjk.size() > 0 and (g_cjk[0]["font_rid"] as RID).is_valid() and (g_cjk[0]["font_rid"] as RID) != builtin_rid
	check("S2", true, borrowed,
		"and they carry a non-zero glyph index from a font_rid that is NOT the built-in font - the engine silently borrowed a font")

	var sys_paths := OS.get_system_font_path_for_text("Sans", "你好")
	check("S3", true, sys_paths.size() > 0 and sys_paths[0].begins_with("/") and not sys_paths[0].begins_with("res://"),
		"OS.get_system_font_path_for_text() names where it borrowed from - an absolute OS path, not a res:// path: %s" % str(sys_paths))

	# The player who does not have that file. This is the whole failure.
	var f_noSys: Font = f.duplicate()
	f_noSys.allow_system_fallback = false
	check("S4", 2, notdef_count(f_noSys, "你好"),
		"with allow_system_fallback = false the same string is 2 notdef glyphs - this is what a machine without a CJK font renders")
	var g_off := shape_glyphs(f_noSys, "你好")
	check("S4b", "20320/false", "%d/%s" % [int(g_off[0]["index"]), str((g_off[0]["font_rid"] as RID).is_valid())],
		"the marker is not glyph index 0: the index IS the codepoint (U+4F60 = 20320) and the font_rid is invalid - that pair is the hex box you see on screen")
	check("S5", 0, notdef_count(f_noSys, "Ola mundo"),
		"the same flag leaves a covered string untouched: 0 notdef")
	check("S6", 1, notdef_count(f_noSys, "Continue → Next"),
		"one plain arrow in an otherwise ASCII UI string is one notdef glyph - no translation involved")
	check("S7", false, f.has_char(0x4F60),
		"has_char() answers no for U+4F60 even while shaping draws it - the project-side check and the screen disagree")
	var size_missing := f_noSys.get_string_size("你好", HORIZONTAL_ALIGNMENT_LEFT, -1, 16)
	check("S8", true, size_missing.x > 0.0,
		"get_string_size() still returns a non-zero width (%.1f px) for the notdef text - the layout does not collapse, so nothing upstream flags it" % size_missing.x)

	# The fix that travels with the game, measured.
	var dv := FontFile.new()
	var err := dv.load_dynamic_font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
	if err == OK:
		check("S9", true, dv.has_char(0x2192), "the font used for S10 does own U+2192")
		var f_fb: Font = f.duplicate()
		f_fb.allow_system_fallback = false
		f_fb.fallbacks = [dv]
		check("S10", 0, notdef_count(f_fb, "Continue → Next"),
			"a Font in fallbacks fixes the arrow with system fallback OFF - that is the fix that ships inside the .pck")
		check("S11", 2, notdef_count(f_fb, "你好"),
			"the same fallback does NOT fix CJK, because DejaVu Sans has no CJK either - a fallback only covers what it owns")
	else:
		print("SKIP  S9..S11 (no /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf on this machine)")

	# ---------------------------------------------------------------- T ---
	# The translation itself is correct. This is what separates this failure
	# from every other "my translation does not work" report.
	var t := Translation.new()
	t.locale = "zh"
	t.add_message("MENU_START", "开始")
	TranslationServer.add_translation(t)
	TranslationServer.set_locale("zh")
	check("T1", "开始", tr("MENU_START"),
		"tr() returns the correct translated string - TranslationServer never sees a font")
	check("T2", false, tr("MENU_START") == "MENU_START",
		"the raw key is NOT what comes back, so every raw-key checklist points at the wrong cause")
	check("T3", 2, notdef_count(f_noSys, tr("MENU_START")),
		"on a machine without the font, that same correct string is 2 notdef glyphs: the data is right, the pixels are not")

	# ---------------------------------------------------------------- Y ---
	# What the engine guarantees to ship.
	check("Y1", true, total == 1010,
		"the only glyph guarantee that travels inside your export is those %d codepoints" % total)
	var emoji_paths := OS.get_system_font_path_for_text("Sans", "😀")
	check("Y2", true, emoji_paths.size() > 0 and emoji_paths[0].begins_with("/"),
		"even an emoji in a UI string is resolved from an OS path at runtime (%s) - nothing about it is in your project" % str(emoji_paths))

	# ------------------------------------------------------------- dump ---
	var out := {
		"engine": Engine.get_version_info()["string"],
		"font": f.get_font_name(),
		"style": f.get_font_style_name(),
		"covered_codepoints": total,
		"ranges": ranges,
	}
	var dump_path: String = OS.get_environment("LGFONT_DUMP")
	if dump_path != "":
		var fa := FileAccess.open(dump_path, FileAccess.WRITE)
		fa.store_string(JSON.stringify(out))
		fa.close()
		print("wrote %s (%d ranges)" % [dump_path, ranges.size()])

	print("")
	print("%d passed / %d failed" % [pass_n, fail_n])
	quit(0 if fail_n == 0 else 1)
