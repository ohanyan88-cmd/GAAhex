"""Comment Standard (file 04) — API routes.

Endpoints — all RLS tenant-scoped, all permission-gated via app.access.can:

  GET    /api/{entityKey}/{id}/comments          list parent's comments
  POST   /api/{entityKey}/{id}/comments          create
  GET    /api/comments/{commentId}               read single
  PATCH  /api/comments/{commentId}               edit (author-self only)
  DELETE /api/comments/{commentId}               soft delete
  POST   /api/comments/{commentId}/resolve       set resolution=RESOLVED
  POST   /api/comments/{commentId}/reopen        set resolution=UNRESOLVED

Gate matrix (file 04 + file 15, lowercase keys):

  view_*           per-row visibility filter — INTERNAL and SYSTEM gated by
                   `comment.view_internal` specifically; EXTERNAL → view_external;
                   PRIVATE → view_private. A caller missing the relevant view_* key
                   for a row → row excluded from list / 404 on direct GET.
  create           `comment.create`. Reply-depth ceiling = 2 (parent + one reply
                   level): if `parentCommentId` is set, that parent must itself be
                   top-level (its own parent_comment_id IS NULL).
  edit             `comment.edit` AND author-self. NO admin bypass for edit —
                   moderation deletes, it doesn't ghost-edit (file 04). Hold blocks
                   for everyone. Within `COMMENT_EDIT_WINDOW_MIN` of created_at.
  delete           (`comment.delete` AND author-self) OR `comment.moderate`. Hold
                   blocks for everyone INCLUDING comment.moderate AND
                   configuration.manage (file 04 — hold beats every role).
  resolve/reopen   (`comment.edit` AND author-self) OR `comment.moderate`. Hold
                   blocks for everyone.

Substrate emit — uses the existing append-only `app.workflow.emit` substrate with
lowercase free-string `type_` values; entity_key/record_id pin to the PARENT object
so the parent's timeline naturally projects the event (file 04 — timeline is a
projection; one event may appear on multiple object timelines). Mention events
emit one per recipient for the Notification module to consume.

  comment_added | comment_edited | comment_deleted | comment_resolved |
  comment_reopened | mention_added
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..access import can, load_grants
from ..db import get_session
from ..models import Comment, CommentMention
from ..models.user import User
from .auth import current_user


router = APIRouter(prefix="/api", tags=["comments"])

# Edit window — file 04 says default 15 min, configurable. Configuration Standard
# (file 08) is the future home for per-tenant override; for v1 this is the constant.
COMMENT_EDIT_WINDOW_MIN = 15

_VALID_TYPES = {"INTERNAL", "EXTERNAL", "PRIVATE", "SYSTEM"}
_VALID_PRINCIPAL_TYPES = {"EMPLOYEE", "ROLE", "DEPARTMENT", "TEAM"}
_VALID_RESOLUTIONS = {"RESOLVED", "UNRESOLVED"}

# Deny-list content sanitization. File 04 — rich content allowed (text, links,
# mentions, lists, tables, code blocks); scripts/executables/embedded programs
# disallowed. Strips dangerous tags + URI schemes; doesn't reformat the rest.
_DANGEROUS_TAG_RE = re.compile(
    r"<\s*(script|iframe|object|embed|applet)\b[^>]*>.*?<\s*/\s*\1\s*>|"
    r"<\s*(script|iframe|object|embed|applet)\b[^>]*/?>",
    re.IGNORECASE | re.DOTALL,
)
_DANGEROUS_URI_RE = re.compile(r"\b(javascript|vbscript|data)\s*:", re.IGNORECASE)


def _sanitize(content: str) -> str:
    """Strip scripts/executables/embedded programs per file 04 §Comment."""
    out = _DANGEROUS_TAG_RE.sub("", content or "")
    out = _DANGEROUS_URI_RE.sub("blocked:", out)
    return out.strip()


def _can_view_type(grants, comment_type: str) -> bool:
    """Visibility gate per file 04: SYSTEM is gated by view_internal specifically."""
    if comment_type in ("INTERNAL", "SYSTEM"):
        return can(grants, "comment", "view_internal")
    if comment_type == "EXTERNAL":
        return can(grants, "comment", "view_external")
    if comment_type == "PRIVATE":
        return can(grants, "comment", "view_private")
    return False


def _serialize(c: Comment) -> dict:
    """One comment row → dict. Deleted rows return the placeholder, not raw content."""
    if c.status == "DELETED":
        body = {
            "content": "Comment Deleted",
            "deletedBy": str(c.deleted_by) if c.deleted_by else None,
            "deletedAt": c.deleted_at.isoformat() if c.deleted_at else None,
        }
    else:
        body = {
            "content": c.content,
            "editedBy": str(c.edited_by) if c.edited_by else None,
            "editedAt": c.edited_at.isoformat() if c.edited_at else None,
        }
    return {
        "id": str(c.id),
        "parentObjectType": c.parent_object_type,
        "parentObjectId": str(c.parent_object_id),
        "parentCommentId": str(c.parent_comment_id) if c.parent_comment_id else None,
        "commentType": c.comment_type,
        "status": c.status,
        "resolution": c.resolution,
        "authorId": str(c.author_id),
        "createdAt": c.created_at.isoformat(),
        "hold": c.hold,
        **body,
    }


async def _get(s: AsyncSession, tenant_id, comment_id: uuid.UUID) -> Comment:
    """Load one tenant-scoped comment or 404. RLS already filters by tenant."""
    row = (await s.execute(
        select(Comment).where(and_(Comment.tenant_id == tenant_id, Comment.id == comment_id))
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    return row


# ──────────────────────────────────────────────────────────────────────────────
# LIST + CREATE on a parent
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/{entity_key}/{parent_id}/comments")
async def list_comments(
    entity_key: str,
    parent_id: uuid.UUID,
    include_deleted: bool = False,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List comments pinned to (entity_key, parent_id) the caller is allowed to see.

    No view_* key at all → 403. Rows whose `commentType` the caller can't view are
    omitted (default-deny per file 17 §1; the denial surface stays generic — the
    caller can't infer that hidden rows exist)."""
    grants = await load_grants(s, user)
    if not any(can(grants, "comment", v) for v in ("view_internal", "view_external", "view_private")):
        raise HTTPException(status_code=403, detail="Access denied")

    q = select(Comment).where(and_(
        Comment.tenant_id == user.tenant_id,
        Comment.parent_object_type == entity_key,
        Comment.parent_object_id == parent_id,
    ))
    if not include_deleted:
        q = q.where(Comment.status != "DELETED")
    q = q.order_by(Comment.created_at)
    rows = (await s.execute(q)).scalars().all()
    return [_serialize(c) for c in rows if _can_view_type(grants, c.comment_type)]


