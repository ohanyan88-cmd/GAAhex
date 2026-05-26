from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
)
from .config import settings

engine = create_async_engine(settings.database_url, echo=False, future=True)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# The Postgres GUC RLS policies key on. Set per request (after auth) via `set_tenant_guc`, and always
# cleared on session teardown so a pooled connection never carries one tenant into another's request.
TENANT_GUC = "gaaex.tenant_id"


async def set_tenant_guc(session: AsyncSession, tenant_id) -> None:
    """Bind this session's connection to a tenant for Row-Level Security.

    Uses session-level `set_config(key, val, is_local=false)` so the binding SURVIVES the mid-request
    commits that `create_record`/`transition` do (a `SET LOCAL` would be lost at the first commit).
    Called from the auth dependency once the tenant is known from the JWT. No-op when RLS is disabled
    or the running role is the owner/superuser (which bypasses RLS) — it's harmless either way and
    leaves the machinery ready for the flip to the dedicated `gaaex_app` role.
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
                await session.execute(text("SELECT set_config('gaaex.tenant_id', NULL, false)"))
                await session.commit()
            except Exception:
                pass
