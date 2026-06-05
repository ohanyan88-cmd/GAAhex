"""Feature-gate service — single chokepoint for fail-closed subsystems.

System role — see ``docs/standards/FEATURE_GATING_POLICY.md``
------------------------------------------------------------
This module is the **platform deploy-shape gate** (policy system #1). It answers
"can the platform technically provide this subsystem in *this* deployment?" and
is **platform-wide**: a deploy-shape gate is the same answer for every tenant.

It is **NOT** the right place for tenant business preferences. Per the policy:

- ``feature_gate.is_enabled()`` MUST stay platform-wide. Adding a ``tenant_id``
  parameter is forbidden (would collapse the two systems).
- New deploy-shape keys are added here only when a new infrastructure subsystem
  ships and may legitimately be unwired in some deploys.
- Tenant business preferences (e.g. ``dunning_automation``, ``self_serve_signup``)
  live in the DB-backed :class:`FeatureFlag` table, accessed server-side via
  :mod:`app.services.tenant_flag` (system #2 — per-tenant, audit-logged).

Packs P3-P6 (RADIUS, OLT provisioning, Import engine, Warehouse) call into
:func:`require` / :func:`is_enabled` (or the per-feature helpers below) at the
top of every request handler / service-action entry point. When the feature
is disabled or stubbed in the current deployment, :class:`FeatureDisabledError`
is raised AND an audit ``FEATURE_BLOCKED_USE`` Event is emitted, so we always
have a forensic trail of "someone tried to use X while X was off".

Default posture
---------------
All four feature flags default to ``False`` in :class:`Settings`. Dev / test
boot with everything OFF — which is correct: a fresh clone shouldn't be able
to silently exercise a stub RADIUS backend and *think* it authenticated a
real customer.

The production deploy contract (see
:func:`app.config._assert_production_deploy_contract`) enforces the inverse:
if a feature is flipped ON in production it MUST have a real implementation
behind it (real RADIUS backend, registered OLT vendor driver, real import
engine, real warehouse module). Booting prod with feature ON + stub backend
is a hard ``RuntimeError`` at startup — fail-closed, not fail-open.

Feature keys
------------
* ``radius`` — RADIUS authentication / accounting / disconnect
* ``olt_provisioning`` — OLT ONU provisioning / VLAN / line-profile
* ``import_engine`` — Bulk CSV / XLSX import pipeline
* ``warehouse`` — Inventory / asset-location warehouse module

Implementation-present flags
----------------------------
Some subsystems (Import, Warehouse) don't yet have a registry / probe surface
we can interrogate — flipping them ON before the real module ships would be a
silent footgun. We track that with the simple module-level constants
:data:`IMPORT_ENGINE_IMPLEMENTED` and :data:`WAREHOUSE_IMPLEMENTED` below.
Flip to ``True`` in the same commit that lands the real engine / module.
"""
from __future__ import annotations

import logging

from ..exceptions.feature_gate import FeatureDisabledError

_log = logging.getLogger("portal.feature_gate")


# ──────────────────────────────────────────────────────────────────────────
# Implementation-present sentinels
# ──────────────────────────────────────────────────────────────────────────
#
# Flip to True in the same commit that lands the corresponding real engine
# / module. Until then, the production deploy contract refuses to start with
# the matching feature flag ON — and :func:`is_enabled` treats the feature
# as effectively unavailable even if the env var says otherwise.

IMPORT_ENGINE_IMPLEMENTED: bool = False
WAREHOUSE_IMPLEMENTED: bool = False


# Stub backend provider names that the RADIUS factory accepts but that MUST
# NEVER count as "RADIUS enabled" — silently passing every auth in production
# is exactly the failure mode this gate exists to prevent.
_RADIUS_STUB_PROVIDERS: frozenset[str] = frozenset({"mock", "stub"})


# ──────────────────────────────────────────────────────────────────────────
# is_enabled — pure probe, no side effects
# ──────────────────────────────────────────────────────────────────────────


