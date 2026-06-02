"""Comment Standard (file 04) — DB-level hold enforcement triggers.

Revision ID: 3a86ae0ed044
Revises: 394729a25cff
Create Date: 2026-06-02

Adds the BEFORE UPDATE / BEFORE DELETE trigger pair on the `comment` table
to enforce legal-hold immutability at the database layer, independent of the
router layer.

Background
----------
Migration `82b37b6342b2_comment_add_first_class.py` deferred this explicitly:

  "Hold-trigger note: This migration does NOT add the DB-level hold trigger.
   Router v1 enforces `hold` refusal on edit/delete. A BEFORE UPDATE / BEFORE
   DELETE trigger (the same compliance class as `b70ef3b98e27` financial
   immutability) is a HARD precondition before the first real legal hold is
   placed AND before any production deploy."

This migration fulfils that precondition.

Trigger logic (BEFORE UPDATE)
-------------------------------
  IF OLD.hold = TRUE THEN
    -- Allow ONLY a hold-release: a single column change where NEW.hold = FALSE
    -- and every other column stays the same. Any other mutation is refused.
    IF NOT (
        NEW.hold = FALSE
        AND NEW.id                  = OLD.id
        AND NEW.tenant_id           = OLD.tenant_id
        AND NEW.parent_object_type  = OLD.parent_object_type
        AND NEW.parent_object_id    = OLD.parent_object_id
        AND NEW.parent_comment_id   IS NOT DISTINCT FROM OLD.parent_comment_id
        AND NEW.comment_type        = OLD.comment_type
        AND NEW.status              = OLD.status
        AND NEW.resolution          IS NOT DISTINCT FROM OLD.resolution
        AND NEW.author_id           = OLD.author_id
        AND NEW.content             = OLD.content
        AND NEW.edited_by           IS NOT DISTINCT FROM OLD.edited_by
        AND NEW.edited_at           IS NOT DISTINCT FROM OLD.edited_at
        AND NEW.deleted_by          IS NOT DISTINCT FROM OLD.deleted_by
        AND NEW.deleted_at          IS NOT DISTINCT FROM OLD.deleted_at
        AND NEW.created_at          = OLD.created_at
    ) THEN
        RAISE EXCEPTION
            'comment is on legal hold (id=%, hold=true) — UPDATE refused by DB trigger',
            OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;

Trigger logic (BEFORE DELETE)
-------------------------------
  IF OLD.hold = TRUE THEN
      RAISE EXCEPTION
          'comment is on legal hold (id=%, hold=true) — DELETE refused by DB trigger',
          OLD.id
          USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;

Compliance class
----------------
Same compliance class as the `b70ef3b98e27` financial-immutability and audit
append-only triggers. The DB trigger is the last line of defence: even a rogue
script that bypasses the API cannot bypass the hold constraint without first
performing DDL to drop the trigger (itself a visible, auditable action).

Downgrade drops both triggers and both functions cleanly.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '3a86ae0ed044'
down_revision: Union[str, Sequence[str], None] = '394729a25cff'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create BEFORE UPDATE + BEFORE DELETE hold-enforcement triggers on comment."""

    # ------------------------------------------------------------------ UPDATE trigger
    # Refuses any UPDATE when OLD.hold = TRUE, UNLESS the only change is
    # hold going TRUE → FALSE (i.e. a deliberate hold-release with no other
    # column touched). Every other mutation — content edit, soft-delete stamp,
    # comment_type change, etc. — is blocked.
    op.execute("""
        CREATE OR REPLACE FUNCTION comment_enforce_hold_update()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF OLD.hold = TRUE THEN
                -- Permit ONLY a pure hold-release: NEW.hold = FALSE and every
                -- other column is identical. IS NOT DISTINCT FROM handles NULLs.
                IF NOT (
                    NEW.hold                = FALSE
                    AND NEW.id                  = OLD.id
                    AND NEW.tenant_id           = OLD.tenant_id
                    AND NEW.parent_object_type  = OLD.parent_object_type
                    AND NEW.parent_object_id    = OLD.parent_object_id
                    AND NEW.parent_comment_id   IS NOT DISTINCT FROM OLD.parent_comment_id
                    AND NEW.comment_type        = OLD.comment_type
                    AND NEW.status              = OLD.status
                    AND NEW.resolution          IS NOT DISTINCT FROM OLD.resolution
                    AND NEW.author_id           = OLD.author_id
                    AND NEW.content             = OLD.content
                    AND NEW.edited_by           IS NOT DISTINCT FROM OLD.edited_by
                    AND NEW.edited_at           IS NOT DISTINCT FROM OLD.edited_at
                    AND NEW.deleted_by          IS NOT DISTINCT FROM OLD.deleted_by
                    AND NEW.deleted_at          IS NOT DISTINCT FROM OLD.deleted_at
                    AND NEW.created_at          = OLD.created_at
                ) THEN
                    RAISE EXCEPTION
                        'comment is on legal hold (id=%, hold=true) — UPDATE refused by DB trigger',
                        OLD.id
                        USING ERRCODE = 'restrict_violation';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$;
    """)

    op.execute("""
        CREATE TRIGGER trg_comment_block_update_when_held
            BEFORE UPDATE ON comment
            FOR EACH ROW
            EXECUTE FUNCTION comment_enforce_hold_update();
    """)

    # ------------------------------------------------------------------ DELETE trigger
    # Refuses any DELETE when OLD.hold = TRUE — unconditionally. Hold beats
    # every role including comment.moderate and configuration.manage (file 04).
    op.execute("""
        CREATE OR REPLACE FUNCTION comment_enforce_hold_delete()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF OLD.hold = TRUE THEN
                RAISE EXCEPTION
                    'comment is on legal hold (id=%, hold=true) — DELETE refused by DB trigger',
                    OLD.id
                    USING ERRCODE = 'restrict_violation';
            END IF;
            RETURN OLD;
        END;
        $$;
    """)

    op.execute("""
        CREATE TRIGGER trg_comment_block_delete_when_held
            BEFORE DELETE ON comment
            FOR EACH ROW
            EXECUTE FUNCTION comment_enforce_hold_delete();
    """)


def downgrade() -> None:
    """Drop hold-enforcement triggers and their backing functions."""
    op.execute("DROP TRIGGER IF EXISTS trg_comment_block_delete_when_held ON comment;")
    op.execute("DROP FUNCTION IF EXISTS comment_enforce_hold_delete();")
    op.execute("DROP TRIGGER IF EXISTS trg_comment_block_update_when_held ON comment;")
    op.execute("DROP FUNCTION IF EXISTS comment_enforce_hold_update();")
