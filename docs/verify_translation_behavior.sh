#!/usr/bin/env bash
# Runs every claim in docs/missing-translations-checklist.md against a real
# Godot 4 binary — including the CSV-importer ones, which need a project whose
# CSV has actually been through the importer.
#
#   docs/verify_translation_behavior.sh /path/to/Godot_v4.7-stable_linux.x86_64
#
# Builds a throwaway project in a temp dir, imports a CSV seeded with the exact
# traps the doc describes (BOM, trailing space, quoted padding, comma in key,
# backslash-n in key and in value, empty cell), then runs the .gd probe inside
# it. Exits non-zero if any claim fails.
set -euo pipefail

GODOT="${1:-}"
if [ -z "$GODOT" ] || [ ! -x "$GODOT" ]; then
  echo "usage: $0 /path/to/godot-binary" >&2
  exit 2
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJ="$(mktemp -d)"
trap 'rm -rf "$PROJ"' EXIT

cat > "$PROJ/project.godot" <<'EOF'
config_version=5

[application]
config/name="LocGuardClaimCheck"
EOF

# The CSV is written with a UTF-8 BOM (\xef\xbb\xbf) on purpose — claim C5.
# Note it is deliberately NOT registered in locale/translations — claim C1.
printf '\xef\xbb\xbfkeys,en,es\n' > "$PROJ/lgcheck.csv"
cat >> "$PROJ/lgcheck.csv" <<'EOF'
MENU_START,Start,Comenzar
TRAIL_SPACE ,Trailing,Trailing es
"WITH,COMMA",Comma,Coma
EMPTY_ES,Hello there,
LINE\nBREAK,Line break,Salto
" QUOTED_PAD ",Padded,Rellenado
ESC_VAL,Line\nOne,Linea\nUno
EOF

cp "$HERE/verify_translation_behavior.gd" "$PROJ/verify_translation_behavior.gd"

"$GODOT" --headless --path "$PROJ" --import >/dev/null 2>&1 || true
if [ ! -f "$PROJ/lgcheck.es.translation" ]; then
  echo "import did not produce lgcheck.es.translation — is this a Godot 4 binary?" >&2
  exit 1
fi

run_probe() {
  "$GODOT" --headless --path "$PROJ" --script verify_translation_behavior.gd 2>&1 \
    | grep -vE '^(Godot Engine v|$)'
  return "${PIPESTATUS[0]}"
}

status=0
echo "### pass 1 — default project (fallback locale = en)"
run_probe || status=1

# The fallback locale is read once at startup, so switching it needs a fresh
# process with the setting already in project.godot.
echo
echo "### pass 2 — same tables, fallback locale cleared"
cat >> "$PROJ/project.godot" <<'EOF'

[internationalization]

locale/fallback=""
EOF
run_probe || status=1
exit "$status"
