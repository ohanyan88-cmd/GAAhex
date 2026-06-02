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
    """The correct prod shape: app role differs from owner role; guard is silent."""
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(
        settings, "database_url", "postgresql+asyncpg://gaahex_app:y@h:5432/a"
    )
    monkeypatch.setattr(
        settings, "owner_database_url", "postgresql+asyncpg://gaahex:y@h:5432/a"
    )
    _assert_production_deploy_contract()  # must not raise
