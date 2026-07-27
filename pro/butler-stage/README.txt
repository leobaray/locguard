LocGuard Pro 1.0.0 — localization QA for Godot 4
=================================================

WHAT'S IN THE BOX
  addons/locguard/     the in-editor dock (scan, findings list, click-to-open)
  cli/                 the full LocGuard CLI (Node 18+, no dependencies)
  ci-presets/          GitHub Actions, GitLab CI and pre-commit templates

EDITOR ADDON
  1. Copy addons/locguard/ into your project's addons/ folder.
  2. Project > Project Settings > Plugins > enable "LocGuard Pro".
  3. A LocGuard dock appears (bottom-right by default). Click "Scan project".
  4. Double-click a finding to open the offending file.

WHAT IT CATCHES
  - missing-key: used in code/scenes but absent from your translation CSV
    (includes .tscn/.tres texts and OptionButton items Godot's POT misses)
  - empty-translation: locale column left blank -> players see untranslated text
  - placeholder drift: %d vs %s, {0}, {name} mismatches between locales
  - bbcode-imbalance: unclosed/mismatched [b]...[/b] in translated strings
  - orphan-key: table entries nothing references
  - (CLI adds: newline-key trap, overflow budgets, --strict, --json)

CI GATE
  See ci-presets/ — the CLI exits non-zero on errors, so your pipeline fails
  before untranslated text reaches players.

Every rule is verified against the real Godot engine by an automated suite —
if a rule can't be demonstrated to break at runtime, it doesn't ship.

License: LICENSE.txt (commercial use unlimited). Support: itch.io comments.
