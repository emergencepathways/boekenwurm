#!/usr/bin/env bash
# Release gate (docs/PRELAUNCH.md): fails while anything of connected apps is left in the code, the database
# migrations' live state, or the privacy notice. Run before any public release or app-store submission.
#   scripts/prelaunch-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
# Migrations 0013/0014 stay in history once the removal migration exists; the plan, this script and the
# removal SQL themselves are allowed to name things.
allow='^(docs/PRELAUNCH\.md|scripts/prelaunch-check\.sh|supabase/prelaunch/|supabase/migrations/0013_|supabase/migrations/0014_|\.github/workflows/prelaunch\.yml)'
hits=$(git grep -n -I -E 'PRELAUNCH-REMOVE|connected apps|Connected apps|app_connections|connection_summary|create_pairing_code|activeSeconds|active_seconds|appsConnected|connect\.json|CONNECTED_APPS' -- . \
  | grep -v -E "$allow" || true)
removal=$(ls supabase/migrations/*remove_connected_apps*.sql 2>/dev/null || true)
fail=0
if [ -n "$hits" ]; then
  echo "Connected apps are still in the code or docs (docs/PRELAUNCH.md):"
  echo "$hits" | head -60
  [ "$(echo "$hits" | wc -l)" -gt 60 ] && echo "… and more"
  fail=1
fi
if [ -z "$removal" ]; then
  echo "No removal migration yet: copy supabase/prelaunch/remove_connected_apps.sql into supabase/migrations/."
  fail=1
fi
if [ "$fail" = 0 ]; then echo "Pre-launch check passed: connected apps are gone."; fi
exit $fail
