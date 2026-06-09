from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy_utils import LtreeType

from .base import Base


class OrgNode(Base):
    """The recursive org spine: Group → Region → OpCo → BU → Division → Department → Team → Squad.

    `path` is a Postgres ltree (dot-separated, ltree-safe code labels) — it makes
    subtree / ancestor queries and rollups cheap. Variable depth, configured per tenant.
    """
    __tablename__ = "org_node"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True
    )
    type: Mapped[str] = mapped_column(String(50), nullable=False)  # Group|Region|OpCo|BU|Division|Department|Team|Squad
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    path: Mapped[str] = mapped_column(LtreeType, nullable=False)
    # SPEC §4.1 Region layer — stable region projection used by the kernel `assert_can` to resolve
    # "what region is this assignment in?" without parsing the ltree at request time. Nullable;
    # when NULL the kernel falls back to the node's own id as a region surrogate.
    region_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # created_at / updated_at: org structure is edited infrequently but the history matters for
    # rollup / audit diffing (e.g. "when was this Division added?"). updated_at also lets the
    # front-end cache bust org-tree queries cheaply. No soft-delete here — removal of a node
    # is a structural operation governed by the workflow engine (reassign children first).
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, onupdate=func.now()
    )
