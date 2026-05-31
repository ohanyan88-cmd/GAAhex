"""Step 2 Wave 1: 22 additive nullable FKs per SPEC §6 relationship map

Revision ID: 60a9edffdefe
Revises: 6389266f4c19
Create Date: 2026-05-31 00:00:00.000000

Pure-additive: adds 21 nullable UUID columns + an index per column + an FK constraint
per column. One row (usage_record.service_id) gets only the index + FK because the column
already exists. NO backfill, NO NOT NULL tightening, NO drops. All cascades RESTRICT except
the soft-link bridges (resource_pool.physical_asset_record_id, service.activation_workitem_id,
calendar_event.*) which use SET NULL.

Source of truth: backend/docs/spec-build/STEP-02-RELATIONSHIP-MAP.md §3 Wave 1 (rows 1-22,
excluding row 19 service.tariff_record_id [deferred: tariff_plan entity_def not seeded] and
row 22 interaction.ticket_id [decision-point: needs explicit form-choice]). Rows 23-25 are
no-ops (already wired). Rows 26-27 add the calendar_event bridges.

Deferred (NOT in this migration):
  - Wave 2 backfill SQL (multi-match ambiguity needs dry-run first)
  - Wave 4 NOT NULL tightening (sparse data; needs tenancy of live data)
  - Wave 5 polymorphic-target denormalized-entity_key CHECK constraints
  - Wave 6 §6.1 service_resource.kind CHECK (needs offender dry-run first)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '60a9edffdefe'
down_revision: Union[str, Sequence[str], None] = '6389266f4c19'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (source_table, column, target_table, target_column, cascade, add_column)
# add_column=False means the column already exists (only add index + FK)
_WAVE1_FKS = [
    # #1-2 payment → customer / account
    ("payment",         "customer_id",                "record",          "id", "RESTRICT", True),
    ("payment",         "account_id",                 "account",         "id", "RESTRICT", True),
    # #3-6 helpdesk_ticket → service / invoice / payment / asset
    ("helpdesk_ticket", "service_id",                 "service",         "id", "RESTRICT", True),
    ("helpdesk_ticket", "invoice_id",                 "invoice",         "id", "RESTRICT", True),
    ("helpdesk_ticket", "payment_id",                 "payment",         "id", "RESTRICT", True),
    ("helpdesk_ticket", "asset_record_id",            "record",          "id", "RESTRICT", True),
    # #7-11 workitem → ticket / service / asset / project / invoice
    ("workitem",        "ticket_id",                  "helpdesk_ticket", "id", "RESTRICT", True),
    ("workitem",        "service_id",                 "service",         "id", "RESTRICT", True),
    ("workitem",        "asset_record_id",            "record",          "id", "RESTRICT", True),
    ("workitem",        "project_record_id",          "record",          "id", "RESTRICT", True),
    ("workitem",        "invoice_id",                 "invoice",         "id", "RESTRICT", True),
    # #12 usage_record.service_id — column already exists; only add index + FK
    ("usage_record",    "service_id",                 "service",         "id", "RESTRICT", False),
    # #13-15 invoice_line → subscription / service / usage_record
    ("invoice_line",    "subscription_id",            "subscription",    "id", "RESTRICT", True),
    ("invoice_line",    "service_id",                 "service",         "id", "RESTRICT", True),
    ("invoice_line",    "usage_record_id",            "usage_record",    "id", "RESTRICT", True),
    # #16-17 order → pipeline_item / subscription  ("order" is reserved; Alembic quotes it)
    ("order",           "pipeline_item_record_id",    "record",          "id", "RESTRICT", True),
    ("order",           "subscription_id",            "subscription",    "id", "RESTRICT", True),
    # #18 service.product_id (replaces 1-hop indirection via subscription)
    ("service",         "product_id",                 "product",         "id", "RESTRICT", True),
    # #20 service.activation_workitem_id (soft-link → SET NULL)
    ("service",         "activation_workitem_id",     "workitem",        "id", "SET NULL", True),
    # #21 §6.1 splitter bridge — physical asset behind a strand pool (soft-link → SET NULL)
    ("resource_pool",   "physical_asset_record_id",   "record",          "id", "SET NULL", True),
    # #26-27 calendar_event bridges (soft-link → SET NULL)
    ("calendar_event",  "customer_record_id",         "record",          "id", "SET NULL", True),
    ("calendar_event",  "helpdesk_ticket_id",         "helpdesk_ticket", "id", "SET NULL", True),
]


def _index_name(table: str, col: str) -> str:
    return f"ix_{table}_{col}"


def _fk_name(table: str, col: str) -> str:
    return f"fk_{table}_{col}"


def upgrade() -> None:
    for source, col, target, target_col, cascade, add_col in _WAVE1_FKS:
        if add_col:
            op.add_column(source, sa.Column(col, sa.UUID(), nullable=True))
        op.create_index(_index_name(source, col), source, [col], unique=False)
        op.create_foreign_key(
            _fk_name(source, col),
            source,
            target,
            [col],
            [target_col],
            ondelete=cascade,
        )


def downgrade() -> None:
    for source, col, target, target_col, cascade, add_col in reversed(_WAVE1_FKS):
        op.drop_constraint(_fk_name(source, col), source, type_="foreignkey")
        op.drop_index(_index_name(source, col), table_name=source)
        if add_col:
            op.drop_column(source, col)
