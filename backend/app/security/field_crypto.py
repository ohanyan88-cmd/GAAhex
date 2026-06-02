"""SPEC §4.4 field-level encryption at rest.

Application-level AEAD using Fernet (AES-128-CBC + HMAC-SHA256). The key comes from
env var ``GAAHEX_FIELD_KEY`` (a 32-byte url-safe base64 string — the shape
``Fernet.generate_key()`` produces). In dev, a deterministic test key is used if the
env var is missing — production MUST set ``GAAHEX_FIELD_KEY``.

Encrypted values are stored as TEXT in PostgreSQL (Fernet output is ASCII, longer than
the plaintext). Read-side automatically decrypts on column access; write-side encrypts
on bind. Legacy plaintext rows and rows encrypted with a now-retired key both return
``None`` from :func:`decrypt_str` rather than raising — call sites must tolerate this
(e.g. "[unreadable secret — re-key required]" in the UI, or a backfill sweep that
re-encrypts).

Key rotation: change ``GAAHEX_FIELD_KEY`` to the new key, then run a one-shot sweep
script (e.g. ``backend/scripts/encrypt_webhook_secrets.py``) that reads + writes every
row so the ORM transparently re-encrypts under the new key. For zero-downtime rotation,
upgrade to ``MultiFernet`` with a comma-separated env var — see
``backend/docs/spec-build/STEP-04-4-FIELD-ENCRYPTION.md`` for the runbook.
"""
import base64
import logging
import os
from typing import Any, Optional

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.types import TypeDecorator, Text

_logger = logging.getLogger("gaahex.field_crypto")

# Deterministic 32-byte raw key → 44-char url-safe base64 Fernet key. Used only when
# ``GAAHEX_FIELD_KEY`` is unset; logs a loud warning every time it's selected.
_DEV_RAW = b"gaahex-dev-fernet-key-32byte-len"  # exactly 32 bytes
_DEV_KEY = base64.urlsafe_b64encode(_DEV_RAW)


def _get_key() -> bytes:
    """Return the active Fernet key. Env var first, deterministic dev key as fallback."""
    k = os.environ.get("GAAHEX_FIELD_KEY")
    if k:
        return k.encode() if isinstance(k, str) else k
    _logger.warning(
        "GAAHEX_FIELD_KEY not set — using deterministic DEV key. "
        "NEVER deploy this to production (SPEC §4.4)."
    )
    return _DEV_KEY


# Module-level Fernet instance: cheap to construct, safe to cache. If the key changes
# at runtime (test fixture flipping env vars), call :func:`_reload_fernet`.
_FERNET = Fernet(_get_key())


def _reload_fernet() -> None:
    """Re-read ``GAAHEX_FIELD_KEY`` from env and rebuild the cached Fernet.

    Exposed so the test suite can simulate key rotation without process restart. Do not
    call from production code paths.
    """
    global _FERNET
    _FERNET = Fernet(_get_key())


def encrypt_str(plain: Optional[str]) -> Optional[str]:
    """Encrypt plaintext ``str`` → ASCII Fernet token. ``None`` passes through."""
    if plain is None:
        return None
    if not isinstance(plain, str):
        plain = str(plain)
    return _FERNET.encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_str(cipher: Optional[str]) -> Optional[str]:
    """Decrypt ASCII Fernet token → plaintext ``str``.

    Returns ``None`` on :class:`InvalidToken` (legacy plaintext, ciphertext from a
    retired key, or a tampered value). Call sites MUST tolerate ``None`` — never blow
    up the response just because one row's secret can't be decrypted.
    """
    if cipher is None:
        return None
    if not isinstance(cipher, str):
        cipher = str(cipher)
    try:
        return _FERNET.decrypt(cipher.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return None
    except Exception:
        # Any other shape problem (bytes that aren't ASCII, etc.) — fail soft.
        return None


class EncryptedString(TypeDecorator):
    """SQLAlchemy column type that auto-encrypts on write, decrypts on read.

    Underlying storage is TEXT. Compatible with existing ``String``-typed columns once
    the column is widened to TEXT in a migration (Fernet output is ~100+ chars even for
    short secrets, so ``String(255)`` would truncate cleanly but pointlessly).

    Migration pattern (see STEP-04-4-FIELD-ENCRYPTION.md §3 for the full runbook):

    1. Alembic migration widens the column to ``sa.Text()`` — no data change.
    2. Switch the model column type to ``EncryptedString()`` in the same release.
    3. Run ``backend/scripts/encrypt_webhook_secrets.py`` (or equivalent per column)
       to re-encrypt the existing plaintext rows. Idempotent: a row already in Fernet
       shape is skipped.

    Legacy rows that are still plaintext at read time return ``None`` rather than the
    raw plaintext, so the leak window is closed even before the backfill finishes —
    the trade-off is a UI "[unreadable]" placeholder until the sweep runs.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Any, dialect) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            value = str(value)
        return encrypt_str(value)

    def process_result_value(self, value: Any, dialect) -> Optional[str]:
        if value is None:
            return None
        return decrypt_str(value)
