from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, func, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class User(Base):
    """A person who logs in. Belongs to a tenant; sits on an org node (primary, for M0)."""
    __tablename__ = "app_user"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True
    )
    primary_node_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="active")
    # Profile avatar stored as a self-contained base64 `data:` URL (Text — a data URL for a ≤2MB image
    # is ~2.7MB, well past varchar limits). Nullable: no avatar by default. Chosen over a filesystem
    # uploads dir because this codebase serves no static files and runs in-process/containerized — a
    # data URL travels with the row (RLS-scoped, survives restarts, works in tests with no shared volume)
    # and drops straight into an <img src>.
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # SPEC §4.1 home department (Sales, Billing, NOC, Customer Care, HR, Finance, …). The Department
    # layer in the 4-way AND evaluated by app.kernel.invariants.assert_can. Nullable until
    # backfill — NULL = no department membership (the kernel treats it accordingly).
    department: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Last time this user's password was changed. NULL = seeded/never-changed. The login handler
    # uses NULL + a known seeded email (admin@demo.isp) to force a first-login password change.
    # /api/me/password stamps this on successful change.
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Workspace module (/api/me/workspace-role) — admin-set primary workspace role + the user's
    # manual override. Both nullable; the resolver falls back to Assignment.role.key when both are
    # NULL, and to 'general' when nothing maps. Kept as plain String(40) (not an FK) because the
    # value space is the frontend LayoutRegistry, NOT role_def.key — see ROLE_DEF_TO_WORKSPACE
    # in app/routers/workspace.py for the mapping.
    primary_role_key: Mapped[str | None] = mapped_column(String(40), nullable=True)
    workspace_role_override: Mapped[str | None] = mapped_column(String(40), nullable=True)
