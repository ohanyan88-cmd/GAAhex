"""M1-A Wave 2 (IDOR) — Hole 5: interactions._ref_record (UNREACHABLE/DEFENSIVE).

Auditor flagged routers/interactions.py:151 as "needs verification" — the helper
checks ``Record.entity_key='ticket'`` but live HelpdeskTickets sit in the
``helpdesk_ticket`` table, not ``record``.

Verification result: the entire bespoke /api/interactions router IS NOT MOUNTED in
app.main (the live /api/interactions surface is the generic records router). The
module is reachable only via the migrate_interactions one-shot. So the IDOR vector
isn't exploitable through HTTP today.

Still, we
  (a) verify ``_ref_record`` correctly tenant-scopes BOTH the legacy
      Record(entity_key='ticket') path AND the new HelpdeskTicket path that Wave 2
      added, and
  (b) leave behind a pinned test so a future re-wire of the router can't ship the
      IDOR.
"""

import uuid

import pytest
from fastapi import HTTPException

from app.db import OwnerSessionLocal, SessionLocal
from app.models.helpdesk import HelpdeskTicket
from app.models.record import Record
from app.models.tenant import Tenant
from app.routers.interactions import _ref_record


@pytest.mark.asyncio
async def test_ref_record_rejects_cross_tenant_legacy_ticket_record():
    """Tenant A asks `_ref_record(ticket=<B>, "ticket")` — must 422 because the
    legacy Record(entity_key='ticket') lives in tenant B."""
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    foreign_ticket_record_id = uuid.uuid4()

    async with OwnerSessionLocal() as o:
        for tid, name in ((tenant_a, "IDOR-Int-A"), (tenant_b, "IDOR-Int-B")):
            o.add(Tenant(id=tid, name=name, status="active"))
        await o.flush()
        o.add(Record(
            id=foreign_ticket_record_id,
            tenant_id=tenant_b,
            entity_key="ticket",
            status="OPEN",
            data={"subject": "Stranger's ticket"},
        ))
        await o.commit()

    async with SessionLocal() as s:
        with pytest.raises(HTTPException) as exc:
            await _ref_record(s, tenant_a, foreign_ticket_record_id, "ticket")
        assert exc.value.status_code == 422
        assert "ticket_id" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_ref_record_rejects_cross_tenant_helpdesk_ticket():
    """Tenant A asks `_ref_record(ticket=<B>, "ticket")` against the live
    HelpdeskTicket table — must 422 because the row lives in tenant B."""
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    foreign_helpdesk_ticket_id = uuid.uuid4()

    async with OwnerSessionLocal() as o:
        for tid, name in ((tenant_a, "IDOR-Int-A2"), (tenant_b, "IDOR-Int-B2")):
            o.add(Tenant(id=tid, name=name, status="active"))
        await o.flush()
        o.add(HelpdeskTicket(
            id=foreign_helpdesk_ticket_id,
            tenant_id=tenant_b,
            subject="Stranger's helpdesk ticket",
            priority="NORMAL",
            status="OPEN",
        ))
        await o.commit()

    async with SessionLocal() as s:
        with pytest.raises(HTTPException) as exc:
            await _ref_record(s, tenant_a, foreign_helpdesk_ticket_id, "ticket")
        assert exc.value.status_code == 422
        assert "ticket_id" in str(exc.value.detail)
