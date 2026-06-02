"""SPEC §4.4 ACTIVATE — backfill ``webhook_def.secret`` from plaintext to Fernet ciphertext.

Run ONCE per environment after the alembic migration ``6389266f4c19_spec_4_4_widen_
webhook_secret_for_.py`` has widened the column to TEXT. Idempotent: rows already in
valid Fernet shape are skipped, so re-runs are safe (and useful — they let an operator
verify "is anything still plaintext?").

Why this lives outside alembic
------------------------------
Fernet is a Python library; the encryption key (``GAAHEX_FIELD_KEY``) lives in the app's
process env, not the database. A SQL-only migration cannot encrypt with Fernet, and
shipping the key into a Postgres function would defeat the purpose. The split is:

* **Migration 6389266f4c19** — widens the column type, ships in normal deploy pipeline.
* **This script** — operator-run with the deployed app's env, encrypts row data.
* **Model change** — already in ``app/models/webhook.py`` (``EncryptedString``), so
  any NEW writes after deploy are encrypted automatically.

How to run
----------
.. code-block:: bash

    cd backend
    # Activate venv, ensure GAAHEX_FIELD_KEY is exported (the same key the running app uses)
    .venv/Scripts/python.exe -m scripts.encrypt_webhook_secrets

    # Dry-run (default false — flip to true to preview without writing):
    DRY_RUN=true .venv/Scripts/python.exe -m scripts.encrypt_webhook_secrets

Output
------
Prints one line per row: ``ENCRYPTED`` (was plaintext, now ciphertext), ``SKIP-EMPTY``
(secret is NULL — nothing to do), or ``SKIP-CIPHERTEXT`` (already Fernet — re-run safe).
Ends with a summary count.

Safety
------
- Runs in a single transaction; if anything blows up mid-sweep, the DB is rolled back.
- Reads the cleartext via the underlying ``Text`` column directly (bypassing
  ``EncryptedString.process_result_value`` which would return ``None`` for legacy
  plaintext) so the operator can see exactly which rows still need migrating.
- Never logs the plaintext secret, only the row id.
"""
import asyncio
import os
import sys
from pathlib import Path

# Allow `python -m scripts.encrypt_webhook_secrets` from backend/ — add backend/ to sys.path
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import text  # noqa: E402

from app.db import engine  # noqa: E402
from app.security.field_crypto import encrypt_str, decrypt_str  # noqa: E402


DRY_RUN = os.environ.get("DRY_RUN", "false").lower() in ("1", "true", "yes")


def _looks_like_fernet(value: str) -> bool:
    """Cheap heuristic: a Fernet token decrypts cleanly with the active key.

    We use ``decrypt_str`` (which swallows :class:`InvalidToken` → ``None``) — if it
    returns a non-None string, the row is already ciphertext under the active key and
    needs no work. If it returns ``None``, the row is either plaintext (legacy) or
    ciphertext from a retired key — in either case, encrypting the raw value with the
    active key is the correct move.
    """
    return decrypt_str(value) is not None


async def main() -> int:
    encrypted = 0
    skipped_empty = 0
    skipped_already_cipher = 0

    async with engine.begin() as conn:
        rows = (await conn.execute(text(
            "SELECT id::text AS id, secret FROM webhook_def"
        ))).mappings().all()

        print(f"[encrypt_webhook_secrets] scanning {len(rows)} rows "
              f"(DRY_RUN={DRY_RUN})")

        for row in rows:
            rid = row["id"]
            secret = row["secret"]

            if secret is None or secret == "":
                print(f"  SKIP-EMPTY      {rid}")
                skipped_empty += 1
                continue

            if _looks_like_fernet(secret):
                print(f"  SKIP-CIPHERTEXT {rid}")
                skipped_already_cipher += 1
                continue

            new_cipher = encrypt_str(secret)
            if not DRY_RUN:
                await conn.execute(
                    text("UPDATE webhook_def SET secret = :s WHERE id = :id"),
                    {"s": new_cipher, "id": rid},
                )
            print(f"  ENCRYPTED       {rid}")
            encrypted += 1

        if DRY_RUN:
            # roll back so DRY_RUN is truly read-only even though encrypt_str ran
            await conn.rollback()

    print(
        "[encrypt_webhook_secrets] done — "
        f"encrypted={encrypted} skip_empty={skipped_empty} "
        f"skip_already_cipher={skipped_already_cipher}"
        + (" (DRY_RUN: nothing written)" if DRY_RUN else "")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
