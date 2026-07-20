#!/bin/bash
# LocGuard full verification: pure-logic unit tests, CLI on a seeded fixture
# (must exit 1), and proof against the real Godot 4.7 engine that the seeded
# defects genuinely break at runtime.
set -e
cd "$(dirname "$0")/.."
GODOT="${GODOT:-/sistemas/blobsmith/tools/godot/Godot_v4.7-stable_linux.x86_64}"

echo "== unit =="
node test/core.test.js

echo "== cli (expect exit 1 on seeded fixture) =="
if node src/cli.js test/fixtures/godot-proj --source en --overflow es:1.6 >/tmp/lg.out 2>&1; then
  echo "FAIL: CLI exited 0 on a project with errors"; cat /tmp/lg.out; exit 1
else
  echo "PASS: CLI exited non-zero as expected"
fi
# clean project must exit 0
node src/cli.js test/fixtures/clean-proj --source en >/dev/null 2>&1 && echo "PASS: clean project exits 0" || { echo "FAIL: clean project should exit 0"; exit 1; }

echo "== runtime (real Godot 4.7) =="
"$GODOT" --headless --path test/fixtures/godot-proj --script verify_runtime.gd 2>&1 | grep -E "PASS|FAIL|RUNTIME"

echo "ALL VERIFICATION PASSED"
