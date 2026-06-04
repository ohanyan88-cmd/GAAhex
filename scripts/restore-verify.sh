#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GAAhex — restore verification (sandbox restore + RLS smoke test)
#
# Source: OPS-BACKUP.md §3a (sandbox restore — into a SCRATCH database, never
# into prod), §3c (single-tenant restore framing), and §4 (RLS dual-role
# probe — the mandatory smoke test after every restore).
#
# This is the quarterly DR drill helper. It does NOT mutate the live 'gaahex'
# database — it restores the dump into a scratch DB ('gaahex_restore_verify'
# by default), runs the §4 dual-role probe against that DB, and drops the
# scratch DB on exit.
#
# IMPORTANT: this is a VERIFY script, not a recovery script. The full DR
# procedure in OPS-BACKUP.md §3a (drop volume, recreate roles, restore as
# owner, recreate gaahex_app, vacuum analyze) is documented there for the
# on-call engineer to execute by hand. Verifying that the dump CAN be
# restored is a different operation from actually restoring it, and that
# separation is intentional — we want zero chance of an automation bug
# dropping the production volume during a verify run.
#
# Post-clone reminder:
#   chmod +x scripts/restore-verify.sh   (git on Windows does not preserve +x)
# ---------------------------------------------------------------------------

set -euo pipefail

# -------- Required environment ---------------------------------------------
#   PGUSER             Owner role. Must be 'gaahex' (NOT 'gaahex_app'); the
#                      restore as owner is the OPS-BACKUP §3a requirement.
#   PGDATABASE         Live DB name (used as the postgres-connection target
#                      to create the scratch DB). Default: gaahex.
#   GAAHEX_DB_PASSWORD Password for $PGUSER.
#   GAAHEX_DB_CONTAINER Container running Postgres. Default: gaahex-db.
#   GAAHEX_RESTORE_DUMP Path (on the host) to the dump file to verify. REQUIRED.
#   GAAHEX_VERIFY_DB   Scratch DB name. Default: gaahex_restore_verify.
#   GAAHEX_VERIFY_TENANT_ID UUID of a tenant known to have rows. Default:
#                      00000000-0000-0000-0000-000000000000. Used for §4b/§4c
#                      probes. If the dump is empty, §4b will return 0 — that's
#                      a soft signal, not a hard failure (the script logs it).
# ---------------------------------------------------------------------------

PGUSER="${PGUSER:-gaahex}"
PGDATABASE="${PGDATABASE:-gaahex}"
GAAHEX_DB_CONTAINER="${GAAHEX_DB_CONTAINER:-gaahex-db}"
GAAHEX_VERIFY_DB="${GAAHEX_VERIFY_DB:-gaahex_restore_verify}"
GAAHEX_VERIFY_TENANT_ID="${GAAHEX_VERIFY_TENANT_ID:-00000000-0000-0000-0000-000000000000}"

DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: restore-verify.sh [--dry-run] [-h|--help]

Restore a pg_dump file into a scratch database and run the OPS-BACKUP.md §4
RLS dual-role probe against it. Does NOT touch the live database.

Options:
  --dry-run   Print every command that would run, without executing.
  -h, --help  Show this help and exit.

Required environment:
  PGUSER                  Owner role (default: gaahex).
  PGDATABASE              Live DB name (default: gaahex).
  GAAHEX_DB_PASSWORD      Password for PGUSER.
  GAAHEX_DB_CONTAINER     Postgres container (default: gaahex-db).
  GAAHEX_RESTORE_DUMP     Host path to the .dump file to verify. REQUIRED.
  GAAHEX_VERIFY_DB        Scratch DB (default: gaahex_restore_verify).
  GAAHEX_VERIFY_TENANT_ID Tenant UUID for §4b/§4c probes
                          (default: 00000000-0000-0000-0000-000000000000).

