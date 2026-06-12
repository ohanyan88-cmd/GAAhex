from sqlalchemy import text, event
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
)
from sqlalchemy.util import await_only
from .config import settings

# Pool sizing: each authenticated request uses an app session AND a short owner session (RLS-flip
# user lookup). Two engines (app+owner) × this pool must stay well under Postgres max_connections
# (100) even with a second process (a running dev server) connected → keep it modest. pool_pre_ping
# avoids stale-conn errors; pool_timeout fails fast instead of hanging if the pool is momentarily full.
_POOL = dict(pool_size=10, max_overflow=10, pool_pre_ping=True, pool_timeout=10)

engine = create_async_engine(settings.database_url, echo=False, future=True, **_POOL)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


# ── C1a condition 1 — GUARANTEED tenant-GUC reset on connection return to the pool ──────────────────
# The tenant GUC is session-level `set_config(..., is_local=false)` (it must survive the app's
# mid-request commits). That means it also survives a connection being recycled — so without this, a
# pooled connection could carry tenant A's scope into tenant B's next request. This checkin listener
# wipes `gaahex.tenant_id` on EVERY connection return, unconditionally — the guaranteed reset point no
# request outcome can skip (replaces the old best-effort, error-swallowing request-teardown reset as
# the load-bearing layer). If the reset itself FAILS we let it raise: SQLAlchemy then INVALIDATES and
# discards the connection rather than returning it to the pool with a possibly-stale GUC. Safety rests
# on the policies being default-DENY on an empty GUC (verified + gated by check_migration_invariants).
@event.listens_for(engine.sync_engine, "checkin")
def _wipe_tenant_guc_on_checkin(dbapi_connection, connection_record):
    raw = dbapi_connection.driver_connection  # the raw asyncpg.Connection
    await_only(raw.execute("SELECT set_config('gaahex.tenant_id', NULL, false)"))

# Owner (RLS-bypass) engine for the pre-auth / no-tenant paths (seeding, login + user lookup,
# org-tree). Falls back to the app engine's URL when owner_database_url is unset — so tests and the
# pre-flip app behave exactly as before; only a real gaahex_app database_url makes the split bite.
owner_engine = create_async_engine(settings.owner_database_url or settings.database_url, echo=False, future=True, **_POOL)
OwnerSessionLocal = async_sessionmaker(owner_engine, class_=AsyncSession, expire_on_commit=False)


async def get_owner_session() -> AsyncSession:
    """Yield a privileged session that BYPASSES RLS — only for the unavoidable pre-auth / no-tenant
    reads (auth lookups, org-tree). Never set the tenant GUC here; it must not carry tenant scope."""
    async with OwnerSessionLocal() as session:
        yield session


# The Postgres GUC RLS policies key on. Set per request (after auth) via `set_tenant_guc`, and always
# cleared on session teardown so a pooled connection never carries one tenant into another's request.
TENANT_GUC = "gaahex.tenant_id"


async def set_tenant_guc(session: AsyncSession, tenant_id) -> None:
    """Bind this session's connection to a tenant for Row-Level Security.

    Uses session-level `set_config(key, val, is_local=false)` so the binding SURVIVES the mid-request
    commits that `create_record`/`transition` do (a `SET LOCAL` would be lost at the first commit).
    Called from the auth dependency once the tenant is known from the JWT. No-op when RLS is disabled
    or the running role is the owner/superuser (which bypasses RLS) — it's harmless either way and
    leaves the machinery ready for the flip to the dedicated `gaahex_app` role.
    """
    if tenant_id is None:
        return
    await session.execute(
        text("SELECT set_config(:k, :v, false)"), {"k": TENANT_GUC, "v": str(tenant_id)}
    )


async def get_session() -> AsyncSession:
    """FastAPI dependency that yields an async DB session, clearing the tenant GUC on teardown
    (pool-leak guard — failure mode #4 in the RLS plan). The reset is best-effort and never raises
    into the request."""
    async with SessionLocal() as session:
        try:
            yield session
        finally:
            try:
                # set to NULL (not '') — an empty string fails the policy's `::uuid` cast, and RESET
                # errors on a never-set custom GUC. NULL ⇒ current_setting(...,true) NULL ⇒ default-deny.
                await session.execute(text("SELECT set_config('gaahex.tenant_id', NULL, false)"))
                await session.commit()
            except Exception:
                pass
