"""kernel: permissions engine — Dept/Region columns + role_def_deny table

Revision ID: a7b3c9d5e1f2
Revises: d4f8a1c6b3e5
Create Date: 2026-05-31 00:00:00.000000

Step 6 of the Cross-Module Architecture SPEC kernel build (SPEC §4 Permissions Model,
SPEC §0 Invariant #2 default-deny). Additive + reversible.

This migration adds the schema that the SPEC §4.1 four-layer AND evaluator (Role × Department ×
Region × Ownership) needs to read:

  - `app_user.department TEXT NULL`             — the user's home department (SPEC §4.1 layer).
                                                  Backfill via seeds; NULL preserved for legacy
                                                  rows. The kernel `assert_can` treats NULL on
                                                  the user side as "no department membership" and
                                                  refuses department-scoped grants accordingly.
  - `assignment.department TEXT NULL`           — optional per-assignment department filter. If
                                                  set, the assignment only applies when acting in
                                                  that department context. NULL = "any department"
                                                  (the existing semantics).
  - `assignment.region_scope TEXT NULL`         — one of 'home_only' | 'subtree' | 'any' (or NULL
                                                  for legacy). Controls how the region partition
                                                  is widened from the assignment's node_id. NULL
                                                  is read by the kernel as 'home_only'.
  - `org_node.region_code TEXT NULL`            — stable region code projection from the ltree
                                                  path. Today regions are encoded as `Region` type
                                                  org_node rows; this column lets the kernel
                                                  resolve "what region is this assignment in?"
                                                  without ltree parsing at request time.
                                                  Backfilled lazily by the kernel/seeders.
  - `role_def_deny`                             — NEW table. SPEC §4.3 role hard-denials (the
                                                  "cannot lists" — sales cannot edit audit log,
                                                  admin cannot delete audit, etc.). One row per
                                                  (role, denied_action, denied_entity_key) tuple.
                                                  Wildcard support via '*' in either column.

The kernel reads these columns in `app.kernel.invariants.assert_can`. None of the columns are
NOT NULL — adoption is transitional, and the kernel falls back to role-only gating (with a
WARNING log) when callers haven't yet started passing region/department context.

SPEC §4.4 (field-level encryption) and §4.5 (mandatory approvals) are SEPARATE concerns and not
touched here — they land in later steps.

Tenant-isolation RLS on `role_def_deny` follows the same NULLIF-guarded pattern as `stage_def` /
`kpi_def` from Step 1 — keeps the default-deny invariant intact at the row level too.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7b3c9d5e1f2'
down_revision: Union[str, Sequence[str], None] = 'd4f8a1c6b3e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # ------------------------------------------------------------------ app_user.department
    op.add_column(
        'app_user',
        sa.Column('department', sa.String(length=80), nullable=True),
    )
    op.execute(
        "COMMENT ON COLUMN app_user.department IS "
        "'SPEC §4.1 home department (Sales, Billing, NOC, Customer Care, HR, Finance, etc.). "
        "Used by app.kernel.invariants.assert_can as the Department layer in the 4-way AND. "
        "Nullable until backfill — NULL = no department membership.';"
    )

    # ------------------------------------------------------------------ assignment.department + region_scope
    op.add_column(
        'assignment',
        sa.Column('department', sa.String(length=80), nullable=True),
    )
    op.execute(
        "COMMENT ON COLUMN assignment.department IS "
        "'Optional department filter on this assignment. If set, the assignment only applies "
        "when acting in that department context. NULL = any department (the legacy semantics).';"
    )
    op.add_column(
        'assignment',
        sa.Column('region_scope', sa.String(length=20), nullable=True),
    )
    op.execute(
        "COMMENT ON COLUMN assignment.region_scope IS "
        "'How wide this assignment reaches across the region partition. One of "
        "''home_only'' (default, only the assigned node), ''subtree'' (the node and its "
        "descendants), or ''any'' (cross-region). NULL is read as ''home_only'' by the kernel.';"
    )

    # ------------------------------------------------------------------ org_node.region_code
    op.add_column(
        'org_node',
        sa.Column('region_code', sa.String(length=80), nullable=True),
    )
    op.execute(
        "COMMENT ON COLUMN org_node.region_code IS "
        "'Stable region code projection from the ltree path. The kernel resolves an "
        "assignment.node_id → region_code via this column instead of parsing the ltree at "
        "request time. Backfilled lazily — when NULL, the kernel falls back to the node''s "
        "own id as a region surrogate.';"
    )

    # ------------------------------------------------------------------ role_def_deny (SPEC §4.3)
    op.create_table(
        'role_def_deny',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('role_id', sa.UUID(), nullable=False),
        sa.Column('denied_action', sa.String(length=80), nullable=False),
        sa.Column('denied_entity_key', sa.String(length=80), nullable=True),
        sa.Column('reason', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.ForeignKeyConstraint(['role_id'], ['role_def.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        # NULL is a legitimate value for `denied_entity_key` (it means "any entity") — we want at
        # most one deny row per (tenant, role, action, entity) tuple INCLUDING the NULL case. A
        # plain UniqueConstraint treats NULLs as distinct in Postgres, which would let duplicates
        # through. The COALESCE-based partial index below handles both halves.
    )
    op.create_index(
        op.f('ix_role_def_deny_tenant_id'),
        'role_def_deny', ['tenant_id'], unique=False,
    )
    op.create_index(
        op.f('ix_role_def_deny_role_id'),
        'role_def_deny', ['role_id'], unique=False,
    )
    # Coalesce NULL entity_key to a sentinel so the dedupe key is total — no duplicates slip
    # through on the "deny entity_key=NULL" branch.
    op.execute("""
        CREATE UNIQUE INDEX uq_role_def_deny_key
          ON role_def_deny (tenant_id, role_id, denied_action,
                            COALESCE(denied_entity_key, '__any__'));
    """)
    op.execute(
        "COMMENT ON TABLE role_def_deny IS "
        "'SPEC §4.3 role hard-denials — the role.cannot list. Evaluated by "
        "app.kernel.invariants.assert_can AFTER the role grant check: a matching deny row "
        "raises AccessDenied even if the role''s positive permissions would have allowed it. "
        "Wildcards: denied_action=''*'' denies all verbs; denied_entity_key=NULL denies any "
        "entity for that action; denied_action=''invoice.*'' style is encoded as "
        "(denied_action=''*'', denied_entity_key=''invoice'').';"
    )

    # SPEC §0.2 default-deny posture is satisfied here too: the new role_def_deny rows are
    # tenant-isolated via the standard NULLIF-guarded policy so a tenant can't see another
    # tenant's denials.
    op.execute("ALTER TABLE role_def_deny ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON role_def_deny
          USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON role_def_deny;")
    op.execute("ALTER TABLE role_def_deny DISABLE ROW LEVEL SECURITY;")
    op.execute("DROP INDEX IF EXISTS uq_role_def_deny_key;")
    op.drop_index(op.f('ix_role_def_deny_role_id'), table_name='role_def_deny')
    op.drop_index(op.f('ix_role_def_deny_tenant_id'), table_name='role_def_deny')
    op.drop_table('role_def_deny')

    op.drop_column('org_node', 'region_code')
    op.drop_column('assignment', 'region_scope')
    op.drop_column('assignment', 'department')
    op.drop_column('app_user', 'department')
