"""SPEC §5 Workflow Orchestration — read API + manual trigger.

Endpoints (all tenant-scoped via the caller's session; mounted in main.py BEFORE the generic
`/api/{slug}` records router so the fixed paths are not swallowed):

    GET    /api/workflows                  → list workflow_def rows (W1..W5 + legacy lifecycle rows)
    GET    /api/workflow-instances         → list runtime instances, newest first
    GET    /api/workflow-instances/{id}    → instance detail
    POST   /api/workflow-instances         → manually trigger a workflow (admin only)

The POST manual-trigger path is gated by `assert_can(action='manage', entity_key='workflow')`.
Holders of the existing `super_admin` role have wildcard grants and so pass through; tenants who
want a dedicated trigger role can add `workflow.manage` to a Studio-built role at any time.

Engine reuse: this router NEVER re-implements workflow logic. The POST handler delegates to
`app.kernel.trigger_workflow`, which is the single SOT. The SPEC §3 Stage 8 control gate is
similarly delegated via the workflow engine's `control_gate` action → kernel.control_gate.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, WorkflowDef, WorkflowInstance
from ..kernel import (
    AccessDenied,
    assert_can,
    trigger_workflow,
    WorkflowExecutionError,
)
from ..kernel.control_gate import ControlGateNotPassed
from .auth import current_user


router = APIRouter(prefix="/api", tags=["workflows"])


# --------------------------------------------------------------------------- serializers

def _serialize_def(w: WorkflowDef) -> dict:
    """Flat shape for `workflow_def` — legacy lifecycle rows and SPEC §5 rows both serialize
    cleanly. SPEC §5 fields are None on legacy rows; `config` is None on SPEC §5 rows."""
    return {
        "id": str(w.id),
        "tenant_id": str(w.tenant_id),
        "entity_def_id": str(w.entity_def_id) if w.entity_def_id else None,
        "key": w.key,
        "label": w.label,
        "config": w.config,
        "trigger_spec": w.trigger_spec,
        "conditions_spec": w.conditions_spec,
        "actions_spec": w.actions_spec,
        "owner_module": w.owner_module,
        "sla_seconds": w.sla_seconds,
        "approval_required": w.approval_required,
        "notification_def_key": w.notification_def_key,
        "failure_action": w.failure_action,
        "created_at": w.created_at.isoformat() if w.created_at else None,
    }


def _serialize_instance(i: WorkflowInstance) -> dict:
    """Flat shape for one runtime instance row. Mirrors WorkflowInstance model fields 1:1."""
    return {
        "id": str(i.id),
        "tenant_id": str(i.tenant_id),
        "workflow_key": i.workflow_key,
        "triggered_by_record_id": str(i.triggered_by_record_id) if i.triggered_by_record_id else None,
        "triggered_at": i.triggered_at.isoformat() if i.triggered_at else None,
        "status": i.status,
        "current_action_index": i.current_action_index,
        "context": i.context or {},
        "sla_breached_at": i.sla_breached_at.isoformat() if i.sla_breached_at else None,
        "completed_at": i.completed_at.isoformat() if i.completed_at else None,
        "failure_reason": i.failure_reason,
    }


# --------------------------------------------------------------------------- endpoints

@router.get("/workflows")
async def list_workflows(
    owner_module: Optional[str] = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List workflow_def rows for the caller's tenant.

    Query params:
        owner_module: optional filter — return only rows whose `owner_module` matches.

    Both SPEC §5 cross-entity workflows (W1..W5 with entity_def_id=NULL) and legacy
    entity-lifecycle workflows (with entity_def_id set + a transitions `config` blob) appear
    in the same list — the SPEC §5 columns are simply None on legacy rows.
    """
    q = select(WorkflowDef).where(WorkflowDef.tenant_id == user.tenant_id)
    if owner_module:
        q = q.where(WorkflowDef.owner_module == owner_module)
    q = q.order_by(WorkflowDef.key.asc())
    rows = (await s.execute(q)).scalars().all()
    return [_serialize_def(w) for w in rows]


@router.get("/workflow-instances")
async def list_workflow_instances(
    status: Optional[str] = None,
    workflow_key: Optional[str] = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List runtime workflow_instance rows, newest first.

    Query params:
        status:       optional filter — running | completed | failed | escalated.
        workflow_key: optional filter — limit to one workflow def's instances.
    """
    q = select(WorkflowInstance).where(WorkflowInstance.tenant_id == user.tenant_id)
    if status:
        q = q.where(WorkflowInstance.status == status)
    if workflow_key:
        q = q.where(WorkflowInstance.workflow_key == workflow_key)
    q = q.order_by(WorkflowInstance.triggered_at.desc())
    rows = (await s.execute(q)).scalars().all()
    return [_serialize_instance(i) for i in rows]


@router.get("/workflow-instances/{instance_id}")
async def get_workflow_instance(
    instance_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Get one runtime workflow_instance row. 404 if not in caller's tenant."""
    row = (await s.execute(
        select(WorkflowInstance).where(
            WorkflowInstance.id == instance_id,
            WorkflowInstance.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Workflow instance not found")
    return _serialize_instance(row)


# ---- manual trigger (admin-only)

class TriggerIn(BaseModel):
    """Body for POST /api/workflow-instances — fire one workflow manually.

    `context` is passed through to the engine and onto each action handler. It is the place to
    supply e.g. `{"order_id": "...", "control_pass": True}` so W1's Stage 8 action can read its
    inputs out of context.
    """
    workflow_key: str = Field(..., description="workflow_def.key — e.g. 'w1_lead_to_activation'")
    context: dict | None = Field(default=None, description="passed to every action handler")
    triggered_by_record_id: uuid.UUID | None = Field(
        default=None, description="optional record that triggered this run (for correlation)"
    )


@router.post("/workflow-instances", status_code=201)
async def trigger_workflow_manually(
    body: TriggerIn,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Manually trigger a workflow run. Admin-only (gated via `workflow.manage`).

    Returns the created `WorkflowInstance` row in its final state — usually status='completed'
    on a happy path, or 409 with the failure reason when an action raised and the def's
    `failure_action` is anything other than `audit_only`.

    Maps:
        AccessDenied            → 403   (caller lacks `workflow.manage`)
        ControlGateNotPassed    → 409   (SPEC §3 Stage 8 — control_pass != TRUE; the kernel
                                          gate raised; failure_reason carries the order_id)
        WorkflowExecutionError  → 409   (any other engine-level error: missing def, conditions
                                          failed, action exception)
    """
    try:
        await assert_can(s, user, action="manage", entity_key="workflow")
    except AccessDenied as e:
        raise HTTPException(403, str(e))

    try:
        instance = await trigger_workflow(
            s,
            tenant_id=user.tenant_id,
            workflow_key=body.workflow_key,
            context=body.context or {},
            triggered_by_record_id=body.triggered_by_record_id,
            actor_user_id=user.id,
        )
    except ControlGateNotPassed as e:
        # SPEC §3 Stage 8 — 409 Conflict per the kernel's class docstring.
        raise HTTPException(409, str(e))
    except WorkflowExecutionError as e:
        raise HTTPException(409, str(e))

    await s.commit()
    return _serialize_instance(instance)
