"""dunning_action_verbs_upper_snake

Revision ID: 7b1e0d3b41fd
Revises: c443f037e6ac
Create Date: 2026-06-02 18:05:03.739966

B1 enum-standard follow-up to ``f18655752e1c`` (status_enum_normalization).
That revision deferred two surfaces because they involved JSONB element
rewrites / CHECK-constraint churn — this revision finishes the job:

  1. ``dunning_policy.steps_json[*].action`` — JSONB array elements rewritten
     in-place so each step's ``action`` value is UPPER_SNAKE.
       notice         -> NOTICE
       throttle       -> THROTTLE
       walled_garden  -> WALLED_GARDEN
       terminate      -> TERMINATE
     (``params`` and ``day_offset`` are preserved verbatim.)

  2. ``service_action_log.action`` column values UPPER-cased to match. The
     pre-existing CHECK constraint ``ck_service_action_log_action`` enforced
     the lowercase value list; it is dropped and re-created with the UNION
     of lowercase + UPPER_SNAKE values. The union is a transitional state:
     ``services/dunning.py`` and the migration both now write UPPER, but the
     v1 LoggingAdapter (``services/network_adapter.py``, out of scope for
     this revision) still writes lowercase verbs into the log. Keeping the
     constraint inclusive lets both producers coexist until the adapter's
     write-side is folded UP in a follow-up.

Upgrade strategy — Postgres native, single-pass per table:
  * dunning_policy: a CTE unnests ``steps_json`` with ``jsonb_array_elements``,
    rewrites each element's ``action`` via ``jsonb_set`` + ``upper(...)`` when
    the value matches the lowercase set, then ``jsonb_agg(... ORDER BY ord)``
    rebuilds the array and the row's column is UPDATEd from the CTE.
    Only rows that actually contain a lowercase action are touched.
  * service_action_log: drop CHECK -> UPDATE rows -> re-add CHECK.

Idempotent: re-running the upgrade is a no-op (the UPDATEs filter on the
lowercase value set; the CHECK swap is unconditional but harmless).

Downgrade lowercases both surfaces back and restores the lowercase CHECK.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7b1e0d3b41fd'
down_revision: Union[str, Sequence[str], None] = 'c443f037e6ac'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ------------------------------------------------------------------
    # 1. dunning_policy.steps_json[*].action -> UPPER
    # ------------------------------------------------------------------
    # Walk the JSONB array, UPPER each element's "action" value when it is one
    # of the known lowercase values, then re-aggregate preserving original
    # element order via WITH ORDINALITY. Only touches rows where at least one
    # step has a lowercase action (idempotent on repeat runs).
    op.execute(sa.text("""
        WITH rewritten AS (
            SELECT
                p.id AS policy_id,
                jsonb_agg(
                    CASE
                        WHEN elem ->> 'action' IN ('notice','throttle','walled_garden','terminate')
                        THEN jsonb_set(elem, '{action}', to_jsonb(upper(elem ->> 'action')))
                        ELSE elem
                    END
                    ORDER BY ord
                ) AS new_steps
            FROM dunning_policy p,
                 jsonb_array_elements(p.steps_json) WITH ORDINALITY AS t(elem, ord)
            WHERE p.steps_json IS NOT NULL
              AND jsonb_typeof(p.steps_json) = 'array'
              AND EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements(p.steps_json) inner_e
                   WHERE inner_e ->> 'action'
                         IN ('notice','throttle','walled_garden','terminate')
              )
            GROUP BY p.id
        )
        UPDATE dunning_policy p
           SET steps_json = r.new_steps
          FROM rewritten r
         WHERE p.id = r.policy_id
    """))

    # ------------------------------------------------------------------
    # 2. service_action_log.action -> UPPER (+ swap CHECK constraint)
    # ------------------------------------------------------------------
    op.drop_constraint(
        'ck_service_action_log_action', 'service_action_log', type_='check',
    )
    op.execute(sa.text(
        "UPDATE service_action_log SET action = UPPER(action) "
        "WHERE action IN ('notice','throttle','walled_garden','terminate','restore')"
    ))
    # Inclusive value list — UPPER_SNAKE (new producers) ∪ lowercase (the v1
    # LoggingAdapter, still out of scope). Tightened to UPPER-only by a
    # follow-up once the adapter is normalised.
    op.create_check_constraint(
        'ck_service_action_log_action',
        'service_action_log',
        "action IN ("
        "'NOTICE','THROTTLE','WALLED_GARDEN','TERMINATE','RESTORE',"
        "'notice','throttle','walled_garden','terminate','restore'"
        ")",
    )


def downgrade() -> None:
    """Downgrade schema."""
    # ------------------------------------------------------------------
    # 2. service_action_log.action -> lowercase (+ restore lowercase CHECK)
    # ------------------------------------------------------------------
    op.drop_constraint(
        'ck_service_action_log_action', 'service_action_log', type_='check',
    )
    op.execute(sa.text(
        "UPDATE service_action_log SET action = LOWER(action) "
        "WHERE action IN ('NOTICE','THROTTLE','WALLED_GARDEN','TERMINATE','RESTORE')"
    ))
    op.create_check_constraint(
        'ck_service_action_log_action',
        'service_action_log',
        "action IN ('notice','throttle','walled_garden','terminate','restore')",
    )

    # ------------------------------------------------------------------
    # 1. dunning_policy.steps_json[*].action -> lowercase
    # ------------------------------------------------------------------
    op.execute(sa.text("""
        WITH rewritten AS (
            SELECT
                p.id AS policy_id,
                jsonb_agg(
                    CASE
                        WHEN elem ->> 'action' IN ('NOTICE','THROTTLE','WALLED_GARDEN','TERMINATE')
                        THEN jsonb_set(elem, '{action}', to_jsonb(lower(elem ->> 'action')))
                        ELSE elem
                    END
                    ORDER BY ord
                ) AS new_steps
            FROM dunning_policy p,
                 jsonb_array_elements(p.steps_json) WITH ORDINALITY AS t(elem, ord)
            WHERE p.steps_json IS NOT NULL
              AND jsonb_typeof(p.steps_json) = 'array'
              AND EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements(p.steps_json) inner_e
                   WHERE inner_e ->> 'action'
                         IN ('NOTICE','THROTTLE','WALLED_GARDEN','TERMINATE')
              )
            GROUP BY p.id
        )
        UPDATE dunning_policy p
           SET steps_json = r.new_steps
          FROM rewritten r
         WHERE p.id = r.policy_id
    """))
