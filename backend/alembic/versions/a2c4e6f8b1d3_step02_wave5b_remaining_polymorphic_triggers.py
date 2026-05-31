"""Step 2 Wave 5b — remaining polymorphic-target validation triggers (SPEC §6)

The generic validation function `spec6_check_polymorphic_record_kind` was added in Wave 5
(d5b9c6f4e21a). This migration attaches trigger wrappers to the 4 columns that were deferred
because their target entity_def seeds were not ready at that time. The function itself does NOT
require an entity_def row — it reads `entity_key` from the `record` row directly. NULL target
→ pass (FK handles dangling). Missing record → pass (vanilla FK handles it).

Columns wired:
  - helpdesk_ticket.asset_record_id  → entity_key='asset'
  - workitem.asset_record_id         → entity_key='asset'
  - order.pipeline_item_record_id    → entity_key='pipeline_item'
  - resource_pool.physical_asset_record_id → entity_key='asset'

Pre-flight: all 4 columns have 0 populated rows on the live dev DB. Safe to enable.

Revision ID: a2c4e6f8b1d3
Revises: f1a3b8d27e64
Create Date: 2026-05-31
"""
from alembic import op


revision = 'a2c4e6f8b1d3'
down_revision = 'f1a3b8d27e64'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # helpdesk_ticket.asset_record_id → entity_key='asset'
    op.execute("""
        CREATE OR REPLACE FUNCTION spec6_ticket_asset_check() RETURNS trigger AS $$
        BEGIN
            PERFORM spec6_check_polymorphic_record_kind(NEW.asset_record_id, 'asset');
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("DROP TRIGGER IF EXISTS spec6_ticket_asset_record_kind ON helpdesk_ticket;")
    op.execute("""
        CREATE TRIGGER spec6_ticket_asset_record_kind
            BEFORE INSERT OR UPDATE OF asset_record_id ON helpdesk_ticket
            FOR EACH ROW EXECUTE FUNCTION spec6_ticket_asset_check();
    """)

    # workitem.asset_record_id → entity_key='asset'
    op.execute("""
        CREATE OR REPLACE FUNCTION spec6_workitem_asset_check() RETURNS trigger AS $$
        BEGIN
            PERFORM spec6_check_polymorphic_record_kind(NEW.asset_record_id, 'asset');
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("DROP TRIGGER IF EXISTS spec6_workitem_asset_record_kind ON workitem;")
    op.execute("""
        CREATE TRIGGER spec6_workitem_asset_record_kind
            BEFORE INSERT OR UPDATE OF asset_record_id ON workitem
            FOR EACH ROW EXECUTE FUNCTION spec6_workitem_asset_check();
    """)

    # order.pipeline_item_record_id → entity_key='pipeline_item'
    op.execute("""
        CREATE OR REPLACE FUNCTION spec6_order_pipeline_item_check() RETURNS trigger AS $$
        BEGIN
            PERFORM spec6_check_polymorphic_record_kind(NEW.pipeline_item_record_id, 'pipeline_item');
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("DROP TRIGGER IF EXISTS spec6_order_pipeline_item_record_kind ON \"order\";")
    op.execute("""
        CREATE TRIGGER spec6_order_pipeline_item_record_kind
            BEFORE INSERT OR UPDATE OF pipeline_item_record_id ON "order"
            FOR EACH ROW EXECUTE FUNCTION spec6_order_pipeline_item_check();
    """)

    # resource_pool.physical_asset_record_id → entity_key='asset'
    op.execute("""
        CREATE OR REPLACE FUNCTION spec6_respool_asset_check() RETURNS trigger AS $$
        BEGIN
            PERFORM spec6_check_polymorphic_record_kind(NEW.physical_asset_record_id, 'asset');
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("DROP TRIGGER IF EXISTS spec6_respool_asset_record_kind ON resource_pool;")
    op.execute("""
        CREATE TRIGGER spec6_respool_asset_record_kind
            BEFORE INSERT OR UPDATE OF physical_asset_record_id ON resource_pool
            FOR EACH ROW EXECUTE FUNCTION spec6_respool_asset_check();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS spec6_respool_asset_record_kind ON resource_pool;")
    op.execute("DROP FUNCTION IF EXISTS spec6_respool_asset_check();")
    op.execute("DROP TRIGGER IF EXISTS spec6_order_pipeline_item_record_kind ON \"order\";")
    op.execute("DROP FUNCTION IF EXISTS spec6_order_pipeline_item_check();")
    op.execute("DROP TRIGGER IF EXISTS spec6_workitem_asset_record_kind ON workitem;")
    op.execute("DROP FUNCTION IF EXISTS spec6_workitem_asset_check();")
    op.execute("DROP TRIGGER IF EXISTS spec6_ticket_asset_record_kind ON helpdesk_ticket;")
    op.execute("DROP FUNCTION IF EXISTS spec6_ticket_asset_check();")
