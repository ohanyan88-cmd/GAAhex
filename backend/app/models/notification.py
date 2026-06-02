"""Notification model — first-class inbox + delivery log.

Notification Standard (file 05) extension applied additively (same D1
strategy as the Event System extension — all new columns are nullable so
every existing row, test, and call site continues to work unchanged).

OPTION A — dual-category approach (Gev 2026-06-02):
  `category` (existing) keeps the internal legacy vocab ("system", "billing",
  "network", "customer", "internal") used by all existing NotificationDef seeds
  and call sites. It is NOT renamed or removed.
  `std_category` (new, nullable) carries the canonical NotificationCategory
  UPPER_SNAKE value (ACTION_REQUIRED, INFORMATIONAL, WARNING, SUCCESS, ERROR,
  SECURITY, COMPLIANCE) for new-standard emits. New code writes both; old code
  only writes `category`. A future cleanup migration merges them.

New additive fields on `notification`:
  event_id        — D16: triggering event id (no FK; events are permanent)
  source          — NotificationSource: TASK|COMMENT|ATTACHMENT|APPROVAL|...
  severity        — INFO|WARNING|ERROR|CRITICAL (impact axis; priority = urgency)
  recipient_type  — RecipientType: EMPLOYEE|ROLE|DEPARTMENT|TEAM|CUSTOMER
  std_category    — Option A canonical NotificationCategory (nullable)
  status          — 7-value state machine PENDING|DELIVERED|READ|...
  acknowledged_at, dismissed_at, expires_at — status audit fields

New table `notification_delivery` — per-attempt delivery log.
  One row per channel delivery attempt. Append-only in spirit (no CASCADE).
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Text, Boolean, ForeignKey, DateTime, func, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class NotificationDef(Base):
    """Configuration of a notification type (e.g. `lead.assigned`). Lives above the Kernel Line:
    the kernel emits notifications from these definitions; what fires and how it reads is config."""
    __tablename__ = "notification_def"
    __table_args__ = (
        UniqueConstraint("tenant_id", "key", name="uq_notification_def_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(120), nullable=False)              # e.g. "lead.assigned"
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    channel: Mapped[str] = mapped_column(String(40), nullable=False, default="inapp")
    category: Mapped[str] = mapped_column(String(40), nullable=False, default="system", server_default="system")  # legacy: system|billing|network|customer|internal
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="info", server_default="info")      # legacy: critical|warning|info
    title_template: Mapped[str] = mapped_column(String(255), nullable=False)   # "{placeholder}" templates
    body_template: Mapped[str] = mapped_column(String(1000), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    gxl_condition: Mapped[str | None] = mapped_column(String(500), nullable=True)  # optional GXL guard
    # Suppression mode (file 05 NotificationSuppressionMode):
    # NONE (default) | DEDUPLICATE | AGGREGATE | THROTTLE | MUTE
    # NONE      — always deliver
    # DEDUPLICATE — skip if same def_key+user exists within dedup_window_seconds
    # AGGREGATE   — collect multiple into one digest-like delivery (future)
    # THROTTLE    — cap delivery rate per user per window (future)
    # MUTE        — never deliver to inbox or external (audit row still generated)
    suppression_mode: Mapped[str | None] = mapped_column(String(20), nullable=True, default="NONE", server_default="'NONE'")
    # Window for DEDUPLICATE + THROTTLE modes (seconds). NULL = use global default (300s).
    dedup_window_seconds: Mapped[int | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    """An instance in a user's inbox. Rendered from a NotificationDef at emit time.

    Original columns are unchanged — all new columns are nullable (additive).
    See module docstring for the dual-category (Option A) design decision.
    """
    __tablename__ = "notification"
    __table_args__ = (
        Index("ix_notification_user_read", "user_id", "read_at"),
        Index("ix_notification_status", "tenant_id", "status"),
        Index("ix_notification_event_id", "event_id"),
    )

    # ── original columns (UNCHANGED) ─────────────────────────────────────────
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    def_key: Mapped[str] = mapped_column(String(120), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False, default="system", server_default="system")  # legacy vocab
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="info", server_default="info")      # legacy: critical|warning|info
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(String(1000), nullable=False)
    entity_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    digest_pending: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # ── Notification Standard extension — file 05 / D16 ──────────────────────
    # All nullable — existing rows carry NULL; new emits set these where known.

    # D16 — triggering event id (file 05). No FK: events are permanent/immutable,
    # no CASCADE needed. Indexed for Event → Notification trace queries.
    event_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # NotificationSource (file 14):
    # TASK|COMMENT|ATTACHMENT|APPROVAL|ASSIGNMENT|ESCALATION|WATCHER|MENTION|
    # STATUS_CHANGE|AUTOMATION|SYSTEM|INTEGRATION
    source: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Severity (impact axis; priority = urgency axis). File 14 NotificationSeverity:
    # INFO|WARNING|ERROR|CRITICAL
    severity: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # RecipientType (file 14): EMPLOYEE|ROLE|DEPARTMENT|TEAM|CUSTOMER
    # Default EMPLOYEE for backward compat (all existing rows are user_id-addressed employees).
    recipient_type: Mapped[str | None] = mapped_column(String(20), nullable=True,
                                                        default="EMPLOYEE", server_default="'EMPLOYEE'")

    # Option A — canonical NotificationCategory alongside legacy `category`.
    # ACTION_REQUIRED|INFORMATIONAL|WARNING|SUCCESS|ERROR|SECURITY|COMPLIANCE
    std_category: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Full 7-value status state machine (file 14 NotificationStatus):
    # PENDING|DELIVERED|READ|ACKNOWLEDGED|DISMISSED|EXPIRED|FAILED
    # Default DELIVERED — existing rows (already in inbox) are effectively delivered.
    status: Mapped[str | None] = mapped_column(String(20), nullable=True,
                                               default="DELIVERED", server_default="'DELIVERED'")

    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NotificationDelivery(Base):
    """Per-attempt delivery log — one row per channel attempt.

    Append-only in spirit (the notification standard requires delivery history
    to be observable). No CASCADE on notification_id — delivery records outlive
    inbox pruning. channel uses canonical UPPER_SNAKE (IN_APP|EMAIL|SMS|PUSH).
    """
    __tablename__ = "notification_delivery"
    __table_args__ = (
        Index("ix_notif_delivery_notification", "notification_id"),
        Index("ix_notif_delivery_tenant", "tenant_id", "attempted_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    notification_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notification.id"), nullable=False
    )
    # NotificationChannel UPPER_SNAKE (D9: WEBHOOK is not a notification channel).
    channel: Mapped[str] = mapped_column(String(20), nullable=False)  # IN_APP|EMAIL|SMS|PUSH
    # NotificationDeliveryResult (file 14): SENT|DELIVERED|FAILED|REJECTED|BOUNCED|EXPIRED
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    result_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
