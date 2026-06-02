"""canonicalize_communication_channel_direction_upper_snake

Revision ID: b470247667d5
Revises: 41c549f6cf47
Create Date: 2026-06-02 09:59:22.137957

Aligns CommunicationChannel + CommunicationDirection data values to the
canonical UPPER_SNAKE vocabulary defined in docs/standards/14-enum-registry.md
(Customer Service-owned enums, D10/E patch in file 13).

Affected data:
  - `interaction` table (legacy dedicated table — `channel`, `direction` columns)
  - generic `record` table where entity_key='interaction' — JSONB fields
      `data->>'channel'` and `data->>'direction'`
  - `entity_field` rows for the seeded interaction entity — `options` arrays on
      the channel/direction select fields (reseed via seed_catalog handles new
      tenants; this migration updates existing tenants in place)

Channel mapping  (legacy → canonical):
  call           → CALLS
  email          → EMAIL
  chat           → INTERNAL_CHAT
  sms            → SMS
  in_person      → CALLS          (closest 1:1 in the canonical set)
  note           → INTERNAL_CHAT  (ambiguous — flagged; pick is fail-safe internal)
  other          → INTERNAL_CHAT  (ambiguous — flagged)
Direction mapping:
  inbound        → INBOUND
  outbound       → OUTBOUND
  internal       → INTERNAL
  (no legacy value maps to the new SYSTEM direction — added value only)

Idempotent: re-running upgrade() is a no-op (UPPER values are not in the
legacy set). downgrade() reverses the mapping for the unambiguous values;
the "in_person/note/other" collapse is one-way (no reversal — those values
were absorbed and cannot be recovered uniquely).
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b470247667d5'
down_revision: Union[str, Sequence[str], None] = '41c549f6cf47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# --- channel & direction mappings (legacy → canonical) -------------------------
CHANNEL_MAP = {
    "call": "CALLS",
    "email": "EMAIL",
    "chat": "INTERNAL_CHAT",
    "sms": "SMS",
    "in_person": "CALLS",
    "note": "INTERNAL_CHAT",
    "other": "INTERNAL_CHAT",
}
DIRECTION_MAP = {
    "inbound": "INBOUND",
    "outbound": "OUTBOUND",
    "internal": "INTERNAL",
}

# Reverse mapping for downgrade — only the bijective entries can be restored.
CHANNEL_REVERSE = {
    "CALLS": "call",
    "EMAIL": "email",
    "INTERNAL_CHAT": "chat",
    "SMS": "sms",
}
DIRECTION_REVERSE = {v: k for k, v in DIRECTION_MAP.items()}


def upgrade() -> None:
    bind = op.get_bind()

    # ---- 1. Legacy dedicated `interaction` table (may or may not still hold rows) ----
    for legacy, canonical in CHANNEL_MAP.items():
        op.execute(
            f"UPDATE interaction SET channel = '{canonical}' WHERE channel = '{legacy}'"
        )
    for legacy, canonical in DIRECTION_MAP.items():
        op.execute(
            f"UPDATE interaction SET direction = '{canonical}' WHERE direction = '{legacy}'"
        )

    # ---- 2. Generic `record` table (entity_key='interaction') — JSONB data fields ----
    # JSONB rewrite via jsonb_set keyed on the legacy value. Run only on rows that
    # actually contain the legacy value to keep the migration idempotent + cheap.
    for legacy, canonical in CHANNEL_MAP.items():
        op.execute(
            f"""
            UPDATE record
               SET data = jsonb_set(data, '{{channel}}', to_jsonb('{canonical}'::text))
             WHERE entity_key = 'interaction'
               AND data ->> 'channel' = '{legacy}'
            """
        )
    for legacy, canonical in DIRECTION_MAP.items():
        op.execute(
            f"""
            UPDATE record
               SET data = jsonb_set(data, '{{direction}}', to_jsonb('{canonical}'::text))
             WHERE entity_key = 'interaction'
               AND data ->> 'direction' = '{legacy}'
            """
        )

    # ---- 3. Existing per-tenant FieldDef option arrays for the interaction entity ----
    # The new canonical option lists; we replace the whole JSON arrays for the
    # `channel` and `direction` select fields under any entity_def with key='interaction'.
    # Tables: entity_def (per tenant) → field_def (one row per field).
    op.execute(
        """
        UPDATE field_def
           SET config = jsonb_set(
                 COALESCE(config, '{}'::jsonb),
                 '{options}',
                 '["WHATSAPP","MESSENGER","SMS","EMAIL","CALLS",
                   "INTERNAL_CHAT","PORTAL_MESSAGE","SYSTEM_MESSAGE"]'::jsonb)
         WHERE key = 'channel'
           AND entity_def_id IN (SELECT id FROM entity_def WHERE key = 'interaction')
        """
    )
    op.execute(
        """
        UPDATE field_def
           SET config = jsonb_set(
                 COALESCE(config, '{}'::jsonb),
                 '{options}',
                 '["INBOUND","OUTBOUND","INTERNAL","SYSTEM"]'::jsonb)
         WHERE key = 'direction'
           AND entity_def_id IN (SELECT id FROM entity_def WHERE key = 'interaction')
        """
    )

    # Bind reference is unused but kept for clarity if future ops need it.
    _ = bind


def downgrade() -> None:
    # Reverse only the bijective subset. `note/other/in_person` were collapsed
    # into INTERNAL_CHAT/CALLS and cannot be split back deterministically; we
    # leave them at the conservative legacy values "chat" and "call".
    for canonical, legacy in CHANNEL_REVERSE.items():
        op.execute(
            f"UPDATE interaction SET channel = '{legacy}' WHERE channel = '{canonical}'"
        )
    for canonical, legacy in DIRECTION_REVERSE.items():
        op.execute(
            f"UPDATE interaction SET direction = '{legacy}' WHERE direction = '{canonical}'"
        )

    for canonical, legacy in CHANNEL_REVERSE.items():
        op.execute(
            f"""
            UPDATE record
               SET data = jsonb_set(data, '{{channel}}', to_jsonb('{legacy}'::text))
             WHERE entity_key = 'interaction'
               AND data ->> 'channel' = '{canonical}'
            """
        )
    for canonical, legacy in DIRECTION_REVERSE.items():
        op.execute(
            f"""
            UPDATE record
               SET data = jsonb_set(data, '{{direction}}', to_jsonb('{legacy}'::text))
             WHERE entity_key = 'interaction'
               AND data ->> 'direction' = '{canonical}'
            """
        )

    op.execute(
        """
        UPDATE field_def
           SET config = jsonb_set(
                 COALESCE(config, '{}'::jsonb),
                 '{options}',
                 '["call","email","chat","sms","note","in_person","other"]'::jsonb)
         WHERE key = 'channel'
           AND entity_def_id IN (SELECT id FROM entity_def WHERE key = 'interaction')
        """
    )
    op.execute(
        """
        UPDATE field_def
           SET config = jsonb_set(
                 COALESCE(config, '{}'::jsonb),
                 '{options}',
                 '["inbound","outbound","internal"]'::jsonb)
         WHERE key = 'direction'
           AND entity_def_id IN (SELECT id FROM entity_def WHERE key = 'interaction')
        """
    )
