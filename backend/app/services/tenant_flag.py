"""Tenant-flag service — per-tenant business-feature lookup.

This is the **server-side reader** for the DB-backed :class:`FeatureFlag` table.
It is the counterpart of the frontend ``useFlag()`` hook: where ``useFlag()``
calls the ``/api/feature-flags`` endpoint from the browser, this helper lets
in-process backend code (background jobs, services, automation passes) read a
tenant's flag without going through HTTP.

System role — see ``docs/standards/FEATURE_GATING_POLICY.md``
------------------------------------------------------------
The platform deliberately maintains **two** feature-gating systems:

1. **Platform deploy-shape gates** (``app/services/feature_gate.py``) —
   ``is_enabled(key)`` / ``require(key)``. Platform-wide, env-var driven. Used
   when an infrastructure subsystem may legitimately be unwired in some
   deploys (radius / olt_provisioning / import_engine / warehouse). Fail-closed
   for all tenants when the backend isn't wired.

2. **Tenant business flags** (this module + ``FeatureFlag`` table) — per-tenant,
   DB-backed, audit-logged via the CRUD router. Used when each tenant should be
   free to decide independently (dunning_automation / self_serve_signup /
   future ISP-optional workflows).

This helper belongs to system #2. Calling ``is_enabled(...)`` with a tenant_id
parameter is **forbidden** by the policy (would collapse the two systems);
business flags MUST be read through this helper.

Typical call pattern
--------------------
A cross-tenant background job that processes one tenant at a time:

.. code-block:: python

    for tenant_id in tenant_ids:
        async with OwnerSessionLocal() as s:
            if not await tenant_flag.is_flag_enabled_for_tenant(
                s, tenant_id, "dunning_automation"
            ):
                continue  # tenant didn't opt in
            await do_dunning_for_tenant(s, tenant_id)

The session may be a request session (RLS-bound to the caller's tenant_id GUC)
or an OwnerSessionLocal (cross-tenant); both work. RLS will hide rows from a
foreign tenant when the session is GUC-bound, which is the desired safety net
(the helper returns ``default`` for an unreachable row — same result as a
missing row).

Constraints honored
-------------------
- Stdlib + project imports only.
- Read-only (never inserts / updates / deletes a flag row).
- Single query per call. Callers iterating tenants should not pre-fetch in
  bulk — the index on ``(tenant_id, key)`` makes the per-call cost negligible
  and avoids stale reads in long-running automation passes.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.feature_flag import FeatureFlag


async def is_flag_enabled_for_tenant(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    key: str,
    *,
    default: bool = False,
) -> bool:
    """Return whether ``key`` is enabled for ``tenant_id``.

    Looks up the :class:`FeatureFlag` row identified by ``(tenant_id, key)``:

    - If a row exists, returns its ``enabled`` value.
    - If no row exists (the tenant has never set this flag), returns
      ``default`` — by default ``False`` (fail-closed: a tenant has not
      opted in unless they explicitly say so).

    Side-effect-free. Safe to call from hot paths (background loops,
    automation passes, etc.).

    Parameters
    ----------
    session
        Any SQLAlchemy AsyncSession. May be RLS-bound (request session) or
        cross-tenant (OwnerSessionLocal). When RLS-bound to a different tenant,
        the row is unreachable and ``default`` is returned — identical to the
        "missing row" path. This is the policy's intended safety net (per
        FEATURE_GATING_POLICY §5.4: per-tenant flag reads inside the tenant
        loop).
    tenant_id
        The tenant whose flag to consult.
    key
        The flag key (e.g. ``"dunning_automation"``). Case-sensitive — matches
        the unique constraint on ``(tenant_id, key)``.
    default
        Returned when no row exists for ``(tenant_id, key)``. Defaults to
        ``False`` so a tenant who hasn't seeded the flag is treated as
        opted-out, not opted-in.
    """
    row = (await session.execute(
        select(FeatureFlag.enabled).where(
            FeatureFlag.tenant_id == tenant_id,
            FeatureFlag.key == key,
        )
    )).scalar_one_or_none()
    if row is None:
        return default
    return bool(row)


__all__ = ["is_flag_enabled_for_tenant"]
