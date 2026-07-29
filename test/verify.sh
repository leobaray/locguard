#!/bin/bash
# LocGuard full verification — the single gate that must be green in the same
# session as any butler push.
#
# Six stages, cheapest first, each one proving something the previous cannot:
#   1. unit       pure rule logic (test/core.test.js)
#   2. cli        the binary behaves: seeded project fails, clean project passes
#   3. copies     every shipped copy of src/ and addon/ is byte-identical
#   4. runtime    real Godot 4.7 proves the seeded defects really break at runtime
#   5. addon      the GDScript dock finds exactly what the Node CLI finds
#   6. published  what we ship == what itch.io actually serves
#
# Stage 3 exists because the product is the SAME code in four places (the test
# fixture, pro/stage, pro/butler-stage and the zip). Stages 1-2 only ever run
# src/; they would stay green while the copy customers download went stale.
#
# Stage 5 exists because LocGuard is sold as two front-ends over one rule set.
# The CLI is what stages 1-2 cover; the editor dock runs a separate GDScript
# implementation, and until 29/07 nothing compared them. Rather than trust two
# hand-written expectation lists, this stage diffs the dock's rule counts
# against the CLI's --json output on the same fixture: drift in EITHER engine
# fails, which a hardcoded list on one side cannot catch.
#
# Stage 6 exists because customers do not get this working tree — they get the
# last thing pushed, and nothing on this machine knows when that was. It is the
# same green-but-stale failure that bit Pixel Logic on 28/07.
#
# NOTE ON EXIT CODES: every Godot stage captures output in a variable instead of
# piping to grep. Until 29/07 stage 4 was `godot ... | grep -E "PASS|FAIL"`, and
# a pipe hands the shell grep's status, not Godot's: a run where the engine
# printed FAIL and quit(1) still ended with "ALL VERIFICATION PASSED" and exit
# 0. Do not reintroduce a pipe here.
#
# Usage:  bash test/verify.sh          (GODOT=... to override the engine binary)
#         LG_SKIP_PUBLISHED=1 ...      (offline stages only; proves nothing
#                                       about what the store serves)
set -e
cd "$(dirname "$0")/.."
GODOT="${GODOT:-/sistemas/blobsmith/tools/godot/Godot_v4.7-stable_linux.x86_64}"
FIXTURE=test/fixtures/godot-proj

# Runs a Godot script against the fixture and fails on a non-zero exit OR on the
# word FAIL appearing in its output (belt and braces: a script that forgets to
# quit(1) must not slip through either).
run_godot() {
  local script="$1" label="$2" out
  out=$("$GODOT" --headless --path "$FIXTURE" --script "$script" 2>&1) || {
    echo "$out"; echo "FAIL: $script exited non-zero ($label)"; exit 1; }
  echo "$out" | grep -E "^(PASS|FAIL|RULES|RUNTIME|PARITY)" || true
  if echo "$out" | grep -q "FAIL"; then
    echo "FAIL: $script reported a failing check ($label)"; exit 1
  fi
  GODOT_OUT="$out"
}

echo "== unit =="
node test/core.test.js

echo "== cli (expect exit 1 on seeded fixture) =="
if node src/cli.js "$FIXTURE" --source en --overflow es:1.6 >/tmp/lg.out 2>&1; then
  echo "FAIL: CLI exited 0 on a project with errors"; cat /tmp/lg.out; exit 1
else
  echo "PASS: CLI exited non-zero as expected"
fi
node src/cli.js test/fixtures/clean-proj --source en >/dev/null 2>&1 \
  && echo "PASS: clean project exits 0" \
  || { echo "FAIL: clean project should exit 0"; exit 1; }

echo "== shipped copies (every copy == the code under test) =="
ZIP=pro/locguard-pro-1.0.0.zip
ZIPDIR=$(mktemp -d); trap 'rm -rf "$ZIPDIR"' EXIT
unzip -oq "$ZIP" -d "$ZIPDIR"
copy_fail=0
check_copy() { # <canonical> <copy>
  diff -q "$1" "$2" >/dev/null 2>&1 || { echo "  DIFF $2 != $1"; copy_fail=1; }
}
for f in cli.js core.js; do
  for c in "pro/stage/cli/src/$f" "pro/butler-stage/cli/src/$f" "$ZIPDIR/cli/src/$f"; do
    check_copy "src/$f" "$c"
  done
