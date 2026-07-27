#!/bin/sh
# LocGuard pre-commit hook — copy to .git/hooks/pre-commit and chmod +x
node locguard/src/cli.js . --source en || {
  echo "LocGuard: localization errors — commit blocked (bypass: git commit --no-verify)"
  exit 1
}
