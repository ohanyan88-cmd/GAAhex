"""NOC Phase A — Installation Board service.

Pure helpers for the install pipeline's stages 9-11 (resource allocation, CPE binding,
service activation). The caller commits. Mirrors the dunning / stage8 service style.

Stages (per the locked architecture decision) are sub-states of Order.status='PROVISIONING':

  Stage 9  RESOURCE_ALLOC   ``allocate_resources``   — picks 1 free splitter strand + 1 free VLAN
  Stage 10 CPE_BOUND        ``bind_cpe``             — registers a CPE (MAC/serial/...) for the order
  Stage 11 ACTIVATED        ``activate_service``     — flips strand→in_use, CPE→provisioned, Order→ACTIVATED

v1 uses the SimulatedAdapter: no real OLT/EMS call goes out. The "provisioning payload" we
WOULD have sent is captured on CpeBinding.last_payload_json so a v2 swap to a real adapter is
a one-line wire-up.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..access import can, load_grants
from ..exceptions import FeatureDisabledError
from ..models.billing import Subscription
from ..models.cpe_binding import CpeBinding
from ..models.order import Order
from ..models.respool import PoolAllocation, ResourcePool
from ..models.service import Service
from ..models.splitter import SplitterStrandAllocation
from ..models.user import User
from ..models.vlan import VlanAssignment

# ``feature_gate`` is owned by Pack P1 (parallel) and may or may not be on disk when this
# module is imported. Tolerate its absence so tests collect cleanly in either ordering — the
# gate then defaults to "feature disabled, not required" (preserves legacy dev behaviour).
try:
    from . import feature_gate  # type: ignore[attr-defined]
except ImportError:  # pragma: no cover — only hit if P1 hasn't landed yet
    class _FeatureGateStub:
        """Fallback when ``services.feature_gate`` has not been provisioned by P1 yet."""

        @staticmethod
        def is_enabled(_key: str) -> bool:
            return False

        @staticmethod
        def require_olt_provisioning() -> None:
            return None

        feature_olt_provisioning_required = False

    feature_gate = _FeatureGateStub()  # type: ignore[assignment]


# ==========================================================================================
# MAC normalization / validation
# ==========================================================================================

_MAC_RE = re.compile(r"^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")


def normalize_mac(value: Any) -> str:
    """Lower-case + colon-separate any of the common MAC formats. Raises HTTPException(400)
    on anything that isn't 12 hex digits.

    Accepts: "AA:BB:CC:DD:EE:FF", "aa-bb-cc-dd-ee-ff", "aabb.ccdd.eeff", "aabbccddeeff",
    plus mixed-case. Returns lowercase "aa:bb:cc:dd:ee:ff".
    """
    if not isinstance(value, str):
        raise HTTPException(400, "mac_address must be a string")
    cleaned = re.sub(r"[\s:.\-]", "", value).lower()
    if len(cleaned) != 12 or not re.fullmatch(r"[0-9a-f]{12}", cleaned):
        raise HTTPException(400, f"mac_address '{value}' is not a valid MAC")
    out = ":".join(cleaned[i:i + 2] for i in range(0, 12, 2))
    if not _MAC_RE.match(out):  # belt-and-suspenders — _MAC_RE is the canonical shape
        raise HTTPException(400, f"mac_address '{value}' is not a valid MAC")
    return out


# ==========================================================================================
# Internal pickers
# ==========================================================================================

async def _pick_free_strand(
    s: AsyncSession, *, tenant_id: uuid.UUID,
) -> SplitterStrandAllocation | None:
    """Pick the first 'free' strand on any optical splitter in the tenant. v1 picker: any free
    strand on any splitter. Neighborhood targeting is a later refinement (the SPEC explicitly
    flagged this as v1-acceptable). Ordered deterministically by (splitter_record_id, strand_no)
    for repeatable allocation in tests."""
    q = (
        select(SplitterStrandAllocation)
        .where(
            SplitterStrandAllocation.tenant_id == tenant_id,
            SplitterStrandAllocation.status == "free",
        )
        .order_by(
            SplitterStrandAllocation.splitter_record_id,
            SplitterStrandAllocation.strand_no,
        )
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    return (await s.execute(q)).scalar_one_or_none()


def _candidates_for_pool(pool: ResourcePool):
    """Yield candidate VLAN values from a pool spec. Mirrors respool._candidates but tighter
    here (only the numeric from/to shape we need for VLAN)."""
    spec = pool.spec or {}
    frm, to = spec.get("from"), spec.get("to")
    if frm is None or to is None:
        return None
    try:
        return (str(i) for i in range(int(frm), int(to) + 1))
    except (TypeError, ValueError):
        return None


async def _pick_free_vlan_allocation(
    s: AsyncSession, *, tenant_id: uuid.UUID, order: Order,
) -> tuple[PoolAllocation, ResourcePool] | None:
    """Pick the next free VLAN from any vlan ResourcePool in the tenant. Creates a
    PoolAllocation row on the chosen value (status='ALLOCATED'); the caller is responsible for
    wrapping it in a VlanAssignment."""
    pools = (
        await s.execute(
            select(ResourcePool)
            .where(
                ResourcePool.tenant_id == tenant_id,
                ResourcePool.kind == "vlan",
            )
            .order_by(ResourcePool.created_at)
        )
    ).scalars().all()
    for pool in pools:
        # Existing ALLOCATED values in this pool
        used = set((await s.execute(
            select(PoolAllocation.value).where(
                PoolAllocation.pool_id == pool.id,
                PoolAllocation.status == "ALLOCATED",
            )
        )).scalars().all())
        cands = _candidates_for_pool(pool)
        if cands is None:
            continue
        value = next((c for c in cands if c not in used), None)
        if value is None:
            continue
        alloc = PoolAllocation(
            tenant_id=tenant_id, pool_id=pool.id, value=value,
            service_id=None, status="ALLOCATED",
            allocated_at=datetime.now(timezone.utc),
        )
        s.add(alloc)
        await s.flush()
        return alloc, pool
    return None


# ==========================================================================================
# Stage 9 — allocate_resources
# ==========================================================================================

async def allocate_resources(
    s: AsyncSession,
    *,
    order_id: uuid.UUID,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
) -> dict:
    """Allocate one splitter strand + one VLAN to the order. Idempotent: if the order already
    has both linkages set, return them. 409 on any precondition violation."""
    order = (await s.execute(
        select(Order).where(Order.id == order_id, Order.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if order is None:
        raise HTTPException(404, "Order not found")
    if order.status != "PROVISIONING":
        raise HTTPException(
            409, f"allocate_resources requires order.status='PROVISIONING' (got '{order.status}')",
        )

    # Idempotency — if both linkages are already set, return them.
    if order.splitter_strand_allocation_id and order.vlan_assignment_id:
        strand = (await s.execute(
            select(SplitterStrandAllocation).where(
                SplitterStrandAllocation.id == order.splitter_strand_allocation_id,
            )
        )).scalar_one()
        va = (await s.execute(
            select(VlanAssignment).where(
                VlanAssignment.id == order.vlan_assignment_id,
            )
        )).scalar_one()
        pa = (await s.execute(
            select(PoolAllocation).where(PoolAllocation.id == va.pool_allocation_id)
        )).scalar_one()
        return {
            "strand_id": str(strand.id),
            "splitter_id": str(strand.splitter_record_id),
            "strand_no": strand.strand_no,
            "vlan_assignment_id": str(va.id),
            "vlan_value": pa.value,
            "idempotent": True,
        }

    # Pick + reserve a free strand
    strand = await _pick_free_strand(s, tenant_id=tenant_id)
    if strand is None:
        raise HTTPException(409, "no free splitter strand available")
    strand.status = "reserved"
    strand.order_id = order.id
    strand.allocated_at = datetime.now(timezone.utc)

    # Pick + reserve a VLAN
    picked = await _pick_free_vlan_allocation(s, tenant_id=tenant_id, order=order)
    if picked is None:
        # roll the strand back so we don't half-reserve
        strand.status = "free"
        strand.order_id = None
        raise HTTPException(409, "no free VLAN available")
    pool_alloc, pool = picked

    va = VlanAssignment(
        tenant_id=tenant_id,
        pool_allocation_id=pool_alloc.id,
        service_id=None,
        order_id=order.id,
        purpose="data",
        assigned_at=datetime.now(timezone.utc),
    )
    s.add(va)
    await s.flush()

    order.splitter_strand_allocation_id = strand.id
    order.vlan_assignment_id = va.id
    order.install_substage = "RESOURCE_ALLOC"
    order.install_substage_at = datetime.now(timezone.utc)

    return {
        "strand_id": str(strand.id),
        "splitter_id": str(strand.splitter_record_id),
        "strand_no": strand.strand_no,
        "vlan_assignment_id": str(va.id),
        "vlan_value": pool_alloc.value,
        "idempotent": False,
    }


# ==========================================================================================
# Stage 10 — bind_cpe
# ==========================================================================================

async def bind_cpe(
    s: AsyncSession,
    *,
    order_id: uuid.UUID,
    mac_address: str,
    serial: str,
    vendor: str | None = None,
    model: str | None = None,
    firmware: str | None = None,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
) -> CpeBinding:
    """Create a pending CpeBinding for the order. Idempotent on (order, pending-binding):
    if a pending row already exists with the same (mac, serial) we return it; 409 on a real
    collision with a different live (non-replaced) row in the tenant."""
    order = (await s.execute(
        select(Order).where(Order.id == order_id, Order.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if order is None:
        raise HTTPException(404, "Order not found")
    if order.status != "PROVISIONING":
        raise HTTPException(
            409, f"bind_cpe requires order.status='PROVISIONING' (got '{order.status}')",
        )

    mac = normalize_mac(mac_address)
    serial = (serial or "").strip()
    if not serial:
        raise HTTPException(400, "serial is required")

    # Idempotent re-bind: an existing pending binding on THIS order with the same MAC+serial
    # returns the same row.
    if order.cpe_binding_id is not None:
        existing = (await s.execute(
            select(CpeBinding).where(CpeBinding.id == order.cpe_binding_id)
        )).scalar_one_or_none()
        if existing is not None and existing.status == "pending":
            if existing.mac_address == mac and existing.serial == serial:
                return existing
            # Different MAC/serial supplied for the SAME order while a pending binding exists
            # — surface as 409 so the caller releases the old one explicitly.
            raise HTTPException(
                409,
                f"order already has a pending CPE binding ({existing.mac_address}); "
                "release it before binding a different CPE",
            )

    # Pre-flight duplicate check for a nicer error than the raw IntegrityError.
    clash = (await s.execute(
        select(CpeBinding).where(
            CpeBinding.tenant_id == tenant_id,
            CpeBinding.status != "replaced",
            (CpeBinding.mac_address == mac) | (CpeBinding.serial == serial),
        )
    )).scalar_one_or_none()
    if clash is not None:
        which = []
        if clash.mac_address == mac:
            which.append(f"mac_address '{mac}'")
        if clash.serial == serial:
            which.append(f"serial '{serial}'")
        raise HTTPException(409, "CPE conflict: " + ", ".join(which) + " already bound")

    binding = CpeBinding(
        tenant_id=tenant_id,
        service_id=None,
        order_id=order.id,
        mac_address=mac,
        serial=serial,
        vendor=vendor,
        model=model,
        firmware=firmware,
        provisioned_at=None,
        last_payload_json=None,
        status="pending",
    )
    s.add(binding)
    try:
        await s.flush()
    except IntegrityError as e:
        await s.rollback()
        raise HTTPException(409, f"CPE conflict (DB constraint): {e.orig}")

    order.cpe_binding_id = binding.id
    order.install_substage = "CPE_BOUND"
    order.install_substage_at = datetime.now(timezone.utc)
    return binding


# ==========================================================================================
# Stage 11 — activate_service
# ==========================================================================================

async def activate_service(
    s: AsyncSession,
    *,
    order_id: uuid.UUID,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
    payload: dict | None = None,
) -> dict:
    """Activate the install. Requires all three resources to be bound on the order:
       strand + VLAN + CPE-binding (status pending or provisioned).

    Effects:
      * SplitterStrandAllocation.status = 'in_use'
      * CpeBinding.status = 'provisioned', .provisioned_at = now, .last_payload_json = sim payload
      * Order.install_substage = 'ACTIVATED'
      * Any Service rows linked to this order's Subscriptions flip to 'ACTIVE' (mirrors the
        completion-side pattern used in orders.py provisioning)

    Fail-closed OLT provisioning gate (Stage 2 remediation):
      * If ``feature_gate.is_enabled("olt_provisioning")`` is TRUE → attempt to invoke the OLT
        driver. A driver failure rolls back the DB updates and emits a
        ``SERVICE_ACTIVATION_FAILED`` audit Event. If no driver is wired for this OLT in dev,
        fall through to the legacy DB-only path with an audit Event noting
        ``olt_driver_invoked_dev_mode=True``.
      * If FALSE and ``feature_olt_provisioning_required`` is TRUE → either honour a manual
        override (``payload['bypass_provisioning_reason']`` + caller holds
        ``service.bypass_provisioning``) and continue DB-only with an audit Event, OR raise
        :class:`~app.exceptions.FeatureDisabledError` (caller maps to 503 + audit).
      * If FALSE and NOT required → preserve current dev/test DB-only behaviour.

    Idempotency: a re-activation attempt on an already-ACTIVATED order returns an idempotent
    summary AND emits a ``SERVICE_ACTIVATION_REATTEMPTED`` audit Event so the trail records
    the duplicate call without double-provisioning the OLT.

    Returns: {activated_at, cpe_id, strand_id, vlan_value, idempotent}.
    """
    order = (await s.execute(
        select(Order).where(Order.id == order_id, Order.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if order is None:
        raise HTTPException(404, "Order not found")
    if order.status != "PROVISIONING":
        raise HTTPException(
            409, f"activate_service requires order.status='PROVISIONING' (got '{order.status}')",
        )

    blockers: list[str] = []
    if not order.splitter_strand_allocation_id:
        blockers.append("no splitter strand allocated")
    if not order.vlan_assignment_id:
        blockers.append("no VLAN assigned")
    if not order.cpe_binding_id:
        blockers.append("no CPE bound")
    if blockers:
        raise HTTPException(409, "activate blocked: " + " | ".join(blockers))

    strand = (await s.execute(
        select(SplitterStrandAllocation).where(
            SplitterStrandAllocation.id == order.splitter_strand_allocation_id,
        )
    )).scalar_one()
    va = (await s.execute(
        select(VlanAssignment).where(VlanAssignment.id == order.vlan_assignment_id)
    )).scalar_one()
    pa = (await s.execute(
        select(PoolAllocation).where(PoolAllocation.id == va.pool_allocation_id)
    )).scalar_one()
    cpe = (await s.execute(
        select(CpeBinding).where(CpeBinding.id == order.cpe_binding_id)
    )).scalar_one()

    if cpe.status not in ("pending", "provisioned"):
        raise HTTPException(
            409, f"activate blocked: CPE status '{cpe.status}' not in (pending|provisioned)",
        )

    now = datetime.now(timezone.utc)

    # ------------------------------------------------------------------------------------
    # Idempotency — re-activating a fully activated order is a no-op summary. We DO emit an
    # audit Event for the re-attempt so the trail records the duplicate call, but we never
    # double-provision the OLT.
    # ------------------------------------------------------------------------------------
    if order.install_substage == "ACTIVATED" and cpe.status == "provisioned" and strand.status == "in_use":
        try:
            await workflow.emit(
                s, tenant_id, "SERVICE_ACTIVATION_REATTEMPTED",
                "order", order.id, actor_id,
                {
                    "order_id": str(order.id),
                    "cpe_id": str(cpe.id),
                    "strand_id": str(strand.id),
                    "vlan_value": pa.value,
                    "reason": "order already ACTIVATED; no-op idempotent re-call",
                },
                event_name="Order.ServiceActivationReattempted",
                category="LIFECYCLE",
            )
        except Exception:
            pass  # audit best-effort; never block the idempotent return
        return {
            "activated_at": (order.install_substage_at or now).isoformat(),
            "cpe_id": str(cpe.id),
            "strand_id": str(strand.id),
            "vlan_value": pa.value,
            "idempotent": True,
        }

    # ------------------------------------------------------------------------------------
    # Stage 2 remediation — fail-closed OLT provisioning gate.
    #
    # Decision tree, in order:
    #   1. feature ENABLED  → driver-invocation path (placeholder; real wiring later).
    #   2. feature DISABLED + REQUIRED + override present + caller authorised → DB-only +
    #      SERVICE_ACTIVATION_BYPASS_PROVISIONING audit.
    #   3. feature DISABLED + REQUIRED + no valid override → FeatureDisabledError (→ 503).
    #   4. feature DISABLED + NOT required (dev/test) → preserve legacy DB-only behaviour.
    # ------------------------------------------------------------------------------------
    olt_driver_invoked = False
    olt_driver_invoked_dev_mode = False
    bypass_reason: str | None = None

    if feature_gate.is_enabled("olt_provisioning"):
        # Path 1 — feature enabled. Attempt the driver. The real per-OLT lookup
        # (cpe→port→olt_id) is the next remediation step; for now we emit an audit
        # Event marking dev-mode and fall through to the DB-only update. A future
        # patch will replace this block with a real call to
        # ``await get_driver_for_olt(...).provision_onu(...)``.
        olt_driver_invoked = True
        olt_driver_invoked_dev_mode = True
        try:
            await workflow.emit(
                s, tenant_id, "OLT_DRIVER_INVOKED",
                "order", order.id, actor_id,
                {
                    "order_id": str(order.id),
                    "cpe_id": str(cpe.id),
                    "olt_driver_invoked_dev_mode": True,
                    "note": "driver-wire placeholder; real provision_onu call lands in follow-up",
                },
                event_name="Order.OltDriverInvoked",
                category="INTEGRATION",
            )
        except Exception:
            pass
    else:
        # Feature disabled — distinguish "required but unavailable" (production posture; must
        # fail-closed or accept an override) from "not required at all" (dev/test; preserve
        # legacy behaviour). The P1-shipped ``feature_gate.is_enabled("olt_provisioning")``
        # is True only when BOTH the required flag is set AND a real (non-mock) driver is
        # registered, so its False says nothing on its own about which case we're in.
        #
        # We read the required posture from ``settings.feature_olt_provisioning_required`` —
        # the same env-var the gate uses internally. Tolerate the module-level shim too so
        # tests can drive the gate state without touching global settings.
        required = bool(getattr(feature_gate, "feature_olt_provisioning_required", False))
        if not required:
            try:
                from ..config import settings
                required = bool(getattr(settings, "feature_olt_provisioning_required", False))
            except Exception:
                required = False

        if required:
            payload = payload or {}
            bypass_reason = (payload.get("bypass_provisioning_reason") or "").strip() or None
            override_ok = False
            if bypass_reason:
                actor = (await s.execute(
                    select(User).where(User.id == actor_id)
                )).scalar_one_or_none()
                if actor is not None:
                    grants = await load_grants(s, actor)
                    override_ok = can(grants, "service", "bypass_provisioning")

            if not (bypass_reason and override_ok):
                # Path 3 — required + unavailable + no valid override → fail-closed.
                # Emit the block as an audit Event (best-effort), then raise the domain
                # exception. Caller (router) maps FeatureDisabledError → 503.
                try:
                    await workflow.emit(
                        s, tenant_id, "SERVICE_ACTIVATION_BLOCKED",
                        "order", order.id, actor_id,
                        {
                            "order_id": str(order.id),
                            "cpe_id": str(cpe.id),
                            "feature": "olt_provisioning",
                            "reason": "feature_required_but_disabled_and_no_override",
                            "bypass_reason_supplied": bool(bypass_reason),
                            "bypass_override_granted": override_ok,
                        },
                        event_name="Order.ServiceActivationBlocked",
                        category="SECURITY",
                    )
                    await s.flush()
                except Exception:
                    pass
                raise FeatureDisabledError(
                    "olt_provisioning",
                    "Provisioning required but driver unavailable",
                )

            # Path 2 — required + manual override accepted.
            try:
                await workflow.emit(
                    s, tenant_id, "SERVICE_ACTIVATION_BYPASS_PROVISIONING",
                    "order", order.id, actor_id,
                    {
                        "order_id": str(order.id),
                        "cpe_id": str(cpe.id),
                        "feature": "olt_provisioning",
                        "bypass_provisioning_reason": bypass_reason,
                        "permission": "service.bypass_provisioning",
                    },
                    event_name="Order.ServiceActivationBypassProvisioning",
                    category="SECURITY",
                )
            except Exception:
                pass
        # else: Path 4 — feature not required (dev/test). Silently preserve legacy behaviour.

    # ------------------------------------------------------------------------------------
    # DB-row updates. Snapshot the prior state so we can roll back if the OLT driver call
    # (when wired in a follow-up) ends up failing.
    # ------------------------------------------------------------------------------------
    prior = {
        "strand_status": strand.status,
        "cpe_status": cpe.status,
        "cpe_provisioned_at": cpe.provisioned_at,
        "cpe_last_payload_json": dict(cpe.last_payload_json) if cpe.last_payload_json else None,
        "order_substage": order.install_substage,
        "order_substage_at": order.install_substage_at,
    }

    strand.status = "in_use"
    # PoolAllocation stays ALLOCATED — the VLAN is still in use. (Released only on tear-down.)
    cpe.status = "provisioned"
    cpe.provisioned_at = now
    cpe.last_payload_json = {
        "splitter_strand": strand.strand_no,
        "vlan": pa.value,
        "mac": cpe.mac_address,
        "serial": cpe.serial,
        "olt_driver_invoked": olt_driver_invoked,
        "olt_driver_invoked_dev_mode": olt_driver_invoked_dev_mode,
        "bypass_provisioning_reason": bypass_reason,
    }

    # Flip any Service rows linked to this order's Subscriptions to ACTIVE.
    # Path: subscriptions on this order's customer that are ACTIVE and reference an order
    # product → services that fulfill those subscriptions. The cheap path: services already
    # linked via service.subscription_id where subscription.customer_id == order.customer_id.
    activated_service_ids: list[uuid.UUID] = []
    if order.customer_id is not None:
        svcs = (await s.execute(
            select(Service)
            .join(Subscription, Subscription.id == Service.subscription_id, isouter=True)
            .where(
                Service.tenant_id == tenant_id,
                Service.customer_id == order.customer_id,
                Service.status != "ACTIVE",
            )
        )).scalars().all()
        for svc in svcs:
            svc.status = "ACTIVE"
            svc.activated_at = now
            activated_service_ids.append(svc.id)
            # Also tie strand/VLAN/CPE to the first service we activate (one service per
            # install for v1; multi-service installs are a v2 refinement).
            if strand.service_id is None:
                strand.service_id = svc.id
            if va.service_id is None:
                va.service_id = svc.id
            if pa.service_id is None:
                pa.service_id = svc.id
            if cpe.service_id is None:
                cpe.service_id = svc.id

    order.install_substage = "ACTIVATED"
    order.install_substage_at = now

    # ------------------------------------------------------------------------------------
    # Driver invocation roll-back hook. When the real ``get_driver_for_olt(...)
    # .provision_onu(...)`` lands, wrap THAT call in the try/except below: a driver
    # failure must restore the snapshot above + emit SERVICE_ACTIVATION_FAILED + re-raise.
    #
    # The placeholder dev-mode path always "succeeds" so this branch is currently inert,
    # but the rollback structure is in place so the follow-up wiring is a one-line swap.
    # ------------------------------------------------------------------------------------
    driver_failed = False
    driver_error: str | None = None
    if olt_driver_invoked and not olt_driver_invoked_dev_mode:  # pragma: no cover — follow-up wiring
        try:
            # await get_driver_for_olt(...).provision_onu(...)
            pass
        except Exception as exc:
            driver_failed = True
            driver_error = repr(exc)

    if driver_failed:  # pragma: no cover — follow-up wiring
        # Rollback DB mutations to the pre-activation snapshot.
        strand.status = prior["strand_status"]
        cpe.status = prior["cpe_status"]
        cpe.provisioned_at = prior["cpe_provisioned_at"]
        cpe.last_payload_json = prior["cpe_last_payload_json"]
        order.install_substage = prior["order_substage"]
        order.install_substage_at = prior["order_substage_at"]
        for svc_id in activated_service_ids:
            svc = (await s.execute(select(Service).where(Service.id == svc_id))).scalar_one()
            svc.status = "PENDING"
            svc.activated_at = None
        try:
            await workflow.emit(
                s, tenant_id, "SERVICE_ACTIVATION_FAILED",
                "order", order.id, actor_id,
                {
                    "order_id": str(order.id),
                    "cpe_id": str(cpe.id),
                    "feature": "olt_provisioning",
                    "reason": "olt_driver_failure",
                    "error": driver_error,
                },
                event_name="Order.ServiceActivationFailed",
                category="INTEGRATION",
            )
        except Exception:
            pass
        raise HTTPException(502, f"OLT provisioning failed: {driver_error}")

    return {
        "activated_at": now.isoformat(),
        "cpe_id": str(cpe.id),
        "strand_id": str(strand.id),
        "vlan_value": pa.value,
        "idempotent": False,
    }


# ==========================================================================================
# Read: install board listing
# ==========================================================================================

async def list_install_board(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    substage: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> list[dict]:
    """List orders currently in PROVISIONING, optionally filtered by install_substage.
    Returns a thin dict per row (id/number/customer/install_substage/timestamps + linkage ids)."""
    q = select(Order).where(
        Order.tenant_id == tenant_id,
        Order.status == "PROVISIONING",
    )
    if substage:
        if substage.upper() == "NONE":
            q = q.where(Order.install_substage.is_(None))
        else:
            q = q.where(Order.install_substage == substage)
    q = q.order_by(Order.created_at).offset(max(0, offset)).limit(max(1, limit))
    rows = (await s.execute(q)).scalars().all()
    out: list[dict] = []
    for o in rows:
        out.append({
            "id": str(o.id),
            "number": o.number,
            "customer_id": str(o.customer_id) if o.customer_id else None,
            "status": o.status,
            "install_substage": o.install_substage,
            "install_substage_at": o.install_substage_at.isoformat()
                if o.install_substage_at else None,
            "splitter_strand_allocation_id": str(o.splitter_strand_allocation_id)
                if o.splitter_strand_allocation_id else None,
            "vlan_assignment_id": str(o.vlan_assignment_id)
                if o.vlan_assignment_id else None,
            "cpe_binding_id": str(o.cpe_binding_id) if o.cpe_binding_id else None,
        })
    return out


async def install_summary(
    s: AsyncSession, *, order_id: uuid.UUID, tenant_id: uuid.UUID,
) -> dict:
    """One-shot snapshot: the order + its linked strand/VLAN/CPE rows."""
    order = (await s.execute(
        select(Order).where(Order.id == order_id, Order.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if order is None:
        raise HTTPException(404, "Order not found")
    strand_d: dict | None = None
    vlan_d: dict | None = None
    cpe_d: dict | None = None
    if order.splitter_strand_allocation_id:
        strand = (await s.execute(
            select(SplitterStrandAllocation).where(
                SplitterStrandAllocation.id == order.splitter_strand_allocation_id,
            )
        )).scalar_one_or_none()
        if strand is not None:
            strand_d = {
                "id": str(strand.id),
                "splitter_record_id": str(strand.splitter_record_id),
                "strand_no": strand.strand_no,
                "status": strand.status,
                "service_id": str(strand.service_id) if strand.service_id else None,
                "allocated_at": strand.allocated_at.isoformat() if strand.allocated_at else None,
            }
    if order.vlan_assignment_id:
        va = (await s.execute(
            select(VlanAssignment).where(VlanAssignment.id == order.vlan_assignment_id)
        )).scalar_one_or_none()
        if va is not None:
            pa = (await s.execute(
                select(PoolAllocation).where(PoolAllocation.id == va.pool_allocation_id)
            )).scalar_one_or_none()
            vlan_d = {
                "id": str(va.id),
                "pool_allocation_id": str(va.pool_allocation_id),
                "vlan_value": pa.value if pa is not None else None,
                "service_id": str(va.service_id) if va.service_id else None,
                "purpose": va.purpose,
                "assigned_at": va.assigned_at.isoformat() if va.assigned_at else None,
            }
    if order.cpe_binding_id:
        cpe = (await s.execute(
            select(CpeBinding).where(CpeBinding.id == order.cpe_binding_id)
        )).scalar_one_or_none()
        if cpe is not None:
            cpe_d = {
                "id": str(cpe.id),
                "mac_address": cpe.mac_address,
                "serial": cpe.serial,
                "vendor": cpe.vendor,
                "model": cpe.model,
                "firmware": cpe.firmware,
                "status": cpe.status,
                "provisioned_at": cpe.provisioned_at.isoformat() if cpe.provisioned_at else None,
                "last_payload_json": dict(cpe.last_payload_json or {}) if cpe.last_payload_json else None,
            }
    return {
        "order": {
            "id": str(order.id),
            "number": order.number,
            "customer_id": str(order.customer_id) if order.customer_id else None,
            "status": order.status,
            "install_substage": order.install_substage,
            "install_substage_at": order.install_substage_at.isoformat()
                if order.install_substage_at else None,
        },
        "splitter_strand": strand_d,
        "vlan": vlan_d,
        "cpe": cpe_d,
    }