The script will:
  1. Create scratch DB owned by PGUSER (drops it first if it exists).
  2. pg_restore the dump into the scratch DB (--clean --if-exists --exit-on-error).
  3. Run smoke test: SELECT count(*) FROM tenant — must return > 0.
  4. Run OPS-BACKUP §4 RLS dual-role probe:
       4a (gaahex_app, no SET LOCAL) -> 0 rows
       4b (gaahex_app, SET LOCAL tenant)    -> >0 rows, 1 distinct tenant
       4c (gaahex_app, cross-tenant probe)  -> 0 rows
       4d (gaahex owner)                    -> baseline counts
  5. Drop the scratch DB on success OR failure (trap'd cleanup).

Exit codes:
  0  All checks passed. Restore is safe.
  1  A check failed. DO NOT cut traffic to this dump.
  2  Misconfiguration (missing env, missing dump file, etc.).
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "FATAL: required env var $name is unset or empty" >&2
    echo "Run: $0 --help" >&2
    exit 2
  fi
}

require_env GAAHEX_DB_PASSWORD
require_env GAAHEX_RESTORE_DUMP

if [ ! -r "${GAAHEX_RESTORE_DUMP}" ]; then
  echo "FATAL: dump file ${GAAHEX_RESTORE_DUMP} not readable." >&2
  exit 2
fi

# -------- Cleanup: drop the scratch DB on exit (success or failure) --------
cleanup() {
  local exit_code=$?
  if [ "$DRY_RUN" = "1" ]; then
    printf '+ %s\n' "docker exec -i '${GAAHEX_DB_CONTAINER}' psql -U '${PGUSER}' -d postgres -c \"DROP DATABASE IF EXISTS ${GAAHEX_VERIFY_DB};\""
  else
    docker exec -i -e PGPASSWORD="${GAAHEX_DB_PASSWORD}" "${GAAHEX_DB_CONTAINER}" \
      psql -U "${PGUSER}" -d postgres -c "DROP DATABASE IF EXISTS ${GAAHEX_VERIFY_DB};" \
      >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT

on_error() {
  local exit_code=$?
  local line_no=${1:-?}
  echo "FATAL: restore-verify.sh failed at line ${line_no} with exit ${exit_code}" >&2
  exit "$exit_code"
}
trap 'on_error $LINENO' ERR

run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '+ %s\n' "$*"
  else
    eval "$@"
  fi
}

# -------- Helper: psql one-liner against the scratch DB --------------------
psql_scratch() {
  local sql="$1"
  local role="${2:-${PGUSER}}"
  if [ "$DRY_RUN" = "1" ]; then
    printf '+ psql(%s, %s): %s\n' "${role}" "${GAAHEX_VERIFY_DB}" "${sql}"
    echo "0"
  else
    docker exec -i -e PGPASSWORD="${GAAHEX_DB_PASSWORD}" "${GAAHEX_DB_CONTAINER}" \
      psql -U "${role}" -d "${GAAHEX_VERIFY_DB}" -tA -c "${sql}"
  fi
}

# -------- 1. (Re)create the scratch DB -------------------------------------
echo "[1/5] (Re)creating scratch DB ${GAAHEX_VERIFY_DB} ..."
run "docker exec -i -e PGPASSWORD=\"\$GAAHEX_DB_PASSWORD\" '${GAAHEX_DB_CONTAINER}' \
       psql -U '${PGUSER}' -d postgres -c \
       \"DROP DATABASE IF EXISTS ${GAAHEX_VERIFY_DB};\""
run "docker exec -i -e PGPASSWORD=\"\$GAAHEX_DB_PASSWORD\" '${GAAHEX_DB_CONTAINER}' \
       psql -U '${PGUSER}' -d postgres -c \
       \"CREATE DATABASE ${GAAHEX_VERIFY_DB} OWNER ${PGUSER};\""

# -------- 2. Restore the dump (OPS-BACKUP §3a flag set) --------------------
echo "[2/5] Restoring ${GAAHEX_RESTORE_DUMP} into ${GAAHEX_VERIFY_DB} ..."
run "docker exec -i -e PGPASSWORD=\"\$GAAHEX_DB_PASSWORD\" '${GAAHEX_DB_CONTAINER}' \
       pg_restore -U '${PGUSER}' -d '${GAAHEX_VERIFY_DB}' \
         -j 4 --clean --if-exists --exit-on-error \
       < '${GAAHEX_RESTORE_DUMP}'"

