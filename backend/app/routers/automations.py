"""Automation rules management endpoints.

AutomationRule rows declare event-triggered actions in config (no code). The executor
is wired into workflow.emit so rules fire on every record mutation, fail-soft via savepoint.

action shapes:
  {type: "notify",     config: {def_key?: str, roles?: [str]}}
  {type: "set_field",  config: {field: str, value?: any, expr?: str}}
  {type: "webhook",    config: {url: str, method?: str, headers?: dict}}
  {type: "emit_event", config: {event_type: str, data?: dict}}
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.automation import AutomationRule
from ..access import load_grants, can
from ..kernel import assert_can, AccessDenied
from .auth import current_user

router = APIRouter(prefix="/api/automations", tags=["automations"])

ALLOWED_EVENT_TYPES = {"create", "update", "transition", "delete"}
ALLOWED_ACTION_TYPES = {"notify", "set_field", "webhook", "emit_event"}


async def _require_config_manage(s: AsyncSession, user: User) -> None:
    """SPEC §0.2 (Step 7): automation rule CRUD flows through the kernel default-deny gate."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage configuration")
    try:
        await assert_can(s, user, action="manage", entity_key="automation_rule",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))


async def _get_rule(s: AsyncSession, tenant_id, rule_id: uuid.UUID) -> AutomationRule:
    rule = (await s.execute(
        select(AutomationRule).where(AutomationRule.tenant_id == tenant_id, AutomationRule.id == rule_id)
    )).scalar_one_or_none()
    if not rule:
        raise HTTPException(404, f"Automation rule '{rule_id}' not found")
    return rule


def _rule_out(rule: AutomationRule) -> dict:
    return {
        "id": str(rule.id),
        "key": rule.key,
        "name": rule.name,
        "event_type": rule.event_type,
        "entity_key": rule.entity_key,
        "condition": rule.condition,
        "action": rule.action,
        "is_active": rule.is_active,
        "order": rule.order,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
    }


def _validate_action(action) -> None:
    if not isinstance(action, dict):
        raise HTTPException(422, "action must be an object with 'type' and 'config'")
    atype = action.get("type")
    if atype not in ALLOWED_ACTION_TYPES:
        raise HTTPException(422, f"action.type must be one of {sorted(ALLOWED_ACTION_TYPES)}")


@router.get("")
async def list_automations(
    entity_key: str | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List all automation rules for the tenant, optionally filtered by entity_key.

    Response: [{id, key, name, event_type, entity_key, condition, action, is_active, order, created_at}]
    """
    q = select(AutomationRule).where(AutomationRule.tenant_id == user.tenant_id)
    if entity_key:
        q = q.where(AutomationRule.entity_key == entity_key)
    q = q.order_by(AutomationRule.order, AutomationRule.created_at)
    rules = (await s.execute(q)).scalars().all()
    return [_rule_out(r) for r in rules]


@router.post("", status_code=201)
async def create_automation(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Create an automation rule.

    Request: {key, name, event_type, entity_key, condition?, action: {type, config}, is_active?, order?}
    Response: {id, key, name, event_type, entity_key, condition, action, is_active, order, created_at}
    """
    await _require_config_manage(s, user)

    key = (payload.get("key") or "").strip()
    name = (payload.get("name") or "").strip()
    event_type = (payload.get("event_type") or "").strip()
    entity_key = (payload.get("entity_key") or "").strip()

    if not key or not name:
        raise HTTPException(422, "key and name are required")
    if event_type not in ALLOWED_EVENT_TYPES:
        raise HTTPException(422, f"event_type must be one of {sorted(ALLOWED_EVENT_TYPES)}")
    if not entity_key:
        raise HTTPException(422, "entity_key is required")

    action = payload.get("action")
    _validate_action(action)

    rule = AutomationRule(
        tenant_id=user.tenant_id,
        key=key,
        name=name,
        event_type=event_type,
        entity_key=entity_key,
        condition=payload.get("condition"),
        action=action,
        is_active=bool(payload.get("is_active", True)),
        order=int(payload.get("order") or 0),
    )
    s.add(rule)
    await s.commit()
    return _rule_out(rule)


@router.patch("/{rule_id}")
async def update_automation(rule_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Update an automation rule (partial update).

    Request: {name?, event_type?, entity_key?, condition?, action?, is_active?, order?}
    Response: {id, key, name, event_type, entity_key, condition, action, is_active, order, created_at}
    """
    await _require_config_manage(s, user)
    rule = await _get_rule(s, user.tenant_id, rule_id)

    if "name" in payload:
        v = (payload["name"] or "").strip()
        if not v:
            raise HTTPException(422, "name cannot be empty")
        rule.name = v
    if "event_type" in payload:
        et = (payload["event_type"] or "").strip()
        if et not in ALLOWED_EVENT_TYPES:
            raise HTTPException(422, f"event_type must be one of {sorted(ALLOWED_EVENT_TYPES)}")
        rule.event_type = et
    if "entity_key" in payload:
        ek = (payload["entity_key"] or "").strip()
        if not ek:
            raise HTTPException(422, "entity_key cannot be empty")
        rule.entity_key = ek
    if "condition" in payload:
        rule.condition = payload["condition"]   # allow None to clear
    if "action" in payload:
        _validate_action(payload["action"])
        rule.action = payload["action"]
    if "is_active" in payload:
        rule.is_active = bool(payload["is_active"])
    if "order" in payload:
        rule.order = int(payload["order"])

    await s.commit()
    return _rule_out(rule)


@router.delete("/{rule_id}", status_code=204)
async def delete_automation(rule_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Delete an automation rule."""
    await _require_config_manage(s, user)
    rule = await _get_rule(s, user.tenant_id, rule_id)
    await s.delete(rule)
    await s.commit()
