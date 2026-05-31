"""kernel: kpi_def.formula_spec + last_computed cache columns

Revision ID: d2bea9d7f819
Revises: c6f3a92e7b81
Create Date: 2026-05-31 06:00:00.000000

The KPI computation engine (see `app/kernel/kpi_engine.py`) needs a structured
formula spec — the existing `formula` text column is free-form (GXL/CEL future)
and not directly executable today. This migration adds:

  - `formula_spec`         JSONB NULL  — structured spec the engine evaluates.
  - `last_computed_at`     TIMESTAMPTZ NULL — cache timestamp (cross-request memo).
  - `last_computed_value`  NUMERIC(20,4) NULL — cached numerical result.

The existing `formula` (VARCHAR(500)) and `denominator` (VARCHAR(255)) columns
are LEFT IN PLACE for backward-compat / human-readable display — they're already
referenced by reports & UI prototypes; dropping them would be a churny break for
zero benefit. The new `formula_spec` is the machine-executable form.

formula_spec shape (documented on KpiDef in code, in docs/kernel-build/KPI-ENGINE.md):

    {"type": "count",       "table": "record", "where": {...}}
    {"type": "ratio",       "numerator": {...}, "denominator": {...}}
    {"type": "stage_total", "stage_key": "lead"}
    {"type": "rate",        "numerator": {...}, "since_days": 30}

Additive + reversible. No data migration. Companion seeder
`seed_kpi_formulas.py::seed_kpi_formulas_if_missing` populates 4–6 of the 14
seeded KPIs with formula_spec on boot (idempotent; SET … WHERE formula_spec IS NULL).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd2bea9d7f819'
down_revision: Union[str, Sequence[str], None] = 'c6f3a92e7b81'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'kpi_def',
        sa.Column('formula_spec', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        'kpi_def',
        sa.Column('last_computed_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'kpi_def',
        sa.Column('last_computed_value', sa.Numeric(precision=20, scale=4), nullable=True),
    )

    op.execute(
        "COMMENT ON COLUMN kpi_def.formula_spec IS "
        "'Structured JSON spec consumed by app/kernel/kpi_engine.py. "
        "Supported shapes: count | ratio | stage_total | rate. "
        "Free-form `formula` column is retained for human-readable display.';"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('kpi_def', 'last_computed_value')
    op.drop_column('kpi_def', 'last_computed_at')
    op.drop_column('kpi_def', 'formula_spec')
