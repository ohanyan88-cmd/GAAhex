"""Fix spec6 polymorphic-target validator to use record.entity_key (schema drift repair)

The original function (migration d5b9c6f4e21a) read the target record's kind via
`record r JOIN entity_def e ON e.id = r.entity_def_id`. A later refactor collapsed the
`record.entity_def_id` FK into a denormalized `record.entity_key` text column and dropped
the `entity_def_id` column entirely. The trigger function was never updated, so it still
references the now-nonexistent `r.entity_def_id`.

Effect of the bug: the BEFORE INSERT/UPDATE triggers on `calendar_event.customer_record_id`
and `workitem.project_record_id` raise
`UndefinedColumnError: column r.entity_def_id does not exist` on EVERY insert/update that
touches those columns — not just in dev seeding. This silently blocked all CalendarEvent
creation tied to a customer (and the equivalent WorkItem path) in production code paths too.

Fix: replace the join with a direct read of `record.entity_key`. Behavior is otherwise
identical (NULL target → pass, missing target → pass, mismatch → RAISE check_violation).
The two trigger wrapper functions and the triggers themselves are unchanged — they only
call this validator, so a CREATE OR REPLACE of the validator is sufficient.

Revision ID: f1a2b3c4d5e6
Revises: c4e7a1f9b3d2
Create Date: 2026-06-06
"""
from alembic import op


revision = 'f1a2b3c4d5e6'
down_revision = 'c4e7a1f9b3d2'
branch_labels = None
depends_on = None


_FN_NAME = 'spec6_check_polymorphic_record_kind'


def upgrade() -> None:
    # entity_key now lives directly on record — read it instead of joining entity_def.
    op.execute(f"""
        CREATE OR REPLACE FUNCTION {_FN_NAME}(p_record_id uuid, p_expected_key text)
        RETURNS void AS $$
        DECLARE
            v_actual text;
        BEGIN
            IF p_record_id IS NULL THEN
                RETURN;
            END IF;
            SELECT r.entity_key INTO v_actual
              FROM record r
             WHERE r.id = p_record_id;
            IF v_actual IS NULL THEN
                RETURN;  -- vanilla FK will handle dangling refs
            END IF;
            IF v_actual <> p_expected_key THEN
                RAISE EXCEPTION 'SPEC §6 polymorphic violation: expected entity_key=%, got %', p_expected_key, v_actual
                  USING ERRCODE = 'check_violation';
            END IF;
        END;
        $$ LANGUAGE plpgsql STABLE;
    """)


def downgrade() -> None:
    # Restore the pre-fix (broken-against-current-schema) definition for exact reversibility.
    op.execute(f"""
        CREATE OR REPLACE FUNCTION {_FN_NAME}(p_record_id uuid, p_expected_key text)
        RETURNS void AS $$
        DECLARE
            v_actual text;
        BEGIN
            IF p_record_id IS NULL THEN
                RETURN;
            END IF;
            SELECT e.key INTO v_actual
              FROM record r JOIN entity_def e ON e.id = r.entity_def_id
             WHERE r.id = p_record_id;
            IF v_actual IS NULL THEN
                RETURN;  -- vanilla FK will handle dangling refs
            END IF;
            IF v_actual <> p_expected_key THEN
                RAISE EXCEPTION 'SPEC §6 polymorphic violation: expected entity_key=%, got %', p_expected_key, v_actual
                  USING ERRCODE = 'check_violation';
            END IF;
        END;
        $$ LANGUAGE plpgsql STABLE;
    """)
