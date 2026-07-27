#!/bin/bash
# Produces pro/shot-dock.png (1280x720) from a real Godot editor session:
# copies the test fixture project to a scratch dir, drops the ShotKick helper
# plugin in, imports headless, boots the editor on a virtual display and grabs
# the window once ShotKick has run the real dock scan.
#
# Usage: pro/shot-tools/capture.sh [output.png]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
GODOT=/sistemas/blobsmith/tools/godot/Godot_v4.7-stable_linux.x86_64
OUT=${1:-$REPO/pro/shot-dock.png}
PROJ=/tmp/lg-shot
RAW=/tmp/lg-shot-raw.png

rm -rf "$PROJ"
cp -r "$REPO/test/fixtures/godot-proj" "$PROJ"
mkdir -p "$PROJ/addons/shotkick"
cp "$HERE/shotkick_plugin.gd" "$PROJ/addons/shotkick/plugin.gd"
cp "$HERE/shotkick_plugin.cfg" "$PROJ/addons/shotkick/plugin.cfg"
sed -i 's|enabled=PackedStringArray("res://addons/locguard/plugin.cfg")|enabled=PackedStringArray("res://addons/locguard/plugin.cfg", "res://addons/shotkick/plugin.cfg")|' \
  "$PROJ/project.godot"
grep -q shotkick "$PROJ/project.godot" || { echo "FAIL: shotkick not enabled in project.godot"; exit 1; }

xvfb-run -a -s "-screen 0 1600x900x24" "$GODOT" --editor --path "$PROJ" --import >/tmp/godot-import.log 2>&1
echo "import done"

pkill -f 'Xvfb :99' 2>/dev/null
Xvfb :99 -screen 0 1600x900x24 >/tmp/xvfb99.log 2>&1 &
XPID=$!
sleep 3
DISPLAY=:99 "$GODOT" --editor --resolution 1600x900 --position 0,0 --path "$PROJ" >/tmp/godot-shot.log 2>&1 &
GPID=$!
sleep 45
DISPLAY=:99 import -window root "$RAW"
echo "grab-exit=$?"
grep -a SHOTKICK /tmp/godot-shot.log
kill $GPID 2>/dev/null
sleep 2
kill $XPID 2>/dev/null

ffmpeg -y -loglevel error -i "$RAW" -vf "scale=1280:720:flags=lanczos" "$OUT"
identify "$OUT"
