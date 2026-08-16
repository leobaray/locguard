#!/usr/bin/env bash
# Runs every claim in docs/locale-switch-does-not-update-ui.md against a real Godot 4
# binary, twice: once with the default fallback locale and once with it cleared.
#
#   docs/verify_locale_switch.sh /path/to/Godot_v4.7-stable_linux.x86_64
#
# Unlike verify_translation_behavior.sh this needs no CSV and no importer — every
# table is built in memory by the probe — so the throwaway project is two lines.
# Exits non-zero if any claim fails.
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
config/name="LocGuardLocaleSwitchCheck"
EOF

cp "$HERE/verify_locale_switch.gd" "$PROJ/verify_locale_switch.gd"

run_probe() {
  "$GODOT" --headless --path "$PROJ" --script verify_locale_switch.gd 2>&1 \
    | grep -vE '^(Godot Engine v|$)'
  return "${PIPESTATUS[0]}"
}

status=0
echo "### pass 1 — default project (fallback locale = en)"
run_probe || status=1

# The fallback locale is read once at startup, so switching it needs a fresh
# process with the setting already in project.godot. S10 changes answer here and
# must still hold: with no fallback, the player of an untranslated locale gets
# the raw key instead of the source language.
echo
echo "### pass 2 — fallback locale cleared"
cat >> "$PROJ/project.godot" <<'EOF'

[internationalization]

locale/fallback=""
EOF
run_probe || status=1
exit "$status"
