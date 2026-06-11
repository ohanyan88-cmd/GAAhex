"""Seed a starter set of NotificationDefs for the demo CRM (Phase-1 M9).

Idempotent and in the style of `seed.py`: no-op once any NotificationDef exists for the demo
tenant. These are pure config — `notify_hooks.fire` derives the def_key from each event and only
materializes a notification when a matching, enabled def's condition (if any) passes.

def_key naming follows `notify_hooks.derive_def_key`:
  - transitions  → "{entity}.{new_status_lower}"   (e.g. lead → QUALIFIED ⇒ "lead.qualified")
  - create       → "{entity}.created"
"""
from sqlalchemy import select, func

from .db import OwnerSessionLocal as SessionLocal   # seeding runs privileged (bypasses RLS)
from .models import Tenant
from .models.notification import NotificationDef


# (key, label, title_template, body_template, gxl_condition)
_DEFS = [
    ("lead.validated_lead", "Lead validated",
     "Lead {name} validated",
     "Lead '{name}' moved to VALIDATED_LEAD. Phone: {phone}, source: {source}.",
     None),
    ("lead.contract_signed", "Lead contract signed",
     "Lead {name} signed",
     "Lead '{name}' signed the contract — ready to convert to a customer.",
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


async def build_notification_defs(s, tenant_id) -> None:
    """Add the baseline CRM NotificationDefs for tenant `tenant_id`. Reusable by the demo seed AND by
    provisioning — no emptiness guard and no commit here (callers own the transaction)."""
    for key, label, title_t, body_t, cond in _DEFS:
        s.add(NotificationDef(
            tenant_id=tenant_id, key=key, label=label, channel="inapp",
            title_template=title_t, body_template=body_t, enabled=True, gxl_condition=cond,
        ))


async def seed_notifications_if_empty() -> None:
    """Seed the demo CRM's NotificationDefs once. No-op if any already exist for the demo tenant."""
    async with SessionLocal() as s:
        # Owner-session seeding is intentionally cross-tenant — bypass the tenant-filter audit.
        await s.connection(execution_options={"audit_tenant_filter": False})
        tenant = (await s.execute(select(Tenant))).scalars().first()
        if not tenant:
            return
        existing = (await s.execute(
            select(func.count()).select_from(NotificationDef).where(NotificationDef.tenant_id == tenant.id)
        )).scalar_one()
        if existing:
            return

        await build_notification_defs(s, tenant.id)
        await s.commit()
