"""GDPR Article 15 (right-to-access) + Article 17 (right-to-erasure) services.

Two pure async functions on AsyncSession — `build_access_export` and `anonymize_customer` —
called by `routers/privacy.complete_request` for the COMPLETED transition and (for erasure)
also by `routers/lifecycle.purge` when an entity_key='customer' Record is being purged
(closing audit finding C4 — "PURGED state decorative").

Both functions are TENANT-SCOPED at the query level (defense-in-depth on top of RLS) and
refuse to operate on a Record whose tenant_id doesn't match the caller's. The router layer
above does the permission gate; this module does the data work and the redaction itself.

Article 17 financial-retention exception
----------------------------------------
GDPR Article 17 explicitly carves out financial records that the controller has a legal
obligation to retain (tax, anti-money-laundering, debt-collection statute of limitations).
For an Armenian ISP that's ~7 years on invoices + payments. So `anonymize_customer` does NOT
delete invoices or payments — it scrubs the PII on the customer Record + linked CustomerUser
and leaves the money rows intact. Their `customer_id` still points at the now-anonymized
Record (which is the audit trail), so reporting and reconciliation continue to work.

PII set (data keys we redact on the customer Record.data JSONB):
  name, email, phone, address, national_id, passport_no

Anything else stored in data (e.g. internal flags, plan_id) is left untouched. The set is
deliberately conservative — when a new PII-bearing field lands, add it here AND to file 15.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Record, Event, Communication
from ..models.billing import Invoice, Payment, Subscription
from ..models.customer_user import CustomerUser


# Keys on Record.data that carry personal identifiers and must be redacted on erasure.
# Order is the order in which they appear in the response — keep it stable for tests.
_PII_DATA_KEYS = ("name", "email", "phone", "address", "national_id", "passport_no")

# Sentinel value written into PII slots. Distinct from "" so an existing empty-string field
# does NOT count as redacted by the audit trail.
_REDACTED = "[REDACTED]"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _serialize_record(r: Record) -> dict:
    """Customer Record → access-export dict. We do NOT call the records router's serializer
    here — it applies role-aware field-level hiding that would over-redact a GDPR export
    (the SUBJECT has the right to see their own data even when an internal RBAC role would
    hide a given field from a typical staff seat)."""
    return {
        "id": str(r.id),
        "entity_key": r.entity_key,
        "owner_node_id": str(r.owner_node_id) if r.owner_node_id else None,
        "status": r.status,
        "data": dict(r.data or {}),
        "deletion_state": r.deletion_state,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _serialize_invoice(i: Invoice) -> dict:
    return {
        "id": str(i.id),
        "number": i.number,
        "status": i.status,
        "total_luma": i.total,
        "period_start": i.period_start.isoformat() if i.period_start else None,
        "period_end": i.period_end.isoformat() if i.period_end else None,
        "issued_at": i.issued_at.isoformat() if i.issued_at else None,
        "due_at": i.due_at.isoformat() if i.due_at else None,
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }


def _serialize_payment(p: Payment) -> dict:
    return {
        "id": str(p.id),
        "invoice_id": str(p.invoice_id) if p.invoice_id else None,
        "amount_luma": p.amount,
        "method": p.method,
        "paid_at": p.paid_at.isoformat() if p.paid_at else None,
        "refunded_amount_luma": p.refunded_amount,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _serialize_subscription(s: Subscription) -> dict:
    return {
        "id": str(s.id),
        "plan_name": s.plan_name,
        "amount_luma": s.amount,
        "cycle": s.cycle,
        "status": s.status,
        "started_at": s.started_at.isoformat() if s.started_at else None,
        "next_invoice_at": s.next_invoice_at.isoformat() if s.next_invoice_at else None,
    }


def _serialize_communication(c: Communication) -> dict:
    return {
        "id": str(c.id),
        "reference_number": c.reference_number,
        "channel": c.channel,
        "direction": c.direction,
        "status": c.status,
        "subject": c.subject,
        "message_body": c.message_body,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "sent_at": c.sent_at.isoformat() if c.sent_at else None,
        "received_at": c.received_at.isoformat() if c.received_at else None,
    }


def _serialize_event(e: Event) -> dict:
    return {
        "id": str(e.id),
        "type": e.type,
        "event_name": e.event_name,
        "category": e.category,
        "entity_key": e.entity_key,
        "record_id": str(e.record_id) if e.record_id else None,
        "actor_user_id": str(e.actor_user_id) if e.actor_user_id else None,
        "data": dict(e.data or {}),
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


async def _load_customer(s: AsyncSession, tenant_id: uuid.UUID, customer_record_id: uuid.UUID) -> Record:
    """Tenant-scoped fetch of the customer Record. Raises ValueError on miss / wrong entity_key.

    The explicit tenant_id predicate is defense-in-depth: RLS already filters, but staff routes
    that bypass via OwnerSessionLocal (tests, migrations) still get this layer."""
    row = (await s.execute(
        select(Record).where(
            Record.tenant_id == tenant_id,
            Record.id == customer_record_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise ValueError(
            f"Customer record {customer_record_id} not found in tenant {tenant_id}"
        )
    if row.entity_key != "customer":
        raise ValueError(
            f"Record {customer_record_id} is entity_key={row.entity_key!r}; "
            "GDPR privacy operations only apply to entity_key='customer'"
        )
    return row


async def build_access_export(
    s: AsyncSession,
    tenant_id: uuid.UUID,
    customer_record_id: uuid.UUID,
) -> dict:
    """GDPR Article 15 — produce a JSON dict of EVERY piece of data the platform holds about a
    customer within the requesting tenant.

    Includes:
      * the customer Record (full data JSONB, including the PII fields — the subject has the
        right to see their own data verbatim);
      * subscriptions, invoices, and payments where customer_id == this Record;
      * communications threaded against this customer Record (related_entity_id);
      * audit events whose record_id is this customer Record.

    Excludes:
      * any row outside the requesting tenant (RLS + explicit tenant_id filter — belt + braces);
      * cross-tenant audit events (same filter as above);
      * the CustomerUser row's password_hash — never disclosed even to the subject (the hash is
        a credential, not subject data — Article 15 covers personal data, not credentials).
    """
    customer = await _load_customer(s, tenant_id, customer_record_id)

    subs = (await s.execute(
        select(Subscription).where(
            Subscription.tenant_id == tenant_id,
            Subscription.customer_id == customer_record_id,
        ).order_by(Subscription.started_at.desc())
    )).scalars().all()

    invoices = (await s.execute(
        select(Invoice).where(
            Invoice.tenant_id == tenant_id,
            Invoice.customer_id == customer_record_id,
        ).order_by(Invoice.created_at.desc())
    )).scalars().all()

    payments = (await s.execute(
        select(Payment).where(
            Payment.tenant_id == tenant_id,
            Payment.customer_id == customer_record_id,
        ).order_by(Payment.paid_at.desc())
    )).scalars().all()

    # Communications pinned to the customer via the polymorphic related_entity_* pair.
    comms = (await s.execute(
        select(Communication).where(
            Communication.tenant_id == tenant_id,
            Communication.related_entity_type == "customer",
            Communication.related_entity_id == customer_record_id,
        ).order_by(Communication.created_at.desc())
    )).scalars().all()

    # Audit events targeting this customer Record. tenant_id filter is REQUIRED — Event rows
    # are tenant-scoped (Event.tenant_id NOT NULL) but `record_id` alone could collide if a
    # UUID happened to repeat across tenants (vanishingly unlikely with UUIDv7 but the filter
    # costs nothing and codifies the boundary).
    audit_events = (await s.execute(
        select(Event).where(
            Event.tenant_id == tenant_id,
            Event.record_id == customer_record_id,
        ).order_by(Event.created_at.desc())
    )).scalars().all()

    # CustomerUser portal-login row (if any). Password hash NEVER disclosed.
    cu_row = (await s.execute(
        select(CustomerUser).where(
            CustomerUser.tenant_id == tenant_id,
            CustomerUser.customer_id == customer_record_id,
        )
    )).scalar_one_or_none()
    customer_user = None
    if cu_row is not None:
        customer_user = {
            "id": str(cu_row.id),
            "email": cu_row.email,
            "name": cu_row.name,
            "is_active": cu_row.is_active,
            "created_at": cu_row.created_at.isoformat() if cu_row.created_at else None,
            "last_login_at": cu_row.last_login_at.isoformat() if cu_row.last_login_at else None,
        }

    return {
        "generated_at": _utcnow().isoformat(),
        "tenant_id": str(tenant_id),
        "customer_record_id": str(customer_record_id),
        "customer": _serialize_record(customer),
        "customer_user": customer_user,
        "subscriptions": [_serialize_subscription(x) for x in subs],
        "invoices": [_serialize_invoice(x) for x in invoices],
        "payments": [_serialize_payment(x) for x in payments],
        "communications": [_serialize_communication(x) for x in comms],
        "audit_events": [_serialize_event(x) for x in audit_events],
        "note": (
            "GDPR Article 15 export. Tenant-scoped. Excludes any data outside the requesting "
            "tenant and excludes CustomerUser password hashes (credentials, not subject data)."
        ),
    }


async def anonymize_customer(
    s: AsyncSession,
    tenant_id: uuid.UUID,
    customer_record_id: uuid.UUID,
) -> dict:
    """GDPR Article 17 — anonymize PII on the customer Record (+ linked CustomerUser) while
    preserving the financial / audit retention rows per the Article 17 financial-retention
    exception. Returns a summary of fields anonymized for the audit trail.

    What this does:
      * On the customer Record: every key in _PII_DATA_KEYS that has a non-empty value in
        data is overwritten with "[REDACTED]". Empty / missing keys are left as-is (no need
        to "create" PII slots just to redact them).
      * On the linked CustomerUser (if any): email + name are overwritten with "[REDACTED]"
        and is_active is set False. token_not_before is stamped to now so any outstanding
        portal session is immediately revoked.

    What this does NOT do:
      * Does NOT delete invoice / payment / event rows — Article 17 financial-retention.
        Those rows continue to reference the (now-anonymized) Record by `customer_id`, so
        reconciliation, dunning, and tax reporting continue to function on the customer's
        contract-defined obligations without exposing personal identifiers.
      * Does NOT touch communications.message_body — message content may itself include
        third-party PII (the other side of a conversation). A separate "delete message body"
        pass belongs to a future moderation tool, not the data-subject erasure flow.
    """
    customer = await _load_customer(s, tenant_id, customer_record_id)

    redacted_fields: list[str] = []

    # Record.data — copy-then-reassign so SQLAlchemy detects the JSONB mutation. Direct
    # mutation of the existing dict does NOT mark the attribute dirty (well-known SQLA
    # gotcha on JSON / JSONB columns without a mutable extension).
    data = dict(customer.data or {})
    for key in _PII_DATA_KEYS:
        if data.get(key):
            data[key] = _REDACTED
            redacted_fields.append(f"customer.data.{key}")
    customer.data = data

    # Linked portal login (CustomerUser). Optional — many customers won't have one.
    cu = (await s.execute(
        select(CustomerUser).where(
            CustomerUser.tenant_id == tenant_id,
            CustomerUser.customer_id == customer_record_id,
        )
    )).scalar_one_or_none()
    if cu is not None:
        if cu.email and cu.email != _REDACTED:
            cu.email = _REDACTED
            redacted_fields.append("customer_user.email")
        if cu.name and cu.name != _REDACTED:
            cu.name = _REDACTED
            redacted_fields.append("customer_user.name")
        if cu.is_active:
            cu.is_active = False
            redacted_fields.append("customer_user.is_active")
        # Revoke every outstanding portal session for this login.
        # Floor to integer-second resolution — see portal_auth.portal_logout for the
        # JWT-NumericDate rationale. A token issued in an EARLIER second is rejected;
        # a token issued in the SAME or LATER second is accepted (sub-second logout
        # window is the standard JWT-revocation trade-off).
        cu.token_not_before = _utcnow().replace(microsecond=0)
        redacted_fields.append("customer_user.token_not_before")

    await s.flush()

    return {
        "tenant_id": str(tenant_id),
        "customer_record_id": str(customer_record_id),
        "redacted_fields": redacted_fields,
        "note": (
            "PII anonymized. Financial records (invoices, payments) and audit events preserved "
            "per GDPR Article 17 financial-retention exception."
        ),
    }
