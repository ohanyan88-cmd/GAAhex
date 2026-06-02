"""Watcher / Subscriber Standard (file 05) — first-class subscription entity.

Additive only — no kernel touches. Polymorphic target pin via
`target_entity_type` + `target_entity_id` (Approval precedent, same as Comment).
Watching is awareness only: never grants permission, never counts toward KPI /
SLA / workload (file 05 §Watcher principle).

Substrate emit: uses the existing `app.workflow.emit` append-only event store with
lowercase free-string `type_` values (`watch_added`, `watch_removed`, `watch_paused`,
`watch_resumed`, `watch_scope_changed`, `watch_preference_changed`). The Event System
extension retrofits these to canonical `eventName=WATCH_*` later.

Legal hold (file 05 — "watchers preserved under legal hold"):
  NOT modeled as a per-watcher column. Hold is a target-object invariant, not a
  per-row attribute, and it's centralized in the upcoming Legal Hold registry
  defined by the Data Retention Standard. When that lands, every mutating endpoint
  (remove / pause / scope change) consults the registry and refuses if the target
  is held. Until then there's no real hold to enforce.

Unique-active invariant: one ACTIVE watcher per (target, watcher) tuple is
enforced at the DB layer by a partial unique index — the spec ("Unique key: target
type+id + watcher type+id where status=ACTIVE") landed from day one to close the
concurrent-double-add race window.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, Text, Index, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Watcher(Base):
    """A subscription pinned to one target object (file 05 — Watcher / Subscriber Standard).

    Watcher type is the PrincipalType subset `EMPLOYEE | ROLE | DEPARTMENT | TEAM`
    (D12 — note: QUEUE is excluded; an Owner that's a QUEUE auto-resolves to the
    queue's owning department before any watcher is created, per E15).

    Status lifecycle: ACTIVE → PAUSED → ACTIVE (resumable) → REMOVED (terminal,
    only one removal — re-watching after REMOVED creates a NEW row, not a revive,
    so the audit story stays per-subscription).

    Department / role watchers resolve dynamically at notification-resolve time —
    there's no membership snapshot here; the Notification module walks the
    PrincipalType → recipient set at delivery.
    """
    __tablename__ = "watcher"
    __table_args__ = (
        # "Who watches this object?" — the parent-listing query.
        Index("ix_watcher_target", "tenant_id", "target_entity_type", "target_entity_id"),
        # "What is this principal watching?" — the inverse.
        Index("ix_watcher_principal", "tenant_id", "watcher_type", "watcher_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)

    # Polymorphic target — entity_def.key lowercase, matching the event substrate
    # vocabulary (retrofits to canonical ObjectType when the Event System extension lands).
    target_entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    target_entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # Watcher principal — PrincipalType subset (no QUEUE per D12).
    watcher_type: Mapped[str] = mapped_column(String(20), nullable=False)  # EMPLOYEE|ROLE|DEPARTMENT|TEAM
    watcher_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE")  # ACTIVE|PAUSED|REMOVED
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="MANUAL")  # MANUAL|AUTOMATIC|MENTION|ASSIGNMENT|ESCALATION|APPROVAL|SYSTEM|AUTOMATION
    scope: Mapped[str] = mapped_column(String(30), nullable=False, default="OBJECT_ONLY")  # OBJECT_ONLY|OBJECT_AND_CHILDREN|OBJECT_AND_RELATED
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="NORMAL")  # LOW|NORMAL|HIGH|CRITICAL
    # Per-watcher delivery cadence — the Notification module reads this at deliver-time.
    notification_frequency: Mapped[str] = mapped_column(String(30), nullable=False, default="IMMEDIATE")  # IMMEDIATE|HOURLY_DIGEST|DAILY_DIGEST|WEEKLY_DIGEST|DISABLED

    watch_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Mention watchers default 30 days (configurable per tenant when Configuration infra lands);
    # auto-removal sweep is a future scheduled job that reads this column.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paused_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    removed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)
