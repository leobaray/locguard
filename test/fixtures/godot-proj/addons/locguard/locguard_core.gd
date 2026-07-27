@tool
class_name LocGuardCore
extends RefCounted
## LocGuard Pro — in-editor localization QA for Godot 4. Port of the LocGuard
## CLI rules (github.com/leobaray/locguard); kept in parity by an automated test.

const TEXT_PROPS := ["text", "title", "tooltip_text", "placeholder_text", "hint_tooltip", "window_title"]

# ---------------------------------------------------------------- extraction

static func extract_gd(text: String, file: String) -> Array:
	var out: Array = []
	var re := RegEx.new()
	re.compile("\\b(tr|tr_n|atr)\\s*\\(\\s*&?([\"'])((?:\\\\.|(?!\\2).)*)\\2\\s*(?:,\\s*&?([\"'])((?:\\\\.|(?!\\4).)*)\\4)?")
	var lines := text.split("\n")
	for i in lines.size():
		for m in re.search_all(lines[i]):
			out.append({ "key": _unescape(m.get_string(3)), "file": file, "line": i + 1 })
			if m.get_string(1) == "tr_n" and m.get_string(5) != "":
				out.append({ "key": _unescape(m.get_string(5)), "file": file, "line": i + 1 })
	return out

static func extract_cs(text: String, file: String) -> Array:
	var out: Array = []
	var re := RegEx.new()
	re.compile("\\b(?:Tr|Translate)\\s*\\(\\s*@?\"((?:\\\\.|[^\"])*)\"")
	var lines := text.split("\n")
	for i in lines.size():
		for m in re.search_all(lines[i]):
			out.append({ "key": _unescape(m.get_string(1)), "file": file, "line": i + 1 })
	return out

static func extract_scene(text: String, file: String) -> Array:
	var out: Array = []
	var prop_re := RegEx.new()
	prop_re.compile("^\\s*(" + "|".join(TEXT_PROPS) + ")\\s*=\\s*\"((?:\\\\.|[^\"])*)\"")
	var items_re := RegEx.new()
	items_re.compile("^\\s*(?:items|popup/item_\\d+/text)\\s*=\\s*(.+)$")
	var str_re := RegEx.new()
	str_re.compile("\"((?:\\\\.|[^\"])*)\"")
	var lines := text.split("\n")
	for i in lines.size():
		var pm := prop_re.search(lines[i])
		if pm and pm.get_string(2).strip_edges() != "":
			out.append({ "key": _unescape(pm.get_string(2)), "file": file, "line": i + 1 })
			continue
		var im := items_re.search(lines[i])
		if im:
			for sm in str_re.search_all(im.get_string(1)):
				if sm.get_string(1).strip_edges() != "":
					out.append({ "key": _unescape(sm.get_string(1)), "file": file, "line": i + 1 })
	return out

static func _unescape(s: String) -> String:
	return s.replace("\\n", "\n").replace("\\t", "\t").replace("\\\"", "\"").replace("\\'", "'").replace("\\\\", "\\")

# ---------------------------------------------------------------- csv

static func parse_csv(text: String) -> Dictionary:
	var records: Array = []
	var field := ""
	var row: Array = []
	var in_q := false
	var i := 0
	while i < text.length():
		var c := text[i]
		if in_q:
			if c == "\"":
				if i + 1 < text.length() and text[i + 1] == "\"":
					field += "\""; i += 1
				else: in_q = false
			else: field += c
		elif c == "\"": in_q = true
		elif c == ",": row.append(field); field = ""
		elif c == "\r": pass
		elif c == "\n": row.append(field); records.append(row); field = ""; row = []
		else: field += c
		i += 1
	if field != "" or row.size() > 0:
		row.append(field); records.append(row)
	if records.is_empty():
		return { "locales": [], "rows": {}, "order": [] }
	var header: Array = records[0]
	var locales: Array = []
	for h in header.slice(1):
		if String(h).strip_edges() != "": locales.append(String(h).strip_edges())
	var rows := {}
	var order: Array = []
	for r in range(1, records.size()):
		var rec: Array = records[r]
		if rec.size() == 1 and rec[0] == "": continue
		var key: String = rec[0]
		if key == "": continue
		var values := {}
		for li in locales.size():
			values[locales[li]] = rec[li + 1] if li + 1 < rec.size() else ""
		rows[key] = values
		order.append(key)
	return { "locales": locales, "rows": rows, "order": order }

# ---------------------------------------------------------------- validators

static func placeholders(s: String) -> Dictionary:
	var out := { "printf": [], "pos": [], "named": [] }
	var re := RegEx.new()
	re.compile("%(?:\\d+\\$)?[-+ 0#]*\\d*(?:\\.\\d+)?[diouxXeEfFgGsc%]")
	for m in re.search_all(s):
		if m.get_string(0) != "%%": out.printf.append(m.get_string(0))
	re.compile("\\{(\\d+)\\}")
	for m in re.search_all(s): out.pos.append(m.get_string(0))
	re.compile("\\{([a-zA-Z_][a-zA-Z0-9_]*)\\}")
	for m in re.search_all(s): out.named.append(m.get_string(0))
	return out

