"""Workflow engine (M4 slice): guarded lifecycle transitions + event emission.

A WorkflowDef.config holds {"transitions": [{from, to, guard}]}. Status changes go ONLY through
transitions (not free PATCH), each gated by a GXL guard. On success an Event is emitted.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import WorkflowDef, FieldDef, Event, Record


async def get_transitions(s: AsyncSession, entity_id) -> list[dict]:
    wf = (await s.execute(select(WorkflowDef).where(WorkflowDef.entity_def_id == entity_id))).scalars().first()
    if not wf or not wf.config:
        return []
    return wf.config.get("transitions", [])


def find_transition(transitions: list[dict], frm: str | None, to: str) -> dict | None:
    for t in transitions:
        if t.get("from") == frm and t.get("to") == to:
            return t
    return None


async def guard_context(s: AsyncSession, entity_id, record: Record) -> dict:
    """Field values + status — the names a guard expression can reference."""
    fields = (await s.execute(select(FieldDef).where(FieldDef.entity_def_id == entity_id))).scalars().all()
    ctx: dict = {}
    for f in fields:
        if f.type == "status":
            continue
        ctx[f.key] = (record.data or {}).get(f.key)
    ctx["status"] = record.status
    return ctx


async def emit(s: AsyncSession, tenant_id, type_: str, entity_key: str, record_id, actor_user_id, data: dict) -> None:
    s.add(Event(
        tenant_id=tenant_id, type=type_, entity_key=entity_key,
        record_id=record_id, actor_user_id=actor_user_id, data=data,
    ))
