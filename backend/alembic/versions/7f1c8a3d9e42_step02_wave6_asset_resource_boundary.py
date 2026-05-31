"""Step 2 Wave 6 — SPEC §6.1 Asset vs Resource boundary: refuse asset-shaped kinds on service_resource

Per SPEC §6.1: Asset = physical item with serial (router, ONT, splitter HW, fiber cable) — owned by
Asset Management (record table). Resource = logical allocatable (IP, VLAN, port, fiber strand,
capacity slot) — owned by Resource Inventory (service_resource table). **No record lives in both.**

This CHECK constraint refuses asset-shaped kinds on `service_resource.kind`. Pre-flight check
against the live dev DB (2026-05-31) showed only `kind='ip'` rows — no asset offenders to relocate
first.

Forbidden: device, asset, router, ont, splitter, cable, hardware
Allowed:   ip, mac, vlan, port, circuit, fiber_strand, capacity, other (logical / allocatable)

Revision ID: 7f1c8a3d9e42
Revises: 60a9edffdefe
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa

revision = '7f1c8a3d9e42'
down_revision = '60a9edffdefe'
branch_labels = None
depends_on = None


_FORBIDDEN = ('device', 'asset', 'router', 'ont', 'splitter', 'cable', 'hardware')
_CONSTRAINT_NAME = 'ck_service_resource_kind_not_asset_shaped'


def upgrade() -> None:
    op.create_check_constraint(
        _CONSTRAINT_NAME,
        'service_resource',
        f"kind NOT IN {_FORBIDDEN!r}",
    )


def downgrade() -> None:
    op.drop_constraint(_CONSTRAINT_NAME, 'service_resource', type_='check')
