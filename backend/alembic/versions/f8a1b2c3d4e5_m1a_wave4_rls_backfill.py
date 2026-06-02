"""M1-A Wave 4: backfill RLS tenant_isolation on the last remaining tenant-scoped tables.

After ``e7f4a2b9c8d1`` (Wave 3) there were still tenant-scoped tables that had never been
given a ``tenant_isolation`` policy — either because they predate the original enable-RLS
migration (``3a9203795d07``) and were skipped, or because they landed on a side branch
without an inline ``CREATE POLICY`` block of their own. This wave closes the gap.

Same pattern as Waves 1/3 and ``642fa959d432`` (notification_pref):

  - ``ALTER TABLE <t> ENABLE ROW LEVEL SECURITY``
  - ``DROP POLICY IF EXISTS tenant_isolation ON <t>`` (idempotent re-run safe)
  - ``CREATE POLICY tenant_isolation ON <t>``
        ``USING      (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)``
        ``WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)``

NULLIF guard: an unset OR reset-to-empty GUC becomes NULL → predicate NULL → row excluded
(default-deny). A bare ``''::uuid`` would raise; this never does. ``true`` is
``missing_ok`` for ``current_setting`` (so it returns NULL instead of raising when the GUC
hasn't been set at all in this session).

Grants are NOT re-issued — ``3a9203795d07`` set ``ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gaahex_app``, so every table created
since then was auto-granted to ``gaahex_app`` at creation time.

Tables covered (31):
  - access:                role_def_deny is NOT here — that table got an inline policy in
                           a7b3c9d5e1f2 (kernel_permissions_engine).
  - party module:          party, account
  - billing module:        subscription, invoice, invoice_line, payment
  - service catalogue:     product, service, service_resource, usage_record
  - configuration:         configuration, configuration_history
  - import/export:         import_job, export_job
  - work + interaction:    task, task_dependency, interaction, comment, comment_mention,
                           attachment, attachment_reference
  - resource pool:         resource_pool, pool_allocation
  - SLA:                   sla_record, sla_event
  - reporting:             report_def
  - orders:                order, order_item
  - outbound / webhooks:   outbound_message, webhook_def, webhook_delivery

Tables explicitly SKIPPED + reason (these have ``tenant_id`` columns but the standard
``tenant_id = current GUC`` policy is unsafe for them):

  - ``stripe_webhook_event``: model docstring states "RLS is NOT applied" — events fired
    from the Stripe dashboard may not carry our ``metadata.tenant_id`` (column is
    nullable). Cross-tenant audit data; isolation is handled by the router instead.
  - ``translation``: ``tenant_id`` is NULLABLE because ``NULL = global default string
    shared across all tenants``. A strict ``tenant_id = <guc>`` policy would HIDE the
    global rows from every tenant and break i18n. ``d2a4f9ad44dd`` (the creation
    migration) already installed a custom ``tenant_id = <guc> OR tenant_id IS NULL``
    policy — there is nothing for this wave to do.

Wave 4 fully closes the M1-A RLS audit.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f8a1b2c3d4e5'
down_revision: Union[str, Sequence[str], None] = '3a86ae0ed044'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 31 tenant-scoped tables that still need the tenant_isolation policy.
# (stripe_webhook_event + translation deliberately omitted — see top-of-file note.)
_TABLES = [
    # party module
    "party",
    "account",
    # billing module
    "subscription",
    "invoice",
    "invoice_line",
    "payment",
    # service catalogue
    "product",
    "service",
    "service_resource",
    "usage_record",
    # configuration
    "configuration",
    "configuration_history",
    # import/export
    "import_job",
    "export_job",
    # work + interaction
    "task",
    "task_dependency",
    "interaction",
    "comment",
    "comment_mention",
    "attachment",
    "attachment_reference",
    # resource pool
    "resource_pool",
    "pool_allocation",
    # SLA
    "sla_record",
    "sla_event",
    # reporting
    "report_def",
    # orders
    "order",
    "order_item",
    # outbound / webhooks
    "outbound_message",
    "webhook_def",
    "webhook_delivery",
]


def upgrade() -> None:
    for table in _TABLES:
        # `order` is a SQL reserved word; double-quote every identifier defensively so any
        # future reserved-word table name is also safe (cheap; same effect on regular names).
        ident = f'"{table}"'
        op.execute(f"ALTER TABLE {ident} ENABLE ROW LEVEL SECURITY;")
        # DROP IF EXISTS first so the migration can be re-run cleanly if a partial state ever
        # arises (e.g. a half-applied previous attempt). The Wave 3 pattern relied on the
        # tables never having had a policy before; Wave 4 is more defensive.
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {ident};")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {ident}
              USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
              WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
        """)


def downgrade() -> None:
    for table in reversed(_TABLES):
        ident = f'"{table}"'
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {ident};")
        op.execute(f"ALTER TABLE {ident} DISABLE ROW LEVEL SECURITY;")