@router.post("/{entity_key}/{parent_id}/comments", status_code=201)
async def create_comment(
    entity_key: str,
    parent_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create a comment pinned to (entity_key, parent_id). Reply-depth ceiling = 2."""
    grants = await load_grants(s, user)
    if not can(grants, "comment", "create"):
        raise HTTPException(status_code=403, detail="Access denied")

    ctype = (payload.get("commentType") or "INTERNAL").upper()
    if ctype not in _VALID_TYPES:
        raise HTTPException(status_code=422, detail=f"commentType must be one of {sorted(_VALID_TYPES)}")
    content = _sanitize(payload.get("content") or "")
    if not content:
        raise HTTPException(status_code=422, detail="content is required")

    parent_comment_id = payload.get("parentCommentId")
    if parent_comment_id:
        try:
            pcid = uuid.UUID(str(parent_comment_id))
        except ValueError:
            raise HTTPException(status_code=422, detail="parentCommentId must be a UUID")
        parent_c = await _get(s, user.tenant_id, pcid)
        # Reply-depth ceiling — file 04: max recommended depth 2 (parent + one reply level).
        if parent_c.parent_comment_id is not None:
            raise HTTPException(status_code=422, detail="Reply depth ceiling is 2 — cannot reply to a reply")
        parent_comment_id = pcid

    c = Comment(
        tenant_id=user.tenant_id,
        parent_object_type=entity_key,
        parent_object_id=parent_id,
        parent_comment_id=parent_comment_id,
        comment_type=ctype,
        author_id=user.id,
        content=content,
    )
    s.add(c)
    await s.flush()

    # Mentions (optional). Per D15 the principal-type enum is UPPER_SNAKE.
    mentions = payload.get("mentions") or []
    if not isinstance(mentions, list):
        raise HTTPException(status_code=422, detail="mentions must be a list")
    mention_rows: list[CommentMention] = []
    for m in mentions:
        mtype = (m.get("mentionedEntityType") or "").upper()
        mid = m.get("mentionedEntityId")
        if mtype not in _VALID_PRINCIPAL_TYPES:
            raise HTTPException(status_code=422, detail=f"mentionedEntityType must be one of {sorted(_VALID_PRINCIPAL_TYPES)}")
        try:
            mid_uuid = uuid.UUID(str(mid))
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail="mentionedEntityId must be a UUID")
        mention_rows.append(CommentMention(
            tenant_id=user.tenant_id, comment_id=c.id,
            mentioned_entity_type=mtype, mentioned_entity_id=mid_uuid,
        ))
    s.add_all(mention_rows)
    if mention_rows:
        await s.flush()

    # Substrate emit — pin to parent so parent's timeline projects the event.
    await workflow.emit(
        s, user.tenant_id, "comment_added", entity_key, parent_id, user.id,
        {"commentId": str(c.id), "commentType": ctype,
         "contentPreview": content[:120], "mentionCount": len(mention_rows)},
    )
    for m in mention_rows:
        await workflow.emit(
            s, user.tenant_id, "mention_added", entity_key, parent_id, user.id,
            {"commentId": str(c.id), "mentionedEntityType": m.mentioned_entity_type,
             "mentionedEntityId": str(m.mentioned_entity_id)},
        )
    return _serialize(c)


# ──────────────────────────────────────────────────────────────────────────────
# READ + EDIT + DELETE on a single comment
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/comments/{comment_id}")
async def get_comment(
    comment_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    c = await _get(s, user.tenant_id, comment_id)
    if not _can_view_type(grants, c.comment_type):
        # Same denial surface as missing row — never leak existence of hidden types.
        raise HTTPException(status_code=404, detail="Comment not found")
    return _serialize(c)


@router.patch("/comments/{comment_id}")
async def edit_comment(
    comment_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Edit content/commentType/resolution.

    Author-self only — NO admin bypass for edit (moderation deletes, doesn't
    ghost-edit). Within COMMENT_EDIT_WINDOW_MIN of created_at. Hold blocks
    everyone."""
    grants = await load_grants(s, user)
    c = await _get(s, user.tenant_id, comment_id)
    if not _can_view_type(grants, c.comment_type):
        raise HTTPException(status_code=404, detail="Comment not found")

    if c.hold:
        # Hold beats every role incl. moderate + configuration.manage (file 04).
        raise HTTPException(status_code=422, detail="Comment is on hold and cannot be edited")
    if c.status == "DELETED":
        raise HTTPException(status_code=422, detail="Deleted comments cannot be edited")
    if c.author_id != user.id:
        # No moderation path for edit — file 04 locks this.
        raise HTTPException(status_code=403, detail="Only the author can edit a comment")
    if not can(grants, "comment", "edit"):
        raise HTTPException(status_code=403, detail="Access denied")

    now = datetime.now(timezone.utc)
    if (now - c.created_at) > timedelta(minutes=COMMENT_EDIT_WINDOW_MIN):
        raise HTTPException(
            status_code=422,
            detail=f"Edit window of {COMMENT_EDIT_WINDOW_MIN} minutes has passed",
        )

    before = {"content": c.content, "commentType": c.comment_type, "resolution": c.resolution}

    if "content" in payload:
        new_content = _sanitize(payload["content"] or "")
        if not new_content:
            raise HTTPException(status_code=422, detail="content cannot be empty")
        c.content = new_content
    if "commentType" in payload:
        new_type = (payload["commentType"] or "").upper()
        if new_type not in _VALID_TYPES:
            raise HTTPException(status_code=422, detail=f"commentType must be one of {sorted(_VALID_TYPES)}")
        c.comment_type = new_type
    if "resolution" in payload:
        new_res = payload["resolution"]
        if new_res is not None:
            new_res = str(new_res).upper()
            if new_res not in _VALID_RESOLUTIONS:
                raise HTTPException(status_code=422, detail=f"resolution must be one of {sorted(_VALID_RESOLUTIONS)} or null")
        c.resolution = new_res

    c.status = "EDITED"
    c.edited_by = user.id
    c.edited_at = now
    await s.flush()

    after = {"content": c.content, "commentType": c.comment_type, "resolution": c.resolution}
    await workflow.emit(
        s, user.tenant_id, "comment_edited", c.parent_object_type, c.parent_object_id, user.id,
        {"commentId": str(c.id), "before": before, "after": after},
    )
    return _serialize(c)


@router.delete("/comments/{comment_id}")
async def delete_comment(
    comment_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Soft delete. (comment.delete AND author-self) OR comment.moderate. Hold blocks both."""
    grants = await load_grants(s, user)
    c = await _get(s, user.tenant_id, comment_id)
    if not _can_view_type(grants, c.comment_type):
        raise HTTPException(status_code=404, detail="Comment not found")
    if c.hold:
        raise HTTPException(status_code=422, detail="Comment is on hold and cannot be deleted")
    if c.status == "DELETED":
        return _serialize(c)  # idempotent — already deleted

    is_author = c.author_id == user.id
    is_moderator = can(grants, "comment", "moderate")
    has_delete = can(grants, "comment", "delete")
    if not ((has_delete and is_author) or is_moderator):
        raise HTTPException(status_code=403, detail="Access denied")

    c.status = "DELETED"
    c.deleted_by = user.id
    c.deleted_at = datetime.now(timezone.utc)
    await s.flush()
    await workflow.emit(
        s, user.tenant_id, "comment_deleted", c.parent_object_type, c.parent_object_id, user.id,
        {"commentId": str(c.id), "byModerator": is_moderator and not is_author},
    )
    return _serialize(c)


# ──────────────────────────────────────────────────────────────────────────────
# RESOLVE + REOPEN
# ──────────────────────────────────────────────────────────────────────────────

async def _set_resolution(
    s: AsyncSession, user: User, comment_id: uuid.UUID,
    new_resolution: str, event_type: str,
) -> dict:
    grants = await load_grants(s, user)
    c = await _get(s, user.tenant_id, comment_id)
    if not _can_view_type(grants, c.comment_type):
        raise HTTPException(status_code=404, detail="Comment not found")
    if c.hold:
        raise HTTPException(status_code=422, detail="Comment is on hold")
    if c.status == "DELETED":
        raise HTTPException(status_code=422, detail="Deleted comments cannot be resolved or reopened")

    is_author = c.author_id == user.id
    is_moderator = can(grants, "comment", "moderate")
    has_edit = can(grants, "comment", "edit")
    if not ((has_edit and is_author) or is_moderator):
        raise HTTPException(status_code=403, detail="Access denied")

    c.resolution = new_resolution
    await s.flush()
    await workflow.emit(
        s, user.tenant_id, event_type, c.parent_object_type, c.parent_object_id, user.id,
        {"commentId": str(c.id), "byModerator": is_moderator and not is_author},
    )
    return _serialize(c)


@router.post("/comments/{comment_id}/resolve")
async def resolve_comment(
    comment_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    return await _set_resolution(s, user, comment_id, "RESOLVED", "comment_resolved")


@router.post("/comments/{comment_id}/reopen")
async def reopen_comment(
    comment_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    return await _set_resolution(s, user, comment_id, "UNRESOLVED", "comment_reopened")