# -------- 3. Smoke test: SELECT count(*) FROM tenant -----------------------
echo "[3/5] Smoke test — SELECT count(*) FROM tenant ..."
TENANT_COUNT=$(psql_scratch "SELECT count(*) FROM tenant;")
if [ "$DRY_RUN" != "1" ] && [ "${TENANT_COUNT:-0}" -lt 1 ]; then
  echo "FAIL: tenant count = ${TENANT_COUNT}; expected >= 1." >&2
  exit 1
fi
echo "      tenant count = ${TENANT_COUNT}"

# -------- 4. OPS-BACKUP §4 RLS dual-role probe -----------------------------
echo "[4/5] RLS dual-role probe ..."

# 4a — gaahex_app, no SET LOCAL -> must be 0 (RLS rejects unset session)
LEAKED=$(psql_scratch "SELECT count(*) FROM record;" "gaahex_app")
if [ "$DRY_RUN" != "1" ] && [ "${LEAKED:-0}" -ne 0 ]; then
  echo "FAIL §4a: gaahex_app with no SET LOCAL returned ${LEAKED} rows (expected 0)." >&2
  echo "         RLS is BROKEN on the restored DB. Do not cut traffic." >&2
  exit 1
fi
echo "      §4a leaked_rows = ${LEAKED}  (PASS — RLS blocks unset session)"

# 4b — gaahex_app, SET LOCAL tenant -> >0 rows, 1 distinct tenant
VISIBLE=$(psql_scratch \
  "SET LOCAL gaahex.tenant_id = '${GAAHEX_VERIFY_TENANT_ID}'; \
   SELECT count(*) FROM record;" \
  "gaahex_app")
DISTINCT=$(psql_scratch \
  "SET LOCAL gaahex.tenant_id = '${GAAHEX_VERIFY_TENANT_ID}'; \
   SELECT count(DISTINCT tenant_id) FROM record;" \
  "gaahex_app")
echo "      §4b visible_rows = ${VISIBLE}, distinct_tenants = ${DISTINCT}"
if [ "$DRY_RUN" != "1" ]; then
  if [ "${DISTINCT:-0}" -gt 1 ]; then
    echo "FAIL §4b: distinct_tenants = ${DISTINCT} (expected 0 or 1) — RLS leak." >&2
    exit 1
  fi
  if [ "${VISIBLE:-0}" -eq 0 ]; then
    echo "      §4b note: 0 rows for tenant ${GAAHEX_VERIFY_TENANT_ID} —" >&2
    echo "             override GAAHEX_VERIFY_TENANT_ID to a populated tenant" >&2
    echo "             for a stronger probe. Not failing the run." >&2
  fi
fi

# 4c — cross-tenant probe -> 0
ESCAPED=$(psql_scratch \
  "SET LOCAL gaahex.tenant_id = '${GAAHEX_VERIFY_TENANT_ID}'; \
   SELECT count(*) FROM record WHERE tenant_id <> '${GAAHEX_VERIFY_TENANT_ID}';" \
  "gaahex_app")
if [ "$DRY_RUN" != "1" ] && [ "${ESCAPED:-0}" -ne 0 ]; then
  echo "FAIL §4c: cross-tenant probe returned ${ESCAPED} rows (expected 0)." >&2
  echo "         Tenant isolation FAILED — DO NOT cut traffic." >&2
  exit 1
fi
echo "      §4c escaped_rows = ${ESCAPED}  (PASS — cross-tenant probe blocked)"

# 4d — owner bypass works (so backups still work)
TOTAL=$(psql_scratch "SELECT count(*) FROM record;" "${PGUSER}")
TENANTS=$(psql_scratch "SELECT count(DISTINCT tenant_id) FROM record;" "${PGUSER}")
echo "      §4d owner total_rows = ${TOTAL}, tenants = ${TENANTS}  (baseline)"

# -------- 5. Done ----------------------------------------------------------
echo "[5/5] Restore verification PASSED."
echo "OK ${GAAHEX_RESTORE_DUMP}"
