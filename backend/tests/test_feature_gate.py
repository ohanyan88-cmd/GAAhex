"""Feature-gate service + production deploy contract feature checks.

Covers ``app.services.feature_gate`` (probe + require + audit) and the four
new clauses added to ``app.config._assert_production_deploy_contract`` that
refuse to boot a production deployment with a feature flag flipped ON but no
real implementation behind it.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import MagicMock

import pytest

from app.config import _assert_production_deploy_contract, settings
from app.exceptions.feature_gate import FeatureDisabledError
from app.services import feature_gate


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────


def _enter_production(monkeypatch):
    """Stage a minimal valid production env so the contract reaches the
    feature-gate clauses without tripping earlier (RLS / CORS / mock provider)
    checks. Tests then flip exactly ONE feature-gate knob and assert
    RuntimeError."""
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "database_url", "postgresql+asyncpg://gaahex_app:y@h:5432/a")
    monkeypatch.setattr(settings, "owner_database_url", "postgresql+asyncpg://gaahex:y@h:5432/a")
    monkeypatch.setattr(settings, "cors_origins", "https://app.example.com")
    monkeypatch.setattr(settings, "payment_gateway_provider", "stripe")
    monkeypatch.setattr(settings, "email_gateway_provider", "sendgrid")
    monkeypatch.setattr(settings, "sms_gateway_provider", "twilio")
    monkeypatch.setattr(settings, "radius_backend_provider", "freeradius")
    # Stage 2 product-decision contract: portal must use cookie/both in prod.
    monkeypatch.setattr(settings, "portal_auth_mode", "cookie")
    # All four feature flags default to False — tests flip individually.
    monkeypatch.setattr(settings, "feature_radius_required", False)
    monkeypatch.setattr(settings, "feature_olt_provisioning_required", False)
    monkeypatch.setattr(settings, "feature_import_engine_enabled", False)
    monkeypatch.setattr(settings, "feature_warehouse_enabled", False)


# ──────────────────────────────────────────────────────────────────────────
# 1. Dev/test defaults — all features disabled
# ──────────────────────────────────────────────────────────────────────────


def test_radius_disabled_by_default():
    """Dev/test default: every feature is_enabled() returns False."""
    assert feature_gate.is_enabled("radius") is False
    assert feature_gate.is_enabled("olt_provisioning") is False
    assert feature_gate.is_enabled("import_engine") is False
    assert feature_gate.is_enabled("warehouse") is False
    # Unknown keys also fail-closed.
    assert feature_gate.is_enabled("does-not-exist") is False
    assert feature_gate.is_enabled("") is False


# ──────────────────────────────────────────────────────────────────────────
# 2. require_radius() raises when disabled
# ──────────────────────────────────────────────────────────────────────────


async def test_require_radius_raises_when_disabled(monkeypatch):
    """With FEATURE_RADIUS_REQUIRED=false (default), require_radius() raises
    FeatureDisabledError carrying feature='radius'."""
    # Swallow the audit emit so this test stays unit-scoped (no DB row needed).
    async def _noop_audit(feature, reason):
        return None
    monkeypatch.setattr(feature_gate, "_emit_blocked_audit", _noop_audit)

    with pytest.raises(FeatureDisabledError) as exc_info:
        await feature_gate.require_radius()
    assert exc_info.value.feature == "radius"
    assert "FEATURE_RADIUS_REQUIRED" in exc_info.value.reason or "stub" in exc_info.value.reason


async def test_require_helpers_raise_for_all_four(monkeypatch):
    """Every helper raises FeatureDisabledError with the matching feature key."""
    async def _noop_audit(feature, reason):
        return None
    monkeypatch.setattr(feature_gate, "_emit_blocked_audit", _noop_audit)

    with pytest.raises(FeatureDisabledError) as ei:
        await feature_gate.require_olt_provisioning()
    assert ei.value.feature == "olt_provisioning"

    with pytest.raises(FeatureDisabledError) as ei:
        await feature_gate.require_import_engine()
    assert ei.value.feature == "import_engine"

    with pytest.raises(FeatureDisabledError) as ei:
        await feature_gate.require_warehouse()
    assert ei.value.feature == "warehouse"


# ──────────────────────────────────────────────────────────────────────────
# 3. require_radius() emits FEATURE_BLOCKED_USE audit Event
# ──────────────────────────────────────────────────────────────────────────


async def test_require_radius_audit_event_emitted(monkeypatch):
    """On a disabled-feature block, an Event row of type FEATURE_BLOCKED_USE is
    added through a FRESH OwnerSessionLocal (independent of any caller txn)."""
    captured: dict = {"events": [], "committed": False}

    class _FakeSession:
        async def __aenter__(self):
            return self
        async def __aexit__(self, exc_type, exc, tb):
            return False
        async def connection(self, execution_options=None):
            return None
        def add(self, obj):
            captured["events"].append(obj)
        async def execute(self, stmt):
            # Stub the SELECT Tenant.id ... ORDER BY created_at lookup.
            from uuid import uuid4
            result = MagicMock()
            scalars = MagicMock()
            scalars.first.return_value = uuid4()
            result.scalars.return_value = scalars
            return result
        async def commit(self):
            captured["committed"] = True

    def _fake_owner_factory():
        return _FakeSession()

    # Patch OwnerSessionLocal *inside* the service module's lazy import path —
    # the function does ``from ..db import OwnerSessionLocal`` so we must patch
    # the actual attribute on app.db.
    import app.db
    monkeypatch.setattr(app.db, "OwnerSessionLocal", _fake_owner_factory)

    with pytest.raises(FeatureDisabledError):
        await feature_gate.require_radius()

    # Exactly one Event was added, with type FEATURE_BLOCKED_USE + feature key
    # in its data payload, and the fresh session committed (independent of any
    # caller transaction).
    assert len(captured["events"]) == 1, "expected exactly one audit Event row"
    ev = captured["events"][0]
    assert ev.type == "FEATURE_BLOCKED_USE"
    assert ev.entity_key == "feature"
    assert ev.event_name == "Feature.BlockedUse"
    assert ev.category == "SECURITY"
    assert ev.actor_type == "SYSTEM"
    assert ev.data.get("feature") == "radius"
    assert ev.data.get("reason")  # non-empty
    assert captured["committed"] is True


# ──────────────────────────────────────────────────────────────────────────
# 4. Production deploy contract — refuses each feature ON without backend
# ──────────────────────────────────────────────────────────────────────────


def test_production_contract_refuses_radius_required_with_mock_provider(monkeypatch):
    """FEATURE_RADIUS_REQUIRED=true + RADIUS_BACKEND_PROVIDER=mock → RuntimeError.

    Uses 'stub' (also in the rejected set) to bypass the legacy mock-provider
    block check higher up and exercise our specific feature-gate clause.
    """
    _enter_production(monkeypatch)
    monkeypatch.setattr(settings, "feature_radius_required", True)
    monkeypatch.setattr(settings, "radius_backend_provider", "stub")
    with pytest.raises(RuntimeError, match="FEATURE_RADIUS_REQUIRED"):
        _assert_production_deploy_contract()


def test_production_contract_refuses_radius_required_with_broken_backend(monkeypatch):
    """FEATURE_RADIUS_REQUIRED=true + provider='freeradius' but config missing →
    RuntimeError (backend construction fails)."""
    _enter_production(monkeypatch)
    monkeypatch.setattr(settings, "feature_radius_required", True)
    # freeradius backend needs host + secret to construct cleanly.
    monkeypatch.setattr(settings, "radius_host", None)
    monkeypatch.setattr(settings, "radius_secret", None)
    monkeypatch.setattr(settings, "radius_nas_ip", None)
    # The check probes by calling the builder; FreeRadiusBackend either
    # constructs (no eager network call) OR raises RadiusBackendConfigError.
    # Either outcome is acceptable — what matters is that if it *does* raise,
    # the contract surfaces a RuntimeError. We force-fail the builder via
    # monkeypatch to make the assertion deterministic.
    from app.services.radius.exceptions import RadiusBackendConfigError
    from app.services.radius import factory as radius_factory

    def _broken_builder():
        raise RadiusBackendConfigError("host is required")

    monkeypatch.setitem(radius_factory._REGISTRY, "freeradius", _broken_builder)

    with pytest.raises(RuntimeError, match="failed to construct"):
        _assert_production_deploy_contract()


def test_production_contract_refuses_olt_required_without_real_driver(monkeypatch):
    """FEATURE_OLT_PROVISIONING_REQUIRED=true + only 'mock' in registry →
    RuntimeError."""
    _enter_production(monkeypatch)
    monkeypatch.setattr(settings, "feature_olt_provisioning_required", True)

    # The real registry has huawei + zte already; simulate a fresh deploy
    # where Packs P3/P4 haven't shipped by patching registered_vendors().
    from app.services.olt import factory as olt_factory
    monkeypatch.setattr(olt_factory, "registered_vendors", lambda: ["mock"])

    with pytest.raises(RuntimeError, match="OLT_PROVISIONING_REQUIRED"):
        _assert_production_deploy_contract()


def test_production_contract_refuses_import_engine_when_unimplemented(monkeypatch):
    """FEATURE_IMPORT_ENGINE_ENABLED=true + IMPORT_ENGINE_IMPLEMENTED=False →
    RuntimeError."""
    _enter_production(monkeypatch)
    monkeypatch.setattr(settings, "feature_import_engine_enabled", True)
    # Belt-and-braces: ensure the sentinel is False (its default at the moment).
    monkeypatch.setattr(feature_gate, "IMPORT_ENGINE_IMPLEMENTED", False)
    with pytest.raises(RuntimeError, match="IMPORT_ENGINE"):
        _assert_production_deploy_contract()


def test_production_contract_refuses_warehouse_when_unimplemented(monkeypatch):
    """FEATURE_WAREHOUSE_ENABLED=true + WAREHOUSE_IMPLEMENTED=False → RuntimeError."""
    _enter_production(monkeypatch)
    monkeypatch.setattr(settings, "feature_warehouse_enabled", True)
    monkeypatch.setattr(feature_gate, "WAREHOUSE_IMPLEMENTED", False)
    with pytest.raises(RuntimeError, match="WAREHOUSE"):
        _assert_production_deploy_contract()


# ──────────────────────────────────────────────────────────────────────────
# 5. is_enabled is idempotent / read-only
# ──────────────────────────────────────────────────────────────────────────


def test_feature_gate_helpers_are_idempotent():
    """Calling is_enabled() many times is a pure read — no state mutation."""
    flag_before = settings.feature_radius_required
    provider_before = settings.radius_backend_provider

    for _ in range(5):
        assert feature_gate.is_enabled("radius") is False
        assert feature_gate.is_enabled("olt_provisioning") is False
        assert feature_gate.is_enabled("import_engine") is False
        assert feature_gate.is_enabled("warehouse") is False

    # Settings unchanged after the probes.
    assert settings.feature_radius_required is flag_before
    assert settings.radius_backend_provider == provider_before
    # Sentinels unchanged.
    assert feature_gate.IMPORT_ENGINE_IMPLEMENTED is False
    assert feature_gate.WAREHOUSE_IMPLEMENTED is False


# ──────────────────────────────────────────────────────────────────────────
# 6. Production contract still PASSES when all features are off (dev default)
# ──────────────────────────────────────────────────────────────────────────


def test_production_contract_passes_when_all_features_off(monkeypatch):
    """Sanity: with prod env staged + every feature flag default-False, the
    new feature-gate clauses are no-ops and the existing contract continues
    to pass."""
    _enter_production(monkeypatch)
    # All four features stay False (set by _enter_production).
    # The suite sets FEATURE_PAYMENTS_ENABLED=true (conftest); with the default dev provider the C2
    # payment gate would (correctly) fire, so declare payments off to keep this a feature-gate sanity.
    monkeypatch.setattr(settings, "feature_payments_enabled", False)
    _assert_production_deploy_contract()  # must not raise