static func multiset_equal(a: Array, b: Array) -> bool:
	if a.size() != b.size(): return false
	var sa := a.duplicate(); sa.sort()
	var sb := b.duplicate(); sb.sort()
	return sa == sb

const BB_PAIRED := ["b","i","u","s","code","color","bgcolor","fgcolor","url","font","font_size","outline_size","center","right","left","fill","indent","wave","shake","rainbow","tornado","cell","table"]

static func bbcode_imbalance(s: String) -> Array:
	var problems: Array = []
	var stack: Array = []
	var re := RegEx.new()
	re.compile("\\[(/?)([a-zA-Z_]+)(?:=[^\\]]*)?\\]")
	for m in re.search_all(s):
		var closing := m.get_string(1) == "/"
		var tag := m.get_string(2).to_lower()
		if not BB_PAIRED.has(tag): continue
		if not closing: stack.append(tag)
		elif stack.is_empty(): problems.append("stray [/%s]" % tag)
		elif stack.back() != tag: problems.append("mismatched [/%s]" % tag)
		else: stack.pop_back()
	for t in stack: problems.append("unclosed [%s]" % t)
	return problems

# ---------------------------------------------------------------- lint

static func lint(used: Array, table: Dictionary, source: String = "") -> Dictionary:
	var findings: Array = []
	var locales: Array = table.locales
	if source == "" and locales.size() > 0: source = locales[0]
	var rows: Dictionary = table.rows

	var used_map := {}
	for u in used:
		if not used_map.has(u.key): used_map[u.key] = u

	for key in used_map:
		var u: Dictionary = used_map[key]
		if String(key).contains("\n"):
			findings.append({ "severity": "error", "rule": "newline-key", "key": key, "file": u.file, "line": u.line })
		elif not rows.has(key):
			findings.append({ "severity": "error", "rule": "missing-key", "key": key, "file": u.file, "line": u.line })

	for key in rows:
		var values: Dictionary = rows[key]
		for loc in locales:
			if loc == source: continue
			if not values.has(loc) or values[loc] == "":
				findings.append({ "severity": "warning", "rule": "empty-translation", "key": key, "locale": loc })
	for key in rows:
		if not used_map.has(key):
			findings.append({ "severity": "warning", "rule": "orphan-key", "key": key })

	for key in rows:
		var values: Dictionary = rows[key]
		var src: String = values.get(source, "")
		if src == "": src = key
		var sp := placeholders(src)
		for loc in locales:
			if loc == source: continue
			var v: String = values.get(loc, "")
			if v == "": continue
			var p := placeholders(v)
			if not multiset_equal(sp.printf, p.printf):
				findings.append({ "severity": "error", "rule": "placeholder-printf", "key": key, "locale": loc })
			if not multiset_equal(sp.pos, p.pos):
				findings.append({ "severity": "error", "rule": "placeholder-index", "key": key, "locale": loc })
			if not bbcode_imbalance(v).is_empty():
				findings.append({ "severity": "error", "rule": "bbcode-imbalance", "key": key, "locale": loc })

	var errors := 0
	var warnings := 0
	for f in findings:
		if f.severity == "error": errors += 1
		else: warnings += 1
	return { "findings": findings, "errors": errors, "warnings": warnings, "ok": errors == 0 }

# ---------------------------------------------------------------- project scan

static func scan_project(root: String = "res://", source: String = "") -> Dictionary:
	var used: Array = []
	var csv_path := ""
	var stack: Array = [root]
	while not stack.is_empty():
		var dir_path: String = stack.pop_back()
		var dir := DirAccess.open(dir_path)
		if dir == null: continue
		dir.list_dir_begin()
		var name := dir.get_next()
		while name != "":
			var full := dir_path.path_join(name)
			if dir.current_is_dir():
				if not name.begins_with(".") and name != "addons":
					stack.append(full)
			else:
				var ext := name.get_extension()
				var txt := ""
				if ext in ["gd", "cs", "tscn", "tres", "csv"]:
					var f := FileAccess.open(full, FileAccess.READ)
					if f: txt = f.get_as_text()
				match ext:
					"gd": used.append_array(extract_gd(txt, full))
					"cs": used.append_array(extract_cs(txt, full))
					"tscn", "tres": used.append_array(extract_scene(txt, full))
					"csv":
						if csv_path == "" and txt.length() > 0:
							var first_line := txt.get_slice("\n", 0).to_lower()
							if first_line.begins_with("keys,") or first_line.begins_with("key,"):
								csv_path = full
			name = dir.get_next()
	if csv_path == "":
		return { "error": "no translation CSV found (header must start with 'keys,')" }
	var f2 := FileAccess.open(csv_path, FileAccess.READ)
	var table := parse_csv(f2.get_as_text())
	var result := lint(used, table, source)
	result["csv"] = csv_path
	result["used_count"] = used.size()
	result["table_count"] = table.rows.size()
	return result
