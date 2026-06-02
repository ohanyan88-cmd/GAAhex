"""Reference-number SEQUENCE infrastructure — per-tenant per-prefix atomic counters.

Revision ID: e4f9c2a8b716
Revises: c4f7a9d31e58
Create Date: 2026-06-02

Adds one database function, ``portal_next_refnum(tenant_id uuid, prefix text)``,
which is the SQL-side mirror of ``app.utils.refnum.next_reference_number``:
lazily creates a per-tenant per-prefix SEQUENCE on first call and returns the
next reference-number string (``TSK-000042``, ``REL-000001``, …).

The function exists so triggers / pure-SQL paths (imports, server-side defaults,
seeders) can mint the same reference numbers the Python helper does — without
duplicating the logic in two places that can drift. Application code routes
through ``app.utils.refnum`` (cheap, no PL/pgSQL round-trip); database triggers
and any future server-side defaults route through this function.

Sequence name format (matches the Python helper exactly so both paths share
state)::

    refnum_{prefix_lower}_{tenant_uuid_hex32}

Per-tenant isolation: tenant A's TSK counter and tenant B's TSK counter live
in different sequences and advance independently.

This migration is ADDITIVE only — no existing table or call site is touched.
Migrating callers off ``SELECT COUNT(*) + 1`` is a separate, follow-up phase.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e4f9c2a8b716'
down_revision: Union[str, Sequence[str], None] = 'c4f7a9d31e58'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ``portal_next_refnum`` — SQL-side mirror of app.utils.refnum.next_reference_number.
    #
    # Inputs:
    #   p_tenant_id  uuid   — tenant scope (matches the app-side helper)
    #   p_prefix     text   — short identifier prefix (REL, TSK, INV, …)
    #   p_width      int    — zero-padding width for the numeric portion (default 6)
    #
    # Returns: text — the next reference number, e.g. 'TSK-000042'.
    #
    # Behaviour:
    #   - Validates that ``p_prefix`` matches ``^[A-Za-z0-9_]+$`` so the value is
    #     safe to interpolate into a SQL identifier (defence-in-depth; today no
    #     caller forwards user input here).
    #   - Builds the deterministic sequence name
    #     ``refnum_{lower(prefix)}_{replace(tenant_id::text,'-','')}`` — identical
    #     to the Python helper so both paths share counter state.
    #   - Issues ``CREATE SEQUENCE IF NOT EXISTS`` (idempotent, cheap when the
    #     sequence already exists) and reads ``nextval()`` for the atomic counter.
    #   - Formats as ``{prefix}-{n:0{width}d}`` via ``lpad``.
    op.execute(r"""
        CREATE OR REPLACE FUNCTION portal_next_refnum(
            p_tenant_id uuid,
            p_prefix    text,
            p_width     int DEFAULT 6
        ) RETURNS text AS $$
        DECLARE
            v_seq_name text;
            v_next     bigint;
        BEGIN
            IF p_prefix IS NULL OR p_prefix !~ '^[A-Za-z0-9_]+$' THEN
                RAISE EXCEPTION 'portal_next_refnum: invalid prefix %', p_prefix
                    USING ERRCODE = 'invalid_parameter_value';
            END IF;
            IF p_tenant_id IS NULL THEN
                RAISE EXCEPTION 'portal_next_refnum: tenant_id is required'
                    USING ERRCODE = 'invalid_parameter_value';
            END IF;

            v_seq_name := format(
                'refnum_%s_%s',
                lower(p_prefix),
                replace(p_tenant_id::text, '-', '')
            );

            EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', v_seq_name);
            EXECUTE format('SELECT nextval(%L)', v_seq_name) INTO v_next;

            RETURN p_prefix || '-' || lpad(v_next::text, p_width, '0');
        END;
        $$ LANGUAGE plpgsql;
    """)


def downgrade() -> None:
    # Drop the function but leave the per-tenant SEQUENCEs in place — they're
    # cheap, carry live counter state, and dropping them on a downgrade would
    # reset every reference-number counter in the database. Operators who want
    # to wipe the counters can do so explicitly.
    op.execute("DROP FUNCTION IF EXISTS portal_next_refnum(uuid, text, int);")
