#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GAAhex — nightly Postgres backup
#
# Source of truth: docs/audit/PRODUCTION-CERT-2026-06-04.md references
# OPS-BACKUP.md §1a as the canonical procedure. This script implements that
# procedure verbatim, with --dry-run + --help affordances added so it can be
# safely exercised on a fresh host.
#
# DOES:
#   1. pg_dump as the 'gaahex' owner role (RLS bypass, full tenant capture)
#      via `docker exec` against the gaahex-db container.
#   2. Writes a custom-format dump (-F c -Z 9) into $GAAHEX_BACKUP_DIR/daily/.
#   3. Generates a sha256 checksum sidecar (.sha256) for tamper / corruption
#      detection, and writes a .toc via `pg_restore --list` so corruption is
#      caught at the source (a 0-byte or truncated dump fails the list step).
#   4. Promotes the dump into weekly (Sunday) and monthly (1st-of-month)
#      retention buckets, then prunes daily >14d, weekly >56d, monthly >366d.
#
# DOES NOT:
#   - Touch the .env file or GAAHEX_FIELD_KEY. Per OPS-BACKUP §1c the secret
#     vault is a SEPARATE step on a SEPARATE destination. This script PRINTS a
#     WARNING if it can detect a co-located .env, so the operator is reminded
#     that secrets must be backed up elsewhere (vault) before disaster strikes.
#   - Replicate off-site. That is `scripts/backup-offsite.sh`, run AFTER this.
#   - Log the contents of .env or any secret value. Ever.
#
# Post-clone (Windows -> Linux host) reminder:
#   Git on Windows does not preserve the executable bit. After clone on the
#   production host run:
#       chmod +x scripts/backup-nightly.sh scripts/backup-offsite.sh scripts/restore-verify.sh
#   Or commit via WSL/`git update-index --chmod=+x` so the bit is tracked.
# ---------------------------------------------------------------------------

set -euo pipefail

# -------- Required environment ---------------------------------------------
#   PGUSER             Postgres role to dump as. Must be 'gaahex' (owner,
#                      BYPASSRLS) — NOT 'gaahex_app'. OPS-BACKUP.md §1 explains
#                      why: 'gaahex_app' is NOBYPASSRLS, so a dump as that role
#                      would silently omit every tenant-scoped row.
#   PGHOST             Hostname or container of the DB. Default: localhost.
#   PGPORT             Port. Default: 5433 (matches docker-compose host port).
#   PGDATABASE         DB name. Default: gaahex.
#   GAAHEX_DB_PASSWORD Password for $PGUSER. Sourced from the vault on prod.
#   GAAHEX_BACKUP_DIR  Root of the backup tree (daily/, weekly/, monthly/
#                      subdirs are created here). Default: /var/backups/gaahex.
#   GAAHEX_DB_CONTAINER Optional override for the container name used by
#                      `docker exec`. Default: gaahex-db (matches compose).
# ---------------------------------------------------------------------------

PGUSER="${PGUSER:-gaahex}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5433}"
PGDATABASE="${PGDATABASE:-gaahex}"
GAAHEX_BACKUP_DIR="${GAAHEX_BACKUP_DIR:-/var/backups/gaahex}"
GAAHEX_DB_CONTAINER="${GAAHEX_DB_CONTAINER:-gaahex-db}"

DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: backup-nightly.sh [--dry-run] [-h|--help]

Take a nightly pg_dump of the GAAhex database, checksum it, verify it opens,
and rotate into daily/weekly/monthly retention buckets.

Options:
  --dry-run   Print every command that would run, without executing.
  -h, --help  Show this help and exit.

Required environment:
  PGUSER              Postgres role (must be the 'gaahex' owner, not 'gaahex_app').
  PGHOST              Postgres host (default: localhost).
  PGPORT              Postgres port (default: 5433).
  PGDATABASE          Database name (default: gaahex).
  GAAHEX_DB_PASSWORD  Password for PGUSER. Never echoed; never written to disk.
  GAAHEX_BACKUP_DIR   Backup root (default: /var/backups/gaahex).
  GAAHEX_DB_CONTAINER Container name for docker exec (default: gaahex-db).

The .env file (containing GAAHEX_FIELD_KEY and JWT_SECRET) is NOT backed up
by this script — that is a separate vault step (see OPS-BACKUP.md §5).
A warning is printed if a .env is found co-located with the backup dir.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

# -------- Fail loud on missing required env --------------------------------
require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "FATAL: required env var $name is unset or empty" >&2
    echo "Run: $0 --help" >&2
    exit 2
  fi
}

# GAAHEX_DB_PASSWORD is the only truly secret one — the rest have safe defaults.
require_env GAAHEX_DB_PASSWORD

