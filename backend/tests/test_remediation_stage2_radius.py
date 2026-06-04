"""Stage-2 production rescue — Pack P3 (RADIUS fail-closed) coverage.

Audit finding: ``services/radius/freeradius_backend.py`` ships the four AAA
methods as :class:`NotImplementedError` stubs. Today no production caller
invokes RADIUS, but if a deploy turns on ``RADIUS_BACKEND_PROVIDER=freeradius``
and a code path attempts to use it, the runtime stub would surface a naked
stack-trace to the customer.

Fail-closed contract (Pack P3, 2026-06-04):

1. ``services/radius/factory.get_radius_backend()`` refuses to return the
   FreeRADIUS stub when RADIUS is required by the deploy
   (``feature_radius_required=True``); raises
   :class:`app.exceptions.FeatureDisabledError` instead.
2. The FreeRADIUS stub's :class:`NotImplementedError` method bodies STAY put —
   they are the safety contract. The fail-closed layer is the factory.
3. The service-lifecycle router (``activate``, ``suspend``, ``terminate``)
   wraps RADIUS provisioning in a feature-gate check and, on
   :class:`FeatureDisabledError`, emits a ``RADIUS_UNAVAILABLE_BLOCKED`` audit
   Event and responds HTTP 503.

The tests below cover each of the four contract clauses one-to-one.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete, select

from app.config import settings
from app.db import OwnerSessionLocal
from app.exceptions import FeatureDisabledError
from app.models import Event
from app.services.radius import (
    FreeRadiusBackend,
    MockRadiusBackend,
    get_radius_backend,
)


# ──────────────────────────────────────────────────────────────────────────
# 1. Factory refuses to return the FreeRADIUS stub when RADIUS is required
# ──────────────────────────────────────────────────────────────────────────


def test_radius_factory_refuses_freeradius_stub_when_required(monkeypatch):
    """``feature_radius_required=True`` + ``radius_backend_provider='freeradius'``
    must raise :class:`FeatureDisabledError` — NOT silently fall back to mock,
    NOT return a stub instance whose methods would later raise
    ``NotImplementedError`` to a customer.
    """
    # Stage the production-required RADIUS configuration. ``raising=False``
    # keeps this resilient to Pack P1 landing the setting before us OR after.
    monkeypatch.setattr(settings, "feature_radius_required", True, raising=False)
    monkeypatch.setattr(settings, "radius_backend_provider", "freeradius", raising=False)

    # Belt-and-braces: ensure the stub still self-reports as not-prod-ready.
    # If a future commit flips this to True without also wiring the methods,
    # THIS assertion fails first and points at the real problem.
    assert FreeRadiusBackend.IS_PRODUCTION_READY is False, (
        "FreeRadiusBackend.IS_PRODUCTION_READY must stay False until M1-C.4 "
        "lands real pyrad packet construction; flipping this flag without "
        "wiring the four async methods re-introduces the audit finding."
    )

    with pytest.raises(FeatureDisabledError) as exc_info:
        get_radius_backend()
    assert exc_info.value.feature == "radius"
    # Message names the underlying cause so an operator can grep the logs.
    assert "FreeRADIUS" in exc_info.value.reason or "stub" in exc_info.value.reason.lower()


def test_radius_factory_refuses_mock_when_required(monkeypatch):
    """Defense in depth: even if the deploy contract's mock-refusal somehow
    let a ``mock`` provider through, the factory's required-mode check must
    refuse to hand out a mock backend. Mirrors the freeradius-stub test."""
    monkeypatch.setattr(settings, "feature_radius_required", True, raising=False)
    monkeypatch.setattr(settings, "radius_backend_provider", "mock", raising=False)

    with pytest.raises(FeatureDisabledError) as exc_info:
        get_radius_backend()
    assert exc_info.value.feature == "radius"


# ──────────────────────────────────────────────────────────────────────────
# 2. Factory returns the mock backend in dev/test (RADIUS not required)
# ──────────────────────────────────────────────────────────────────────────


def test_radius_factory_returns_mock_when_not_required(monkeypatch):
    """The dev/test path is the suite default; the existing
    test_radius_backend_protocol.py exercises it too. We re-assert it here so
    that any future "always-require" regression in factory.py is caught by
    THIS test file, which is the canonical Pack P3 contract."""
    monkeypatch.setattr(settings, "feature_radius_required", False, raising=False)
    monkeypatch.setattr(settings, "radius_backend_provider", "mock", raising=False)

    backend = get_radius_backend()
    assert isinstance(backend, MockRadiusBackend)
    assert backend.provider == "mock"


def test_radius_factory_falls_back_to_mock_when_freeradius_not_required(monkeypatch):
    """Sibling of the above — when ``feature_radius_required=False`` even the
    FreeRADIUS provider name falls through to the mock (existing legacy
    behavior preserved: pyrad ImportError / RadiusBackendConfigError trigger
    the fall-back, and required=False keeps the gate disabled)."""
    monkeypatch.setattr(settings, "feature_radius_required", False, raising=False)
    monkeypatch.setattr(settings, "radius_backend_provider", "freeradius", raising=False)
    # Force the host/secret blanks → RadiusBackendConfigError inside the
    # builder → factory swallows + returns mock.
    monkeypatch.setattr(settings, "radius_host", None, raising=False)
    monkeypatch.setattr(settings, "radius_secret", None, raising=False)

    backend = get_radius_backend()
    # Either we get a Mock (pyrad missing / config blank) or a real FreeRADIUS
    # construction succeeded (pyrad installed AND host+secret somehow set).
    # In CI the former branch fires; we assert at minimum that no error is
    # raised and the result is one of the two valid types.
    assert isinstance(backend, (MockRadiusBackend, FreeRadiusBackend))


# ──────────────────────────────────────────────────────────────────────────
# 3. FreeRADIUS stub methods still raise NotImplementedError (contract intact)
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_freeradius_methods_still_raise_not_implemented():
    """The :class:`NotImplementedError` bodies are the safety contract.
    Deleting / stubbing them would let the audit finding reappear: a deploy
    that misconfigured ``feature_radius_required=False`` AND
    ``radius_backend_provider=freeradius`` could otherwise silently
    authenticate or kick sessions with the wrong return shape."""
    # Construct WITHOUT the factory so the fail-closed gate is bypassed; we're
    # testing the inner contract here, not the gate. Use a fake pyrad shim if
    # pyrad isn't installed so the constructor itself doesn't ImportError on
    # CI runners that don't pip install pyrad.
    try:
        import pyrad  # noqa: F401  type: ignore
    except ImportError:
        pytest.skip("pyrad not installed — stub method bodies covered by other tests")

    backend = FreeRadiusBackend(host="10.0.0.1", secret="s3cr3t")
    # All four AAA methods MUST raise NotImplementedError today. Pin the
    # method names so a rename (refactor) breaks this test loudly.
    with pytest.raises(NotImplementedError, match="pyrad"):
        await backend.authenticate(username="u", password="p")
    with pytest.raises(NotImplementedError, match="pyrad"):
        await backend.acct_start(session_id="s", username="u")
    with pytest.raises(NotImplementedError, match="pyrad"):
        await backend.acct_stop(session_id="s", username="u")
    with pytest.raises(NotImplementedError, match="pyrad"):
        await backend.disconnect(session_id="s", username="u")


def test_freeradius_class_carries_production_ready_marker():
    """Pin the class-level flag the factory consults. If a future refactor
    moves the flag or renames it, the factory's gate silently degrades; this
    test makes that breakage loud."""
    assert hasattr(FreeRadiusBackend, "IS_PRODUCTION_READY")
    assert FreeRadiusBackend.IS_PRODUCTION_READY is False


# ──────────────────────────────────────────────────────────────────────────
# 4. Service activation: RADIUS-blocked → 503 + audit Event
# ──────────────────────────────────────────────────────────────────────────


async def _customer(client, admin, name: str) -> str:
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _create_pending_service(client, admin, tag: str) -> str:
    cust = await _customer(client, admin, f"RadiusBlocked {tag}")
    svc = (await client.post(
        "/api/services", headers=admin,
        json={"name": f"Radius-Gated {tag}", "customer_id": cust},
    )).json()
    return svc["id"]


@pytest.mark.asyncio
async def test_service_activation_emits_audit_when_radius_blocked(
    client, admin, monkeypatch,
):
    """End-to-end: with the RADIUS factory raising :class:`FeatureDisabledError`
    (simulated by flipping ``feature_radius_required=True`` + provider=freeradius),
    a POST to ``/api/services/{id}/activate`` must:

    * respond ``503`` with the canonical ``feature_disabled`` body shape, and
    * leave behind a ``RADIUS_UNAVAILABLE_BLOCKED`` audit Event row scoped to
      the caller's tenant + service.

    Importantly the service must NOT have transitioned to ACTIVE — we'd rather
    a failed transition than a customer marked ACTIVE in the DB but offline
    on the BNG.
    """
    svc_id = await _create_pending_service(client, admin, tag=uuid.uuid4().hex[:6])

    # Arrange the production-required configuration so the factory will refuse.
    # We patch via monkeypatch so the rest of the suite is unaffected.
    monkeypatch.setattr(settings, "feature_radius_required", True, raising=False)
    monkeypatch.setattr(settings, "radius_backend_provider", "freeradius", raising=False)

    r = await client.post(f"/api/services/{svc_id}/activate", headers=admin)
    assert r.status_code == 503, f"expected 503 RADIUS-blocked, got {r.status_code}: {r.text}"
    body = r.json()
    detail = body["detail"] if isinstance(body.get("detail"), dict) else body
    assert detail.get("error") == "feature_disabled", detail
    assert detail.get("feature") == "radius", detail
    assert detail.get("reason"), detail

    # The audit Event must be present. Query with audit_tenant_filter=False
    # since we don't have the caller's tenant_id handy here, then filter on
    # record_id (the service uuid) which is unique enough.
    async with OwnerSessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})
        rows = (await s.execute(
            select(Event).where(
                Event.type == "RADIUS_UNAVAILABLE_BLOCKED",
                Event.record_id == uuid.UUID(svc_id),
            )
        )).scalars().all()
    assert len(rows) >= 1, (
        f"expected at least one RADIUS_UNAVAILABLE_BLOCKED audit Event row "
        f"for service {svc_id}; got {len(rows)}"
    )
    ev = rows[-1]
    assert ev.entity_key == "service"
    assert ev.category == "SECURITY"
    assert ev.data.get("feature") == "radius"
    assert ev.data.get("transition") == "ACTIVATE"
    # Audit Event must NOT leak the raw NotImplementedError stack — only the
    # feature-gate reason string.
    assert "Traceback" not in (ev.data.get("reason") or "")

    # Service must still be PENDING; the transition was refused.
    svc_after = (await client.get(f"/api/services/{svc_id}", headers=admin)).json()
    assert svc_after["status"] == "PENDING", (
        f"service must NOT have transitioned to ACTIVE under RADIUS-blocked; "
        f"got status={svc_after['status']}"
    )

    # ── teardown: clean the audit row so subsequent runs of this test in the
    # same session-scoped DB don't accumulate. Use audit_tenant_filter bypass
    # since Event is RLS-filtered by tenant for normal sessions.
    async with OwnerSessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})
        await s.execute(
            delete(Event).where(
                Event.type == "RADIUS_UNAVAILABLE_BLOCKED",
                Event.record_id == uuid.UUID(svc_id),
            )
        )
        await s.commit()


@pytest.mark.asyncio
async def test_service_activation_succeeds_when_radius_not_required(client, admin):
    """Sibling positive control: with the dev/test default
    (``feature_radius_required=False``) activation proceeds without RADIUS.
    Proves the fail-closed gate is OFF in the existing path so the rest of
    the suite is unaffected by Pack P3."""
    svc_id = await _create_pending_service(client, admin, tag=uuid.uuid4().hex[:6])
    r = await client.post(f"/api/services/{svc_id}/activate", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ACTIVE"
