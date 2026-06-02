"""background_job_standard_extension

Revision ID: 89518e0c00a7
Revises: 3c31f1734821
Create Date: 2026-06-02

Background Job Standard (file 12, std 68) rollout — extends ``job_run`` with
the fields required by the standard. All new columns are NULLABLE so the
existing two J96 insertion sites (POST /api/invoices/run-dunning,
POST /api/billing/run-cycle) keep working with no code change; new code can
populate the richer schema incrementally.

Columns added (13):
    job_status         varchar(20)  NULL  DEFAULT 'PENDING'
    reference_number   varchar(20)  NULL                  -- JOB-NNNNNN
    job_type           varchar(80)  NULL
    queue_name         varchar(80)  NULL  DEFAULT 'default'
    priority           varchar(20)  NULL  DEFAULT 'NORMAL'
    retry_count        integer      NULL  DEFAULT 0
    max_retries        integer      NULL  DEFAULT 3
    idempotency_key    varchar(200) NULL
    correlation_id     uuid         NULL
    causation_id       uuid         NULL
    payload_reference  varchar(500) NULL
    error_code         varchar(50)  NULL
    error_message      text         NULL

Constraints / indexes added (2):
    UNIQUE (tenant_id, reference_number)
        — per-tenant uniqueness of the human JOB-NNNNNN id; NULLs allowed
          and don't collide (Postgres treats NULLs as distinct in UNIQUE).
    UNIQUE INDEX (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
        — idempotency uniqueness only applies to rows that opt in by providing
          a key; partial index keeps the legacy rows (NULL key) out of scope.

Data backfill (1):
    UPDATE job_run SET job_status = CASE
        WHEN status = 'SUCCESS' THEN 'SUCCEEDED'
        WHEN status = 'ERROR'   THEN 'FAILED'
        ELSE 'PENDING'
    END
    — maps the legacy 2-value vocabulary to the file 14 BackgroundJobStatus
      enum. The legacy ``status`` column itself is left alone so old readers
      keep working; new code reads ``job_status``.

``reference_number`` backfill is deliberately deferred — minting JOB-NNNNNN
for historical rows is a separate housekeeping job (per-tenant sequence
allocation, audit trail), out of scope here.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '89518e0c00a7'
down_revision: Union[str, Sequence[str], None] = '3c31f1734821'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the 13 columns, the UNIQUE constraint, the partial UNIQUE index,
    then backfill ``job_status`` from the legacy ``status`` column."""

    # ── 13 column adds ───────────────────────────────────────────────────────
    op.add_column(
        "job_run",
        sa.Column(
            "job_status",
            sa.String(length=20),
            nullable=True,
            server_default=sa.text("'PENDING'"),
        ),
    )
    op.add_column(
        "job_run",
        sa.Column("reference_number", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "job_run",
        sa.Column("job_type", sa.String(length=80), nullable=True),
    )
    op.add_column(
        "job_run",
        sa.Column(
            "queue_name",
            sa.String(length=80),
            nullable=True,
            server_default=sa.text("'default'"),
        ),
    )
    op.add_column(
        "job_run",
        sa.Column(
            "priority",
            sa.String(length=20),
            nullable=True,
            server_default=sa.text("'NORMAL'"),
        ),
    )
    op.add_column(
        "job_run",
        sa.Column(
            "retry_count",
            sa.Integer(),
            nullable=True,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "job_run",
        sa.Column(
            "max_retries",
            sa.Integer(),
            nullable=True,
            server_default=sa.text("3"),
        ),
    )
    op.add_column(
        "job_run",
        sa.Column("idempotency_key", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "job_run",
        sa.Column("correlation_id", sa.UUID(), nullable=True),
    )
    op.add_column(
        "job_run",
        sa.Column("causation_id", sa.UUID(), nullable=True),
    )
    op.add_column(
        "job_run",
        sa.Column("payload_reference", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "job_run",
        sa.Column("error_code", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "job_run",
        sa.Column("error_message", sa.Text(), nullable=True),
    )

    # ── 1 UNIQUE constraint ──────────────────────────────────────────────────
    op.create_unique_constraint(
        "uq_job_run_tenant_reference_number",
        "job_run",
        ["tenant_id", "reference_number"],
    )

    # ── 1 partial UNIQUE index (idempotency_key opt-in) ──────────────────────
    op.create_index(
        "uq_job_run_tenant_idempotency_key",
        "job_run",
        ["tenant_id", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )

    # ── 1 backfill UPDATE ────────────────────────────────────────────────────
    # Map the legacy 2-value status to the file 14 BackgroundJobStatus enum.
    # CASE keeps unexpected legacy values from breaking the update — fallback
    # is PENDING (matches the column default for fresh rows).
    op.execute(
        """
        UPDATE job_run
        SET job_status = CASE
            WHEN status = 'SUCCESS' THEN 'SUCCEEDED'
            WHEN status = 'ERROR'   THEN 'FAILED'
            ELSE 'PENDING'
        END
        """
    )


def downgrade() -> None:
    """Drop the partial UNIQUE index, the UNIQUE constraint, then the 13 columns
    in reverse order. Backfilled ``job_status`` values are discarded with the
    column drop; the legacy ``status`` column is untouched on either path."""

    op.drop_index("uq_job_run_tenant_idempotency_key", table_name="job_run")
    op.drop_constraint(
        "uq_job_run_tenant_reference_number", "job_run", type_="unique"
    )

    op.drop_column("job_run", "error_message")
    op.drop_column("job_run", "error_code")
    op.drop_column("job_run", "payload_reference")
    op.drop_column("job_run", "causation_id")
    op.drop_column("job_run", "correlation_id")
    op.drop_column("job_run", "idempotency_key")
    op.drop_column("job_run", "max_retries")
    op.drop_column("job_run", "retry_count")
    op.drop_column("job_run", "priority")
    op.drop_column("job_run", "queue_name")
    op.drop_column("job_run", "job_type")
    op.drop_column("job_run", "reference_number")
    op.drop_column("job_run", "job_status")
