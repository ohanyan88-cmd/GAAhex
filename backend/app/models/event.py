"""Event log — the canonical audit log table for GAAex.

SPEC §0.4 AUDIT APPEND-ONLY (kernel invariant, alembic revision b70ef3b98e27):
  The `event` table carries DB-level BEFORE UPDATE and BEFORE DELETE triggers
  (`prevent_update_event`, `prevent_delete_event`) that raise an exception on ANY edit or delete
  attempt. The audit log cannot be modified by ANY role, including Admin. Only INSERTs are legal.
  The triggers enforce this at the database layer below the application so the invariant holds
  even against raw SQL access by a privileged operator (short of dropping the trigger itself,
  which would be a DDL-visible action).
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Event(Base):
    """A domain event emitted by the kernel (M4: workflow transitions). Foundation for the
    audit log (M5). Append-only in spirit AND enforced at the DB layer (see module docstring)."""
    __tablename__ = "event"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(80), nullable=False)          # e.g. "transition"
    entity_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    data: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
