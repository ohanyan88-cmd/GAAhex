"""Tests for POST /api/outbound/compose (A28).

Uses the LogEmailAdapter and LogSmsAdapter (the dev defaults — no SMTP, no Twilio).
All six cases from C28-outbound-tests.md are covered.

Unknown channel ("fax") returns 422 — the ComposeIn validator rejects it before the
adapter lookup, so the endpoint never reaches the 503 path.
"""

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.outbound import OutboundMessage


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

async def _compose(client, headers, payload):
    return await client.post("/api/outbound/compose", json=payload, headers=headers)


async def _row_exists(msg_id: str) -> bool:
    """Return True if an OutboundMessage with the given id exists in the DB."""
    import uuid
    async with SessionLocal() as s:
        row = (await s.execute(
            select(OutboundMessage).where(OutboundMessage.id == uuid.UUID(msg_id))
        )).scalar_one_or_none()
        return row is not None


# ---------------------------------------------------------------------------
# 1. Happy path — email
# ---------------------------------------------------------------------------

async def test_compose_email_happy_path(client, admin):
    """201, status is LOG (LogEmailAdapter), OutboundMessage row exists in DB."""
    r = await _compose(client, admin, {
        "channel": "email",
        "to": "test@example.com",
        "subject": "Hi",
        "body": "Hello",
    })
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["status"] in {"LOG", "SENT"}, f"unexpected status: {data['status']}"
    assert data["channel"] == "email"
    assert data["to_addr"] == "test@example.com"
    assert await _row_exists(data["id"])


# ---------------------------------------------------------------------------
# 2. Happy path — sms
# ---------------------------------------------------------------------------

async def test_compose_sms_happy_path(client, admin):
    """201, status is LOG (LogSmsAdapter), OutboundMessage row exists in DB."""
    r = await _compose(client, admin, {
        "channel": "sms",
        "to": "+37491000000",
        "body": "Hello",
    })
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["status"] in {"LOG", "SENT"}, f"unexpected status: {data['status']}"
    assert data["channel"] == "sms"
    assert data["to_addr"] == "+37491000000"
    assert await _row_exists(data["id"])


# ---------------------------------------------------------------------------
# 3. Missing `to` → 422
# ---------------------------------------------------------------------------

async def test_compose_missing_to(client, admin):
    """Pydantic / model_post_init rejects a blank `to` → 422."""
    r = await _compose(client, admin, {
        "channel": "email",
        "body": "Hello",
    })
    assert r.status_code == 422, r.text


# ---------------------------------------------------------------------------
# 4. Blank `body` → 422
# ---------------------------------------------------------------------------

async def test_compose_blank_body(client, admin):
    """model_post_init rejects an empty body → 422."""
    r = await _compose(client, admin, {
        "channel": "email",
        "to": "x@x.com",
        "body": "",
    })
    assert r.status_code == 422, r.text


# ---------------------------------------------------------------------------
# 5. Unknown channel → 422
#    (ComposeIn.model_post_init raises ValueError before the adapter lookup,
#     so the response is 422, not 503.)
# ---------------------------------------------------------------------------

async def test_compose_unknown_channel(client, admin):
    """channel='fax' is rejected by the Pydantic validator → 422."""
    r = await _compose(client, admin, {
        "channel": "fax",
        "to": "x",
        "body": "x",
    })
    # The model validator fires before adapter lookup → 422
    assert r.status_code == 422, (
        f"expected 422 (validator rejects unknown channel); got {r.status_code}: {r.text}"
    )


# ---------------------------------------------------------------------------
# 6. Unauthenticated → 401 or 403
# ---------------------------------------------------------------------------

async def test_compose_unauthenticated(client):
    """No token → 401 or 403."""
    r = await _compose(client, {}, {
        "channel": "email",
        "to": "test@example.com",
        "subject": "Hi",
        "body": "Hello",
    })
    assert r.status_code in {401, 403}, f"expected 401/403; got {r.status_code}"
