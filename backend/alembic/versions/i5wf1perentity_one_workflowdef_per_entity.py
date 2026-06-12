"""PERFECT-TARGET I5 — exactly one lifecycle WorkflowDef per entity (partial unique index).

Revision ID: i5wf1perentity
Revises: c7d8e9f0a1b2
Create Date: 2026-06-12

Enforces the I5 determinism invariant: an entity has at most ONE lifecycle WorkflowDef. The constraint
is PARTIAL (entity_def_id IS NOT NULL) so the SPEC §5 cross-entity automation rows (entity_def_id NULL,
seeded by seed_workflows.py) are exempt. The existing uq_workflow_def_key (tenant_id, key) only catches
same-KEY duplicates; this catches a 2nd lifecycle WorkflowDef under a DIFFERENT key for the same entity
— the determinism hole CI caught when this index was first attempted (then reverted pending a dedup).

Defensive: a legacy/dirty production DB may already carry duplicate lifecycle WorkflowDefs. The upgrade
DEDUPS first — keeping the earliest (min uuid7 id) per (tenant_id, entity_def_id) and deleting the rest
— so creating the unique index never fails on existing data. The kept row's transitions are re-normalized
to the canonical SST on the next boot by seed_lifecycle_statuses, so dropping the newer duplicate is safe.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'i5wf1perentity'
down_revision: Union[str, Sequence[str], None] = 'c7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) Dedup any legacy duplicate lifecycle WorkflowDefs: keep the earliest per (tenant, entity), drop
    #    the rest. No-op on a clean DB (the current dev/test data already has 0 duplicates).
    # NB: keeper is selected via `ORDER BY w2.id LIMIT 1`, NOT `MIN(w2.id)` — Postgres ships no
    # min(uuid) aggregate, so MIN(id) raises `function min(uuid) does not exist` and the migration
    # could never apply to a real DB (it was only ever validated on create_all, never `upgrade head`).
    # uuid has a btree opclass, so ORDER BY id is valid and yields the same earliest-uuid7 keeper.
    op.execute("""
        DELETE FROM workflow_def w
        WHERE w.entity_def_id IS NOT NULL
          AND w.id <> (
              SELECT w2.id
              FROM workflow_def w2
              WHERE w2.tenant_id = w.tenant_id
                AND w2.entity_def_id = w.entity_def_id
              ORDER BY w2.id
              LIMIT 1
          )
    """)
    # 2) Enforce I5: one lifecycle WorkflowDef per entity (automations with NULL entity_def_id exempt).
    op.create_index(
        'uq_workflow_def_one_per_entity',
        'workflow_def',
        ['entity_def_id'],
        unique=True,
        postgresql_where='entity_def_id IS NOT NULL',
    )


def downgrade() -> None:
    # Drop the index — the ONLY reversible half of this migration. The upgrade's dedup DELETE of
    # duplicate lifecycle WorkflowDef rows is NOT undone here: a DELETE has no inverse, and this
    # downgrade deliberately does not fabricate one (no invented re-insert that would manufacture a
    # reversibility claim the operation cannot honor). Operators who need the deleted duplicates must
    # restore them from a backup taken BEFORE the upgrade ran. The downgrade emits a loud WARNING so
    # this is never silent.
    op.drop_index('uq_workflow_def_one_per_entity', table_name='workflow_def')
    # Loud signal to the OPERATOR running the downgrade (stderr → surfaced in the alembic command
    # output; the server-side RAISE WARNING below only reaches the Postgres log, which asyncpg swallows).
    import sys
    print(
        "WARNING [i5wf1perentity downgrade]: dropped uq_workflow_def_one_per_entity (reversible). "
        "The upgrade's dedup DELETE of duplicate lifecycle WorkflowDefs is IRREVERSIBLE and is NOT "
        "restored — recover those rows from a pre-upgrade backup if you need them.",
        file=sys.stderr,
    )
    op.execute(
        "DO $$ BEGIN "
        "RAISE WARNING 'i5wf1perentity downgrade: dropped uq_workflow_def_one_per_entity. "
        "The upgrade''s dedup DELETE of duplicate lifecycle WorkflowDefs is IRREVERSIBLE and is NOT "
        "restored — recover those rows from a pre-upgrade backup if needed.'; "
        "END $$;"
    )
