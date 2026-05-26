"""AI-assist API (foundation). Provider-agnostic and dormant-safe — every endpoint returns a useful
result with NO provider configured (see app/ai.py). Gated on `ai.use`; record lookups are org-scoped
exactly like the records engine.

NOTE: fixed paths under /api ("/api/ai"), so register BEFORE records.router ("/api/{slug}").
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Record, User
from ..access import load_grants, can
from ..ai import score_lead, summarize_record
from .auth import current_user
from .records import _node_path

router = APIRouter(prefix="/api/ai", tags=["ai"])


async def _require_ai(s: AsyncSession, user: User):
    grants = await load_grants(s, user)
    if not can(grants, "ai", "use"):
        raise HTTPException(403, "Not allowed: ai.use")
    return grants


async def _resolve_fields(s: AsyncSession, user: User, grants, payload: dict) -> dict:
    """Fields to operate on: a scoped record's data (via `record_id`) or an inline `fields` object."""
    rid = payload.get("record_id")
    if rid:
        try:
            rid = uuid.UUID(str(rid))
        except (ValueError, AttributeError, TypeError):
            raise HTTPException(422, "record_id must be a uuid")
        rec = (await s.execute(
            select(Record).where(Record.id == rid, Record.tenant_id == user.tenant_id)
        )).scalar_one_or_none()
        if not rec:
            raise HTTPException(404, "Record not found")
        if not can(grants, rec.entity_key, "view", await _node_path(s, rec.owner_node_id)):
            raise HTTPException(403, f"Not allowed: {rec.entity_key}.view")
        return {**(rec.data or {}), "status": rec.status}
    fields = payload.get("fields")
    if not isinstance(fields, dict):
        raise HTTPException(422, "provide a record_id or a fields object")
    return fields


@router.post("/score-lead")
async def score_lead_endpoint(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Rule-based lead score → {score, band, reasons}. Deterministic; always available."""
    grants = await _require_ai(s, user)
    fields = await _resolve_fields(s, user, grants, payload)
    return score_lead(fields)


@router.post("/summarize")
async def summarize_endpoint(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Record summary via the AI gateway — templated with no provider, real LLM when configured."""
    grants = await _require_ai(s, user)
    fields = await _resolve_fields(s, user, grants, payload)
    return {"summary": await summarize_record(fields)}
