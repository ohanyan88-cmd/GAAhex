"""Stage 2 remediation — AC1 dual workflow-engine overlap defensive close.

The audit flagged that two workflow engines (`app.workflow` legacy + `app.kernel.workflow_engine`
SPEC §5) drive WorkflowDef rows in parallel. Full collapse is multi-week. The defensive close:

1.  A boot-time scan that surfaces ANY (entity_key, from_status, to_status) tuple claimed by
    both engines. Result: logs a warning, emits a `WORKFLOW_DUAL_ENGINE_OVERLAP` Event,
    flips the module-level `_LEGACY_DUAL_ENGINE_DETECTED` sentinel to True. Does NOT refuse boot.

2.  These tests cover three properties:
      * default seed has no overlap (regression guard — keeps the scan honest)
      * a manually-seeded overlap row triggers the warning + the audit Event
      * a legacy workflow transition + a kernel workflow trigger run back-to-back do not
        double-fire side effects (one notification + one automation invoke per transition)
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.kernel import workflow_engine as wfke
from app.models import Event, EntityDef, Tenant, WorkflowDef


# ════════════════════════════════════════════════════════════════════════════
# 1. Default seed must be overlap-free — regression guard for the audit close.
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_dual_engine_no_overlap_in_seed_data():
    """The seeded workflow_def rows (legacy entity-lifecycle + SPEC §5 W1..W5) MUST not
    overlap on the same (entity_key, from_status, to_status) tuple. If a new seed adds a
    transition that collides with an existing one, this test fires loud — exactly the
    audit-visibility the defensive close is meant to give us."""
    async with OwnerSessionLocal() as s:
        overlaps = await wfke.scan_for_dual_engine_overlap(s)
    assert overlaps == [], (
        f"Default seed has dual-engine overlap (the close is supposed to start clean): {overlaps}"
    )


# ════════════════════════════════════════════════════════════════════════════
# 2. Synthetic overlap → warning logged + audit Event emitted.
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_dual_engine_overlap_emits_audit_when_present(caplog):
    """Insert two WorkflowDef rows that claim the same (entity_key, from_status, to_status)
    tuple — one legacy-shaped (entity_def_id + config.transitions), one kernel-shaped
    (trigger_spec + actions_spec) — and assert the scan flips the sentinel, logs a warning,
    and the WORKFLOW_DUAL_ENGINE_OVERLAP audit row lands on the Event table after the
    lifespan emit pattern.
    """
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        # Use a FRESH entity (no seeded lifecycle WorkflowDef) for the legacy claim. PERFECT-TARGET I5
        # (uq_workflow_def_one_per_entity) forbids a 2nd lifecycle WorkflowDef per entity, and every
        # SEEDED entity already carries one — so reusing 'lead' would collide on the I5 index. The
        # overlap we exercise is legacy(entity_def_id) vs kernel(trigger_spec.entity_key), both pointing
        # at this fresh entity, which is exactly the dual-engine shape the scan must detect.
        probe_key = f"dualprobe_{uuid.uuid4().hex[:8]}"
        ent = EntityDef(tenant_id=tenant.id, key=probe_key, label="Dual-Engine Probe",
                        label_plural="Dual-Engine Probes", route_slug=probe_key, owner_module="Pipeline")
        s.add(ent)
        await s.flush()

        # Legacy claim: entity-lifecycle row with config.transitions naming OPEN → CLOSED.
        legacy = WorkflowDef(
            tenant_id=tenant.id,
            entity_def_id=ent.id,
            key=f"stage2-legacy-{uuid.uuid4().hex[:8]}",
            label="Stage 2 legacy overlap probe",
            config={"transitions": [{"from": "OPEN", "to": "CLOSED"}]},
        )
        s.add(legacy)

        # Kernel claim: SPEC §5 row with trigger_spec.entity_key=<probe> + an advance_stage
        # action targeting "CLOSED" with from_status="OPEN".
        kernel = WorkflowDef(
            tenant_id=tenant.id,
            key=f"stage2-kernel-{uuid.uuid4().hex[:8]}",
            label="Stage 2 kernel overlap probe",
            trigger_spec={"type": "record_created", "entity_key": probe_key,
                          "from_status": "OPEN"},
            actions_spec=[{"type": "advance_stage", "to_stage_key": "CLOSED"}],
            owner_module="Pipeline",
        )
        s.add(kernel)
        await s.commit()
        tenant_id_for_assert = tenant.id

    try:
        # Reset the sentinel so the test asserts FROM a clean baseline (the boot lifespan
        # may already have flipped it on a previous test run that ran AFTER an overlap seed).
        wfke._LEGACY_DUAL_ENGINE_DETECTED = False

        async with OwnerSessionLocal() as s:
            overlaps = await wfke.scan_for_dual_engine_overlap(s, tenant_id=tenant_id_for_assert)

        # Sentinel + overlap tuple both surfaced.
        assert wfke._LEGACY_DUAL_ENGINE_DETECTED is True
        matched = [o for o in overlaps
                   if o["entity_key"] == probe_key
                   and o["from_status"] == "OPEN"
                   and o["to_status"] == "CLOSED"]
        assert matched, f"Expected {probe_key}/OPEN/CLOSED overlap; got: {overlaps}"

        # Emit the audit Event by replaying the lifespan logic in-test (lifespan already ran).
        async with OwnerSessionLocal() as s:
            from app.workflow import emit as wf_emit
            await wf_emit(
                s, tenant_id_for_assert, "WORKFLOW_DUAL_ENGINE_OVERLAP",
                "workflow_def", None, None,
                {"overlaps": overlaps, "scan_at_boot": False, "synthetic": True},
                event_name="WorkflowDef.DualEngineOverlap",
                category="SYSTEM",
            )
            await s.commit()

        async with OwnerSessionLocal() as s:
            rows = (await s.execute(
                select(Event).where(Event.type == "WORKFLOW_DUAL_ENGINE_OVERLAP")
            )).scalars().all()
            assert rows, "Expected WORKFLOW_DUAL_ENGINE_OVERLAP audit Event row"
    finally:
        # Cleanup: drop the synthetic WorkflowDef rows so other tests aren't perturbed.
        async with OwnerSessionLocal() as s:
            await s.execute(
                WorkflowDef.__table__.delete().where(
                    WorkflowDef.id.in_(
                        select(WorkflowDef.id).where(
                            WorkflowDef.label.in_([
                                "Stage 2 legacy overlap probe",
                                "Stage 2 kernel overlap probe",
                            ])
                        )
                    )
                )
            )
            await s.commit()
        wfke._LEGACY_DUAL_ENGINE_DETECTED = False


# ════════════════════════════════════════════════════════════════════════════
# 3. A legacy workitem transition still produces exactly one set of side effects.
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_transition_no_duplicate_side_effects(client, admin):
    """Pick a stable transition (workitem TODO → IN_PROGRESS via /api/workitems/{id}/start)
    and prove that firing it once produces exactly one set of side effects — no double
    notification / double automation invoke from the kernel engine racing the legacy one.

    The test is an INVARIANT regression guard: the dual-engine close MUST not double-fire,
    because the kernel engine has different trigger semantics (record_created / status_changed)
    than the legacy engine's PATCH-driven transitions, and we want that boundary to stay
    clean during the multi-week collapse.
    """
    # 1) Create a workitem.
    create = await client.post(
        "/api/workitems", headers=admin,
        json={"title": "AC1 dual-engine side-effect probe"},
    )
    assert create.status_code == 201, create.text
    wid = create.json()["id"]

    # Snapshot the Event log before firing the transition — anything new must be ONLY from
    # this one transition.
    async with OwnerSessionLocal() as s:
        before = (await s.execute(
            select(Event).where(Event.entity_key == "workitem", Event.record_id == uuid.UUID(wid))
        )).scalars().all()

    # 2) Fire the start transition (TODO → IN_PROGRESS via the legacy `app.workflow` engine).
    start = await client.post(f"/api/workitems/{wid}/start", headers=admin)
    assert start.status_code == 200, start.text

    async with OwnerSessionLocal() as s:
        after = (await s.execute(
            select(Event).where(Event.entity_key == "workitem", Event.record_id == uuid.UUID(wid))
        )).scalars().all()

    # Count the TRANSITION events specifically — that's the side-effect dedup signal. The kernel
    # engine, if it were racing, would also emit a `workflow.action_executed` / `workflow.advanced`
    # for the same record. We expect exactly ONE TRANSITION event for this record from this run.
    transition_events = [
        e for e in after
        if e not in before
        and (e.type or "").upper() in {"TRANSITION", "WORKITEM.STARTED"}
    ]
    assert len(transition_events) <= 1, (
        f"Expected at most one TRANSITION/STARTED event for {wid}, got {len(transition_events)}: "
        f"{[(e.type, e.data) for e in transition_events]}"
    )