def _radius_backend_constructs() -> bool:
    """Try to build the configured RADIUS backend; return False on config error.

    We probe by actually calling the registry builder so a misconfigured prod
    deployment (env var set, but secret / host missing) reads as ``disabled``
    rather than ``enabled-but-broken``. ``get_radius_backend`` swallows config
    errors and falls back to mock, so we go through the lower-level builder
    map directly to see the real result.
    """
    try:
        from ..config import settings
        from .radius.exceptions import RadiusBackendConfigError
        from .radius.factory import _REGISTRY  # type: ignore[attr-defined]

        name = (getattr(settings, "radius_backend_provider", None) or "mock").lower()
        if name in _RADIUS_STUB_PROVIDERS:
            return False
        builder = _REGISTRY.get(name)
        if builder is None:
            return False
        try:
            builder()
        except (RadiusBackendConfigError, ImportError, Exception):
            return False
        return True
    except Exception:  # pragma: no cover — defensive, never block on probe failure
        return False


def _olt_registry_has_real_driver() -> bool:
    """True iff the OLT driver registry has at least one non-mock vendor."""
    try:
        from .olt.factory import registered_vendors

        vendors = [v for v in registered_vendors() if v.lower() != "mock"]
        return bool(vendors)
    except Exception:  # pragma: no cover — defensive
        return False


def is_enabled(feature: str) -> bool:
    """Return True iff ``feature`` is BOTH switched on AND has a real backend.

    Pure probe — no side effects, no mutation. Safe to call from anywhere
    (including hot paths) without auditing.

    Recognised keys: ``radius``, ``olt_provisioning``, ``import_engine``,
    ``warehouse``. Unknown keys return False (fail-closed).
    """
    from ..config import settings

    key = (feature or "").strip().lower()

    if key == "radius":
        if not getattr(settings, "feature_radius_required", False):
            return False
        provider = (getattr(settings, "radius_backend_provider", None) or "mock").lower()
        if provider in _RADIUS_STUB_PROVIDERS:
            return False
        return _radius_backend_constructs()

    if key in ("olt", "olt_provisioning"):
        if not getattr(settings, "feature_olt_provisioning_required", False):
            return False
        return _olt_registry_has_real_driver()

    if key in ("import", "import_engine"):
        if not getattr(settings, "feature_import_engine_enabled", False):
            return False
        return IMPORT_ENGINE_IMPLEMENTED

    if key == "warehouse":
        if not getattr(settings, "feature_warehouse_enabled", False):
            return False
        return WAREHOUSE_IMPLEMENTED

    # Unknown feature → fail-closed.
    return False


# ──────────────────────────────────────────────────────────────────────────
# Audit emit — fresh OwnerSessionLocal, swallow all errors
# ──────────────────────────────────────────────────────────────────────────


async def _emit_blocked_audit(feature: str, reason: str) -> None:
    """Insert a FEATURE_BLOCKED_USE Event on a fresh owner session.

    A fresh session is used (not the caller's request session) because the
    caller is about to abort the request via :class:`FeatureDisabledError`,
    which would roll back any audit row sharing its transaction. Owner session
    is used so the insert is not subject to the request's RLS GUC.

    All exceptions are swallowed — an audit-emit failure must NEVER mask the
    real fail-closed error the caller is about to surface.
    """
    try:
        from sqlalchemy import select

        from ..db import OwnerSessionLocal
        from ..models import Event, Tenant

        async with OwnerSessionLocal() as s:
            # Disable the tenant-filter audit listener for this owner session;
            # we're writing one row per tenant in the worst case (a system-wide
            # block during boot), and the audit listener is for per-request
            # query auditing, not for per-event writes.
            try:
                await s.connection(execution_options={"audit_tenant_filter": False})
            except Exception:
                pass

            # Event.tenant_id is NOT NULL. Pick the first tenant row — in single
            # tenant deployments (M1) this is THE tenant; in future multi-tenant
            # deployments a feature-block is a deployment-wide signal and a
            # representative tenant is acceptable for the audit fence.
            tenant_id = (
                await s.execute(select(Tenant.id).order_by(Tenant.created_at))
            ).scalars().first()
            if tenant_id is None:
                # No tenant rows yet (very early boot) — nothing to attach the
                # event to. Log and bail.
                _log.warning(
                    "feature_gate.blocked feature=%s reason=%s (no tenant row to anchor audit event)",
                    feature, reason,
                )
                return

            s.add(Event(
                tenant_id=tenant_id,
                type="FEATURE_BLOCKED_USE",
                entity_key="feature",
                record_id=None,
                actor_user_id=None,
                data={"feature": feature, "reason": reason},
                event_name="Feature.BlockedUse",
                category="SECURITY",
                schema_version=1,
                actor_type="SYSTEM",
                visibility="INTERNAL",
            ))
            await s.commit()
    except Exception as e:  # pragma: no cover — audit MUST NOT mask the original error
        _log.warning("feature_gate.audit_emit_failed feature=%s err=%s", feature, e)


