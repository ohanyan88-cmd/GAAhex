"""Starter-record seeder: inserts 2–3 readable demo rows for every config entity
that currently has 0 records in a given tenant.

Idempotent: rows tagged ``data["_seed"] = "starter"`` are detected on re-run and
nothing is written a second time.  Entities that already have *any* records (e.g.
the demo-loop leads/customers) are left completely untouched.

Ref-field strategy
------------------
When a field targets another catalog entity (e.g. ``site``, ``supplier``, ``user``)
we look up the *first existing record* of that entity in the same tenant and use its
UUID.  If the target entity has no records yet we try to seed it first (depth-first
with a visited guard to prevent infinite loops).  If we still can't find a target we
*skip* the whole entity and log a warning — we never insert garbage IDs.

The ``user`` ref target is resolved differently: we look up the *first app_user* row
for the tenant (the seeded admin) since user data doesn't live in the ``record`` table.

Run standalone::

    cd backend
    .venv/Scripts/python.exe -c "import asyncio; from app.seed_default_records import run; asyncio.run(run())"
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, func

from .db import OwnerSessionLocal as SessionLocal
from .models import Tenant, EntityDef, FieldDef, StatusDef, Record, User
from .seed_catalog import ENTITY_CATALOG

_log = logging.getLogger("gaaex.seed_default_records")

SEED_MARKER = "starter"
RECORDS_PER_ENTITY = 3  # we'll insert up to this many

# Map entity key → route_slug for quick look-ups (populated from ENTITY_CATALOG)
_KEY_TO_SLUG: dict[str, str] = {e["key"]: e["route_slug"] for e in ENTITY_CATALOG}


# ---------------------------------------------------------------------------
# Value generators — deterministic, human-readable sample values
# ---------------------------------------------------------------------------

def _sample_value(field: FieldDef, n: int, tenant_id, ref_cache: dict) -> object:
    """Return a sample value for ``field`` at row index ``n`` (0-based).

    ``ref_cache`` maps entity_key -> list[str uuid] and is populated by the caller
    before this function is called (or is empty when the ref target has no records).
    """
    t = field.type
    label = field.label or field.key
    cfg = field.config or {}

    if t in ("text",):
        return f"Sample {label} {n + 1}"
    if t == "textarea":
        return f"Sample {label} {n + 1}. This is a starter record created for demonstration purposes."
    if t == "number":
        return (n + 1) * 10
    if t == "money":
        return (n + 1) * 5000  # integer luma / cents
    if t == "boolean":
        return bool(n % 2 == 0)
    if t == "email":
        return f"sample{n + 1}@demo.isp"
    if t == "phone":
        return f"+3749100000{n + 1}"
    if t == "date":
        base = datetime.now(timezone.utc).date() + timedelta(days=n * 7)
        return base.isoformat()
    if t in ("datetime",):
        base = datetime.now(timezone.utc) + timedelta(hours=n * 24)
        return base.isoformat()
    if t == "select":
        opts = cfg.get("options", [])
        if opts:
            return opts[n % len(opts)]
        return f"option_{n + 1}"
    if t == "multiselect":
        opts = cfg.get("options", [])
        if opts:
            return [opts[0]]
        return []
    if t == "ref":
        target = cfg.get("target", "")
        ids = ref_cache.get(target, [])
        if ids:
            return ids[n % len(ids)]
        return None  # caller will decide whether to skip
    if t == "status":
        # status fields are lifecycle-managed; skip from data dict
        return None
    # fallback: text-ish
    return f"Sample {label} {n + 1}"


# ---------------------------------------------------------------------------
# Core per-tenant seeder
# ---------------------------------------------------------------------------

async def _seed_entity(
    s,
    tenant_id,
    spec: dict,
    org_node_id,
    visited: set,
) -> bool:
    """Seed starter records for one entity in one tenant.

    Returns True if records were inserted (or already existed with seed marker),
    False if the entity was skipped due to unresolvable required refs.
    """
    entity_key = spec["key"]
    if entity_key in visited:
        return False
    visited.add(entity_key)

    # Resolve EntityDef
    ent = (await s.execute(
        select(EntityDef).where(
            EntityDef.tenant_id == tenant_id,
            EntityDef.key == entity_key,
        )
    )).scalar_one_or_none()
    if not ent:
        _log.debug("Entity '%s' not found in tenant %s — skipping", entity_key, tenant_id)
        return False

    # Idempotency check: any record with _seed=starter means we already seeded this entity
    existing_count = (await s.execute(
        select(func.count()).select_from(Record).where(
            Record.tenant_id == tenant_id,
            Record.entity_key == entity_key,
        )
    )).scalar_one()

    if existing_count > 0:
        # Check if there's a starter record already (for re-run idempotency)
        starter_exists = (await s.execute(
            select(func.count()).select_from(Record).where(
                Record.tenant_id == tenant_id,
                Record.entity_key == entity_key,
                Record.data["_seed"].astext == SEED_MARKER,
            )
        )).scalar_one()
        if starter_exists > 0:
            _log.debug("Entity '%s' already has starter records — skipping", entity_key)
            return True
        # Entity has data but no starter records — leave it alone
        _log.debug("Entity '%s' has %d existing records (not starter) — leaving untouched", entity_key, existing_count)
        return True

    # Resolve FieldDefs
    fields = list((await s.execute(
        select(FieldDef).where(FieldDef.entity_def_id == ent.id).order_by(FieldDef.order)
    )).scalars().all())

    # Resolve initial status
    initial_status: str | None = None
    st_row = (await s.execute(
        select(StatusDef).where(
            StatusDef.entity_def_id == ent.id,
            StatusDef.is_initial == True,  # noqa: E712
        )
    )).scalar_one_or_none()
    if st_row:
        initial_status = st_row.key

    # Build ref_cache: pre-fetch first few IDs for each ref target field
    ref_cache: dict[str, list[str]] = {}
    skip_entity = False

    for fld in fields:
        if fld.type != "ref":
            continue
        target_key = (fld.config or {}).get("target", "")
        if not target_key or target_key in ref_cache:
            continue

        if target_key == "user":
            # Users live in app_user, not record
            user_ids = list((await s.execute(
                select(User.id).where(User.tenant_id == tenant_id).limit(5)
            )).scalars().all())
            ref_cache["user"] = [str(uid) for uid in user_ids]
        else:
            # Try to get existing record IDs for the target entity
            target_ids = list((await s.execute(
                select(Record.id).where(
                    Record.tenant_id == tenant_id,
                    Record.entity_key == target_key,
                ).limit(5)
            )).scalars().all())

            if not target_ids:
                # Try to seed the target entity first (depth-first)
                target_spec = next((e for e in ENTITY_CATALOG if e["key"] == target_key), None)
                if target_spec and target_key not in visited:
                    _log.debug("Seeding dependency '%s' before '%s'", target_key, entity_key)
                    await _seed_entity(s, tenant_id, target_spec, org_node_id, visited)
                    # Re-query after seeding
                    target_ids = list((await s.execute(
                        select(Record.id).where(
                            Record.tenant_id == tenant_id,
                            Record.entity_key == target_key,
                        ).limit(5)
                    )).scalars().all())

            ref_cache[target_key] = [str(uid) for uid in target_ids]

            # If a required ref field still has no target records, skip this entity
            if not target_ids and fld.required:
                _log.warning(
                    "Entity '%s' has required ref field '%s' targeting '%s' but no records exist — skipping",
                    entity_key, fld.key, target_key,
                )
                skip_entity = True
                break

    if skip_entity:
        return False

    # Insert RECORDS_PER_ENTITY starter records
    for n in range(RECORDS_PER_ENTITY):
        data: dict = {"_seed": SEED_MARKER}
        skip_row = False

        for fld in fields:
            if fld.type == "status":
                # managed by status column, not data
                continue

            val = _sample_value(fld, n, tenant_id, ref_cache)

            if val is None:
                if fld.required:
                    _log.debug(
                        "Required field '%s.%s' (type=%s) could not be resolved for row %d — skipping entity",
                        entity_key, fld.key, fld.type, n,
                    )
                    skip_row = True
                    break
                # optional ref with no target — omit field
                continue

            data[fld.key] = val

        if skip_row:
            continue

        rec = Record(
            tenant_id=tenant_id,
            entity_key=entity_key,
            owner_node_id=org_node_id,
            status=initial_status,
            data=data,
        )
        s.add(rec)

    _log.info("Seeded %d starter records for entity '%s' (tenant %s)", RECORDS_PER_ENTITY, entity_key, tenant_id)
    return True


async def seed_default_records() -> dict[str, int]:
    """Insert starter records for every empty catalog entity in every tenant.

    Returns a dict mapping entity_key -> total records inserted across all tenants.
    """
    inserted: dict[str, int] = {}
    skipped: list[str] = []

    async with SessionLocal() as s:
        tenants = (await s.execute(select(Tenant))).scalars().all()

        for tenant in tenants:
            # Resolve org node for owner_node_id (use the root/group node)
            from .models import OrgNode
            root_node = (await s.execute(
                select(OrgNode).where(OrgNode.tenant_id == tenant.id).order_by(OrgNode.id).limit(1)
            )).scalar_one_or_none()
            org_node_id = root_node.id if root_node else None

            visited: set = set()

            for spec in ENTITY_CATALOG:
                # Count before
                before = (await s.execute(
                    select(func.count()).select_from(Record).where(
                        Record.tenant_id == tenant.id,
                        Record.entity_key == spec["key"],
                    )
                )).scalar_one()

                ok = await _seed_entity(s, tenant.id, spec, org_node_id, visited)

                if not ok:
                    skipped.append(spec["key"])

                # Count after (before commit — same session)
                after = (await s.execute(
                    select(func.count()).select_from(Record).where(
                        Record.tenant_id == tenant.id,
                        Record.entity_key == spec["key"],
                    )
                )).scalar_one()

                delta = after - before
                if delta > 0:
                    inserted[spec["key"]] = inserted.get(spec["key"], 0) + delta

        await s.commit()

    if skipped:
        _log.warning("Skipped entities (unresolvable deps or already populated): %s", sorted(set(skipped)))

    _log.info("seed_default_records complete. Inserted per entity: %s", inserted)
    return inserted


async def grant_request_perms_to_existing_roles() -> None:
    """Secondary task: non-destructively add request.* perms to existing manager and
    sales_agent RoleDef rows in all tenants (idempotent — only adds missing entries)."""
    _request_perms = ["request.view", "request.create", "request.edit", "request.delete"]

    from .models import RoleDef

    async with SessionLocal() as s:
        tenants = (await s.execute(select(Tenant))).scalars().all()

        for tenant in tenants:
            roles = list((await s.execute(
                select(RoleDef).where(
                    RoleDef.tenant_id == tenant.id,
                    RoleDef.key.in_(["manager", "sales_agent"]),
                )
            )).scalars().all())

            for role in roles:
                existing_perms: list = list(role.permissions or [])
                missing = [p for p in _request_perms if p not in existing_perms]
                if missing:
                    role.permissions = existing_perms + missing
                    _log.info(
                        "Added %s to role '%s' in tenant %s",
                        missing, role.key, tenant.id,
                    )
                else:
                    _log.info("Role '%s' in tenant %s already has all request.* perms", role.key, tenant.id)

        await s.commit()

    _log.info("grant_request_perms_to_existing_roles complete")


async def run() -> None:
    """Single entry-point for standalone execution and lifespan wiring."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
    await grant_request_perms_to_existing_roles()
    await seed_default_records()


if __name__ == "__main__":
    import asyncio
    asyncio.run(run())
