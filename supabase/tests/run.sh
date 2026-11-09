#!/usr/bin/env bash
# Test the migration and its row-level security on a throwaway local Postgres.
#   supabase/tests/run.sh            (needs PostgreSQL 15+ server binaries)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
tmp="$(mktemp -d)"
trap '"$bin/pg_ctl" -D "$tmp/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
if [ "$(id -u)" = 0 ]; then run() { su postgres -s /bin/bash -c "$*"; }; chown -R postgres "$tmp"; else run() { bash -c "$*"; }; fi
run "'$bin/initdb' -D '$tmp/data' -A trust -U postgres >/dev/null"
run "'$bin/pg_ctl' -D '$tmp/data' -o '-k $tmp -p 54329 -c listen_addresses=' -l '$tmp/log' -w start >/dev/null"
psql=(psql -h "$tmp" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${psql[@]}" -f "$here/supabase_stubs.sql"
"${psql[@]}" -f "$here/../migrations/0001_init.sql"
"${psql[@]}" -t -A -f "$here/rls_test.sql" 2>&1 | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /'
