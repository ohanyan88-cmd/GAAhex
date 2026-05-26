"""Seed a starter set of NotificationDefs for the demo CRM (Phase-1 M9).

Idempotent and in the style of `seed.py`: no-op once any NotificationDef exists for the demo
tenant. These are pure config — `notify_hooks.fire` derives the def_key from each event and only
materializes a notification when a matching, enabled def's condition (if any) passes.

def_key naming follows `notify_hooks.derive_def_key`:
  - transitions  → "{entity}.{new_status_lower}"   (e.g. lead → QUALIFIED ⇒ "lead.qualified")
  - create       → "{entity}.created"
"""
from sqlalchemy import select, func

from .db import SessionLocal
from .models import Tenant
from .models.notification import NotificationDef


# (key, label, title_template, body_template, gxl_condition)
_DEFS = [
    ("lead.qualified", "Lead qualified",
     "Lead {name} qualified",
     "Lead '{name}' moved to QUALIFIED. Phone: {phone}, source: {source}.",
     None),
    ("lead.converted", "Lead converted",
     "Lead {name} converted 🎉",
     "Lead '{name}' was converted to a customer.",
     None),
    ("deal.won", "Deal won",
     "Deal won: {title}",
     "Deal '{title}' was won (value: {value}).",
     # only notify on won deals that carry a value — demonstrates a GXL condition gate
     "value != None and value != ''"),
    ("deal.lost", "Deal lost",
     "Deal lost: {title}",
     "Deal '{title}' was marked lost.",
     None),
    ("ticket.opened", "Ticket opened",
     "New ticket: {subject}",
     "A ticket '{subject}' was opened (priority: {priority}).",
     None),
    ("ticket.resolved", "Ticket resolved",
     "Ticket resolved: {subject}",
     "Ticket '{subject}' was resolved.",
     None),
]


async def seed_notifications_if_empty() -> None:
    """Seed the demo CRM's NotificationDefs once. No-op if any already exist for the demo tenant."""
    async with SessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        if not tenant:
            return
        existing = (await s.execute(
            select(func.count()).select_from(NotificationDef).where(NotificationDef.tenant_id == tenant.id)
        )).scalar_one()
        if existing:
            return

        for key, label, title_t, body_t, cond in _DEFS:
            s.add(NotificationDef(
                tenant_id=tenant.id, key=key, label=label, channel="inapp",
                title_template=title_t, body_template=body_t, enabled=True, gxl_condition=cond,
            ))
        await s.commit()
