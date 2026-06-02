"""M1-C Phase 0 — RadiusBackend Protocol + MockRadiusBackend + FreeRadiusBackend + factory."""
from __future__ import annotations

import pytest

from app.services.radius import (
    FreeRadiusBackend,
    MockRadiusBackend,
    RadiusAcctResult,
    RadiusAuthResult,
    RadiusBackend,
    RadiusBackendConfigError,
    RadiusDisconnectResult,
    get_radius_backend,
    registered_radius_backends,
)

try:
    import pyrad  # type: ignore  # noqa: F401
    _PYRAD_INSTALLED = True
except ImportError:
    _PYRAD_INSTALLED = False


def test_mock_radius_satisfies_protocol():
    b = MockRadiusBackend()
    assert isinstance(b, RadiusBackend)
    assert b.provider == "mock"


def test_mock_radius_has_full_method_surface():
    b = MockRadiusBackend()
    for name in ("authenticate", "acct_start", "acct_stop", "disconnect", "reset"):
        assert callable(getattr(b, name))


@pytest.mark.asyncio
async def test_mock_authenticate_allows_by_default():
    b = MockRadiusBackend()
    res = await b.authenticate(username="user1", password="p")
    assert isinstance(res, RadiusAuthResult)
    assert res.allowed is True
    assert res.framed_ip and res.framed_ip.startswith("10.200.")
    assert "Framed-IP-Address" in res.attributes


@pytest.mark.asyncio
async def test_mock_authenticate_denies_on_deny_sentinel():
    b = MockRadiusBackend()
    res = await b.authenticate(username="user1", password="passdeny")
    assert res.allowed is False
    assert res.framed_ip is None


@pytest.mark.asyncio
async def test_mock_acct_start_registers_session():
    b = MockRadiusBackend()
    res = await b.acct_start(session_id="sid-1", username="user1", framed_ip="10.1.2.3")
    assert isinstance(res, RadiusAcctResult)
    assert res.status == "ok"
    assert "sid-1" in b.sessions
    assert b.sessions["sid-1"]["status"] == "started"
    assert b.sessions["sid-1"]["framed_ip"] == "10.1.2.3"


@pytest.mark.asyncio
async def test_mock_acct_stop_updates_session():
    b = MockRadiusBackend()
    await b.acct_start(session_id="sid-1", username="user1")
    res = await b.acct_stop(
        session_id="sid-1", username="user1",
        octets_in=1_000_000, octets_out=2_000_000,
        termination_cause="User-Request",
    )
    assert res.status == "ok"
    assert b.sessions["sid-1"]["status"] == "stopped"
    assert b.sessions["sid-1"]["octets_in"] == 1_000_000
    assert b.sessions["sid-1"]["termination_cause"] == "User-Request"


@pytest.mark.asyncio
async def test_mock_acct_stop_without_prior_start_tolerated():
    b = MockRadiusBackend()
    res = await b.acct_stop(session_id="orphan", username="u", octets_in=10)
    assert res.status == "ok"
    assert b.sessions["orphan"]["status"] == "stopped"


@pytest.mark.asyncio
async def test_mock_disconnect_removes_session():
    b = MockRadiusBackend()
    await b.acct_start(session_id="sid-1", username="user1")
    res = await b.disconnect(session_id="sid-1", username="user1")
    assert isinstance(res, RadiusDisconnectResult)
    assert res.status == "ok"
    assert "sid-1" not in b.sessions


@pytest.mark.asyncio
async def test_mock_disconnect_unknown_session_returns_not_found():
    b = MockRadiusBackend()
    res = await b.disconnect(session_id="ghost", username="user1")
    assert res.status == "not-found"


def test_mock_reset_clears_state():
    b = MockRadiusBackend()
    b.sessions["x"] = {"y": 1}
    b.calls.append(("noop", {}))
    b.reset()
    assert b.sessions == {}
    assert b.calls == []


# ─── FreeRadiusBackend ────────────────────────────────────────────────────


@pytest.mark.skipif(_PYRAD_INSTALLED, reason="pyrad installed; ImportError path not exercised")
def test_freeradius_construction_raises_importerror_when_sdk_missing():
    with pytest.raises(ImportError, match="pyrad is required"):
        FreeRadiusBackend(host="10.0.0.1", secret="s3cr3t")


@pytest.mark.skipif(not _PYRAD_INSTALLED, reason="pyrad not installed")
def test_freeradius_construction_with_valid_config_succeeds():
    b = FreeRadiusBackend(host="10.0.0.1", secret="s3cr3t")
    assert b.provider == "freeradius"


@pytest.mark.skipif(not _PYRAD_INSTALLED, reason="pyrad not installed")
def test_freeradius_missing_host_raises_config_error():
    with pytest.raises(RadiusBackendConfigError, match="RADIUS_HOST"):
        FreeRadiusBackend(host=None, secret="s3cr3t")


@pytest.mark.skipif(not _PYRAD_INSTALLED, reason="pyrad not installed")
def test_freeradius_missing_secret_raises_config_error():
    with pytest.raises(RadiusBackendConfigError, match="RADIUS_SECRET"):
        FreeRadiusBackend(host="10.0.0.1", secret=None)


# ─── Factory ──────────────────────────────────────────────────────────────


def test_registered_radius_backends_includes_mock_and_freeradius():
    backends = registered_radius_backends()
    assert "mock" in backends
    assert "freeradius" in backends


def test_radius_factory_returns_mock_by_default(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.radius_backend_provider", "mock", raising=False,
    )
    b = get_radius_backend()
    assert isinstance(b, MockRadiusBackend)


def test_radius_factory_falls_back_to_mock_on_unknown(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.radius_backend_provider", "no-such", raising=False,
    )
    b = get_radius_backend()
    assert isinstance(b, MockRadiusBackend)


def test_radius_factory_falls_back_to_mock_when_freeradius_unconfigured(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.radius_backend_provider", "freeradius", raising=False,
    )
    monkeypatch.setattr("app.config.settings.radius_host", None, raising=False)
    monkeypatch.setattr("app.config.settings.radius_secret", None, raising=False)
    b = get_radius_backend()
    assert isinstance(b, MockRadiusBackend)
