"""Security package — re-exports the historical ``app.security`` API plus the new
field-level encryption primitives (SPEC §4.4).

Existing imports (``from app.security import hash_password``, etc.) keep working
because everything from the old ``app/security.py`` module is re-exported below.
"""
from .auth import (
    create_access_token,
    decode_token,
    hash_password,
    verify_password,
)
from .field_crypto import (
    EncryptedString,
    decrypt_str,
    encrypt_str,
)

__all__ = [
    # auth (was app/security.py before SPEC §4.4)
    "create_access_token",
    "decode_token",
    "hash_password",
    "verify_password",
    # field-level encryption at rest (SPEC §4.4)
    "EncryptedString",
    "decrypt_str",
    "encrypt_str",
]
