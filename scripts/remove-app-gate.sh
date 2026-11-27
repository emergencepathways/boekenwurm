#!/usr/bin/env bash
# Take the app gate (docs/APP_GATE.md) out of Boekenwurm in one step: its folders, every block marked
# APPGATE-REMOVE-START … APPGATE-REMOVE-END, every line marked APPGATE-REMOVE-LINE, its docs, and finally this script.
#   scripts/remove-app-gate.sh           remove it (then run the tests and commit)
#   scripts/remove-app-gate.sh --check   only list what is left of it; exits 1 if anything is
# Nothing in the database belongs to the gate, so there is no migration to run.
set -euo pipefail
cd "$(dirname "$0")/.."

self='scripts/remove-app-gate.sh'
paths=(apps/web/src/gate apps/web/test/gate docs/APP_GATE.md)

leftovers() {
  git grep -n -I -E 'APPGATE-REMOVE|src/gate/|test/gate/|gate/index|privacy\.gate|APP_GATE|remove-app-gate' -- . ":!$self" || true
  for p in "${paths[@]}"; do [ -e "$p" ] && echo "$p (still here)"; done
  return 0
}

if [ "${1:-}" = "--check" ]; then
  left=$(leftovers)
  if [ -n "$left" ]; then
    echo "The app gate is still in the code (docs/APP_GATE.md):"
    echo "$left" | head -60
    exit 1
  fi
  echo "The app gate is gone."
  exit 0
fi

# 1. Its own folders and doc.
for p in "${paths[@]}"; do [ -e "$p" ] && git rm -r -q "$p"; done

# 2. The marked blocks and lines in shared files (perl, so it runs the same on Linux and macOS). A marker counts only
#    inside a comment (// … , {/* … */} or <!-- … -->), so prose that names the markers (CLAUDE.md) isn't mistaken
#    for one.
for f in $(git grep -l -I -E 'APPGATE-REMOVE-(START|END|LINE)' -- . ":!$self"); do
  perl -i -ne '
    BEGIN { $skip = 0; $c = qr{(?://|/\*|<!--)\s*} }
    $skip = 1 if /${c}APPGATE-REMOVE-START/;
    print unless $skip || /${c}APPGATE-REMOVE-LINE/;
    $skip = 0 if /${c}APPGATE-REMOVE-END/;
  ' "$f"
done

# 3. Check, then this script goes too.
left=$(leftovers)
if [ -n "$left" ]; then
  echo "Removed the gate, but something still mentions it; take it out by hand:"
  echo "$left"
  exit 1
fi
git rm -q "$self"
cat <<'EOF'
The app gate is removed. Next:
  cd apps/web && npm test && npm run build && node test/e2e.mjs
  then commit ("Remove the app gate"). On the iPhone, delete the two Boekenwurm Shortcuts and the app automations;
  in Safari, the gate's data stays on that phone until Safari's website data for Boekenwurm is cleared.
EOF
