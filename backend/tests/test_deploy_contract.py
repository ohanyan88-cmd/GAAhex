"""M1-A Wave 4 — production deploy contract guard.

The app refuses to boot in production if DATABASE_URL and OWNER_DATABASE_URL
would land the app on the same Postgres role as the table owner — because then
RLS would be bypassed and every Wave 3 policy would be decorative.

In dev / test / CI (the default `settings.environment == "development"`) the
guard is a no-op so the rest of the suite is unaffected.
"""
import pytest

from app.config import _assert_production_deploy_contract, settings


def test_dev_default_does_not_fire():
    """With ENVIRONMENT unset (default "development") the guard is a no-op even
    when the URLs are equal — which is the normal dev/test setup."""
    # No monkeypatching: rely on the real settings as the suite loads them.
    # conftest.py sets DATABASE_URL == OWNER_DATABASE_URL deliberately; the
    # guard MUST tolerate that outside of production.
    assert settings.environment != "production"
    _assert_production_deploy_contract()  # must not raise


def test_production_with_equal_urls_raises(monkeypatch):
    """In production, equal DATABASE_URL / OWNER_DATABASE_URL is the exact
    failure mode the guard exists to catch."""
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(
        settings, "database_url", "postgresql+asyncpg://x:y@h:5432/db"
    )
    # owner unset → falls back to database_url
    monkeypatch.setattr(settings, "owner_database_url", None)
    with pytest.raises(RuntimeError, match="production deploy contract violation"):
        _assert_production_deploy_contract()


def test_production_with_same_role_raises(monkeypatch):
    """Different URLs (different DBs) but the same Postgres role still means
    the app runs as the table owner → RLS bypassed."""
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(
        settings, "database_url", "postgresql+asyncpg://gaahex:y@h:5432/a"
    )
    monkeypatch.setattr(
        settings, "owner_database_url", "postgresql+asyncpg://gaahex:y@h:5432/b"
    )
    with pytest.raises(RuntimeError, match="same role"):
        _assert_production_deploy_contract()


def test_production_with_separate_roles_passes(monkeypatch):
    """The correct prod shape: app role differs from owner role; guard is silent.

    The production deploy contract also forbids CORS_ORIGINS="*" (dev default),
    so the test sets it to a concrete origin to validate the happy path."""
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(
        settings, "database_url", "postgresql+asyncpg://gaahex_app:y@h:5432/a"
    )
    monkeypatch.setattr(
        settings, "owner_database_url", "postgresql+asyncpg://gaahex:y@h:5432/a"
    )
    monkeypatch.setattr(settings, "cors_origins", "https://app.example.com")
    # The contract also forbids mock providers in production; set them all to
    # a real-looking value so this happy-path test isolates the role check.
    monkeypatch.setattr(settings, "payment_gateway_provider", "stripe")
    monkeypatch.setattr(settings, "email_gateway_provider", "sendgrid")
    monkeypatch.setattr(settings, "sms_gateway_provider", "twilio")
    monkeypatch.setattr(settings, "radius_backend_provider", "freeradius")
    monkeypatch.setattr(settings, "portal_auth_mode", "cookie")
    monkeypatch.setattr(settings, "email_provider", "smtp")    # E1: legacy comms not on dev/no-op
    monkeypatch.setattr(settings, "sms_provider", "twilio")    # E1
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")       # E1b: real SMTP gateway constructs
    monkeypatch.setattr(settings, "twilio_account_sid", "ACxxxxxxxxxxxx")  # E1b: real Twilio gateway constructs
    monkeypatch.setattr(settings, "twilio_auth_token", "tok_xxxxxxxxxxxx")
    monkeypatch.setattr(settings, "twilio_from", "+37410000000")
    monkeypatch.setattr(settings, "rate_limit_enabled", True)  # E2: abuse guard on in prod
    # The suite sets FEATURE_PAYMENTS_ENABLED=true (conftest); with the default dev provider the C2
    # payment gate would fire, so this role-check happy-path declares payments off to stay isolated.
    monkeypatch.setattr(settings, "feature_payments_enabled", False)
    _assert_production_deploy_contract()  # must not raise


def _prod_base(monkeypatch):
    """Production happy-path so a payment-gate test isolates the C2 check."""
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "database_url", "postgresql+asyncpg://gaahex_app:y@h:5432/a")
    monkeypatch.setattr(settings, "owner_database_url", "postgresql+asyncpg://gaahex:y@h:5432/a")
    monkeypatch.setattr(settings, "cors_origins", "https://app.example.com")
    monkeypatch.setattr(settings, "payment_gateway_provider", "stripe")
    monkeypatch.setattr(settings, "email_gateway_provider", "sendgrid")
    monkeypatch.setattr(settings, "sms_gateway_provider", "twilio")
    monkeypatch.setattr(settings, "radius_backend_provider", "freeradius")
    monkeypatch.setattr(settings, "portal_auth_mode", "cookie")
    monkeypatch.setattr(settings, "email_provider", "smtp")    # E1: legacy comms not on dev/no-op
    monkeypatch.setattr(settings, "sms_provider", "twilio")    # E1
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")       # E1b: real SMTP gateway constructs
    monkeypatch.setattr(settings, "twilio_account_sid", "ACxxxxxxxxxxxx")  # E1b: real Twilio gateway constructs
    monkeypatch.setattr(settings, "twilio_auth_token", "tok_xxxxxxxxxxxx")
    monkeypatch.setattr(settings, "twilio_from", "+37410000000")
    monkeypatch.setattr(settings, "rate_limit_enabled", True)  # E2: abuse guard on in prod