done
for f in locguard_core.gd plugin.cfg plugin.gd; do
  for c in "$FIXTURE/addons/locguard/$f" "pro/stage/addons/locguard/$f" \
           "pro/butler-stage/addons/locguard/$f" "$ZIPDIR/addons/locguard/$f"; do
    check_copy "addon/addons/locguard/$f" "$c"
  done
done
if [ "$copy_fail" = 1 ]; then
  echo "FAIL: a shipped copy drifted from the canonical source above."
  echo "      The stages that follow test src/ and addon/ — they would stay green"
  echo "      while customers download the stale copy. Re-stage on purpose:"
  echo "        cp src/*.js pro/butler-stage/cli/src/ && cp src/*.js pro/stage/cli/src/"
  echo "        cp addon/addons/locguard/* pro/butler-stage/addons/locguard/   # etc, then rezip"
  exit 1
fi
echo "PASS: fixture, pro/stage, pro/butler-stage and $ZIP all match src/ + addon/"

echo "== runtime (real Godot 4.7) =="
run_godot verify_runtime.gd "seeded defects break at runtime"

echo "== addon/CLI parity (real Godot 4.7) =="
run_godot verify_addon_parity.gd "dock rule counts"
DOCK_RULES=$(echo "$GODOT_OUT" | sed -n 's/^RULES: //p' | head -1)
CLI_RULES=$(node src/cli.js "$FIXTURE" --source en --json 2>/dev/null | python3 -c "
import json,sys,collections
d=json.load(sys.stdin)
f=d.get('findings', d if isinstance(d,list) else [])
print(json.dumps(dict(sorted(collections.Counter(x['rule'] for x in f).items())),separators=(',',':')))
")
NORM_DOCK=$(python3 -c "
import json,sys
print(json.dumps(dict(sorted(json.loads(sys.argv[1]).items())),separators=(',',':')))
" "$DOCK_RULES")
if [ "$NORM_DOCK" = "$CLI_RULES" ]; then
  echo "PASS: dock == CLI on the same fixture ($CLI_RULES)"
else
  echo "  dock: $NORM_DOCK"
  echo "  cli : $CLI_RULES"
  echo "FAIL: the editor dock and the CLI disagree about the same project."
  echo "      Both are sold as 'LocGuard'; a customer would get different answers"
  echo "      depending on which one they ran. Fix the rule in whichever engine"
  echo "      drifted (src/core.js or addon/addons/locguard/locguard_core.gd)."
  exit 1
fi

echo "== published parity (what we ship vs what itch.io serves) =="
# butler push-preview is authenticated and read-only: it hashes the local files,
# asks itch.io for the current build's signature and reports the per-file diff
# without creating a build.
BUTLER=/sistemas/blobsmith/tools/butler-bin/butler
KEYFILE=/sistemas/blobsmith/.itch-api-key
if [ -n "$LG_SKIP_PUBLISHED" ]; then
  echo "SKIP: LG_SKIP_PUBLISHED set — this run does NOT prove what the store serves."
elif [ ! -x "$BUTLER" ] || [ ! -f "$KEYFILE" ]; then
  echo "FAIL: cannot check the store (butler at $BUTLER or key at $KEYFILE missing)."
  echo "      Set LG_SKIP_PUBLISHED=1 to run the offline stages only — but then this"
  echo "      run proves nothing about what customers actually download."
  exit 1
else
  export BUTLER_API_KEY=$(tr -d '\n\r ' < "$KEYFILE")
  out=$("$BUTLER" push-preview pro/butler-stage blobsmith/locguard:win-linux-osx 2>&1) || {
    echo "$out"; echo "FAIL: could not compare against itch.io"; exit 1; }
  if echo "$out" | grep -qE "0 new, 0 modified, 0 deleted"; then
    echo "PASS: the store serves exactly pro/butler-stage"
  else
    echo "$out" | grep -E "^(MODIFIED|ADDED|DELETED|✓)" || true
    echo "FAIL: itch.io is NOT serving pro/butler-stage — the store is stale (or was"
    echo "      pushed from somewhere else). Ship the verified build, only ever with"
    echo "      this whole suite green in the same session."
    exit 1
  fi
fi

echo "ALL VERIFICATION PASSED"
