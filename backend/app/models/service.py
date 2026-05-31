"""Service & resource inventory (doc 19) — kept THIN: what the ISP delivers + its lifecycle, plus
a freeform record of the resources a service consumes. Deliberately NOT a network controller —
"adapters not core": real gear/EMS integration slots in behind this inventory later.

Mirrors the billing/record style (UUID, tenant_id, owner_node_id, timestamps); tenant + org scoped;
emits audit Events. Sits at the end of the chain: order → subscription → service."""
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Service(Base):
    """A provisioned service for a customer (e.g. an internet line). Optionally linked to the
    Subscription it fulfills."""
    __tablename__ = "service"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id"), nullable=True, index=True)
    account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("account.id"), nullable=True, index=True)  # additive (17a) — null = pre-Account row; resolve via customer_id
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("subscription.id"), nullable=True, index=True)
    type: Mapped[str] = mapped_column(String(40), nullable=False, default="service")   # internet|tv|voip|hosting|… (free string)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")  # PENDING|ACTIVE|SUSPENDED|TERMINATED
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # SPEC §6 Wave 1 (additive, nullable): direct product link (today reached via subscription),
    # and soft-link to the WorkItem that activated this service. service.tariff_record_id (#19)
    # is DEFERRED until the tariff_plan entity_def is seeded.
    product_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("product.id", ondelete="RESTRICT"), nullable=True, index=True)
    activation_workitem_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("workitem.id", ondelete="SET NULL"), nullable=True, index=True)


class ServiceResource(Base):
    """A resource a service consumes — freeform inventory (an IP, MAC, port, device, circuit…).
    Released resources keep their row (status RELEASED) for history, never hard-deleted."""
    __tablename__ = "service_resource"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    service_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("service.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)                       # ip|mac|port|device|circuit|other
    value: Mapped[str] = mapped_column(String(255), nullable=False)                     # the identifier, e.g. "10.0.0.5"
    label: Mapped[str | None] = mapped_column(String(160), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ALLOCATED")  # ALLOCATED|RELEASED
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
