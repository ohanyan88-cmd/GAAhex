# OPS — Backup & Recovery Runbook (Production)

**Audience:** on-call engineer at 3 AM. **Scope:** GAAhex on-prem Armenian ISP deployment,
15k subscribers, M1 go-live target. **Stack:** Postgres 16 (PostGIS) + Redis via docker-compose,
FastAPI/uvicorn backend, Vite static frontend.

> **The two things that, if lost, lose customer data:**
> 1. The Postgres dump (or `gaahex_pgdata` volume) — the system of record.
> 2. `GAAHEX_FIELD_KEY` in `.env` — without it, Fernet-encrypted columns are unrecoverable
>    cipher-text. The DB dump alone is **not** sufficient. Back them up to **different** systems.

**Container & volume names (from `docker-compose.yml`):**
- DB container: `gaahex-db` · host port `5433` → container `5432`
- Redis container: `gaahex-redis` · host port `6380` → container `6379`
- Persistent volume: `gaahex_pgdata`
- DB superuser/owner role: `gaahex` (BYPASSRLS) · App role: `gaahex_app` (NOSUPERUSER NOBYPASSRLS)
- Database name: `gaahex`

**RTO / RPO targets (M1):** RTO 4h · RPO 1h target / 24h actual until WAL archiving lands (see §6).

---

## 1. Daily backup (planned)

Runs nightly off-peak (03:00 Yerevan). Owned by cron on the app host. The dump is taken **as role
`gaahex`** (the owner). `gaahex_app` cannot dump everything — RLS would silently filter rows on
tenant-scoped tables and the dump would be **incomplete by tenant**. Always dump as owner.

### 1a. The nightly command

```bash
# /opt/gaahex/bin/backup-nightly.sh
set -euo pipefail

STAMP=$(date -u +%Y%m%d_%H%M%SZ)
DEST=/var/backups/gaahex
DUMP="$DEST/daily/gaahex_${STAMP}.dump"
mkdir -p "$DEST/daily" "$DEST/weekly" "$DEST/monthly"

# Dump as the owner role (gaahex) — bypasses RLS, captures every tenant.
# -F c   custom binary format (parallel-restorable, selective)
# -Z 9   max zlib compression
# --no-password — relies on ~/.pgpass for the gaahex role
docker exec -e PGPASSWORD="$GAAHEX_DB_PASSWORD" gaahex-db \
  pg_dump -U gaahex -d gaahex -F c -Z 9 --no-password \
  > "$DUMP"

# Checksum (sha256) for tamper detection and corruption catch.
sha256sum "$DUMP" > "${DUMP}.sha256"

# Verify the dump opens — pg_restore --list will fail on truncation or corruption.
docker exec -i gaahex-db pg_restore --list < "$DUMP" > "${DUMP}.toc" \
  || { echo "DUMP CORRUPT: $DUMP" >&2; exit 1; }

echo "OK $(du -h "$DUMP" | cut -f1) $DUMP"
```

### 1b. Retention policy

| Tier    | Frequency | Keep     | Path                                |
|---------|-----------|----------|-------------------------------------|
| Daily   | Nightly   | 14 days  | `/var/backups/gaahex/daily/`        |
| Weekly  | Sun 03:00 | 8 weeks  | `/var/backups/gaahex/weekly/`       |
| Monthly | 1st of mo | 12 months| `/var/backups/gaahex/monthly/`      |

Rotation (run after the nightly):

```bash
# Promote last-Sunday daily into weekly, last-of-month into monthly.
[ "$(date -u +%u)" = "7" ] && cp "$DUMP" "$DEST/weekly/$(basename "$DUMP")"
[ "$(date -u +%d)" = "01" ] && cp "$DUMP" "$DEST/monthly/$(basename "$DUMP")"

# Prune.
find "$DEST/daily"   -name 'gaahex_*.dump' -mtime +14  -delete
find "$DEST/daily"   -name 'gaahex_*.sha256' -mtime +14 -delete
find "$DEST/weekly"  -name 'gaahex_*.dump' -mtime +56  -delete
find "$DEST/monthly" -name 'gaahex_*.dump' -mtime +366 -delete
```

### 1c. `.env` is NOT in this backup — it goes to the vault

