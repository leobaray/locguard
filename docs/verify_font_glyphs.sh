#!/usr/bin/env bash
# Measures which codepoints Godot 4's built-in font can draw, and what the
# engine does with the ones it cannot. Every claim in
# docs/font-glyphs-missing-in-translations.md carries an id printed here.
#
# usage:
#   docs/verify_font_glyphs.sh /path/to/Godot_v4.7-stable_linux.x86_64 [dump.json]
#
# The optional second argument writes the exact coverage (ranges of codepoints
# the built-in font owns) as JSON, which is what the web scanner is built from.
set -u

GODOT="${1:-}"
DUMP="${2:-}"
if [ -z "$GODOT" ] || [ ! -x "$GODOT" ]; then
  echo "usage: $0 /path/to/godot-binary [dump.json]" >&2
  exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
LAB="$(mktemp -d /tmp/lgfont.XXXXXX)"
trap 'rm -rf "$LAB"' EXIT

cat > "$LAB/project.godot" <<EOF
config_version=5

[application]

config/name="lgfont"
config/features=PackedStringArray("4.7")
EOF
cp "$HERE/verify_font_glyphs.gd" "$LAB/verify_font_glyphs.gd"

if [ -n "$DUMP" ]; then
  DUMP_ABS="$(cd "$(dirname "$DUMP")" && pwd)/$(basename "$DUMP")"
  export LGFONT_DUMP="$DUMP_ABS"
fi

"$GODOT" --headless --path "$LAB" --script verify_font_glyphs.gd
rc=$?
exit $rc
