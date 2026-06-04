#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GAAhex — off-site backup replication
#
# Source: OPS-BACKUP.md §2a (rsync to a second host) and §2b (optional
# S3-compatible object storage with versioning + Object Lock).
#
# RUN ORDER: this script runs AFTER scripts/backup-nightly.sh has completed
# successfully. Local backups protect against `rm -rf`; off-site protects
# against fire, theft, ransomware, and the host being seized.
#
# Two independent destinations is the floor for M1 — this script handles
# the first (rsync to a second host, different region) and optionally hooks
# the third (S3-compatible bucket with Object Lock + versioning).
#
# Post-clone reminder:
#   chmod +x scripts/backup-offsite.sh   (git on Windows does not preserve +x)
# ---------------------------------------------------------------------------

set -euo pipefail

# -------- Required environment ---------------------------------------------
#   GAAHEX_BACKUP_DIR        Local backup root. Default: /var/backups/gaahex.
#   GAAHEX_OFFSITE_HOST      SSH destination, e.g. gaahex-backup@offsite.example.am.
#   GAAHEX_OFFSITE_PATH      Remote destination path. Default: /srv/gaahex-backups/.
#   GAAHEX_OFFSITE_SSH_KEY   Path to SSH private key. Default: /root/.ssh/gaahex_offsite.
#
# Optional (S3 tier — §2b):
#   GAAHEX_S3_REMOTE         rclone remote name + bucket, e.g. gaahex-b2:gaahex-backups-prod.
#                            If unset, the S3 step is skipped.
# ---------------------------------------------------------------------------

GAAHEX_BACKUP_DIR="${GAAHEX_BACKUP_DIR:-/var/backups/gaahex}"
GAAHEX_OFFSITE_PATH="${GAAHEX_OFFSITE_PATH:-/srv/gaahex-backups/}"
GAAHEX_OFFSITE_SSH_KEY="${GAAHEX_OFFSITE_SSH_KEY:-/root/.ssh/gaahex_offsite}"

DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: backup-offsite.sh [--dry-run] [-h|--help]

Replicate the local GAAhex backup tree to an off-site host via rsync over SSH,
then verify with a remote sha256sum probe. Optionally also push to an
S3-compatible bucket (Object Lock + versioning) via rclone.

Options:
  --dry-run   Print every command that would run, without executing.
              Also passes --dry-run through to rsync and rclone so the remote
              side is touched read-only.
  -h, --help  Show this help and exit.

Required environment:
  GAAHEX_BACKUP_DIR       Local backup root (default: /var/backups/gaahex).
  GAAHEX_OFFSITE_HOST     SSH destination user@host (REQUIRED — no default).
  GAAHEX_OFFSITE_PATH     Remote path (default: /srv/gaahex-backups/).
  GAAHEX_OFFSITE_SSH_KEY  SSH private key (default: /root/.ssh/gaahex_offsite).

Optional:
  GAAHEX_S3_REMOTE        rclone remote+bucket. If set, the S3 hook fires
                          after the rsync probe succeeds. If unset, skipped.

Per OPS-BACKUP.md §2a, the off-site host must:
  - Be in a different building (different city if possible).
  - Run append-only filesystem snapshots (ZFS/Btrfs) so a compromised app host
    cannot retroactively delete the backups via the rsync channel.
  - Allow only inbound SSH from the app host's static IP.

Per §2b, the S3 bucket must have Object Lock + versioning ON, with a lifecycle
rule that transitions >30d objects to cold storage. The lock period must be
>= the retention window.

This script NEVER reads, logs, or transmits the .env file. Secrets go to the
vault (OPS-BACKUP.md §5) on a destination physically separate from this rsync
target — the blast-radius rule.
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

require_env GAAHEX_OFFSITE_HOST

if [ ! -d "${GAAHEX_BACKUP_DIR}" ]; then
  echo "FATAL: local backup dir ${GAAHEX_BACKUP_DIR} does not exist." >&2
  echo "       Run scripts/backup-nightly.sh first." >&2
  exit 2
