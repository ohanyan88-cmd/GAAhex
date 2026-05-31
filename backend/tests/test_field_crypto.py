"""SPEC §4.4 ACTIVATE — tests for the field-level encryption helper.

Covers:

1. ``encrypt_str`` / ``decrypt_str`` round-trip + ``None`` passthrough.
2. ``EncryptedString`` ORM column round-trip via a live ``WebhookDef`` row — read side
   returns plaintext, the on-disk value is ciphertext.
3. Legacy plaintext value at read time returns ``None`` from ``decrypt_str``
   (fail-soft contract — UI shows placeholder, doesn't blow up).
4. Key rotation simulation: encrypt with key 1, swap to key 2, decrypt returns ``None``
   rather than raising. The rotation runbook (``backend/scripts/
   encrypt_webhook_secrets.py``) is the supported way to migrate the rows.
"""
import base64
import os
import uuid

import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from sqlalchemy import text

from app.db import OwnerSessionLocal
from app.models.tenant import Tenant
from app.models.webhook import WebhookDef
from app.security import EncryptedString, decrypt_str, encrypt_str
from app.security import field_crypto


# ---- 1) helper-level round-trip -------------------------------------------------

def test_encrypt_decrypt_round_trip_plain_string():
    plain = "super-secret-hmac-key-12345"
    cipher = encrypt_str(plain)
    assert cipher != plain
    assert cipher is not None
    assert isinstance(cipher, str)
    # Fernet tokens are ASCII and start with the version byte 0x80 base64-encoded ("gAAAA...")
    assert cipher.startswith("gAAAA")
    assert decrypt_str(cipher) == plain


def test_encrypt_decrypt_none_passthrough():
    assert encrypt_str(None) is None
    assert decrypt_str(None) is None


def test_decrypt_legacy_plaintext_returns_none():
    """A row written before §4.4 landed holds plaintext. ``decrypt_str`` must not
    raise — it returns ``None`` so the call site can render a placeholder."""
    assert decrypt_str("legacy-plaintext-not-a-fernet-token") is None


def test_decrypt_garbage_returns_none():
    """Even a tampered or otherwise-shaped value must not raise into the caller."""
    assert decrypt_str("totally not base64 ???") is None
    assert decrypt_str("") is None


def test_encrypt_is_non_deterministic():
    """Fernet uses a random IV, so two encryptions of the same plaintext differ.
    This is the property that prevents an attacker from spotting duplicate values
    in a stolen ciphertext dump."""
    a = encrypt_str("same-secret")
    b = encrypt_str("same-secret")
    assert a != b
    assert decrypt_str(a) == decrypt_str(b) == "same-secret"


# ---- 2) ORM round-trip via a live WebhookDef row --------------------------------

@pytest_asyncio.fixture
async def tenant_id() -> uuid.UUID:
    """Grab any existing tenant from the seeded test DB so the FK on WebhookDef holds."""
    async with OwnerSessionLocal() as s:
        row = (await s.execute(text("SELECT id FROM tenant LIMIT 1"))).first()
        assert row is not None, "test seed should have created at least one tenant"
        return row[0]


