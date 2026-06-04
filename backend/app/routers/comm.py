import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Record
from ..models.comm import Thread, Message
from ..access import load_grants, can
from ..kernel import assert_can, AccessDenied
from .. import notify_hooks, workflow
from .auth import current_user
from .records import _entity, _get, _node_path     # reuse the exact records scope-check primitives

# NOTE on namespacing: these are FIXED paths under /api ("/api/records/.../comments",
# "/api/threads"). The generic record router serves "/api/{slug}", so this router MUST be
# registered BEFORE records.router in main.py, or "/api/records/..." and "/api/threads" would be
# captured as entity slugs. See the wiring report.
router = APIRouter(prefix="/api", tags=["comm"])


# ---- helpers ----

def _comment(m: Message, author_name: str) -> dict:
    return {
        "id": str(m.id),
        "thread_id": str(m.thread_id),
        "author_user_id": str(m.author_user_id),
        "author_name": author_name,
        "body": m.body,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def _thread(th: Thread) -> dict:
    return {
        "id": str(th.id),
        "entity_key": th.entity_key,
        "record_id": str(th.record_id) if th.record_id else None,
        "title": th.title,
        "created_by": str(th.created_by),
        "created_at": th.created_at.isoformat() if th.created_at else None,
    }


async def _author_names(s: AsyncSession, tenant_id, messages: list[Message]) -> dict[str, str]:
    ids = {m.author_user_id for m in messages}
    if not ids:
        return {}
    rows = (await s.execute(
        select(User.id, User.name).where(User.tenant_id == tenant_id, User.id.in_(ids))
    )).all()
    return {str(i): n for i, n in rows}


async def _record_thread(s: AsyncSession, tenant_id, entity_key, record_id, created_by) -> Thread:
    """The record's comment thread — created lazily on first access."""
    th = (await s.execute(
        select(Thread).where(
            Thread.tenant_id == tenant_id, Thread.entity_key == entity_key, Thread.record_id == record_id
        )
    )).scalar_one_or_none()
    if th:
        return th
    th = Thread(tenant_id=tenant_id, entity_key=entity_key, record_id=record_id, created_by=created_by)
    s.add(th)
    await s.flush()
    return th


async def _can_view_record(s: AsyncSession, user: User, grants, entity_key: str, record_id) -> bool:
    rec = (await s.execute(
        select(Record).where(Record.id == record_id, Record.tenant_id == user.tenant_id, Record.entity_key == entity_key)
    )).scalar_one_or_none()
    if not rec:
        return False
    return can(grants, entity_key, "view", await _node_path(s, rec.owner_node_id))


async def _can_access_thread(s: AsyncSession, user: User, grants, th: Thread) -> bool:
    """A user may see a thread they created, or a record-linked thread whose record they can view."""
    if th.created_by == user.id:
        return True
    if th.record_id and th.entity_key:
        return await _can_view_record(s, user, grants, th.entity_key, th.record_id)
    return False


# ---- record comments (scope = the record's view permission) ----

@router.get("/records/{slug}/{rec_id}/comments")
async def list_comments(slug: str, rec_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """A record's comment thread, oldest-first (chronological). Lazily creates the thread.
    403 if the caller cannot view the record."""
    ent = await _entity(s, user.tenant_id, slug)
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "view", await _node_path(s, rec.owner_node_id)):
        raise HTTPException(403, f"Not allowed: {ent.key}.view")
    th = await _record_thread(s, user.tenant_id, ent.key, rec.id, user.id)
    msgs = (await s.execute(
        select(Message).where(Message.thread_id == th.id).order_by(Message.created_at)
    )).scalars().all()
    await s.commit()                                  # persist a lazily-created thread
    names = await _author_names(s, user.tenant_id, msgs)
    return [_comment(m, names.get(str(m.author_user_id), "")) for m in msgs]


@router.post("/records/{slug}/{rec_id}/comments", status_code=201)
async def add_comment(slug: str, rec_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Append a comment to a record's thread. Notifies other participants (not the author) via
    notify_hooks and emits a `comment` audit Event. Requires view permission on the record."""
    body = (payload or {}).get("body")
    if not body or not str(body).strip():
        raise HTTPException(422, "Comment body is required")
    ent = await _entity(s, user.tenant_id, slug)
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "view", await _node_path(s, rec.owner_node_id)):
        raise HTTPException(403, f"Not allowed: {ent.key}.view")
    # SPEC §0.2 default-deny (Step 7) — kernel gate piggybacks on the host entity's view grant
    # (commenting is a derived action on the record, not a separate entity), so the kernel re-runs
    # the host-entity view evaluation with full Role × Department × Region × Ownership AND.
    try:
        await assert_can(s, user, action="view", entity_key=ent.key,
                         region_id=getattr(rec, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    th = await _record_thread(s, user.tenant_id, ent.key, rec.id, user.id)
    msg = Message(tenant_id=user.tenant_id, thread_id=th.id, author_user_id=user.id, body=str(body))
    s.add(msg)
    await s.flush()

    preview = str(body)[:140]
    # BL-7 — route through workflow.emit so the audit Event is fully populated
    # (schema_version, actor_type, visibility, category, event_name) instead of
    # the structurally-undersized hand-rolled Event row.
    await workflow.emit(
        s, user.tenant_id, "COMMENT", ent.key, rec.id, user.id,
        {"thread_id": str(th.id), "message_id": str(msg.id), "preview": preview},
        event_name="Comment.Posted", category="COMMENT",
    )
    # notify the record's other participants (fail-soft; no-op unless a "{entity}.comment" def is configured)
    await notify_hooks.fire(
        s, tenant_id=user.tenant_id, event_type="COMMENT", entity_key=ent.key, record=rec,
        actor_user_id=user.id, extra={"thread_id": str(th.id), "preview": preview},
    )
    await s.commit()
    await s.refresh(msg)
    return _comment(msg, user.name)


# ---- standalone threads (lightweight) ----

@router.get("/threads")
async def list_threads(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Threads the caller may see: ones they created + record-linked ones whose record they can view."""
    grants = await load_grants(s, user)
    threads = (await s.execute(
        select(Thread).where(Thread.tenant_id == user.tenant_id).order_by(Thread.created_at)
    )).scalars().all()
    out = [th for th in threads if await _can_access_thread(s, user, grants, th)]
    return [_thread(th) for th in out]


@router.get("/threads/{thread_id}/messages")
async def list_thread_messages(thread_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    th = (await s.execute(
        select(Thread).where(Thread.id == thread_id, Thread.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not th:
        raise HTTPException(404, "Thread not found")
    grants = await load_grants(s, user)
    if not await _can_access_thread(s, user, grants, th):
        raise HTTPException(403, "Not allowed")
    msgs = (await s.execute(
        select(Message).where(Message.thread_id == th.id).order_by(Message.created_at)
    )).scalars().all()
    names = await _author_names(s, user.tenant_id, msgs)
    return [_comment(m, names.get(str(m.author_user_id), "")) for m in msgs]


@router.post("/threads/{thread_id}/messages", status_code=201)
async def add_thread_message(thread_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    body = (payload or {}).get("body")
    if not body or not str(body).strip():
        raise HTTPException(422, "Message body is required")
    th = (await s.execute(
        select(Thread).where(Thread.id == thread_id, Thread.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not th:
        raise HTTPException(404, "Thread not found")
    grants = await load_grants(s, user)
    if not await _can_access_thread(s, user, grants, th):
        raise HTTPException(403, "Not allowed")
    msg = Message(tenant_id=user.tenant_id, thread_id=th.id, author_user_id=user.id, body=str(body))
    s.add(msg)
    await s.commit()
    await s.refresh(msg)
    return _comment(msg, user.name)