fi

if [ ! -r "${GAAHEX_OFFSITE_SSH_KEY}" ]; then
  echo "FATAL: SSH key ${GAAHEX_OFFSITE_SSH_KEY} not readable." >&2
  exit 2
fi

# -------- Trap unexpected failures -----------------------------------------
on_error() {
  local exit_code=$?
  local line_no=${1:-?}
  echo "FATAL: backup-offsite.sh failed at line ${line_no} with exit ${exit_code}" >&2
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

# -------- 1. rsync to the off-site host (OPS-BACKUP §2a) -------------------
# -a   archive (recursive + preserve perms/links/times)
# -v   verbose (captured by cron mail / journald)
# -z   compress in transit
# --delete   mirror — local prunes propagate to the off-site copy
# --partial  resume a broken transfer instead of starting over
RSYNC_FLAGS="-avz --delete --partial"
if [ "$DRY_RUN" = "1" ]; then
  RSYNC_FLAGS="${RSYNC_FLAGS} --dry-run"
fi

run "rsync ${RSYNC_FLAGS} \
       -e \"ssh -i '${GAAHEX_OFFSITE_SSH_KEY}' -o StrictHostKeyChecking=yes\" \
       '${GAAHEX_BACKUP_DIR}/' \
       '${GAAHEX_OFFSITE_HOST}:${GAAHEX_OFFSITE_PATH}'"

# -------- 2. Remote checksum probe (catches silent transport corruption) ---
# Pick the newest local daily dump, then verify it on the remote.
LATEST_DUMP=$(ls -t "${GAAHEX_BACKUP_DIR}/daily/"gaahex_*.dump 2>/dev/null | head -n1 || true)

if [ -z "${LATEST_DUMP}" ]; then
  echo "WARNING: no daily dump found locally — skipping checksum probe." >&2
else
  LATEST_BASE=$(basename "${LATEST_DUMP}")
  # Use the .sha256 sidecar produced by backup-nightly.sh (cwd to daily/ so the
  # sidecar's "path  basename" form resolves on the remote).
  run "ssh -i '${GAAHEX_OFFSITE_SSH_KEY}' '${GAAHEX_OFFSITE_HOST}' \
         \"cd '${GAAHEX_OFFSITE_PATH}/daily' && sha256sum -c '${LATEST_BASE}.sha256'\""
fi

# -------- 3. Optional: S3-compatible object storage (OPS-BACKUP §2b) -------
if [ -n "${GAAHEX_S3_REMOTE:-}" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "WARNING: GAAHEX_S3_REMOTE is set but rclone is not installed — skipping S3 tier." >&2
  else
    RCLONE_FLAGS="--checksum --transfers 4"
    if [ "$DRY_RUN" = "1" ]; then
      RCLONE_FLAGS="${RCLONE_FLAGS} --dry-run"
    fi
    # Object Lock + versioning ON; lifecycle rule transitions >30d to cold.
    # Lock period >= retention window (the bucket-side guarantee against
    # ransomware reaching into the bucket via this same rclone credential).
    run "rclone copy '${GAAHEX_BACKUP_DIR}/daily/' \
           '${GAAHEX_S3_REMOTE}/daily/' \
           ${RCLONE_FLAGS}"
    run "rclone copy '${GAAHEX_BACKUP_DIR}/weekly/' \
           '${GAAHEX_S3_REMOTE}/weekly/' \
           ${RCLONE_FLAGS}"
    run "rclone copy '${GAAHEX_BACKUP_DIR}/monthly/' \
           '${GAAHEX_S3_REMOTE}/monthly/' \
           ${RCLONE_FLAGS}"
  fi
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "OK [dry-run] off-site replication plan printed."
else
  echo "OK off-site replication complete to ${GAAHEX_OFFSITE_HOST}:${GAAHEX_OFFSITE_PATH}"
fi