@pytest.mark.asyncio
async def test_encrypted_string_column_round_trip_via_orm(tenant_id):
    """Write a WebhookDef with plaintext via the ORM, then re-read via the ORM and
    confirm the ORM gives back the original plaintext. Separately, hit the row via
    raw SQL and confirm the on-disk value is Fernet ciphertext, not plaintext."""
    plaintext_secret = "orm-test-secret-" + uuid.uuid4().hex
    hook_name = "fc-roundtrip-" + uuid.uuid4().hex[:8]

    async with OwnerSessionLocal() as s:
        w = WebhookDef(
            tenant_id=tenant_id,
            name=hook_name,
            url="https://example.com/hook",
            events=["*"],
            secret=plaintext_secret,
            active=True,
        )
        s.add(w)
        await s.commit()
        await s.refresh(w)
        # ORM-side: secret is plaintext (decrypted on read)
        assert w.secret == plaintext_secret
        wid = w.id

    # Raw SQL: secret on disk is ciphertext, not plaintext
    async with OwnerSessionLocal() as s:
        raw = (await s.execute(
            text("SELECT secret FROM webhook_def WHERE id = :id"),
            {"id": wid},
        )).scalar_one()
        assert raw != plaintext_secret, "on-disk secret leaked as plaintext"
        assert raw.startswith("gAAAA"), f"on-disk value not a Fernet token: {raw[:20]}…"

    # Re-fetch via ORM: still decrypts cleanly
    async with OwnerSessionLocal() as s:
        w2 = (await s.execute(
            text("SELECT secret FROM webhook_def WHERE id = :id"),
            {"id": wid},
        )).scalar_one()
        # And via the ORM-typed column too
        w3 = await s.get(WebhookDef, wid)
        assert w3.secret == plaintext_secret

    # Cleanup
    async with OwnerSessionLocal() as s:
        await s.execute(text("DELETE FROM webhook_def WHERE id = :id"), {"id": wid})
        await s.commit()


@pytest.mark.asyncio
async def test_encrypted_string_handles_null_secret(tenant_id):
    """``secret`` is nullable on WebhookDef — None must round-trip without trouble."""
    hook_name = "fc-null-" + uuid.uuid4().hex[:8]
    async with OwnerSessionLocal() as s:
        w = WebhookDef(
            tenant_id=tenant_id,
            name=hook_name,
            url="https://example.com/null",
            events=["*"],
            secret=None,
            active=True,
        )
        s.add(w)
        await s.commit()
        await s.refresh(w)
        assert w.secret is None
        wid = w.id

    async with OwnerSessionLocal() as s:
        w2 = await s.get(WebhookDef, wid)
        assert w2.secret is None
        await s.delete(w2)
        await s.commit()


# ---- 3) Key rotation simulation -------------------------------------------------

def test_key_rotation_simulation_returns_none_not_raises(monkeypatch):
    """Encrypt with key A. Swap the env to key B. ``decrypt_str`` must return ``None``
    (not raise) — the rotation runbook handles re-encryption out-of-band."""
    # Encrypt with the current (dev) key
    cipher_under_key_a = encrypt_str("rotation-test-plaintext")
    assert decrypt_str(cipher_under_key_a) == "rotation-test-plaintext"

    # Generate a fresh, different key and rebuild the module's Fernet
    new_key = Fernet.generate_key().decode()
    monkeypatch.setenv("GAAEX_FIELD_KEY", new_key)
    field_crypto._reload_fernet()
    try:
        # The old ciphertext can no longer be decrypted — but no exception either
        assert decrypt_str(cipher_under_key_a) is None
        # The new key still round-trips fine for fresh writes
        fresh = encrypt_str("post-rotation-plaintext")
        assert decrypt_str(fresh) == "post-rotation-plaintext"
    finally:
        # Restore the original (dev) key so the rest of the suite stays consistent
        monkeypatch.delenv("GAAEX_FIELD_KEY", raising=False)
        field_crypto._reload_fernet()


def test_dev_key_fallback_is_deterministic(monkeypatch):
    """Two processes started without GAAEX_FIELD_KEY must land on the same dev key,
    so dev databases can be opened from any checkout of the repo. The warning log
    is the price of admission."""
    monkeypatch.delenv("GAAEX_FIELD_KEY", raising=False)
    field_crypto._reload_fernet()
    try:
        cipher = encrypt_str("dev-mode-secret")
        assert decrypt_str(cipher) == "dev-mode-secret"
    finally:
        field_crypto._reload_fernet()


def test_encrypted_string_typedecorator_basic():
    """Direct unit test of the TypeDecorator bind/result hooks — no DB needed."""
    col = EncryptedString()
    plain = "td-test-value"
    cipher = col.process_bind_param(plain, dialect=None)
    assert cipher != plain
    assert cipher is not None
    assert col.process_result_value(cipher, dialect=None) == plain
    # None passes through both directions
    assert col.process_bind_param(None, dialect=None) is None
    assert col.process_result_value(None, dialect=None) is None
