"""Step 2 Wave 5 — polymorphic-target validation triggers (SPEC §6)

Polymorphic FKs that point to `record.id` need an additional invariant: the target record
must have the expected `entity_key`. A vanilla FK only checks "row exists"; we need
"row exists AND it's the right kind". PostgreSQL CHECK can't do cross-row, so we use triggers.

This migration adds the validation function + attaches it to 2 polymorphic FKs whose target
entity_def exists in M0:
  - workitem.project_record_id      → must point to a record with entity_key='project'
  - calendar_event.customer_record_id → must point to a record with entity_key='customer'

Deferred (target entity_def not seeded):
  - helpdesk_ticket.asset_record_id  → needs 'asset' entity_def
  - workitem.asset_record_id         → needs 'asset' entity_def
  - order.pipeline_item_record_id    → needs 'pipeline_item' entity_def
  - resource_pool.physical_asset_record_id → needs 'asset' entity_def

Add triggers for those when their entity_defs land.

Pre-flight (2026-05-31 live DB): both columns have 0 populated rows. Safe to enable.

Revision ID: d5b9c6f4e21a
Revises: c4a1b5e7d29f
Create Date: 2026-05-31
"""
from alembic import op


revision = 'd5b9c6f4e21a'
down_revision = 'c4a1b5e7d29f'
branch_labels = None
depends_on = None


_FN_NAME = 'spec6_check_polymorphic_record_kind'


def upgrade() -> None:
    # Generic validator: takes (target_record_id, expected_entity_key), raises on mismatch.
    # NULL target → pass (nullable FK). Missing target → pass (the FK constraint catches it).
    # Wrong entity_key → RAISE EXCEPTION with SPEC §6 citation.
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

    op.execute("""
        CREATE OR REPLACE FUNCTION spec6_workitem_project_check() RETURNS trigger AS $$
        BEGIN
            PERFORM spec6_check_polymorphic_record_kind(NEW.project_record_id, 'project');
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("DROP TRIGGER IF EXISTS spec6_workitem_project_record_kind ON workitem;")
    op.execute("""
        CREATE TRIGGER spec6_workitem_project_record_kind
            BEFORE INSERT OR UPDATE OF project_record_id ON workitem
            FOR EACH ROW EXECUTE FUNCTION spec6_workitem_project_check();
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION spec6_calendar_event_customer_check() RETURNS trigger AS $$
        BEGIN
            PERFORM spec6_check_polymorphic_record_kind(NEW.customer_record_id, 'customer');
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("DROP TRIGGER IF EXISTS spec6_calendar_event_customer_record_kind ON calendar_event;")
    op.execute("""
        CREATE TRIGGER spec6_calendar_event_customer_record_kind
            BEFORE INSERT OR UPDATE OF customer_record_id ON calendar_event
            FOR EACH ROW EXECUTE FUNCTION spec6_calendar_event_customer_check();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS spec6_calendar_event_customer_record_kind ON calendar_event;")
    op.execute("DROP FUNCTION IF EXISTS spec6_calendar_event_customer_check();")
    op.execute("DROP TRIGGER IF EXISTS spec6_workitem_project_record_kind ON workitem;")
    op.execute("DROP FUNCTION IF EXISTS spec6_workitem_project_check();")
    op.execute(f"DROP FUNCTION IF EXISTS {_FN_NAME}(uuid, text);")
