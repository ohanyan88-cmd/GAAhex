"""C3/C4 — boot-contract fail-safe: the production posture is FAIL-CLOSED.

Before this fix:
  * the JWT weak-secret check was gated behind ``require_strong_secrets`` (default ``False``), so a prod
    deploy that forgot the flag booted happily on ``dev-only-change-me``;
  * the field-encryption key silently fell back to a PUBLIC in-source dev Fernet key when
    ``GAAHEX_FIELD_KEY`` was unset;
  * a typo'd or unset ``ENVIRONMENT`` (``prod``/``Production``/empty) ran in permissive mode because every
    gate used a raw ``== "production"`` compare.

After: ``is_production()`` is fail-closed (unset/typo/unknown → strict), and the JWT + field-key checks
fire AUTOMATICALLY in production regardless of the opt-in flag. These tests reproduce each original gap
and prove it now refuses to boot, while confirming dev/test stay relaxed.
"""
import pytest

from app.config import (
    settings,
    is_production,
    environment_is_recognised,
    assert_production_secrets,
)
from app.security.field_crypto import assert_production_key_is_real


# ── is_production() is fail-closed ───────────────────────────────────────────────────────────────
@pytest.mark.parametrize("env,strict", [
    ("production", True),
    ("prod", True),        # typo → strict (was permissive — the bug)
    ("Production", True),   # case variant → strict
    ("staging", True),      # staging is a real deploy → strict
    ("", True),             # empty → strict
    ("garbage", True),      # unknown → strict
    ("development", False),
    ("dev", False),
    ("test", False),
    ("ci", False),
    ("local", False),
])
def test_is_production_is_fail_closed(monkeypatch, env, strict):
    monkeypatch.setattr(settings, "environment", env)
    assert is_production() is strict


@pytest.mark.parametrize("env,known", [
    ("production", True), ("development", True), ("test", True), ("staging", True),
    ("prod", False), ("", False), ("garbage", False),
])
def test_environment_recognition_flags_typos(monkeypatch, env, known):
    monkeypatch.setattr(settings, "environment", env)
    assert environment_is_recognised() is known


# ── C3 — JWT weak-secret refusal is automatic in production (no opt-in flag) ──────────────────────
def test_c3_weak_jwt_refuses_boot_without_the_optin_flag(monkeypatch):
    # Reproduce the ORIGINAL gap: production + require_strong_secrets UNSET (default) + the dev JWT.
    # Previously this booted; now it must refuse.
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "require_strong_secrets", False)  # the forgotten flag
    monkeypatch.setattr(settings, "jwt_secret", "dev-only-change-me")
    with pytest.raises(RuntimeError, match="Weak JWT secret"):
        assert_production_secrets()


def test_c3_short_jwt_refuses_boot_in_production(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "require_strong_secrets", False)
    monkeypatch.setattr(settings, "jwt_secret", "short-secret")  # < 32 bytes
    with pytest.raises(RuntimeError, match="Weak JWT secret"):
        assert_production_secrets()


def test_c3_typo_environment_also_enforces_jwt(monkeypatch):
    monkeypatch.setattr(settings, "environment", "prod")  # typo → still strict
    monkeypatch.setattr(settings, "require_strong_secrets", False)
    monkeypatch.setattr(settings, "jwt_secret", "dev-only-change-me")
    with pytest.raises(RuntimeError, match="Weak JWT secret"):
        assert_production_secrets()


def test_c3_strong_jwt_boots_in_production(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "jwt_secret", "x" * 48)  # strong, 48 bytes
    assert_production_secrets()  # must NOT raise


def test_c3_dev_keeps_weak_jwt(monkeypatch):
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "require_strong_secrets", False)
    monkeypatch.setattr(settings, "jwt_secret", "dev-only-change-me")
    assert_production_secrets()  # dev is relaxed — must NOT raise


# ── C4 — field-encryption dev-key refusal is automatic in production ──────────────────────────────
def test_c4_dev_field_key_refuses_boot_in_production(monkeypatch):
    # Reproduce the ORIGINAL gap: production with no GAAHEX_FIELD_KEY → would silently use the public
    # in-source dev Fernet key. Now it must refuse.
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.delenv("GAAHEX_FIELD_KEY", raising=False)
    with pytest.raises(RuntimeError, match="GAAHEX_FIELD_KEY is unset in production"):
        assert_production_key_is_real()


def test_c4_typo_environment_also_enforces_field_key(monkeypatch):
    monkeypatch.setattr(settings, "environment", "Production")  # case variant → strict
    monkeypatch.delenv("GAAHEX_FIELD_KEY", raising=False)
    with pytest.raises(RuntimeError, match="GAAHEX_FIELD_KEY is unset in production"):
        assert_production_key_is_real()


def test_c4_real_field_key_boots_in_production(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setenv("GAAHEX_FIELD_KEY", "a-real-operator-provided-fernet-key-value")
    assert_production_key_is_real()  # key present → must NOT raise


def test_c4_dev_keeps_dev_field_key(monkeypatch):
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.delenv("GAAHEX_FIELD_KEY", raising=False)
    assert_production_key_is_real()  # dev is relaxed — must NOT raise
