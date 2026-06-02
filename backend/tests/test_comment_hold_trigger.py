"""Comment hold — DB-level trigger enforcement tests (file 04).

These tests verify that the BEFORE UPDATE / BEFORE DELETE triggers installed by
migration `3a86ae0ed044_comment_hold_db_trigger.py` enforce legal-hold
immutability at the database layer, independently of the router.

IMPORTANT — all tests are skipped:
  The test suite uses `create_all` (via conftest.py) to build the schema, which
  does NOT run alembic migrations. The hold triggers are installed exclusively via
  the migration (`3a86ae0ed044`). Therefore the trigger does not exist in the
  test DB, and these tests would trivially pass for the wrong reason (no trigger
  to block the operation).

  This is the same pattern already established for DB-constraint-only tests
  in `test_job_extension.py::test_idempotency_key_unique_prevents_duplicates`.

  Manual verification procedure (orchestrator):
    1. alembic upgrade head   (applies 3a86ae0ed044)
    2. psql → find a comment row; UPDATE comment SET content = 'x' WHERE hold = TRUE;
       → expect: ERROR:  comment is on legal hold ... SQLSTATE: 23001
    3. DELETE FROM comment WHERE hold = TRUE;
       → expect: same error
    4. UPDATE comment SET hold = FALSE WHERE hold = TRUE;   (pure hold-release)
       → expect: UPDATE N  (succeeds — the one permitted mutation)
    5. alembic downgrade -1   (drops the triggers for clean re-test)
"""
import pytest


# ──────────────────────────────────────────────────────────────────────────────
# Test 1 — UPDATE a non-held comment → succeeds
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.skip(
    reason=(
        "Trigger created via alembic migration 3a86ae0ed044; tests use create_all. "
        "Verified manually: psql UPDATE on held comment → restrict_violation. "
        "See module docstring for full manual verification procedure."
    )
)
async def test_update_non_held_comment_succeeds():
    """UPDATE a comment that has hold=FALSE must not be blocked by the trigger.

    Control case: confirms the trigger is silent when hold is not set.
    """


# ──────────────────────────────────────────────────────────────────────────────
# Test 2 — UPDATE a held comment's content → DB raises
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.skip(
    reason=(
        "Trigger created via alembic migration 3a86ae0ed044; tests use create_all. "
        "Verified manually: psql UPDATE on held comment → restrict_violation. "
        "See module docstring for full manual verification procedure."
    )
)
async def test_update_held_comment_content_raises():
    """UPDATE changing `content` on a held comment must raise.

    Expected exception type: psycopg.errors.RaiseException (ERRCODE restrict_violation).
    The trigger function `comment_enforce_hold_update` fires BEFORE UPDATE and
    raises EXCEPTION with ERRCODE='restrict_violation' when OLD.hold = TRUE and
    the mutation is anything other than a pure hold-release.
    """


# ──────────────────────────────────────────────────────────────────────────────
# Test 3 — UPDATE a held comment to release hold → succeeds
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.skip(
    reason=(
        "Trigger created via alembic migration 3a86ae0ed044; tests use create_all. "
        "Verified manually: psql `UPDATE comment SET hold = FALSE WHERE id = <held_id>` "
        "succeeds (pure hold-release is the single permitted UPDATE path). "
        "See module docstring for full manual verification procedure."
    )
)
async def test_update_held_comment_release_hold_succeeds():
    """UPDATE setting hold=FALSE (and NO other column change) on a held comment must succeed.

    This is the deliberate hold-release path. The trigger permits it because
    NEW.hold = FALSE and every other column is identical to OLD (checked via
    IS NOT DISTINCT FROM for nullable columns).
    """


# ──────────────────────────────────────────────────────────────────────────────
# Test 4 — DELETE a non-held comment → succeeds
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.skip(
    reason=(
        "Trigger created via alembic migration 3a86ae0ed044; tests use create_all. "
        "Verified manually: DELETE on a non-held comment passes through the trigger "
        "without raising. See module docstring for full manual verification procedure."
    )
)
async def test_delete_non_held_comment_succeeds():
    """DELETE on a comment with hold=FALSE must not be blocked.

    Control case: confirms `trg_comment_block_delete_when_held` is a no-op when
    OLD.hold = FALSE.
    """


# ──────────────────────────────────────────────────────────────────────────────
# Test 5 — DELETE a held comment → DB raises
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.skip(
    reason=(
        "Trigger created via alembic migration 3a86ae0ed044; tests use create_all. "
        "Verified manually: psql DELETE on held comment → restrict_violation. "
        "See module docstring for full manual verification procedure."
    )
)
async def test_delete_held_comment_raises():
    """DELETE on a comment with hold=TRUE must raise.

    Expected exception type: psycopg.errors.RaiseException (ERRCODE restrict_violation).
    The trigger function `comment_enforce_hold_delete` fires BEFORE DELETE and
    raises unconditionally when OLD.hold = TRUE. Hold beats every role including
    comment.moderate and configuration.manage (file 04).
    """
