"""Comment Standard (file 04) — first-class parent-pinned conversation entity.

Additive only — does NOT touch the existing `Thread`/`Message` chat model in `comm.py`.
That is a separate facility (a record's chat thread); Comments are conversation pinned
to any object via polymorphic `parent_object_type` + `parent_object_id`, matching the
`Approval.target_entity_key` + `target_record_id` precedent (no FK, indexed).

Substrate emit: comment lifecycle uses the existing `app.workflow.emit` append-only event
substrate with lowercase free-string `type_` values (`comment_added`, `comment_edited`,
`comment_deleted`, `comment_resolved`, `comment_reopened`). The Event System extension
(canonical `eventName=COMMENT_ADDED` etc.) retrofits these later; not pre-built here.

Hold field semantics (router-enforced v1):
  `hold=true` means the comment is under investigation / legal hold / audit / compliance
  review and refuses edit + delete from the router. The DB-trigger hardening of this
  invariant (the same compliance class as audit append-only, alembic `b70ef3b98e27`) is
  a HARD precondition before the first real legal hold is ever placed AND before any
  production deploy — tracked as a follow-up, not optional.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, Text, Boolean, Index, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Comment(Base):
    """A conversation entry pinned to one parent object (file 04 — Comment Standard).

    Polymorphic parent pointer (`parent_object_type` + `parent_object_id`) follows the
    Approval precedent — no FK, indexed for the parent-listing query. Reply pointer
    (`parent_comment_id`) is a self-reference; max depth 2 (parent + one level of
    replies) is enforced router-side at create.

    Lifecycle: ACTIVE -> EDITED (on edit) -> DELETED (on soft-delete). Soft delete only;
    deleted rows stay in the table (the UI renders "Comment Deleted"). Edits capture
    before/after in the emitted Event payload — the per-edit history is the event log,
    not a separate revision table (per file 04 / D1 single append-only store).
    """
    __tablename__ = "comment"
    __table_args__ = (
        # Parent-listing query: "all comments on this customer/lead/ticket".
        Index("ix_comment_parent", "tenant_id", "parent_object_type", "parent_object_id"),
        # Author-history query.
        Index("ix_comment_author", "tenant_id", "author_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)

    # Polymorphic parent (Approval precedent; no FK; entity_def.key lowercase per existing
    # event substrate vocabulary — retrofits to the canonical ObjectType enum when the
    # Event System extension lands).
    parent_object_type: Mapped[str] = mapped_column(String(40), nullable=False)
    parent_object_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # Reply pointer (self-FK). NULL = top-level. Depth-2 ceiling enforced router-side
    # at create (a reply cannot itself be replied to).
    parent_comment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("comment.id"), nullable=True
    )

    # Visibility class. SYSTEM-authored comments are gated by `comment.view_internal`
    # specifically (file 04 — a holder of only `comment.view_external` must never see
    # internal system annotations).
    comment_type: Mapped[str] = mapped_column(String(20), nullable=False)  # INTERNAL|EXTERNAL|PRIVATE|SYSTEM

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE")  # ACTIVE|EDITED|DELETED
    resolution: Mapped[str | None] = mapped_column(String(20), nullable=True)  # RESOLVED|UNRESOLVED (optional)

    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)  # sanitized server-side at write

    edited_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    deleted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Legal/investigation/audit/compliance hold (file 04). Router v1 refuses edit + delete
    # when true; DB-trigger hardening is a hard precondition before first real legal hold
    # AND before any production deploy.
    hold: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class CommentMention(Base):
    """A `@mention` target on a Comment (file 04 — D15: targets are `PrincipalType` UPPER_SNAKE).

    Mentions generate notifications. v1 records the rows + emits a `mention_added` event
    via the substrate; the Notification module (file 05 — to be built) consumes the event
    and fans delivery out. ON DELETE CASCADE because mentions are owned by their comment.

    Reverse-lookup ("where am I mentioned?") is the principal-axis index.
    """
    __tablename__ = "comment_mention"
    __table_args__ = (
        Index("ix_comment_mention_principal", "tenant_id", "mentioned_entity_type", "mentioned_entity_id"),
        Index("ix_comment_mention_comment", "comment_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    comment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("comment.id", ondelete="CASCADE"), nullable=False
    )

    # PrincipalType (file 03 / D15): EMPLOYEE | ROLE | DEPARTMENT | TEAM.
    mentioned_entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    mentioned_entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
