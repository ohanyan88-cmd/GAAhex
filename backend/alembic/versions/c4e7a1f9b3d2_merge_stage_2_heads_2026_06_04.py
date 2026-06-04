"""merge stage 2 heads — privacy_request + subscription_anchor_day

Two stage-2 remediation packs both branched off f8c5b1e9a3d2:
  - a2c4d6e8b1f3 (privacy_request table, Pack P7)
  - b3d5f7a9c2e4 (subscription billing_anchor_day, Pack P8)

This is a no-op merge revision to give the chain a single HEAD again.

Revision ID: c4e7a1f9b3d2
Revises: a2c4d6e8b1f3, b3d5f7a9c2e4
Create Date: 2026-06-04
"""
from typing import Sequence, Union


revision: str = 'c4e7a1f9b3d2'
down_revision: Union[str, Sequence[str], None] = ('a2c4d6e8b1f3', 'b3d5f7a9c2e4')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
