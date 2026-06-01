"""Phase B.2 — Dunning engine: dunning_policy + dunning_case + service_action_log.

Three first-class physical tables:
* ``dunning_policy``     — config-driven steps_json (ordered ascending by day_offset).
* ``dunning_case``       — per-(account, triggering_invoice) state machine.
* ``service_action_log`` — every adapter side-effect (one row per action).

Seeds ONE default policy per existing tenant with the canonical sequence:
  3d/notice → 7d/notice → 14d/throttle (256kbps) → 21d/walled_garden → 45d/terminate.

Revision ID: c9f5a3b7e2d1
Revises: b8e4d2f7a1c9
Create Date: 2026-06-01
"""
import json
import sqlalchemy as sa
from alembic import op


revision = 'c9f5a3b7e2d1'
down_revision = 'b8e4d2f7a1c9'
branch_labels = None
depends_on = None


_DEFAULT_POLICY_STEPS = [
    {"day_offset": 3,  "action": "notice",        "params": {"template": "dunning_notice_1"}},
    {"day_offset": 7,  "action": "notice",        "params": {"template": "dunning_notice_2"}},
    {"day_offset": 14, "action": "throttle",      "params": {"kbps": 256}},
    {"day_offset": 21, "action": "walled_garden", "params": {"redirect_url": "https://payment.example.com"}},
    {"day_offset": 45, "action": "terminate",     "params": {}},
]


def upgrade() -> None:
    # ---- 1. dunning_policy ----
    op.create_table(
        'dunning_policy',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('name', sa.String(160), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('is_default', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('steps_json', sa.dialects.postgresql.JSONB, nullable=False, server_default='[]'),
        sa.Column('applies_to_tariff_plan_ids', sa.dialects.postgresql.JSONB, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint('tenant_id', 'name', name='uq_dunning_policy_tenant_name'),
    )
    op.create_index('ix_dunning_policy_tenant_id', 'dunning_policy', ['tenant_id'])

    # ---- 2. dunning_case ----
    op.create_table(
        'dunning_case',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('account_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('account.id'), nullable=False),
        sa.Column('triggering_invoice_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('invoice.id'), nullable=False),
        sa.Column('policy_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('dunning_policy.id'), nullable=False),
        sa.Column('current_step_index', sa.Integer, nullable=False, server_default='-1'),
        sa.Column('step_entered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('next_action_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('opened_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('cured_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closed_reason', sa.String(80), nullable=True),
        sa.CheckConstraint(
            "status IN ('active','cured','escalated','closed')",
            name='ck_dunning_case_status',
        ),
    )
    op.create_index('ix_dunning_case_tenant_id', 'dunning_case', ['tenant_id'])
    op.create_index('ix_dunning_case_account_id', 'dunning_case', ['account_id'])
    op.create_index('ix_dunning_case_triggering_invoice_id', 'dunning_case', ['triggering_invoice_id'])
    op.create_index('ix_dunning_case_policy_id', 'dunning_case', ['policy_id'])
    op.create_index('ix_dunning_case_sweep', 'dunning_case', ['status', 'next_action_at'])

    # ---- 3. service_action_log ----
    op.create_table(
        'service_action_log',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('service_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('service.id'), nullable=True),
        sa.Column('dunning_case_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('dunning_case.id'), nullable=True),
        sa.Column('action', sa.String(40), nullable=False),
        sa.Column('adapter', sa.String(40), nullable=False),
        sa.Column('request_payload', sa.dialects.postgresql.JSONB, nullable=False,
                  server_default='{}'),
        sa.Column('response_payload', sa.dialects.postgresql.JSONB, nullable=False,
                  server_default='{}'),
        sa.Column('status', sa.String(20), nullable=False, server_default='queued'),
        sa.Column('requested_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error_message', sa.Text, nullable=True),
        sa.CheckConstraint(
            "action IN ('notice','throttle','walled_garden','terminate','restore')",
            name='ck_service_action_log_action',
        ),
        sa.CheckConstraint(
            "status IN ('queued','success','failed')",
            name='ck_service_action_log_status',
        ),
    )
    op.create_index('ix_service_action_log_tenant_id', 'service_action_log', ['tenant_id'])
    op.create_index('ix_service_action_log_service_id', 'service_action_log', ['service_id'])
    op.create_index('ix_service_action_log_dunning_case_id', 'service_action_log',
                    ['dunning_case_id'])

    # ---- 4. Seed ONE default policy per existing tenant. ----
    # Idempotent under uq_dunning_policy_tenant_name.
    steps_json_literal = json.dumps(_DEFAULT_POLICY_STEPS)
    op.execute(sa.text(
        "INSERT INTO dunning_policy "
        "(id, tenant_id, name, description, is_default, active, steps_json, "
        " applies_to_tariff_plan_ids, created_at, updated_at) "
        "SELECT gen_random_uuid(), t.id, 'Default Dunning Policy', "
        "       'Canonical 5-step dunning sequence seeded by migration c9f5a3b7e2d1.', "
        "       TRUE, TRUE, "
        "       CAST(:steps AS JSONB), NULL, now(), now() "
        "  FROM tenant t "
        " WHERE NOT EXISTS ( "
        "       SELECT 1 FROM dunning_policy p "
        "        WHERE p.tenant_id = t.id AND p.name = 'Default Dunning Policy' "
        " )"
    ).bindparams(steps=steps_json_literal))


def downgrade() -> None:
    op.drop_index('ix_service_action_log_dunning_case_id', table_name='service_action_log')
    op.drop_index('ix_service_action_log_service_id', table_name='service_action_log')
    op.drop_index('ix_service_action_log_tenant_id', table_name='service_action_log')
    op.drop_table('service_action_log')

    op.drop_index('ix_dunning_case_sweep', table_name='dunning_case')
    op.drop_index('ix_dunning_case_policy_id', table_name='dunning_case')
    op.drop_index('ix_dunning_case_triggering_invoice_id', table_name='dunning_case')
    op.drop_index('ix_dunning_case_account_id', table_name='dunning_case')
    op.drop_index('ix_dunning_case_tenant_id', table_name='dunning_case')
    op.drop_table('dunning_case')

    op.drop_index('ix_dunning_policy_tenant_id', table_name='dunning_policy')
    op.drop_table('dunning_policy')
