"""Enforce I5 (determinism): at most ONE lifecycle WorkflowDef per entity_def.

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-06-12

PERFECT-TARGET-ARCHITECTURE invariant I5 — one source of truth, no ambiguity. A partial unique index on
workflow_def(entity_def_id) WHERE entity_def_id IS NOT NULL makes a duplicate entity-lifecycle workflow
impossible (the `.first()` roulette that forced the Step-4 fallback can never reappear at 50 tenants).
The NULL-entity rows (SPEC §5 cross-entity workflows W1..W5) are intentionally excluded by the partial
predicate. Verified before writing: every non-null entity_def_id currently has exactly one row.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd8e9f0a1b2c3'
down_revision: Union[str, Sequence[str], None] = 'c7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        'uq_workflow_def_one_per_entity',
        'workflow_def',
        ['entity_def_id'],
        unique=True,
        postgresql_where=sa.text('entity_def_id IS NOT NULL'),
    )


def downgrade() -> None:
    op.drop_index('uq_workflow_def_one_per_entity', table_name='workflow_def')
