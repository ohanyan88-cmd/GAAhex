"""Billing — Credit-note endpoints (split from the original ``routers/billing.py``).

Credit notes (SPEC §4.5 path 'credit_note'; SPEC §2.2 owner = "Invoices") are config-driven
Records (entity_key='credit_note'), not a physical billing table — fields {number, customer,
invoice_id, amount} live in `record.data` JSONB. The generic record CRUD at /api/credit-notes
serves reads; this dedicated POST overrides the write path so the §4.5 approval gate + invoice
linkage + cumulative-amount validation run before the row lands. Financial immutability (DELETE
blocked) is enforced by the `prevent_delete_credit_note_record` trigger in migration
f1a3b8d27e64.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Record
from ..access import load_grants  # noqa: F401  (parity with original imports — not used here but kept for symmetry)
from .. import workflow
from ..kernel import (
    assert_can, AccessDenied,
    assert_approval_or_raise, ApprovalRequired,
    create_approval_request, find_approved_approval, mark_approval_executed,
)
from ..utils.http_errors import approval_required  # PC-2
from ..utils.refnum import next_reference_number
from .auth import current_user
from ._billing_shared import (
    _owner_gate, _credit_note, _get_invoice,
)

router = APIRouter(prefix="/api", tags=["billing"])


async def _credited_total(s: AsyncSession, invoice_id: uuid.UUID, tenant_id: uuid.UUID) -> int:
    """Sum of all non-VOID credit_note amounts already issued against `invoice_id` (luma)."""
    rows = (await s.execute(
        select(Record).where(
            Record.tenant_id == tenant_id,
            Record.entity_key == "credit_note",
        )
    )).scalars().all()
    total = 0
    inv_str = str(invoice_id)
    for r in rows:
        d = r.data or {}
        if d.get("invoice_id") == inv_str and (r.status or "ISSUED") != "VOID":
            total += int(d.get("amount") or 0)
    return total


async def _next_credit_note_number(s: AsyncSession, tenant_id: uuid.UUID) -> str:
    return await next_reference_number(s, tenant_id=tenant_id, prefix="CN", width=5)


@router.post("/credit-notes", status_code=200)
async def issue_credit_note(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """SPEC §4.5 path 'credit_note' — issue a credit note against an existing invoice.

    Body: {"invoice_id": uuid, "amount": int_luma, "reason": str (optional), "number": str (optional)}

    Gates:
      1. assert_can('create', 'credit_note') — Step 7 default-deny matrix.
      2. SPEC §2.2 owner gate: writer_module='Invoices' (credit notes are owned by Invoices).
      3. SPEC §4.5 approval gate: first call → 202 with PENDING approval; after APPROVED a
         second call inserts the Record and marks the approval EXECUTED.

    Validation (SPEC §0.3 financial immutability — credits accumulate, never replace):
      - amount > 0 and ≤ (invoice.total - already_credited_non_void)
      - the credit_note row, once issued, is DB-trigger-immune to DELETE
        (prevent_delete_credit_note_record, f1a3b8d27e64)
    """
    try:
        inv_id = uuid.UUID(str(payload.get("invoice_id") or ""))
    except (TypeError, ValueError):
        raise HTTPException(422, "invoice_id must be a UUID")
    inv = await _get_invoice(s, user, inv_id)

    # Step 7 layer-1 default-deny.
    try:
        await assert_can(s, user, action="create", entity_key="credit_note",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # First-class owner gate (SPEC §0.1 / §2.2).
    await _owner_gate(s, table_name="credit_note", writer_module="Invoices")

    # Validate credit amount.
    try:
        credit_amount = int(payload.get("amount", 0))
    except (TypeError, ValueError):
        raise HTTPException(422, "amount must be an integer (luma)")
    if credit_amount <= 0:
        raise HTTPException(422, "amount must be > 0")

    already_credited = await _credited_total(s, inv.id, user.tenant_id)
    max_creditable = int(inv.total) - already_credited
    if credit_amount > max_creditable:
        raise HTTPException(
            422,
            f"credit {credit_amount} exceeds remaining creditable {max_creditable} on invoice {inv.number}",
        )

    reason = str(payload.get("reason") or "").strip()[:500]

    # SPEC §4.5 approval gate.
    try:
        await assert_approval_or_raise(
            s, tenant_id=user.tenant_id,
            action_type="credit_note",
            target_entity_key="invoice",
            target_record_id=inv.id,
        )
    except ApprovalRequired:
        approval = await create_approval_request(
            s, tenant_id=user.tenant_id,
            action_type="credit_note",
            requested_by_user_id=user.id,
            target_entity_key="invoice",
            target_record_id=inv.id,
            payload={
                "invoice_id": str(inv.id),
                "invoice_number": inv.number,
                "amount": credit_amount,
                "currency_minor": "luma",
                "reason": reason,
                "already_credited": already_credited,
                "invoice_total": int(inv.total),
            },
        )
        await s.commit()
        raise approval_required(approval.id, "credit_note")

    # Approval exists — find + consume it.
    approved = await find_approved_approval(
        s, tenant_id=user.tenant_id,
        action_type="credit_note",
        target_entity_key="invoice",
        target_record_id=inv.id,
    )

    # Insert the credit_note Record (entity_key='credit_note', status='ISSUED').
    number = str(payload.get("number") or "").strip() or await _next_credit_note_number(s, user.tenant_id)
    cn = Record(
        tenant_id=user.tenant_id,
        entity_key="credit_note",
        owner_node_id=inv.owner_node_id,
        status="ISSUED",
        data={
            "number": number,
            "invoice_id": str(inv.id),
            "invoice_number": inv.number,
            "customer_id": str(inv.customer_id) if inv.customer_id else None,
            "amount": credit_amount,
            "reason": reason,
        },
    )
    s.add(cn)
    await s.flush()

    await workflow.emit(s, user.tenant_id, "CREATE", "credit_note", cn.id, user.id, {
        "invoice_id": str(inv.id),
        "invoice_number": inv.number,
        "amount": credit_amount,
        "already_credited": already_credited,
        "new_total_credited": already_credited + credit_amount,
        "reason": reason,
    })

    if approved is not None:
        await mark_approval_executed(s, approval_id=approved.id, actor_user_id=user.id)
    await s.commit()
    await s.refresh(cn)
    return _credit_note(cn)