# -------- Trap unexpected failures -----------------------------------------
on_error() {
  local exit_code=$?
  local line_no=${1:-?}
  echo "FATAL: backup-nightly.sh failed at line ${line_no} with exit ${exit_code}" >&2
  exit "$exit_code"
}
trap 'on_error $LINENO' ERR

# -------- Helper: run-or-print --------------------------------------------
run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '+ %s\n' "$*"
  else
    eval "$@"
  fi
}

# -------- Co-located .env warning (per OPS-BACKUP §1c) ---------------------
if [ -f "${GAAHEX_BACKUP_DIR}/.env" ] || [ -f "${GAAHEX_BACKUP_DIR}/../.env" ]; then
  echo "WARNING: .env appears to be co-located near ${GAAHEX_BACKUP_DIR}." >&2
  echo "         OPS-BACKUP.md §1c forbids this — move GAAHEX_FIELD_KEY to" >&2
  echo "         the vault on a separate host (see §5). Continuing anyway." >&2
fi

# -------- Paths -------------------------------------------------------------
STAMP=$(date -u +%Y%m%d_%H%M%SZ)
DUMP="${GAAHEX_BACKUP_DIR}/daily/gaahex_${STAMP}.dump"

run "mkdir -p '${GAAHEX_BACKUP_DIR}/daily' '${GAAHEX_BACKUP_DIR}/weekly' '${GAAHEX_BACKUP_DIR}/monthly'"

# -------- 1. Dump (OPS-BACKUP §1a) -----------------------------------------
# -F c   custom binary format (parallel-restorable, selective)
# -Z 9   max zlib compression
# --no-password — relies on PGPASSWORD env injected into the container
run "docker exec -e PGPASSWORD=\"\$GAAHEX_DB_PASSWORD\" '${GAAHEX_DB_CONTAINER}' \
       pg_dump -U '${PGUSER}' -d '${PGDATABASE}' -F c -Z 9 --no-password \
       > '${DUMP}'"

# -------- 2. Checksum sidecar ----------------------------------------------
run "sha256sum '${DUMP}' > '${DUMP}.sha256'"

# -------- 3. Verify the dump opens — corruption / truncation catch ---------
# pg_restore --list will fail on truncation or corruption; we capture the TOC
# as a sidecar for auditability and abort the run if --list errors out.
run "docker exec -i '${GAAHEX_DB_CONTAINER}' pg_restore --list < '${DUMP}' > '${DUMP}.toc' \
       || { echo 'DUMP CORRUPT: ${DUMP}' >&2; exit 1; }"

# -------- 4. Rotation (OPS-BACKUP §1b) -------------------------------------
DOW=$(date -u +%u)   # 1..7, Sun = 7
DOM=$(date -u +%d)   # 01..31

if [ "$DOW" = "7" ]; then
  run "cp '${DUMP}' '${GAAHEX_BACKUP_DIR}/weekly/$(basename "${DUMP}")'"
  run "cp '${DUMP}.sha256' '${GAAHEX_BACKUP_DIR}/weekly/$(basename "${DUMP}").sha256'"
fi
if [ "$DOM" = "01" ]; then
  run "cp '${DUMP}' '${GAAHEX_BACKUP_DIR}/monthly/$(basename "${DUMP}")'"
  run "cp '${DUMP}.sha256' '${GAAHEX_BACKUP_DIR}/monthly/$(basename "${DUMP}").sha256'"
fi

# -------- 5. Prune ---------------------------------------------------------
run "find '${GAAHEX_BACKUP_DIR}/daily'   -name 'gaahex_*.dump'   -mtime +14  -delete"
run "find '${GAAHEX_BACKUP_DIR}/daily'   -name 'gaahex_*.sha256' -mtime +14  -delete"
run "find '${GAAHEX_BACKUP_DIR}/daily'   -name 'gaahex_*.toc'    -mtime +14  -delete"
run "find '${GAAHEX_BACKUP_DIR}/weekly'  -name 'gaahex_*.dump'   -mtime +56  -delete"
run "find '${GAAHEX_BACKUP_DIR}/weekly'  -name 'gaahex_*.sha256' -mtime +56  -delete"
run "find '${GAAHEX_BACKUP_DIR}/monthly' -name 'gaahex_*.dump'   -mtime +366 -delete"
run "find '${GAAHEX_BACKUP_DIR}/monthly' -name 'gaahex_*.sha256' -mtime +366 -delete"

if [ "$DRY_RUN" = "1" ]; then
  echo "OK [dry-run] ${DUMP}"
else
  echo "OK $(du -h "${DUMP}" | cut -f1) ${DUMP}"
fi
