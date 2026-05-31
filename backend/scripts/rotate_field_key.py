"""SPEC §4.4 — Fernet key rotation script.

Re-encrypts every encrypted column from the OLD key to the NEW key in a single DB
transaction. Safe to re-run: rows already under the new key are skipped.

Usage (from backend/):
    .venv/Scripts/python.exe -m scripts.rotate_field_key \\
        --old-key "$GAAEX_FIELD_KEY_OLD" \\
        --new-key "$GAAEX_FIELD_KEY_NEW"

Dry-run (preview without writing):
    DRY_RUN=true .venv/Scripts/python.exe -m scripts.rotate_field_key \\
        --old-key "..." --new-key "..."

After successful rotation: update GAAEX_FIELD_KEY in .env / secrets vault to the
new key and restart the app.

Columns rotated:
  - webhook_def.secret
  (add more encrypted columns here as §4.4 scope expands)
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from cryptography.fernet import Fernet, InvalidToken  # noqa: E402
from sqlalchemy import text  # noqa: E402
from app.db import engine  # noqa: E402


DRY_RUN = os.environ.get("DRY_RUN", "false").lower() in ("1", "true", "yes")


def _decrypt_with(key: bytes, cipher: str) -> str | None:
    try:
        return Fernet(key).decrypt(cipher.encode("ascii")).decode("utf-8")
    except (InvalidToken, Exception):
        return None


def _encrypt_with(key: bytes, plain: str) -> str:
    return Fernet(key).encrypt(plain.encode("utf-8")).decode("ascii")


async def _rotate_column(
    conn,
    table: str,
    column: str,
    old_key: bytes,
    new_key: bytes,
) -> tuple[int, int, int]:
    """Rotate one column. Returns (rotated, skipped_already_new, skipped_empty)."""
    rows = (await conn.execute(text(
        f"SELECT id::text AS id, {column} AS val FROM {table}"  # noqa: S608
    ))).mappings().all()

    rotated = skipped_new = skipped_empty = 0
    print(f"\n[rotate] {table}.{column} — {len(rows)} rows")

    for row in rows:
        rid, cipher = row["id"], row["val"]
        if not cipher:
            skipped_empty += 1
            continue

        # Try decrypting with the NEW key first — already rotated, skip.
        if _decrypt_with(new_key, cipher) is not None:
            print(f"  SKIP-ALREADY-NEW  {rid}")
            skipped_new += 1
            continue

        # Decrypt with OLD key.
        plain = _decrypt_with(old_key, cipher)
        if plain is None:
            print(f"  WARN-UNREADABLE   {rid}  (neither key works; row skipped)")
            skipped_empty += 1
            continue

        new_cipher = _encrypt_with(new_key, plain)
        if not DRY_RUN:
            await conn.execute(
                text(f"UPDATE {table} SET {column} = :val WHERE id = :id"),  # noqa: S608
                {"val": new_cipher, "id": rid},
            )
        print(f"  ROTATED           {rid}")
        rotated += 1

    return rotated, skipped_new, skipped_empty


async def main(old_key: bytes, new_key: bytes) -> int:
    print(f"[rotate_field_key] DRY_RUN={DRY_RUN}")

    # Columns to rotate: (table, column)
    COLUMNS = [
        ("webhook_def", "secret"),
        # Add future encrypted columns here as R-06 §4.4 expands.
    ]

    total_rotated = 0

    async with engine.begin() as conn:
        for table, column in COLUMNS:
            rotated, skipped_new, skipped_empty = await _rotate_column(
                conn, table, column, old_key, new_key,
            )
            total_rotated += rotated
            print(
                f"  → rotated={rotated} already_new={skipped_new} empty/unreadable={skipped_empty}"
            )

        if DRY_RUN:
            await conn.rollback()
            print("\n[rotate_field_key] DRY_RUN — rolled back, nothing written")
        else:
            print(f"\n[rotate_field_key] committed — {total_rotated} rows re-encrypted total")

    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rotate GAAEX_FIELD_KEY Fernet keys")
    parser.add_argument("--old-key", required=True, help="The current (old) Fernet key")
    parser.add_argument("--new-key", required=True, help="The replacement Fernet key")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(
        args.old_key.encode() if isinstance(args.old_key, str) else args.old_key,
        args.new_key.encode() if isinstance(args.new_key, str) else args.new_key,
    )))
