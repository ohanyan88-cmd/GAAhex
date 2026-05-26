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
from ..ai import score_lead, summarize_record, ask_assistant, active_provider
from .auth import current_user
from .records import _node_path

router = APIRouter(prefix="/api/ai", tags=["ai"])


def _amd(luma) -> str:
    """luma (minor units) → a plain '12,345 ֏' string for the assistant context."""
    return f"{int(luma) / 100:,.0f} ֏"


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


@router.get("/status")
async def ai_status(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Which brain is live — so the UI can show 'local/offline' vs a real provider."""
    await _require_ai(s, user)
    p = active_provider()
    return {"provider": p, "live": p != "none"}


async def _business_context(s: AsyncSession, user: User) -> list[str]:
    """Live, SCOPED business facts for the assistant to answer from. Reuses analytics.overview (so
    the same scope + permission rules apply); if the caller lacks analytics.view we simply answer
    without the financial context rather than failing."""
    from .analytics import overview as analytics_overview
    lines: list[str] = []
    try:
        ov = await analytics_overview(user=user, s=s)
        lines += [
            f"- MRR (monthly recurring revenue): {_amd(ov['mrr'])}",
            f"- Active subscriptions: {ov['active_subscriptions']}",
            f"- Accounts receivable outstanding: {_amd(ov['ar_outstanding'])}",
            f"- Overdue invoices: {ov['overdue_count']} totaling {_amd(ov['overdue_total'])}",
            f"- Collected this month: {_amd(ov['collected_this_month'])} (previous month {_amd(ov['collected_prev_month'])})",
            f"- New leads in the last 30 days: {ov['new_leads_30d']} (prior 30 days: {ov['new_leads_prev_30d']})",
        ]
    except HTTPException:
        pass  # no analytics permission → answer from general knowledge of GAAex only
    return lines


@router.post("/ask")
async def ask_endpoint(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Ask GAAex — a free-text question answered from the caller's live, scoped business context.
    Templated readout with no provider; a real answer when a provider (e.g. Gemini) is configured."""
    await _require_ai(s, user)
    question = (payload.get("question") or "").strip()
    if not question:
        raise HTTPException(422, "question is required")
    context = await _business_context(s, user)
    answer = await ask_assistant(question, context)
    return {"answer": answer, "provider": active_provider(), "grounded": bool(context)}
