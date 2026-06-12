"""P1 — Migration-backed invariant gate (T0-PREREQ).

The green suite builds its schema with `create_all`, so RLS policies + DB triggers (installed only by
alembic migrations) are ABSENT from every test run — making every "RLS works"/"append-only works" proof
void. This gate closes that hole: it builds a scratch DB via real `alembic upgrade head`, reproduces the
full role topology (gaahex_app NOSUPERUSER/NOBYPASSRLS, provisioned by migration 3a9203795d07) + applies
cosmetic FORCE, then asserts the production DDL is actually present:

  (1) Every tenant-scoped table with a NOT NULL tenant_id has a tenant_isolation RLS policy whose
      USING clause references the tenant GUC `current_setting('gaahex.tenant_id'`. (ADD 1 — a policy
      that exists but does not filter on the GUC FAILS; "a policy row exists" is not enough.)
      Tables whose tenant_id is NULLABLE are treated as documented RLS exemptions (reported, not failed).
  (2) The append-only/hold tables carry their BEFORE UPDATE/DELETE triggers (event, comment).

Exit 1 on any gap. Own scratch DB only — never touches dev data.
"""
import os, sys, asyncio, subprocess
from pathlib import Path
import urllib.parse as up

BACKEND = Path(__file__).resolve().parent.parent
# CI provides DATABASE_URL in the environment; local dev keeps it in backend/.env. Prefer the env.
env = {}
_envfile = BACKEND / ".env"
if _envfile.exists():
    for ln in _envfile.read_text(encoding="utf-8").splitlines():
        if "=" in ln and not ln.strip().startswith("#"):
            k, _, v = ln.partition("="); env[k.strip()] = v.strip()
_dburl = os.environ.get("DATABASE_URL") or env.get("DATABASE_URL")
if not _dburl:
    print("FATAL: no DATABASE_URL (checked os.environ and backend/.env)"); sys.exit(2)
pr = up.urlparse(_dburl)
OWNER, PW, HOST, PORT = pr.username, pr.password, pr.hostname, pr.port
SCRATCH = "gaahex_p1_invariants"
GUC = "current_setting('gaahex.tenant_id'"

def raw(db): return f"postgresql://{OWNER}:{PW}@{HOST}:{PORT}/{db}"
def sa(db):  return f"postgresql+asyncpg://{OWNER}:{PW}@{HOST}:{PORT}/{db}"

import asyncpg


async def build():
    c = await asyncpg.connect(raw("postgres"))
    await c.execute(f"DROP DATABASE IF EXISTS {SCRATCH} WITH (FORCE)")
    await c.execute(f"CREATE DATABASE {SCRATCH} OWNER {OWNER}")
    await c.close()
    e = dict(os.environ); e["OWNER_DATABASE_URL"] = sa(SCRATCH); e["DATABASE_URL"] = sa(SCRATCH)
    r = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"],
                       cwd=str(BACKEND), env=e, capture_output=True, text=True)
    if r.returncode != 0:
        print("ALEMBIC FAILED:\n", r.stdout[-1500:], "\n", r.stderr[-1500:]); sys.exit(2)
    # safety: confirm the upgrade hit SCRATCH, not the dev DB
    c = await asyncpg.connect(raw(SCRATCH))
    n = await c.fetchval("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
    await c.close()
    if n < 50:
        print(f"ABORT: scratch has only {n} tables — alembic did not target the scratch DB"); sys.exit(2)
    print(f"alembic upgrade head -> {SCRATCH}: OK ({n} tables)")


async def check():
    c = await asyncpg.connect(raw(SCRATCH))
    role = await c.fetchrow("SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='gaahex_app'")
    # tenant tables + nullability of tenant_id
    rows = await c.fetch(
        "SELECT table_name, is_nullable FROM information_schema.columns "
        "WHERE column_name='tenant_id' AND table_schema='public' ORDER BY table_name")
    tenant = [(r["table_name"], r["is_nullable"] == "YES") for r in rows]
    for t, _ in tenant:
        await c.execute(f'ALTER TABLE "{t}" FORCE ROW LEVEL SECURITY')  # cosmetic — gaahex is superuser
    ok, weak, missing_required, exempt = [], [], [], []
    for t, nullable in tenant:
        pols = await c.fetch(
            "SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr "
            "FROM pg_policy p JOIN pg_class cl ON cl.oid=p.polrelid WHERE cl.relname=$1", t)
        has_guc = any(GUC in (pl["using_expr"] or "") for pl in pols)
        if has_guc:
            ok.append((t, pols[0]["polname"]))
        elif pols:                              # policy exists but does NOT reference the GUC (ADD 1)
            weak.append((t, [pl["using_expr"] for pl in pols]))
        elif nullable:                          # nullable tenant_id → documented exemption
            exempt.append(t)
        else:                                   # NOT NULL tenant_id and no GUC policy → REAL GAP
            missing_required.append(t)
    trg = await c.fetch(
        "SELECT c.relname, tg.tgname FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid "
        "WHERE NOT tg.tgisinternal AND c.relname IN ('event','comment') ORDER BY c.relname, tg.tgname")
    await c.close()
    return tenant, ok, weak, missing_required, exempt, trg, role


async def teardown():
    c = await asyncpg.connect(raw("postgres"))
    await c.execute(f"DROP DATABASE IF EXISTS {SCRATCH} WITH (FORCE)")
    await c.close()


async def main():
    await build()
    tenant, ok, weak, missing_required, exempt, trg, role = await check()
    print(f"\nrole topology: gaahex_app present={role is not None} "
          f"super={role['rolsuper'] if role else '?'} bypassrls={role['rolbypassrls'] if role else '?'}")
    print(f"tenant-scoped tables: {len(tenant)}  |  GUC-policy OK: {len(ok)}  |  "
          f"weak-USING: {len(weak)}  |  missing(NOT NULL): {len(missing_required)}  |  exempt(nullable): {len(exempt)}")

    REQUIRED_TRG = {("event", "prevent_update_event"), ("event", "prevent_delete_event"),
                    ("comment", "trg_comment_block_update_when_held"),
                    ("comment", "trg_comment_block_delete_when_held")}
    present_trg = {(r["relname"], r["tgname"]) for r in trg}
    print("\nappend-only/hold triggers present (migration-installed):")
    for r in trg:
        print(f"  {r['relname']:10} {r['tgname']}")
    missing_trg = REQUIRED_TRG - present_trg

    print("\n--- GUC-backed policies (sample, first 25) ---")
    for t, pol in ok[:25]:
        print(f"  OK   {t:28} policy={pol}")
    if len(ok) > 25:
        print(f"  ... (+{len(ok) - 25} more OK)")
    if exempt:
        print("\n--- nullable-tenant_id (documented exemptions, not failed) ---")
        print("  " + ", ".join(exempt))
    if weak:
        print("\n--- WEAK USING (policy exists but does NOT reference the GUC) [FAIL] ---")
        for t, exprs in weak:
            print(f"  {t}: {exprs}")
    if missing_required:
        print("\n--- MISSING POLICY on NOT NULL tenant_id table [FAIL] ---")
        for t in missing_required:
            print(f"  {t}")
    if missing_trg:
        print("\n--- MISSING required trigger [FAIL] ---")
        for rel, tg in sorted(missing_trg):
            print(f"  {rel}.{tg}")

    await teardown()
    failed = bool(weak or missing_required or missing_trg) or role is None
    print(f"\n==== P1 {'FAIL' if failed else 'PASS'} ====")
    sys.exit(1 if failed else 0)


asyncio.run(main())