def test_payments_enabled_with_dev_provider_raises(monkeypatch):
    """C2 — FEATURE_PAYMENTS_ENABLED with the dev/mock legacy provider must refuse boot."""
    _prod_base(monkeypatch)
    monkeypatch.setattr(settings, "feature_payments_enabled", True)
    monkeypatch.setattr(settings, "payment_provider", "dev")
    with pytest.raises(RuntimeError, match="dev/mock gateway must never"):
        _assert_production_deploy_contract()


def test_payments_enabled_unconfirmed_provider_raises(monkeypatch):
    """C2 — a real legacy provider WITHOUT the go-live affirmation must refuse boot."""
    _prod_base(monkeypatch)
    monkeypatch.setattr(settings, "feature_payments_enabled", True)
    monkeypatch.setattr(settings, "payment_provider", "idram")
    monkeypatch.setattr(settings, "payment_provider_go_live_confirmed", False)
    with pytest.raises(RuntimeError, match="GO_LIVE_CONFIRMED"):
        _assert_production_deploy_contract()


def test_payments_enabled_confirmed_provider_passes(monkeypatch):
    """C2 — a real provider WITH the explicit go-live affirmation boots."""
    _prod_base(monkeypatch)
    monkeypatch.setattr(settings, "feature_payments_enabled", True)
    monkeypatch.setattr(settings, "payment_provider", "idram")
    monkeypatch.setattr(settings, "payment_provider_go_live_confirmed", True)
    _assert_production_deploy_contract()  # must not raise


def test_payments_disabled_skips_provider_gate(monkeypatch):
    """C2 — with payments OFF (default), the legacy provider is irrelevant; gate does not fire."""
    _prod_base(monkeypatch)
    monkeypatch.setattr(settings, "feature_payments_enabled", False)
    monkeypatch.setattr(settings, "payment_provider", "dev")
    _assert_production_deploy_contract()  # must not raise


def test_legacy_comms_dev_provider_raises(monkeypatch):
    """E1 (SEC-1/2) — legacy EMAIL_PROVIDER/SMS_PROVIDER on the dev no-op channel must refuse
    boot in production (they silently DROP outbound email/SMS)."""
    _prod_base(monkeypatch)
    monkeypatch.setattr(settings, "feature_payments_enabled", False)
    monkeypatch.setattr(settings, "email_provider", "dev")   # _prod_base set it to smtp; trip E1
    with pytest.raises(RuntimeError, match="EMAIL_PROVIDER"):
        _assert_production_deploy_contract()


def test_email_smtp_without_host_raises(monkeypatch):
    """E1b — EMAIL_PROVIDER=smtp passes the E1 name-check but with no SMTP_HOST the real adapter never
    registers (channels.py falls back to the dev no-op), silently dropping email. Must refuse boot."""
    _prod_base(monkeypatch)
    monkeypatch.setattr(settings, "feature_payments_enabled", False)
    monkeypatch.setattr(settings, "smtp_host", None)   # _prod_base set it; clear → real SMTP can't construct
    with pytest.raises(RuntimeError, match="SMTP_HOST"):
        _assert_production_deploy_contract()


def test_sms_twilio_without_credentials_raises(monkeypatch):
    """E1b — SMS_PROVIDER=twilio with missing credentials would silently fall back to the dev no-op
    (dropping OTP/dunning SMS). Must refuse boot."""
    _prod_base(monkeypatch)
    monkeypatch.setattr(settings, "feature_payments_enabled", False)
    monkeypatch.setattr(settings, "twilio_account_sid", None)   # real Twilio adapter can't construct
    with pytest.raises(RuntimeError, match="TWILIO_ACCOUNT_SID"):
        _assert_production_deploy_contract()


def test_rate_limit_disabled_in_production_raises(monkeypatch):
    """E2 (SEC-3) — RATE_LIMIT_ENABLED=false must refuse boot in production (no abuse guard)."""
    _prod_base(monkeypatch)
    monkeypatch.setattr(settings, "feature_payments_enabled", False)
    monkeypatch.setattr(settings, "rate_limit_enabled", False)   # _prod_base set True; trip E2
    with pytest.raises(RuntimeError, match="RATE_LIMIT_ENABLED"):
        _assert_production_deploy_contract()
