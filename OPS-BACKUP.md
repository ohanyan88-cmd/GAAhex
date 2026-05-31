# OPS — Backup, Restore & Key Rotation Runbook

This doc covers everything needed to safely run, back up, and recover a GAAex Portal install.
Run through this checklist before handing over credentials to the first customer.

---

## 1. Pre-install checklist

Before going live, confirm:

- [ ] `.env` on server has every `CHANGE_ME` replaced (see `.env.production.example`)
- [ ] `JWT_SECRET` is ≥32 random bytes (`python -c "import secrets; print(secrets.token_hex(32))"`)
- [ ] `GAAEX_FIELD_KEY` is a real Fernet key (see below) — stored in vault, not just in `.env`
- [ ] `REQUIRE_STRONG_SECRETS=true` is set — app refuses to start with the dev default
- [ ] `CORS_ORIGINS` is the exact frontend domain, not `*`
- [ ] `RATE_LIMIT_ENABLED=true`
- [ ] `WEBHOOK_ALLOW_PRIVATE=false` (unless the install is fully on a private network)
- [ ] Postgres `gaaex_app` user has minimal grants (SELECT/INSERT/UPDATE/DELETE on app tables only)
- [ ] `alembic upgrade head` runs cleanly on a fresh DB
- [ ] Test restore completed (section 4) before first customer data is created

---

## 2. Database backup

### 2a. Full logical dump (recommended — works with any Postgres host)

```bash
# Run from any machine with pg_dump and network access to the DB host.
# Replace HOST, PORT, USER, DBNAME with your values.
pg_dump -h HOST -p PORT -U gaaex -d gaaex -F c -Z 9 \
  -f "gaaex_$(date +%Y%m%d_%H%M%S).dump"
```

Flags: `-F c` = custom (binary) format · `-Z 9` = max compression

### 2b. Restore from dump

```bash
pg_restore -h HOST -p PORT -U gaaex -d gaaex_restore \
  --no-owner --no-privileges gaaex_20260101_030000.dump
```

Create the target DB first:
```bash
createdb -h HOST -p PORT -U gaaex gaaex_restore
```

### 2c. Verify the restore

```bash
# Row counts should match the source DB.
psql -h HOST -p PORT -U gaaex -d gaaex_restore -c "
  SELECT 'tenant' as t, count(*) FROM tenant
  UNION ALL SELECT 'record', count(*) FROM record
  UNION ALL SELECT 'invoice', count(*) FROM invoice
  UNION ALL SELECT 'payment', count(*) FROM payment
  UNION ALL SELECT 'event', count(*) FROM event
  ORDER BY 1;
"
```

### 2d. Docker volume backup (if running Postgres in Docker)

```bash
# Stop the container first (or use --no-stop-on-errors with pg_dump above).
docker stop gaaex-db
docker run --rm \
  -v portal_db_data:/source:ro \
  -v $(pwd)/backups:/dest \
  busybox tar czf /dest/db_volume_$(date +%Y%m%d).tar.gz -C /source .
docker start gaaex-db
```

### 2e. Backup frequency recommendation

| Data | Frequency | Retention |
|---|---|---|
| Full logical dump | Daily (off-peak) | 30 days |
| Docker volume snapshot | Weekly | 4 weeks |
| Pre-migration snapshot | Before every `alembic upgrade head` | Keep until next upgrade |

---

## 3. Redis backup

Redis is used for rate-limiting and session cache. It is **not** a system of record — all
persistent state lives in Postgres. Redis data loss = users get logged out + rate counters reset.
No customer data is lost.

For completeness:
```bash
# Trigger an RDB snapshot (BGSAVE) and copy the file.
redis-cli -h HOST -p PORT BGSAVE
# After "Background saving started":
cp /var/lib/redis/dump.rdb backups/redis_$(date +%Y%m%d).rdb
```

---

## 4. Restore test procedure (run before go-live)

1. Create a fresh Postgres DB: `createdb -U gaaex gaaex_restore_test`
2. Restore the latest dump (section 2b).
3. Point a test app instance at `gaaex_restore_test`:
   ```
   DATABASE_URL=postgresql+asyncpg://gaaex:PASS@HOST:PORT/gaaex_restore_test
   ```
4. Start the app and run: `python -m pytest backend/tests/ -q --tb=short`
5. Confirm: same pass count as main DB. If any test fails on schema, run `alembic upgrade head`.
6. Log in at `/` with `admin@demo.isp` — confirm you can see records and dashboards.
7. Drop the restore DB: `dropdb -U gaaex gaaex_restore_test`

---

## 5. Field-level encryption key management

### 5a. Generate the initial key

```python
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
# Output: a base64 string like: kXOhKs3YB8mS...==
```

Set `GAAEX_FIELD_KEY=<output>` in `.env` and in your secrets vault.

### 5b. Key rotation procedure

When you need to rotate `GAAEX_FIELD_KEY` (scheduled or after suspected compromise):

1. **Take a DB backup** (section 2a) before touching anything.
2. Generate a new Fernet key (5a).
3. Run the re-encryption script (to be written when §4.4 activation is complete — tracked as R-06):
   ```bash
   python -m app.scripts.rotate_field_key \
     --old-key "$GAAEX_FIELD_KEY_OLD" \
     --new-key "$GAAEX_FIELD_KEY_NEW"
   ```
   This script re-encrypts every encrypted column row-by-row in a transaction.
4. Verify row count matches pre-rotation count.
5. Update `.env` and vault with the new key.
6. Restart the app.
7. Confirm app starts without `INVALID_KEY` errors in the log.

### 5c. What is encrypted

Once R-06 (§4.4 activation) is complete:
- `api_key.key_enc` — raw API key material
- `webhook.secret_enc` — HMAC signing secret
- *(add more here as §4.4 activation proceeds)*

---

## 6. Migration procedure

Run before every deploy that includes schema changes:

```bash
# 1. Backup first.
pg_dump -h HOST -p PORT -U gaaex -d gaaex -F c -Z 9 \
  -f "pre_migration_$(date +%Y%m%d_%H%M%S).dump"

# 2. Check pending migrations.
cd backend
.venv/Scripts/python.exe -m alembic history --indicate-current

# 3. Dry-run (shows SQL without executing).
.venv/Scripts/python.exe -m alembic upgrade head --sql

# 4. Apply.
.venv/Scripts/python.exe -m alembic upgrade head

# 5. Verify head.
.venv/Scripts/python.exe -m alembic current
```

If a migration fails mid-run:
```bash
# Roll back to the previous revision.
.venv/Scripts/python.exe -m alembic downgrade -1
# Fix the migration file, then re-apply.
.venv/Scripts/python.exe -m alembic upgrade head
```

---

## 7. First-customer install checklist

- [ ] Server provisioned (Ubuntu 22.04+ or Debian 12+, 4 GB RAM minimum)
- [ ] Docker + Docker Compose installed
- [ ] `.env` filled from `.env.production.example` (all `CHANGE_ME` replaced)
- [ ] `docker compose up -d` — Postgres + Redis running
- [ ] `alembic upgrade head` — schema applied
- [ ] `python -m app.seed` — demo tenant + admin user seeded
- [ ] Change admin password immediately: `POST /api/me/password`
- [ ] Set `GAAEX_TENANT_ID` in `.env` to the tenant UUID from `SELECT id FROM tenant LIMIT 1`
- [ ] Restart app
- [ ] Smoke test: log in, create a customer, create an invoice, confirm audit log entry
- [ ] Backup completed (section 2a) and restore tested (section 4)
- [ ] Monitoring alert set on app + DB process health

---

*Last updated: 2026-05-31*
