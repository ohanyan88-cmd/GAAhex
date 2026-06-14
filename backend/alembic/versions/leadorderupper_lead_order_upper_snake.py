"""B1b — UPPER_SNAKE the lead + order lifecycle vocabularies (single source of truth, NO exception).

The frontend canonical (lifecycle.ts) already declared these keys UPPER_SNAKE; the backend lowercase was
the split-brain deviation. The customer base was collapsed to UPPER earlier (fin-/seed work, 2026-06-14);
this migration brings the last two SST entities — lead + order — into the same casing with no exception.

Every lowercase key maps to its own uppercase (lead→LEAD, validated_lead→VALIDATED_LEAD, order_created→
ORDER_CREATED, …), so the transformation is exactly UPPER(). Scoped to the known SST key sets so nothing
unexpected is touched. Idempotent: re-running only affects rows still lowercase.

Migrates, for lead + order:
  * record.status   (leads are generic Records: entity_key='lead')
  * "order".status  (the order is a first-class table)
  * status_def.key  (the per-entity status registry the transition engine reads)
  * workflow_def.config transitions[].from/.to  (the canonical transition graph)

Revision ID: leadorderupper
Revises: fin1allocluma
Create Date: 2026-06-14
"""
from __future__ import annotations

import json

from alembic import op
from sqlalchemy import text

revision = "leadorderupper"
down_revision = "fin1allocluma"
branch_labels = None
depends_on = None

_LEAD_KEYS = ("lead", "validated_lead", "assigned", "deal", "contract_signed", "order_created", "lost")
_ORDER_KEYS = ("order_created", "order_validated", "scheduling", "config", "installation",
               "connection_test", "payment_confirmed", "activation", "cancelled")


def _in(keys: tuple[str, ...]) -> str:
    return ", ".join(f"'{k}'" for k in keys)


def _retoken(conn, *, to_upper: bool) -> None:
    """Rewrite workflow_def transition endpoints for lead + order (from/to) to upper/lower."""
    rows = conn.execute(text(
        "SELECT wd.id, wd.config FROM workflow_def wd "
        "JOIN entity_def ed ON ed.id = wd.entity_def_id "
        "WHERE ed.key IN ('lead', 'order')"
    )).fetchall()
    valid = set(_LEAD_KEYS) | set(_ORDER_KEYS)
    valid |= {k.upper() for k in valid}
    for wid, config in rows:
        if not config:
            continue
        cfg = dict(config)
        trs = cfg.get("transitions")
        if not isinstance(trs, list):
            continue
        changed = False
        for tr in trs:
            if not isinstance(tr, dict):
                continue
            for k in ("from", "to"):
                v = tr.get(k)
                if not isinstance(v, str) or v not in valid:
                    continue
                nv = v.upper() if to_upper else v.lower()
                if nv != v:
                    tr[k] = nv
                    changed = True
        if changed:
            conn.execute(
                text("UPDATE workflow_def SET config = CAST(:c AS jsonb) WHERE id = :i"),
                {"c": json.dumps(cfg), "i": wid},
            )


def upgrade() -> None:
    conn = op.get_bind()
    # 1) lead records (generic Record table)
    op.execute(
        f"UPDATE record SET status = UPPER(status) "
        f"WHERE entity_key = 'lead' AND status IN ({_in(_LEAD_KEYS)})"
    )
    # 2) order rows (first-class "order" table — reserved word, must be quoted)
    op.execute(
        f'UPDATE "order" SET status = UPPER(status) WHERE status IN ({_in(_ORDER_KEYS)})'
    )
    # 3) status_def registry keys for the lead + order entity_defs
    op.execute(
        "UPDATE status_def SET key = UPPER(key) WHERE entity_def_id IN "
        "(SELECT id FROM entity_def WHERE key IN ('lead', 'order')) "
        f"AND key IN ({_in(set(_LEAD_KEYS) | set(_ORDER_KEYS))})"
    )
    # 4) workflow_def transition graph
    _retoken(conn, to_upper=True)


def downgrade() -> None:
    conn = op.get_bind()
    up_lead = _in(tuple(k.upper() for k in _LEAD_KEYS))
    up_order = _in(tuple(k.upper() for k in _ORDER_KEYS))
    op.execute(
        f"UPDATE record SET status = LOWER(status) "
        f"WHERE entity_key = 'lead' AND status IN ({up_lead})"
    )
    op.execute(
        f'UPDATE "order" SET status = LOWER(status) WHERE status IN ({up_order})'
    )
    op.execute(
        "UPDATE status_def SET key = LOWER(key) WHERE entity_def_id IN "
        "(SELECT id FROM entity_def WHERE key IN ('lead', 'order')) "
        f"AND key IN ({_in(set(k.upper() for k in _LEAD_KEYS) | set(k.upper() for k in _ORDER_KEYS))})"
    )
    _retoken(conn, to_upper=False)
