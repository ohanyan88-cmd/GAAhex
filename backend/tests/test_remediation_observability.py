"""Critical observability remediation tests (C1 PII in logs + H15 readiness leak).

C1 / D22 — Channel adapters MUST NOT log full recipient addresses or message body content. The
OutboundMessage row keeps the full data behind RBAC; INFO log lines are operator breadcrumbs and
only carry redacted address + body LENGTH.

H15 / D13 — /api/health/ready MUST NOT surface driver-specific exception text to anonymous callers.
The raw exception is logged server-side (visible in the gaahex.health logger) and the wire payload
is the generic 'db_unavailable' marker.
"""

from __future__ import annotations

import logging

import pytest

from app import channels
from app.routers import health as health_router


# ============================================================================================
# C1 — PII redaction in channel adapter INFO logs
# ============================================================================================

@pytest.mark.asyncio
async def test_email_send_does_not_log_body(caplog):
    """The literal email body must NEVER appear in any log record (only its length)."""
    caplog.set_level(logging.INFO, logger="gaahex.channels")
    secret = "secret-content-do-not-log-12345"
    await channels._email_adapter("alice@example.com", "Welcome", secret)

    for rec in caplog.records:
        assert secret not in rec.getMessage(), (
            f"PII LEAK: email body found in log record: {rec.getMessage()!r}"
        )

    # Positive check — body_len placeholder did make it through.
    assert any("body_len=" in rec.getMessage() for rec in caplog.records), \
        "expected body_len=<int> breadcrumb in log output"


@pytest.mark.asyncio
async def test_email_send_redacts_recipient_address(caplog):
    """Full 'alice@example.com' must NOT appear in logs; redacted form (al***@example.com) MUST."""
    caplog.set_level(logging.INFO, logger="gaahex.channels")
    full = "alice@example.com"
    await channels._email_adapter(full, "Subject", "body")

    messages = [rec.getMessage() for rec in caplog.records]
    joined = " | ".join(messages)

    assert full not in joined, f"PII LEAK: full recipient address in logs: {joined!r}"
    # Redaction shape: first 2 chars of local-part + *** + @domain
    assert "al***@example.com" in joined, \
        f"expected redacted 'al***@example.com' in logs, got: {joined!r}"


@pytest.mark.asyncio
async def test_sms_send_redacts_phone(caplog):
    """Full phone number must NOT appear in logs; last-4 redacted form MUST."""
    caplog.set_level(logging.INFO, logger="gaahex.channels")
    full_phone = "+37499123456"
    await channels._sms_adapter(full_phone, None, "your code is 9999")

    messages = [rec.getMessage() for rec in caplog.records]
    joined = " | ".join(messages)

    assert full_phone not in joined, f"PII LEAK: full phone in logs: {joined!r}"
    # Last-4 redaction
    assert "***3456" in joined, \
        f"expected redacted last-4 '***3456' in logs, got: {joined!r}"
    # Body should not appear either — only its length.
    assert "your code is 9999" not in joined, "PII LEAK: SMS body in logs"
    assert "body_len=" in joined, "expected body_len= breadcrumb on sms adapter"


@pytest.mark.asyncio
async def test_console_adapter_redacts_to_and_drops_body(caplog):
    """Sibling check — the console adapter is the bedrock dev log path and must obey the same rule."""
    caplog.set_level(logging.INFO, logger="gaahex.channels")
    body = "console-body-content-PII-shape"
    await channels._console_adapter("bob@example.com", "Subj", body)

    joined = " | ".join(rec.getMessage() for rec in caplog.records)
    assert body not in joined, f"console adapter leaked body: {joined!r}"
    assert "bob@example.com" not in joined, f"console adapter leaked full address: {joined!r}"
    assert "bo***@example.com" in joined, \
        f"expected 'bo***@example.com' redaction from console adapter, got: {joined!r}"


# ---- helper-level unit checks (defense for the redactors themselves) ----------------------

def test_redact_addr_helper_shapes():
    """Direct verification of the email redaction shape."""
    assert channels._redact_addr("alice@example.com") == "al***@example.com"
    assert channels._redact_addr("ab@example.com") == "***@example.com"     # local-part <= 2 chars
    assert channels._redact_addr("a@example.com") == "***@example.com"
    assert channels._redact_addr("") == "***"
    assert channels._redact_addr(None) == "***"
    assert channels._redact_addr("not-an-email") == "***"


def test_redact_phone_helper_shapes():
    """Direct verification of the phone redaction shape."""
    assert channels._redact_phone("+37499123456") == "***3456"
    assert channels._redact_phone("9999") == "***9999"
    assert channels._redact_phone("12") == "***"      # < 4 chars → fully masked
    assert channels._redact_phone("") == "***"
    assert channels._redact_phone(None) == "***"


# ============================================================================================
# H15 — Readiness probe must not leak DB error text
# ============================================================================================

@pytest.mark.asyncio
async def test_readiness_probe_does_not_leak_db_error_message(client, monkeypatch, caplog):
    """When the DB is unreachable, /api/health/ready must return a generic 503 payload
    (no driver/postgres/FATAL tokens) and log the raw error server-side via gaahex.health.
    """
    caplog.set_level(logging.WARNING, logger="gaahex.health")

    class _BoomSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def execute(self, *_args, **_kwargs):
            raise RuntimeError(
                "connection to server at \"localhost\" (127.0.0.1), port 5433 failed: "
                "FATAL: password authentication failed for user \"postgres\" (postgres driver)"
            )

    def _broken_session_factory():
        return _BoomSession()

    # Patch the SessionLocal symbol THE ROUTER imported (it imports by name, not via app.db).
    monkeypatch.setattr(health_router, "SessionLocal", _broken_session_factory)

    r = await client.get("/api/health/ready")
    assert r.status_code == 503, f"expected 503 when DB is down, got {r.status_code}: {r.text}"

    body_text = r.text
    body_json = r.json()

    # ---- wire payload must be GENERIC (no driver/postgres/error-text leakage) ----
    assert body_json == {"status": "db_unavailable"}, \
        f"expected generic body, got: {body_json!r}"

    for forbidden in ("postgres", "FATAL", "password", "authentication", "5433", "127.0.0.1",
                      "driver", "localhost", "connection to server"):
        assert forbidden.lower() not in body_text.lower(), \
            f"H15 LEAK: token {forbidden!r} found in public readiness response: {body_text!r}"

    # ---- server-side log MUST contain the raw error so ops can debug ----
    raw_logged = any(
        "readiness DB check failed" in rec.getMessage()
        for rec in caplog.records
        if rec.name == "gaahex.health"
    )
    assert raw_logged, (
        "expected server-side WARNING log 'readiness DB check failed' on gaahex.health logger; "
        f"got records: {[(r.name, r.getMessage()) for r in caplog.records]}"
    )

    # And the original exception should travel as exc_info on that record.
    exc_carried = any(
        rec.exc_info is not None and "FATAL" in str(rec.exc_info[1])
        for rec in caplog.records
        if rec.name == "gaahex.health"
    )
    assert exc_carried, "raw DB exception should be attached to the server-side log via exc_info"
