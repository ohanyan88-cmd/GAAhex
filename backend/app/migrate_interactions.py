"""One-shot migration: copy rows from the dedicated `interaction` table into the generic
`record` table (entity_key='interaction'), then verify the interaction config entity exists.

Idempotent: skips records whose ID already exists in the `record` table (checked by matching
the interaction id stored in data->>'_src_id').

Run:  python -m app.migrate_interactions
Also called from main.py lifespan (after seed_catalog_if_missing).
"""
import asyncio

from sqlalchemy import select, text

from .db import OwnerSessionLocal as SessionLocal
from .utils.ids import uuid7
from .models import Tenant, Record
from .models.interaction import Interaction


async def migrate_interactions() -> int:
    """Copy each interaction row to record (entity_key='interaction'). Returns count of rows inserted."""
    inserted = 0
    async with SessionLocal() as s:
        # Need the EntityDef for each tenant to set entity_key — just use the string key directly.
        tenants = (await s.execute(select(Tenant))).scalars().all()
        for tenant in tenants:
            rows = (await s.execute(
                select(Interaction).where(Interaction.tenant_id == tenant.id)
            )).scalars().all()

            for ix in rows:
                # Idempotency check: look for a record with this source interaction id
                existing = (await s.execute(
                    select(Record).where(
                        Record.tenant_id == tenant.id,
                        Record.entity_key == "interaction",
                        text("data->>'_src_id' = :src_id"),
                    ).params(src_id=str(ix.id))
                )).scalar_one_or_none()
                if existing:
                    continue

                data = {
                    "_src_id": str(ix.id),
                    "channel": ix.channel,
                    "direction": ix.direction,
                    "subject": ix.subject,
                    "body": ix.body,
                    "occurred_at": ix.occurred_at.isoformat() if ix.occurred_at else None,
                }
                if ix.customer_id:
                    data["customer"] = str(ix.customer_id)
                if ix.ticket_id:
                    data["ticket"] = str(ix.ticket_id)

                rec = Record(
                    id=uuid7(),
                    tenant_id=tenant.id,
                    owner_node_id=ix.owner_node_id,
                    entity_key="interaction",
                    status=None,
                    data=data,
                    created_at=ix.created_at,
                )
                s.add(rec)
                inserted += 1

        await s.commit()
    return inserted


if __name__ == "__main__":
    n = asyncio.run(migrate_interactions())
    print(f"migrate_interactions: {n} record(s) inserted")
