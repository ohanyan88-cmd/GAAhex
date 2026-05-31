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
from ..kernel import assert_can, AccessDenied
from ..models import Record, User
from ..access import load_grants, can
from sqlalchemy import func

from ..ai import score_lead, summarize_record, ask_assistant, active_provider, plan_chat
from .auth import current_user
from .records import _node_path, create_record as records_create, transition as records_transition

# The actions the agent may execute (server-side allowlist — the model's proposal is validated
# against this, never trusted blindly). v1 = leads only.
_LEAD_SOURCES = {"Website", "Referral", "Cold Call", "Ad"}
_LEAD_STATUSES = {"NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"}

router = APIRouter(prefix="/api/ai", tags=["ai"])


def _amd(luma) -> str:
    """luma (minor units) → a plain '12,345 ֏' string for the assistant context."""
    return f"{int(luma) / 100:,.0f} ֏"


async def _require_ai(s: AsyncSession, user: User):
    grants = await load_grants(s, user)
    if not can(grants, "ai", "use"):
        raise HTTPException(403, "Not allowed: ai.use")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements legacy role check.
    try:
        await assert_can(s, user, action="use", entity_key="ai",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
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


# ---- agent: propose (LLM) → confirm (user) → execute (server) ----

def _validate_action(action: str, args: dict) -> tuple[str, dict]:
    """Validate a proposed action against the server-side allowlist. Returns a sanitized
    (action, args) or raises 422. The model is never trusted — every field is re-checked here."""
    if action == "create_lead":
        name = (args.get("name") or "").strip()
        if not name:
            raise HTTPException(422, "create_lead needs a name")
        clean = {"name": name}
        for k in ("phone", "email"):
            if args.get(k):
                clean[k] = str(args[k]).strip()
        src = (args.get("source") or "").strip()
        if src and src in _LEAD_SOURCES:
            clean["source"] = src
        return action, clean
    if action == "move_lead":
        lead_name = (args.get("lead_name") or args.get("name") or "").strip()
        to = (args.get("to_status") or args.get("to") or "").strip().upper()
        if not lead_name or to not in _LEAD_STATUSES:
            raise HTTPException(422, "move_lead needs lead_name and a valid to_status")
        return action, {"lead_name": lead_name, "to_status": to}
    raise HTTPException(422, f"Unknown action: {action}")


@router.post("/chat")
async def chat_endpoint(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Agent turn: the model answers OR proposes ONE action (it never executes). A proposal comes
    back for the user to confirm; execution happens only via /act."""
    await _require_ai(s, user)
    question = (payload.get("question") or "").strip()
    if not question:
        raise HTTPException(422, "question is required")
    context = await _business_context(s, user)
    plan = await plan_chat(question, context)
    if plan.get("kind") == "proposal":
        try:
            action, clean = _validate_action(plan.get("action", ""), plan.get("args", {}))
            return {"kind": "proposal", "action": action, "args": clean,
                    "summary": plan.get("summary") or "Confirm this action?", "provider": active_provider()}
        except HTTPException:
            # an unproposable/invalid action → just answer instead of erroring at the user
            return {"kind": "answer", "answer": plan.get("summary") or "I can't do that yet.", "provider": active_provider()}
    return {"kind": "answer", "answer": plan.get("text", ""), "provider": active_provider()}


@router.post("/act")
async def act_endpoint(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Execute a CONFIRMED action. Re-validated against the allowlist, then run through the SAME
    records engine as the UI — so the caller's lead.create / lead.edit permissions, scope and audit
    all apply exactly as normal. The AI gets no special privilege."""
    await _require_ai(s, user)
    action, args = _validate_action((payload.get("action") or ""), payload.get("args") or {})

    if action == "create_lead":
        rec = await records_create("leads", args, user=user, s=s)
        return {"ok": True, "action": action,
                "message": f"Created lead '{args['name']}'.", "record": rec}

    if action == "move_lead":
        rid = (await s.execute(
            select(Record.id).where(
                Record.tenant_id == user.tenant_id, Record.entity_key == "lead",
                func.lower(Record.data["name"].astext) == args["lead_name"].lower())
        )).scalars().all()
        if not rid:
            raise HTTPException(404, f"No lead named '{args['lead_name']}'")
        if len(rid) > 1:
            raise HTTPException(409, f"Several leads named '{args['lead_name']}' — open the pipeline to pick one")
        await records_transition("leads", rid[0], {"to": args["to_status"]}, user=user, s=s)
        return {"ok": True, "action": action,
                "message": f"Moved '{args['lead_name']}' to {args['to_status']}."}

    raise HTTPException(422, f"Unknown action: {action}")