The `.env` file holds `GAAHEX_FIELD_KEY` (Fernet) and `JWT_SECRET`. **Do not co-locate it with
the database dump.** If both leak, the attacker has plaintext data; if the key is lost with the
DB dump alone, encrypted columns are gone forever. See §5 — secrets go to a separate vault.

### 1d. Success signal

The cron unit must:
- Exit non-zero on any failure (`set -euo pipefail` above).
- Emit a heartbeat to the monitoring system on success (Healthchecks.io ping or equivalent).
- Page on-call if no heartbeat for 36 h (one missed night + 12 h grace).

---

## 2. Off-site replication

Local backups protect against `rm -rf`. Off-site protects against fire, theft, ransomware,
and the host being seized. Two independent destinations is the floor for M1.

### 2a. rsync to a second host (different region)

```bash
# /opt/gaahex/bin/backup-offsite.sh — runs after 1a finishes.
rsync -avz --delete --partial \
  -e "ssh -i /root/.ssh/gaahex_offsite -o StrictHostKeyChecking=yes" \
  /var/backups/gaahex/ \
  gaahex-backup@offsite.example.am:/srv/gaahex-backups/

# Verify with a remote checksum probe (catches silent transport corruption).
ssh -i /root/.ssh/gaahex_offsite gaahex-backup@offsite.example.am \
  "cd /srv/gaahex-backups/daily && sha256sum -c $(basename "$DUMP").sha256"
```

The off-site host must:
- Be in a different building (different city if possible — Yerevan ↔ Gyumri).
- Run an append-only filesystem snapshot (ZFS/Btrfs daily snapshots) so a compromised app host
  cannot retroactively delete the backups via the rsync channel.
- Have only inbound SSH from the app host's static IP.

### 2b. Optional: S3-compatible object storage with versioning

For cloud customers and as a third tier. Backblaze B2 / AWS S3 / Wasabi all work via `rclone`.

```bash
# Bucket has Object Lock + versioning ON; lifecycle rule transitions >30d to cold storage.
rclone copy /var/backups/gaahex/daily/ \
  gaahex-b2:gaahex-backups-prod/daily/ \
  --checksum --transfers 4
```

**Object Lock** (write-once-read-many) is the protection against ransomware reaching into the
bucket and deleting history. Set the lock period to at least the retention window.

---

## 3. Restore procedures

### 3a. Full restore to a fresh DB (most common — DR or new host)

This is the canonical restore. **Restore as `gaahex` (owner)**, not as `gaahex_app`. The app role
lacks privilege to recreate schema objects (extensions, roles, policies, owners) and the restore
will fail mid-way with `permission denied for schema public` or similar.

```bash
# 1. Bring up the stack with an EMPTY data volume.
docker compose down
docker volume rm gaahex_pgdata          # destructive — only on the restore target
docker compose up -d db
docker exec gaahex-db pg_isready -U gaahex   # wait for "accepting connections"

# 2. The image bootstraps DB "gaahex" owned by "gaahex" from POSTGRES_*.
#    We need a clean DB to restore into — drop+recreate.
docker exec -i gaahex-db psql -U gaahex -d postgres <<'SQL'
DROP DATABASE IF EXISTS gaahex;
CREATE DATABASE gaahex OWNER gaahex;
SQL

# 3. Recreate the app role BEFORE restore so grants in the dump resolve.
#    If you skip this, pg_restore emits "role gaahex_app does not exist" warnings
#    and grants are silently dropped — the app will boot but get permission errors.
docker exec -i gaahex-db psql -U gaahex -d postgres <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gaahex_app') THEN
    CREATE ROLE gaahex_app LOGIN PASSWORD :'app_pw'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
SQL

# 4. Restore the dump.
#    -j 4  parallel workers — speeds up 15k-subscriber DB substantially
#    --clean --if-exists  drop pre-existing objects (safe on the empty DB)
#    --no-owner is NOT used — we WANT owner reassigned to gaahex
docker exec -i gaahex-db pg_restore \
  -U gaahex -d gaahex \
  -j 4 --clean --if-exists --exit-on-error \
  < /var/backups/gaahex/daily/gaahex_YYYYMMDD_HHMMSSZ.dump

# 5. Vacuum + analyze immediately — fresh restore has zero planner stats.
docker exec -i gaahex-db psql -U gaahex -d gaahex -c "VACUUM ANALYZE;"

# 6. Run the RLS smoke test (§4) — do not declare the restore good without it.
```

