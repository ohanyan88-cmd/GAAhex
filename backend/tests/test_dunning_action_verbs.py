"""B1 follow-up — verify ``DunningPolicy.steps_json`` action verbs are UPPER_SNAKE.

Sister to ``test_dunning_policy.py`` / ``test_dunning_case.py`` but scoped to one thing:
proving the action vocabulary owned by ``services/dunning.py`` is now UPPER_SNAKE
(NOTICE / THROTTLE / WALLED_GARDEN / TERMINATE) per the B1 enum standard, and that
``validate_steps_json`` still accepts legacy lowercase input for back-compat (normalising
it UP) — both halves of the contract documented in migration
``7b1e0d3b41fd_dunning_action_verbs_upper_snake``.

Three cases:
  1. ``DEFAULT_POLICY_STEPS`` and the auto-seeded default policy expose UPPER action verbs.
  2. ``validate_steps_json`` normalises legacy lowercase input UP without 422.
  3. Advancing a case with no services on a THROTTLE step writes an UPPER ``action`` value
     on the ServiceActionLog row written by ``services/dunning.py``.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.billing import Invoice
from app.models.dunning import DunningCase, DunningPolicy, ServiceActionLog
from app.models.user import User
from app.services import dunning as dunning_service


# ---------- helpers (kept self-contained — no cross-file imports) ----------

async def _admin_tenant_id() -> uuid.UUID:
    async with SessionLocal() as s:
        u = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        return u.tenant_id


async def _party_account(client, admin) -> str:
    pid = (await client.post("/api/parties", headers=admin,
                             json={"name": f"DAV {uuid.uuid4().hex[:6]}",
                                   "type": "organization"})).json()["id"]
    return (await client.post("/api/accounts", headers=admin,
                              json={"holder_party_id": pid, "type": "business"})).json()["id"]


async def _overdue_invoice(client, admin, account_id: str) -> str:
    cust = (await client.post("/api/customers", headers=admin,
                              json={"name": f"DAVC {uuid.uuid4().hex[:6]}"})).json()["id"]
    inv = (await client.post("/api/invoices", headers=admin, json={
        "customer_id": cust,
        "lines": [{"kind": "charge", "description": "X", "quantity": 1, "unit_amount": 5000}],
    })).json()
    async with SessionLocal() as s:
        row = (await s.execute(select(Invoice).where(Invoice.id == uuid.UUID(inv["id"])))).scalar_one()
        row.account_id = uuid.UUID(account_id)
        await s.commit()
    past = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin, json={"due_at": past})
    return inv["id"]


# ===================== 1. DEFAULT_POLICY_STEPS exposes UPPER action verbs =====================

def test_default_policy_steps_action_verbs_are_upper_snake():
    """The in-code canonical sequence must use the UPPER_SNAKE vocabulary (B1)."""
    actions = [step["action"] for step in dunning_service.DEFAULT_POLICY_STEPS]
    assert actions == ["NOTICE", "NOTICE", "THROTTLE", "WALLED_GARDEN", "TERMINATE"]
    # And the validator's whitelist agrees.
    assert dunning_service.ALLOWED_ACTIONS == {
        "NOTICE", "THROTTLE", "WALLED_GARDEN", "TERMINATE",
    }


async def test_auto_seeded_default_policy_uses_upper_actions(client, admin):
    """The fallback default policy that ``get_default_policy`` lazy-creates must persist
    UPPER action verbs into the JSONB column — i.e. the steps_json round-trip is UPPER."""
    tid = await _admin_tenant_id()
    async with SessionLocal() as s:
        policy = await dunning_service.get_default_policy(s, tid)
        await s.commit()
        # Reload to verify what actually landed in PG.
        reloaded = (await s.execute(
            select(DunningPolicy).where(DunningPolicy.id == policy.id)
        )).scalar_one()
    persisted_actions = [step["action"] for step in reloaded.steps_json]
    # Every action verb in the seeded sequence is UPPER_SNAKE — no lowercase leakage.
    assert all(a == a.upper() for a in persisted_actions), persisted_actions
    assert set(persisted_actions) <= dunning_service.ALLOWED_ACTIONS


# ===================== 2. validate_steps_json accepts + folds legacy lowercase =====================

def test_validate_steps_json_folds_legacy_lowercase_to_upper():
    """Legacy lowercase input must NOT 422; it must be folded UP per B1 normalisation."""
    legacy = [
        {"day_offset": 1, "action": "notice", "params": {"template": "t1"}},
        {"day_offset": 7, "action": "throttle", "params": {"kbps": 256}},
        {"day_offset": 14, "action": "walled_garden", "params": {}},
        {"day_offset": 30, "action": "terminate", "params": {}},
    ]
    normalised = dunning_service.validate_steps_json(legacy)
    assert [step["action"] for step in normalised] == [
        "NOTICE", "THROTTLE", "WALLED_GARDEN", "TERMINATE",
    ]
    # day_offsets + params pass through unchanged.
    assert [step["day_offset"] for step in normalised] == [1, 7, 14, 30]
    assert normalised[0]["params"] == {"template": "t1"}

    # Unknown actions still 422 (UPPER or not).
    with pytest.raises(ValueError):
        dunning_service.validate_steps_json([
            {"day_offset": 1, "action": "nuke", "params": {}},
        ])


# ===================== 3. service-less advance writes UPPER action on log row =====================

async def test_serviceless_throttle_advance_writes_upper_action_on_log(client, admin):
    """When an account has no services, the THROTTLE step's fallback ServiceActionLog row
    written DIRECTLY by ``services/dunning.py`` (not via the LoggingAdapter) must carry the
    UPPER_SNAKE action value. This is the surface that B1 normalised in this revision."""
    acc_id = await _party_account(client, admin)
    await _overdue_invoice(client, admin, acc_id)
    await client.post("/api/invoices/run-dunning", headers=admin)

    # Pull the freshly opened case.
    async with SessionLocal() as s:
        case = (await s.execute(
            select(DunningCase).where(
                DunningCase.account_id == uuid.UUID(acc_id),
                DunningCase.status == "ACTIVE",
            )
        )).scalar_one()
        case_id = case.id

    # Advance through both NOTICE steps + the THROTTLE step (default sequence indexes 0,1,2).
    for _ in range(3):
        r = await client.post(f"/api/dunning/cases/{case_id}/advance", headers=admin)
        assert r.status_code == 200, r.text

    # Account has no service → the THROTTLE step took the service-less fallback path that
    # writes a ServiceActionLog row directly with action='THROTTLE'.
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(ServiceActionLog).where(
                ServiceActionLog.dunning_case_id == case_id,
                ServiceActionLog.service_id.is_(None),
            )
        )).scalars().all()
    throttle_rows = [r for r in rows if r.action.upper() == "THROTTLE"]
    assert len(throttle_rows) >= 1
    # Every service-less log row written by services/dunning.py is UPPER_SNAKE.
    for r in throttle_rows:
        assert r.action == "THROTTLE", f"expected UPPER 'THROTTLE', got {r.action!r}"