# ──────────────────────────────────────────────────────────────────────────
# require — raise FeatureDisabledError + audit on disabled
# ──────────────────────────────────────────────────────────────────────────


async def require(feature: str) -> None:
    """Raise :class:`FeatureDisabledError` if ``feature`` is not enabled.

    On disabled, also emits a ``FEATURE_BLOCKED_USE`` audit Event on a fresh
    owner session so we have a forensic trail of the block independent of
    whatever transaction the caller is about to abort.

    Async because the audit emit is async. Call sites in async request
    handlers and async service-action paths await this directly.
    """
    if is_enabled(feature):
        return

    reason = _disabled_reason(feature)
    await _emit_blocked_audit(feature, reason)
    raise FeatureDisabledError(feature, reason)


def _disabled_reason(feature: str) -> str:
    """Short human-readable reason — used in the audit row + exception message."""
    from ..config import settings

    key = (feature or "").strip().lower()
    if key == "radius":
        if not getattr(settings, "feature_radius_required", False):
            return "FEATURE_RADIUS_REQUIRED=false in this deployment"
        provider = (getattr(settings, "radius_backend_provider", None) or "mock").lower()
        if provider in _RADIUS_STUB_PROVIDERS:
            return f"RADIUS backend provider is stub ({provider!r})"
        return "RADIUS backend failed to construct (config error)"

    if key in ("olt", "olt_provisioning"):
        if not getattr(settings, "feature_olt_provisioning_required", False):
            return "FEATURE_OLT_PROVISIONING_REQUIRED=false in this deployment"
        return "No real OLT vendor driver registered (only mock)"

    if key in ("import", "import_engine"):
        if not getattr(settings, "feature_import_engine_enabled", False):
            return "FEATURE_IMPORT_ENGINE_ENABLED=false in this deployment"
        return "Import engine implementation has not landed yet"

    if key == "warehouse":
        if not getattr(settings, "feature_warehouse_enabled", False):
            return "FEATURE_WAREHOUSE_ENABLED=false in this deployment"
        return "Warehouse module has not landed yet"

    return f"Unknown feature key {feature!r}"


# ──────────────────────────────────────────────────────────────────────────
# Convenience wrappers — Packs P3-P6 call these from their handlers
# ──────────────────────────────────────────────────────────────────────────


async def require_radius() -> None:
    """Gate for the RADIUS subsystem (P3)."""
    await require("radius")


async def require_olt_provisioning() -> None:
    """Gate for OLT ONU provisioning + VLAN + line-profile commands (P4)."""
    await require("olt_provisioning")


async def require_import_engine() -> None:
    """Gate for the bulk import pipeline (P5)."""
    await require("import_engine")


async def require_warehouse() -> None:
    """Gate for the warehouse / inventory module (P6)."""
    await require("warehouse")


__all__ = [
    "FeatureDisabledError",
    "IMPORT_ENGINE_IMPLEMENTED",
    "WAREHOUSE_IMPLEMENTED",
    "is_enabled",
    "require",
    "require_radius",
    "require_olt_provisioning",
    "require_import_engine",
    "require_warehouse",
]
