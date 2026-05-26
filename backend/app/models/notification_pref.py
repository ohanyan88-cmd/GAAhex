import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, ForeignKey, DateTime, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class NotificationPref(Base):
    """A user's per-category notification preference.

    Two layers live on this one row, both default-on / non-breaking:

    1. **Legacy per-channel opt-out** (`channel`, `enabled`) — a *disabled* row for a category /
       def_key on a channel suppresses that delivery for the user. Absence of a row ⇒ deliver.
       (Kept intact: the in-app inbox-suppression behaviour and its tests rely on it.)

    2. **A26 delivery preference** (`mode`, `channels`, `muted`) — governs EXTERNAL channel delivery
       only; the in-app inbox row is ALWAYS created regardless (the non-breaking invariant).
         - `category`  : a notification category OR a specific def_key, or `"*"` for the user default.
         - `mode`      : `off` | `realtime` | `digest`. Default `realtime`.
             realtime → dispatch externally now (to `channels`); digest → no external send now, the
             notification is flagged `digest_pending=true` (lane E sends the digest later); off →
             in-app inbox only, no external delivery.
         - `channels`  : JSONB list of channels external delivery may use (e.g. `["inapp","email"]`).
             Default `["inapp"]` (inapp is the inbox, always-on; external dispatch only fires for
             channels in this list other than inapp).
         - `muted`     : when true, suppress ALL external delivery for the category (inbox still gets
             the row). Independent of `mode`.

    Resolution (see routers/notifications.resolve_pref): the most specific category row wins, else the
    `"*"` default row, else the implicit default (realtime + inapp). A new-style row carries
    `enabled=True` (default) so it never trips the legacy suppression path; the new fields are purely
    additive and a fresh user with no rows behaves exactly as today.
    """
    __tablename__ = "notification_pref"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "category", "channel", name="uq_notification_pref"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(120), nullable=False)          # a category name OR a def_key OR "*"
    channel: Mapped[str] = mapped_column(String(40), nullable=False, default="inapp")  # legacy opt-out key; "*" for A26 rows
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # ---- A26 delivery preference (additive) ----
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="realtime", server_default="realtime")  # off|realtime|digest
    channels: Mapped[list] = mapped_column(JSONB, nullable=False, default=lambda: ["inapp"], server_default='["inapp"]')
    muted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