### 3b. Point-in-time recovery (PITR) — optional, not M1

PITR requires WAL archiving (`archive_mode=on`, `archive_command='...'`). **Not configured in M1.**
The effective RPO until this lands is the gap between the incident and the last nightly dump
(worst case 24 h). Tracked as M1-B gap below in §6.

Once WAL archiving is on, recovery is: restore the base backup as in §3a, then drop a
`recovery.signal` file in `$PGDATA` and set `restore_command` + `recovery_target_time` in
`postgresql.auto.conf`, then start Postgres — it replays WAL up to the target.

### 3c. Single-tenant restore (rare — for support / GDPR right-to-restore)

Used when one tenant corrupted their data (bad import, accidental bulk delete) and you need to
restore *just their rows* without rolling back the other 14,999 customers.

```bash
# 1. Restore the nightly dump into a SCRATCH database — never directly into prod.
docker exec -i gaahex-db psql -U gaahex -d postgres -c \
  "CREATE DATABASE gaahex_scratch OWNER gaahex;"
docker exec -i gaahex-db pg_restore -U gaahex -d gaahex_scratch -j 4 --exit-on-error \
  < /var/backups/gaahex/daily/gaahex_YYYYMMDD_HHMMSSZ.dump

# 2. Pull just the affected tenant's rows out, table-by-table.
#    Replace TENANT_UUID and the table list with the actual scope of the restore.
TENANT='00000000-0000-0000-0000-000000000000'
TABLES='record invoice payment service_instance ticket event audit_log'

for T in $TABLES; do
  docker exec -i gaahex-db psql -U gaahex -d gaahex_scratch -c \
    "\COPY (SELECT * FROM $T WHERE tenant_id='$TENANT') TO '/tmp/${T}.csv' CSV HEADER"
done

# 3. In prod, delete the corrupt rows for that tenant inside a transaction,
#    then COPY the scratch rows back in. Run this WITH AN OPEN SESSION TO ROLLBACK.
#    BEGIN ... COPY ... verify row counts ... COMMIT or ROLLBACK.

# 4. Drop the scratch DB once verified.
docker exec -i gaahex-db psql -U gaahex -d postgres -c "DROP DATABASE gaahex_scratch;"
```

This procedure is for support engineers; never run unattended. The COPY-back step MUST happen
inside an explicit `BEGIN; ... COMMIT;` with a row-count check before commit.

---

## 4. RLS isolation verification (smoke test after every restore)

This is **mandatory** after §3a. RLS policies are stored in the dump and come back with the
schema, but a restore can still go wrong (policies disabled, wrong role used, GUC not respected).
If this test fails, the restore is **not** safe to put traffic on — one tenant could read another's data.

### 4a. Test 1: unset session → must return zero rows

```bash
docker exec -i gaahex-db psql -U gaahex_app -d gaahex <<'SQL'
-- No SET LOCAL gaahex.tenant_id — RLS should reject all rows.
SELECT count(*) AS leaked_rows FROM record;
-- Expected: 0. Any other result = RLS broken, DO NOT cut over.
SQL
```

### 4b. Test 2: set tenant → must return only that tenant's rows

```bash
docker exec -i gaahex-db psql -U gaahex_app -d gaahex <<'SQL'
-- Pick a tenant UUID known to have records.
SET LOCAL gaahex.tenant_id = '00000000-0000-0000-0000-000000000000';
SELECT count(*) AS visible_rows,
       count(DISTINCT tenant_id) AS distinct_tenants
FROM record;
-- Expected: visible_rows > 0, distinct_tenants = 1.
SQL
```

### 4c. Test 3: cross-tenant probe → must return zero

```bash
docker exec -i gaahex-db psql -U gaahex_app -d gaahex <<'SQL'
SET LOCAL gaahex.tenant_id = '00000000-0000-0000-0000-000000000000';
-- Try to read another tenant's rows directly.
SELECT count(*) AS escaped_rows
FROM record
WHERE tenant_id <> '00000000-0000-0000-0000-000000000000';
-- Expected: 0. Anything else = isolation failure.
SQL
```

### 4d. Test 4: owner bypass works (so backups still work)

