#!/usr/bin/env bash
# Measures what happens to Godot 4 translations when the project is EXPORTED,
# as opposed to run from the editor. Every claim in
# docs/translations-missing-in-exported-build.md carries an id printed here.
#
# usage:
#   docs/verify_export_translations.sh /path/to/Godot_v4.7-stable_linux.x86_64
#
# It needs no export templates: `--export-pack` writes a .pck without them, and
# the same binary runs that .pck with `--main-pack`, which is the runtime path
# an exported game takes.
set -u

GODOT="${1:-}"
if [ -z "$GODOT" ] || [ ! -x "$GODOT" ]; then
  echo "usage: $0 /path/to/godot-binary" >&2
  exit 2
fi
echo "engine: $("$GODOT" --headless --version 2>/dev/null | tail -1)"

LAB="$(mktemp -d /tmp/lgexport.XXXXXX)"
pass=0; fail=0

check() { # id expected actual desc
  local id="$1" expected="$2" actual="$3" desc="$4"
  if [ "$expected" = "$actual" ]; then
    printf 'PASS %-4s %s\n' "$id" "$desc"; pass=$((pass+1))
  else
    printf 'FAIL %-4s %s\n' "$id" "$desc"
    printf '       expected: %s\n       actual:   %s\n' "$expected" "$actual"
    fail=$((fail+1))
  fi
}

# ---------------------------------------------------------------- fixtures --
make_project() { # dir  extra-project-godot-lines
  local d="$1"; shift
  mkdir -p "$d"
  cat > "$d/project.godot" <<EOF
config_version=5

[application]

config/name="lgexport"
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.7")

[internationalization]

locale/translations=PackedStringArray("res://t.en.translation","res://t.pt.translation")
$*
EOF
  printf 'keys,en,pt\nMENU_START,Start,Iniciar\nMENU_QUIT,Quit,Sair\n' > "$d/t.csv"
  cat > "$d/main.gd" <<'EOF'
extends Node

func _ready() -> void:
	var locales := TranslationServer.get_loaded_locales()
	locales.sort()
	print("PROBE locales=", ",".join(locales))
	TranslationServer.set_locale("pt")
	print("PROBE tr_pt=", tr("MENU_START"))
	print("PROBE csv_readable=", FileAccess.file_exists("res://t.csv"))
	print("PROBE translation_resource=", FileAccess.file_exists("res://t.en.translation"))
	var files := DirAccess.get_files_at("res://")
	files.sort()
	print("PROBE files=", ",".join(files))
	get_tree().quit()
EOF
  cat > "$d/main.tscn" <<'EOF'
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1"]

[node name="Main" type="Node"]
script = ExtResource("1")
EOF
}

make_preset() { # dir  export_filter  export_files  include  exclude
  cat > "$1/export_presets.cfg" <<EOF
[preset.0]

name="Linux"
platform="Linux"
runnable=true
advanced_options=false
dedicated_server=false
custom_features=""
export_filter="$2"
export_files=PackedStringArray($3)
include_filter="$4"
exclude_filter="$5"
export_path="out/game.x86_64"
encryption_include_filters=""
encryption_exclude_filters=""
seed=0
encrypt_pck=false
encrypt_directory=false
script_export_mode=2

[preset.0.options]

binary_format/embed_pck=false
binary_format/architecture="x86_64"
EOF
}

import_project() { # dir   — the editor pass that turns t.csv into .translation
  timeout 300 "$GODOT" --headless --editor --path "$1" --quit >"$1/_import.log" 2>&1
}

export_pack() { # dir
  mkdir -p "$1/out"
  timeout 300 "$GODOT" --headless --path "$1" --export-pack "Linux" "$1/out/game.pck" \
    >"$1/_export.log" 2>&1
  echo $?
}

run_pack() { # dir  -> stdout of the packed game
  timeout 300 "$GODOT" --headless --main-pack "$1/out/game.pck" 2>&1
}

probe() { # text  key
  printf '%s\n' "$1" | sed -n "s/^PROBE $2=//p" | tail -1
}

# What a .pck contains is asked of the running game, not of the bytes: the path
# string "res://t.en.translation" is written into project.binary by the
# locale/translations setting whether or not the resource itself was packed, so
# grepping the pack answers the wrong question.

# =============================================================== E1 baseline =
# The reference run: everything set up the way the docs describe, exported with
# the default filter, executed from the .pck.
D="$LAB/e1"; make_project "$D"; make_preset "$D" "all_resources" "" "" ""
import_project "$D"
EDITOR_OUT="$(timeout 300 "$GODOT" --headless --path "$D" 2>&1)"
rc="$(export_pack "$D")"
PACK_OUT="$(run_pack "$D")"

check E1a "0" "$rc" "--export-pack succeeds with no export templates installed"
check E1b "en,pt" "$(probe "$EDITOR_OUT" locales)" "running from the project dir, both locales load"
check E1c "Iniciar" "$(probe "$EDITOR_OUT" tr_pt)" "running from the project dir, tr() translates"
check E1d "en,pt" "$(probe "$PACK_OUT" locales)" "running from the .pck, both locales load"
check E1e "Iniciar" "$(probe "$PACK_OUT" tr_pt)" "running from the .pck, tr() translates"

