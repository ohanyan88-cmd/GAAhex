"""Coverage for SPEC §5 Workflow Orchestration (Step 4).

Verifies the three pieces that landed in Step 4:

    1. SPEC §5.4 W1..W5 seeds  — 5 workflow_def rows present after boot, each carrying the
                                  Universal Workflow Contract columns (trigger / actions / SLA /
                                  failure_action / owner_module).
    2. Manual trigger          — POST /api/workflow-instances fires a workflow, returns a 201
                                  with the WorkflowInstance row in its final state.
    3. SPEC §3 Stage 8 reuse   — W1's control_gate action delegates to the kernel function
                                  `assert_can_advance_to_scheduling`. With `control_pass=False`
                                  the gate refuses; the workflow surfaces 409 via the router.

The conftest spins a clean test DB and runs the early seeders only — so this suite uses the
in-test SessionLocal pattern (mirroring test_kpi_engine.py) to seed the workflow rows directly
against the admin's tenant before exercising the endpoints.
"""
from __future__ import annotations

import uuid

import pytest

from app.db import SessionLocal
from app.seed_workflows import seed_workflows_if_missing, SPEC_WORKFLOWS


# ---------------------------------------------------------------- bootstrap

@pytest.fixture(scope="session", autouse=True)
async def _seed_workflows(client, admin):
    """Run the SPEC §5 seeder once per test session, against the existing tenant set.

    The seeder iterates over all tenants (the conftest creates one demo tenant + the admin),
    so a single call lays down all 5 SPEC workflows for the admin's tenant. Idempotent on
    re-run via the `(tenant_id, key)` UNIQUE.
    """
    await seed_workflows_if_missing()


# ---------------------------------------------------------------- 1. seeds present

async def test_w1_through_w5_seeded(client, admin):
    """All 5 SPEC §5.4 workflows must show up in GET /api/workflows for the admin's tenant."""
    rows = (await client.get("/api/workflows", headers=admin)).json()
    keys = {r["key"] for r in rows}
    expected = {
        "w1_lead_to_activation",
        "w2_ticket_to_resolution",
        "w3_billing_collection",
        "w4_incident_to_impact",
        "w5_procurement_to_asset",
    }
    assert expected <= keys, f"missing SPEC §5 workflows: {expected - keys}"

    by_key = {r["key"]: r for r in rows}

    # SPEC §5.1 Universal Workflow Contract columns are populated on every §5 row.
    w1 = by_key["w1_lead_to_activation"]
    assert w1["owner_module"] == "Pipeline"
    assert w1["trigger_spec"]["type"] == "record_created"
    assert w1["trigger_spec"]["entity_key"] == "lead"
    assert isinstance(w1["actions_spec"], list) and len(w1["actions_spec"]) >= 4
    assert w1["sla_seconds"] is not None and w1["sla_seconds"] > 0
    # W1 carries the Stage 8 control_gate action.
    action_types = [a["type"] for a in w1["actions_spec"]]
    assert "control_gate" in action_types, "W1 must include a control_gate action (SPEC §3 Stage 8)"

    # SPEC §5.4 owners come straight from the SPEC table.
    assert by_key["w2_ticket_to_resolution"]["owner_module"] == "Tickets"
    assert by_key["w3_billing_collection"]["owner_module"] == "Billing"
    assert by_key["w4_incident_to_impact"]["owner_module"] == "Incidents & Outages"
    assert by_key["w5_procurement_to_asset"]["owner_module"] == "Procurement"


# ---------------------------------------------------------------- 2. manual trigger

async def test_manual_trigger_creates_instance(client, admin):
    """POST /api/workflow-instances with a benign workflow (W2) creates a WorkflowInstance row.

    W2 has no control_gate action so it can complete end-to-end against the admin's tenant
    without an order or control_pass in context — exercising the happy path through the engine.
    """
    body = {
        "workflow_key": "w2_ticket_to_resolution",
        "context": {"ticket_id": str(uuid.uuid4())},
    }
    r = await client.post("/api/workflow-instances", json=body, headers=admin)
    assert r.status_code == 201, r.text
    instance = r.json()
    assert instance["workflow_key"] == "w2_ticket_to_resolution"
    # W2's actions are audit_only / create_task / send_notification — all should complete or
    # short-circuit safely; the final status is either 'completed' (all actions ran) or
    # 'escalated' (a notification def_key was missing and failure_action='escalate'). Both
    # are valid SPEC outcomes; we assert the instance is FORWARD of 'running'.
    assert instance["status"] in ("completed", "escalated"), instance
    # Round-trip the instance via GET to verify the read API stays in sync.
    iid = instance["id"]
    got = (await client.get(f"/api/workflow-instances/{iid}", headers=admin)).json()
    assert got["id"] == iid

    # The list endpoint must include the new instance.
    listed = (await client.get("/api/workflow-instances", headers=admin)).json()
    assert any(i["id"] == iid for i in listed)


# ---------------------------------------------------------------- 3. Stage 8 reuse

async def test_w1_control_gate_refuses_when_pass_false(client, admin):
    """SPEC §3 Stage 8 — W1's control_gate action delegates to the kernel function.

    Triggering W1 with `control_pass=False` in context must result in 409 from the gate,
    proving that:
      a) the engine's control_gate handler is wired to assert_can_advance_to_scheduling,
      b) the kernel function is the SINGLE source of truth (no second gate exists), and
      c) failure_action='retry' on W1 surfaces the failure cleanly (not silently swallowed).
    """
    body = {
        "workflow_key": "w1_lead_to_activation",
        "context": {
            "order_id": str(uuid.uuid4()),
            "control_pass": False,    # the kernel gate refuses NULL and FALSE; only TRUE passes
        },
    }
    r = await client.post("/api/workflow-instances", json=body, headers=admin)
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    # The kernel's exception text mentions SPEC §3 Stage 8 — the workflow engine surfaces it as-is.
    assert "Stage 8" in detail or "control_pass" in detail


async def test_w1_control_gate_refuses_when_pass_null(client, admin):
    """A NULL control_pass (pending validation) is also refused — the gate only opens on literal TRUE.
    This is the most common live state: Revenue Control hasn't issued a verdict yet."""
    body = {
        "workflow_key": "w1_lead_to_activation",
        "context": {
            "order_id": str(uuid.uuid4()),
            # control_pass omitted → reads as None in context → gate refuses
        },
    }
    r = await client.post("/api/workflow-instances", json=body, headers=admin)
    assert r.status_code == 409, r.text


# ---------------------------------------------------------------- bonus: catalog completeness

async def test_seed_spec_workflows_module_has_all_five():
    """Sanity check the SPEC_WORKFLOWS list itself — keys + owners must match SPEC §5.4."""
    keys = {wf["key"] for wf in SPEC_WORKFLOWS}
    assert keys == {
        "w1_lead_to_activation",
        "w2_ticket_to_resolution",
        "w3_billing_collection",
        "w4_incident_to_impact",
        "w5_procurement_to_asset",
    }
    # Every workflow declares the full Universal Workflow Contract surface.
    for wf in SPEC_WORKFLOWS:
        for required in ("trigger_spec", "conditions_spec", "actions_spec", "owner_module",
                         "sla_seconds", "approval_required", "notification_def_key",
                         "failure_action"):
            assert required in wf, f"{wf['key']} missing {required}"