```bash
docker exec -i gaahex-db psql -U gaahex -d gaahex -c \
  "SELECT count(*) AS total_rows, count(DISTINCT tenant_id) AS tenants FROM record;"
# Expected: matches pre-restore numbers (cross-check against the source DB row count).
```

All four tests must pass. Capture the output in the restore ticket.

---

## 5. Secrets backup — `.env` and `GAAHEX_FIELD_KEY`

The dev workflow mirrors `.env` to `D:\Backups\GAAhex-mirror` via robocopy on the developer box.
**That is a developer convenience, not a production posture.** Production must:

### 5a. Store secrets in a real vault

- HashiCorp Vault (on-prem option — fits the Armenian on-prem deployment best).
- AWS Secrets Manager (if the customer chooses cloud).
- GCP Secret Manager (same).

The vault must be **separate from the DB backup destination**. The blast radius rule: one
compromise should not yield both ciphertext and key.

### 5b. What goes into the vault

| Secret              | Why                                                            |
|---------------------|----------------------------------------------------------------|
| `GAAHEX_FIELD_KEY`  | Fernet key; without it `api_key.key_enc`, `webhook.secret_enc` are dead |
| `JWT_SECRET`        | Loss invalidates every active session — recoverable, but disruptive |
| `DATABASE_URL`      | Holds the `gaahex` owner password                               |
| SMTP/SMS creds      | Notification channel credentials                                |
| Stripe/PSP keys     | Payment provider — rotate via the provider on suspected leak    |

### 5c. Key rotation runbook

`GAAHEX_FIELD_KEY` rotation procedure — driven by `backend/scripts/rotate_field_key.py`:

```bash
# 1. Fresh DB backup BEFORE touching the key (§1a).
/opt/gaahex/bin/backup-nightly.sh

# 2. Generate the new key.
NEW_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

# 3. Run the rotation script — re-encrypts every Fernet column inside one transaction per table.
cd /opt/gaahex/backend
.venv/bin/python -m scripts.rotate_field_key \
  --old-key "$GAAHEX_FIELD_KEY" \
  --new-key "$NEW_KEY"

# 4. Verify row counts unchanged (the script prints before/after — both must match).

# 5. Push the new key to the vault. Keep the old key in the vault under a `previous` slot
#    for 24 h in case rollback is needed.

# 6. Update the app's `.env` (pulled from vault at boot) and restart.
docker compose -f /opt/gaahex/docker-compose.yml restart  # backend only, db stays up

# 7. Tail the app log for `INVALID_KEY` / Fernet errors for the next 15 min.
```

If the script aborts mid-run, the transaction rolls back and the old key is still valid.
**Never** delete the old key from the vault until 24 h of clean operation on the new key.

---

## 6. Disaster recovery — RTO / RPO targets

| Target | Value | What it means                                              |
|--------|-------|------------------------------------------------------------|
| RTO    | 4 h   | From "outage declared" to "service back" — restore + smoke |
| RPO    | 1 h   | Max acceptable data loss window — drives WAL cadence       |

### 6a. M1 gap — actual RPO is 24 h

The nightly dump cadence in §1 gives an effective RPO of **~24 h** worst case (incident just
before the next nightly). **This is a known gap.** Acceptable for the 90-day M1 on-prem test
(15k subscribers, low transaction velocity per minute), **not** acceptable for the post-M1
SaaS scale.

**Path to 1 h RPO** (post-M1, tracked as M1-B work-stream):
- Turn on Postgres WAL archiving (`archive_mode=on`, `archive_command` shipping to off-site).
- Continuous base backup every 6 h instead of nightly.
- Add a streaming replica on the off-site host (`pg_basebackup` + `primary_conninfo`).
- PITR becomes the recovery path (§3b) instead of dump-replay.

### 6b. Quarterly DR drill

Once per quarter (calendar reminder, not "when we get to it"):
- Pick a random nightly dump from the off-site host.
- Restore it on a separate test box following §3a end-to-end.
- Run §4 (RLS smoke test) and the backend test suite against the restored DB.
- Time the whole thing — if it exceeds 4 h, the RTO is fiction; fix the slow step.
- Write the timing into the runbook commit log.

---

## 7. Common pitfalls (the 3-AM mistakes)

### 7a. "Restored as wrong role" → RLS policies present but no owner match

