"""Order.lead_id — link an order back to its source lead (iron rule: lead → ORDER at ORDER_CREATED).

Revision ID: c7d8e9f0a1b2
Revises: e6f7a8b9c0d1
Create Date: 2026-06-12

Additive, nullable column. When a lead reaches ORDER_CREATED (sales done) it converts to an ORDER; the
order carries the lead's identity via `lead_id` until ACTIVATION, when the CUSTOMER is created and
`customer_id` is set. Existing orders (pre-conversion) keep lead_id = NULL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, Sequence[str], None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('order', sa.Column('lead_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_order_lead_id_record', 'order', 'record', ['lead_id'], ['id'])
    op.create_index('ix_order_lead_id', 'order', ['lead_id'])


def downgrade() -> None:
    op.drop_index('ix_order_lead_id', table_name='order')
    op.drop_constraint('fk_order_lead_id_record', 'order', type_='foreignkey')
    op.drop_column('order', 'lead_id')