# ================================================= E2 the CSV is not shipped =
check E2a "true"  "$(probe "$EDITOR_OUT" csv_readable)" "res://t.csv is readable when running from the project dir"
check E2b "false" "$(probe "$PACK_OUT" csv_readable)"   "res://t.csv is NOT readable from the .pck"
check E2c "main.gd.remap,main.gdc,main.tscn.remap,project.binary,t.csv.import,t.en.translation,t.pt.translation" \
  "$(probe "$PACK_OUT" files)" \
  "the pack holds the .translation files and the .import sidecar, and no .csv"

# ======================================= E3 selective export drops the tables =
# "Export selected resources (and dependencies)" with the main scene picked.
# The .translation files are referenced by project.godot, not by any scene, so
# nothing pulls them in as a dependency.
D="$LAB/e3"; make_project "$D"
make_preset "$D" "resources" '"res://main.tscn"' "" ""
import_project "$D"; rc="$(export_pack "$D")"
PACK_OUT="$(run_pack "$D")"
check E3a "0"     "$rc"                                    "the selective export reports success"
check E3b "false" "$(probe "$PACK_OUT" translation_resource)" "no .translation file made it into the pack"
check E3c ""      "$(probe "$PACK_OUT" locales)"           "the exported game loads zero locales"
check E3d "MENU_START" "$(probe "$PACK_OUT" tr_pt)"        "the exported game prints the raw key"

# ======================================== E4 exclude_filter swallows the pack =
D="$LAB/e4"; make_project "$D"
make_preset "$D" "all_resources" "" "" "*.translation"
import_project "$D"; rc="$(export_pack "$D")"
PACK_OUT="$(run_pack "$D")"
check E4a "0"     "$rc"                                    "exporting with exclude_filter=*.translation reports success"
check E4b "false" "$(probe "$PACK_OUT" translation_resource)" "the filter removed the tables from the pack"
check E4c "MENU_START" "$(probe "$PACK_OUT" tr_pt)"        "the exported game prints the raw key"

# ================================ E5 exporting from CI without an editor pass =
# Fresh clone: .godot/, the .import sidecars and the .translation files are all
# gitignored, and the build machine goes straight to --export-pack. The export
# prints "Cannot open file 'res://t.en.translation'" while it works.
D="$LAB/e5"; make_project "$D"; make_preset "$D" "all_resources" "" "" ""
import_project "$D"
rm -rf "$D/.godot" "$D"/*.translation "$D"/t.csv.import
rc="$(export_pack "$D")"
PACK_OUT="$(run_pack "$D")"
errs="$(grep -c "Cannot open file 'res://t.en.translation'" "$D/_export.log")"
check E5a "0"   "$rc"                          "--export-pack on a never-imported project succeeds"
check E5b "yes" "$([ "$errs" -gt 0 ] && echo yes || echo no)" \
  "it prints 'Cannot open file' errors for the tables it is about to build"
check E5c "true" "$(probe "$PACK_OUT" translation_resource)" \
  "the export imported the .csv itself: the tables are in the pack anyway"
check E5d "Iniciar" "$(probe "$PACK_OUT" tr_pt)" "the exported game translates"

# ============================== E6 stale entry in locale/translations is silent =
D="$LAB/e6"; make_project "$D"; make_preset "$D" "all_resources" "" "" ""
import_project "$D"
sed -i 's|res://t.pt.translation|res://t.fr.translation|' "$D/project.godot"
rc="$(export_pack "$D")"
PACK_OUT="$(run_pack "$D")"
check E6a "0"    "$rc"                          "a path in locale/translations that does not exist does not fail the export"
check E6b "en"   "$(probe "$PACK_OUT" locales)" "the missing table is skipped, the others still load"
check E6c "Start" "$(probe "$PACK_OUT" tr_pt)"  "the locale with no table serves English, not the key"

# ========================= E7 the '*.csv' filter advice changes nothing at all =
# Forum answers tell you to add *.csv to the include filter (or blame an exclude
# filter that eats it). The engine reads neither.
D="$LAB/e7"; make_project "$D"; make_preset "$D" "all_resources" "" "" "*.csv"
import_project "$D"; rc="$(export_pack "$D")"
PACK_OUT="$(run_pack "$D")"
check E7a "0"       "$rc"                       "excluding *.csv from the export succeeds"
check E7b "Iniciar" "$(probe "$PACK_OUT" tr_pt)" "the exported game still translates with the .csv excluded"

D="$LAB/e8"; make_project "$D"; make_preset "$D" "all_resources" "" "*.csv" ""
import_project "$D"; rc="$(export_pack "$D")"
PACK_OUT="$(run_pack "$D")"
check E7c "false"   "$(probe "$PACK_OUT" csv_readable)" \
  "include_filter=*.csv does NOT ship the .csv either: it is an imported resource, not a loose file"
check E7d "Iniciar" "$(probe "$PACK_OUT" tr_pt)"        "and translation works regardless"

# ================================================================== summary ==
echo
echo "RESULT: $pass passed, $fail failed"
echo "lab: $LAB"
[ "$fail" -eq 0 ]