Symptom: app boots, every query returns zero rows, no error in the log.
Cause: dump restored as `gaahex_app` (or `postgres`) instead of `gaahex` — policies exist, but
table owners point at a role that doesn't match the app's connection, and `FORCE ROW LEVEL
SECURITY` blocks everything.
Fix: drop the DB, redo §3a as `gaahex`. **Do not** try to ALTER owners in-place; the schema is
extensive and you will miss something.

### 7b. "Restored without recreating `gaahex_app`" → app can't connect

Symptom: `pg_restore` warnings about `role "gaahex_app" does not exist`; app boot fails with
`FATAL: role "gaahex_app" does not exist` or `permission denied for table tenant`.
Cause: skipped step 3 of §3a.
Fix: `CREATE ROLE gaahex_app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;` then re-run the
grants — easiest is to re-run the relevant alembic migration that creates the role, or restore
fresh after creating the role.

### 7c. "Restored without `.env`" → Fernet columns unreadable

Symptom: app boots, most pages work, but anything touching `api_key.key_enc` or
`webhook.secret_enc` throws `cryptography.fernet.InvalidToken`.
Cause: the DB came back but `GAAHEX_FIELD_KEY` did not — the dump has ciphertext encrypted with
a key that no longer exists.
Fix: **there is no fix** if the key is truly gone. The columns must be reset (NULL out the
encrypted columns, force users to re-enter API keys / webhook secrets via the UI). This is why
§5 says: back up the key to the vault, not co-located with the DB.

### 7d. "Forgot to vacuum after restore" → slow first hour, on-call paged for latency

Symptom: app is up post-restore, but every query is ~10× slower than normal; CPU pinned on the
DB; the on-call alarm fires for `p95_latency > 2s`.
Cause: a fresh restore has zero `pg_statistic` rows — the planner picks bad plans (seq scans
where an index scan was right).
Fix: run `VACUUM ANALYZE;` as in §3a step 5. Already in the runbook — but it's the step that
gets skipped under time pressure. Don't skip it.

### 7e. "Backup ran but the dump is 0 bytes"

Symptom: nightly cron logged success, but the file is empty or pg_restore --list errors out.
Cause: `pg_dump` failed (DB down, password wrong, disk full) and the shell didn't propagate the
exit code — or the dump was redirected before being checked.
Fix: the script in §1a uses `set -euo pipefail` and runs `pg_restore --list` before declaring
success. **Never** trust a backup that hasn't been list-verified. Restore is the only true test.

### 7f. "Volume snapshot taken with DB running" → silently corrupt

Symptom: `gaahex_pgdata` tar snapshot restores, but Postgres won't start — `invalid magic
number` in WAL or "database files are incompatible".
Cause: filesystem-level snapshot of a running Postgres data dir captures torn pages.
Fix: **always** use `pg_dump` (§1a) for logical backups. Volume-level snapshots require
`pg_start_backup()` / `pg_stop_backup()` framing, which the M1 procedure doesn't include.
`pg_dump` is the safe path.

---

## 8. Redis — not a system of record

Redis (`gaahex-redis`, host port 6380) holds rate-limit counters and ephemeral session cache.
**It is not backed up.** Loss = users get logged out + rate-limit windows reset. No customer
data lost. If a customer asks "do you back up Redis?", the answer is "we don't need to — all
durable state is in Postgres." If that changes (e.g. Redis becomes the queue for background
jobs with no DB-side outbox), this section gets a §1-style nightly procedure.

---

## 9. Quick reference — the four commands that matter

```bash
# Take a backup right now (manual, ad-hoc).
docker exec gaahex-db pg_dump -U gaahex -d gaahex -F c -Z 9 \
  > /var/backups/gaahex/manual/gaahex_$(date -u +%Y%m%d_%H%M%SZ).dump

# Verify a dump file opens.
docker exec -i gaahex-db pg_restore --list < /path/to/dump | head

# Restore (assumes empty DB — see §3a for full sequence).
docker exec -i gaahex-db pg_restore -U gaahex -d gaahex -j 4 \
  --clean --if-exists --exit-on-error < /path/to/dump

# RLS smoke (§4 — run after every restore).
docker exec -i gaahex-db psql -U gaahex_app -d gaahex \
  -c "SELECT count(*) FROM record;"   # must be 0 without SET LOCAL
```

---

*Owner: Platform / On-call rotation. Review cadence: quarterly, alongside the DR drill (§6b).*
