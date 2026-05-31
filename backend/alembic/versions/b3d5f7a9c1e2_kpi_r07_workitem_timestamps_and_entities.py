"""R-07 KPI source data — workitem assignment timestamps + coverage_check + schedule_slot entities.

Three KPIs were formula_spec=NULL because their source data didn't exist (SPEC §9 / R-07):

  1. assignment_sla_compliance — needs assigned_at + first_response_at on workitem.
     We add both as nullable timestamptz columns. No NOT NULL (existing rows have none).
     The formula counts workitems WHERE first_response_at IS NOT NULL AND
     first_response_at <= assigned_at + sla_hours (currently approximated as first_response
     within 4 h of assignment). Denominator = assigned workitems in window.

  2. feasibility_pass_rate — needs a 'coverage_check' entity. Seeded by the app's
     seed_catalog_if_missing at startup; the KPI reads Record WHERE entity_key='coverage_check'
     AND data->>'result' = 'PASS'. No new table needed — uses the generic `record` table.

  3. schedule_fill_rate — needs a 'schedule_slot' entity. Same pattern. KPI reads
     Record WHERE entity_key='schedule_slot' AND data->>'status' = 'FILLED'.

No index is added for the new workitem columns at this stage (tiny row counts in M0).

Revision ID: b3d5f7a9c1e2
Revises: a2c4e6f8b1d3
Create Date: 2026-05-31
"""
import sqlalchemy as sa
from alembic import op


revision = 'b3d5f7a9c1e2'
down_revision = 'a2c4e6f8b1d3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. workitem assignment SLA timestamps
    op.add_column('workitem', sa.Column('assigned_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('workitem', sa.Column('first_response_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('workitem', 'first_response_at')
    op.drop_column('workitem', 'assigned_at')
