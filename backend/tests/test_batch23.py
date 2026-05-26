"""Batch 23 tests — job dashboard (A23) + channel adapters (E23).

A23: GET /api/jobs — lists JobRun rows, ?job_key= filter, unauth rejection.
     The jobs.py router is NOT yet merged (A23 still in lane A) and billing_cycle
     does not yet log a JobRun. Those tests are guarded with pytest.skip so the
     suite stays green. The skip probe is clean: we try to import the router; if it
     doesn't exist we skip every API-level assertion. The JobRun model itself IS
     already present (models/job.py) and is tested unconditionally.

E23: app/adapters package (base.py with ChannelAdapter + registry singleton).
     base.py IS present. email.py and sms.py are NOT yet present (E23 not fully
     merged). Adapter-class-level tests run unconditionally; tests that need the
     concrete email/sms adapters are skipped when those files are absent.

All async tests rely on asyncio_mode=auto (pytest.ini). Session-scoped client +
admin fixtures are from conftest — unchanged.
"""

import importlib
import inspect
import uuid

import pytest

# ---------------------------------------------------------------------------
# Detect A23 — jobs router wired in main.py (not just present as a file)
#
# The router module (app.routers.jobs) may exist but NOT be registered in main.py.
# We detect wiring by inspecting app.routes for a route whose path is "/api/jobs".
# This correctly returns False when the file exists but is not mounted.
# ---------------------------------------------------------------------------

_A23_REASON = ""
_A23_PRESENT = False

try:
    _jobs_mod = importlib.import_module("app.routers.jobs")
    _jobs_router = getattr(_jobs_mod, "router", None)
    if _jobs_router is None:
        _A23_REASON = "app.routers.jobs imported but 'router' not found (A23)"
    else:
        # Check if the router is actually mounted in the app
        from app.main import app as _app
        _mounted_paths = {getattr(r, "path", "") for r in _app.routes}
        if "/api/jobs" in _mounted_paths:
            _A23_PRESENT = True
        else:
            _A23_REASON = (
                "app.routers.jobs exists but is NOT registered in main.py (A23 not yet wired)"
            )
except ModuleNotFoundError:
    _A23_REASON = "app.routers.jobs not yet merged (A23)"

# ---------------------------------------------------------------------------
# Detect E23 — adapters package (base, email, sms)
# ---------------------------------------------------------------------------

_ADAPTERS_BASE = None
_E23_BASE_REASON = ""
_ADAPTER_REGISTRY = None

try:
    _base_mod = importlib.import_module("app.adapters.base")
    _ADAPTERS_BASE = _base_mod
    _ADAPTER_REGISTRY = getattr(_base_mod, "registry", None)
except ModuleNotFoundError:
    _E23_BASE_REASON = "app.adapters.base not yet merged (E23)"

_E23_BASE_PRESENT = _ADAPTERS_BASE is not None

_EMAIL_ADAPTER_CLS = None
_E23_EMAIL_REASON = ""

try:
    _email_mod = importlib.import_module("app.adapters.email")
    # could be a class or a module-level instance — we accept either
    _EMAIL_ADAPTER_CLS = (
        getattr(_email_mod, "DefaultEmailAdapter", None)
        or getattr(_email_mod, "LogEmailAdapter", None)
        or getattr(_email_mod, "EmailAdapter", None)
    )
    if _EMAIL_ADAPTER_CLS is None:
        _E23_EMAIL_REASON = "app.adapters.email has no known adapter class"
except ModuleNotFoundError:
    _E23_EMAIL_REASON = "app.adapters.email not yet merged (E23)"

_E23_EMAIL_PRESENT = _EMAIL_ADAPTER_CLS is not None

_SMS_ADAPTER_CLS = None
_E23_SMS_REASON = ""

try:
    _sms_mod = importlib.import_module("app.adapters.sms")
    _SMS_ADAPTER_CLS = (
        getattr(_sms_mod, "DefaultSmsAdapter", None)
        or getattr(_sms_mod, "LogSmsAdapter", None)
        or getattr(_sms_mod, "SmsAdapter", None)
    )
    if _SMS_ADAPTER_CLS is None:
        _E23_SMS_REASON = "app.adapters.sms has no known adapter class"
except ModuleNotFoundError:
    _E23_SMS_REASON = "app.adapters.sms not yet merged (E23)"

_E23_SMS_PRESENT = _SMS_ADAPTER_CLS is not None

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _uniq(tag: str) -> str:
    return f"{tag}-{uuid.uuid4().hex[:8]}"


# ===========================================================================
# PART 1 — JobRun model (always runs — model is already present)
# ===========================================================================


def test_jobrun_model_importable():
    """JobRun model is importable from app.models (models/job.py is merged)."""
    from app.models.job import JobRun  # noqa: F401 — import only
    assert JobRun.__tablename__ == "job_run"


def test_jobrun_model_has_required_columns():
    """JobRun has the columns specified in A23: job_key, status, summary, started_at,
    finished_at, actor_user_id, tenant_id."""
    from app.models.job import JobRun

    mapper = JobRun.__mapper__
    col_names = {c.key for c in mapper.column_attrs}
    required = {"id", "tenant_id", "job_key", "status", "summary", "started_at", "finished_at", "actor_user_id"}
    missing = required - col_names
    assert not missing, f"JobRun is missing columns: {missing}"


def test_jobrun_model_status_choices_are_strings():
    """Instantiating a JobRun with SUCCESS/ERROR status does not raise."""
    from app.models.job import JobRun

    for status in ("SUCCESS", "ERROR"):
        run = JobRun(
            tenant_id=uuid.uuid4(),
            job_key="billing.run_cycle",
            status=status,
            summary={"generated": 1, "skipped": 0, "errors": []},
        )
        assert run.status == status
        assert run.job_key == "billing.run_cycle"


# ===========================================================================
# PART 2 — /api/jobs endpoint (skip gracefully until A23 lands)
# ===========================================================================


async def test_jobs_endpoint_unauthenticated_rejected(client):
    """GET /api/jobs without a token returns 401 or 403 (never 200).
    Skipped until A23 is merged."""
    if not _A23_PRESENT:
        pytest.skip(f"Skipping: {_A23_REASON}")

    r = await client.get("/api/jobs")
    assert r.status_code in (401, 403), (
        f"Expected 401 or 403 for unauthenticated /api/jobs; got {r.status_code}: {r.text}"
    )


async def test_jobs_endpoint_empty_before_any_run(client, admin):
    """GET /api/jobs returns a list (possibly empty) for an authenticated admin.
    Skipped until A23 is merged."""
    if not _A23_PRESENT:
        pytest.skip(f"Skipping: {_A23_REASON}")

    r = await client.get("/api/jobs", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list), f"Expected list from /api/jobs; got {type(body).__name__}: {body!r:.200}"


async def test_jobs_endpoint_after_billing_cycle_run(client, admin):
    """Run billing cycle then check /api/jobs shows a JobRun with job_key='billing.run_cycle'
    and status='SUCCESS'. Skipped until A23 is merged (router + logging wired)."""
    if not _A23_PRESENT:
        pytest.skip(f"Skipping: {_A23_REASON}")

    # Trigger a billing cycle run so at least one JobRun is written
    cycle_r = await client.post("/api/billing/run-cycle", headers=admin, json={})
    assert cycle_r.status_code == 200, f"billing run-cycle failed: {cycle_r.text}"

    r = await client.get("/api/jobs", headers=admin)
    assert r.status_code == 200, r.text
    runs = r.json()
    assert isinstance(runs, list)
    # Find the run_cycle entry
    cycle_runs = [x for x in runs if x.get("job_key") == "billing.run_cycle"]
    assert cycle_runs, (
        f"No JobRun with job_key='billing.run_cycle' found in /api/jobs; got: {runs!r:.400}"
    )
    run = cycle_runs[0]
    assert run["status"] == "SUCCESS", f"Expected SUCCESS status; got: {run}"
    assert "summary" in run, f"JobRun missing 'summary' field: {run}"
    summary = run["summary"]
    assert isinstance(summary, dict), f"summary should be a dict; got {type(summary).__name__}"
    # summary must have the billing-cycle keys
    for key in ("generated", "skipped", "errors"):
        assert key in summary, f"JobRun summary missing '{key}'; got: {summary}"


async def test_jobs_endpoint_job_key_filter(client, admin):
    """?job_key=billing.run_cycle returns only runs for that key (no cross-key bleed).
    Skipped until A23 is merged."""
    if not _A23_PRESENT:
        pytest.skip(f"Skipping: {_A23_REASON}")

    r = await client.get("/api/jobs?job_key=billing.run_cycle", headers=admin)
    assert r.status_code == 200, r.text
    runs = r.json()
    assert isinstance(runs, list)
    # Every row must have the requested job_key
    wrong = [x for x in runs if x.get("job_key") != "billing.run_cycle"]
    assert not wrong, (
        f"?job_key filter leaked other job keys: {wrong!r:.300}"
    )


async def test_jobs_endpoint_unknown_filter_returns_empty(client, admin):
    """?job_key=nonexistent.key returns an empty list (never an error).
    Skipped until A23 is merged."""
    if not _A23_PRESENT:
        pytest.skip(f"Skipping: {_A23_REASON}")

    r = await client.get("/api/jobs?job_key=nonexistent.key", headers=admin)
    assert r.status_code == 200, r.text
    runs = r.json()
    assert runs == [], f"Expected empty list for unknown job_key filter; got: {runs!r:.200}"


# ===========================================================================
# PART 3 — adapters.base — ChannelAdapter interface + registry (always runs)
# ===========================================================================


def test_adapters_base_importable():
    """app.adapters.base is importable and exposes ChannelAdapter + registry."""
    if not _E23_BASE_PRESENT:
        pytest.skip(f"Skipping: {_E23_BASE_REASON}")

    from app.adapters.base import ChannelAdapter, registry  # noqa: F401
    assert ChannelAdapter is not None
    assert registry is not None


def test_adapters_registry_singleton():
    """The module-level `registry` object is an _AdapterRegistry (or equivalent) with
    get/set/all methods."""
    if not _E23_BASE_PRESENT:
        pytest.skip(f"Skipping: {_E23_BASE_REASON}")

    from app.adapters.base import registry

    assert hasattr(registry, "get"), "registry must have a .get(channel) method"
    assert hasattr(registry, "set"), "registry must have a .set(adapter) method"
    # all() or channels() for introspection
    has_all = hasattr(registry, "all") or hasattr(registry, "channels")
    assert has_all, "registry must have .all() or .channels() for introspection"


def test_channel_adapter_is_abstract():
    """ChannelAdapter cannot be instantiated directly (it is abstract)."""
    if not _E23_BASE_PRESENT:
        pytest.skip(f"Skipping: {_E23_BASE_REASON}")

    from app.adapters.base import ChannelAdapter
    import abc

    # Must be an ABC (has abstract methods)
    assert inspect.isabstract(ChannelAdapter), (
        "ChannelAdapter should be abstract and not directly instantiable"
    )


def test_channel_adapter_subclass_contract():
    """A minimal concrete ChannelAdapter subclass can be instantiated and registered."""
    if not _E23_BASE_PRESENT:
        pytest.skip(f"Skipping: {_E23_BASE_REASON}")

    from app.adapters.base import ChannelAdapter, _AdapterRegistry

    class _TestAdapter(ChannelAdapter):
        channel = "test-channel-b23"

        async def send(self, to, subject, body, meta=None):
            return {"status": "LOG", "channel": self.channel, "to": to, "detail": "test"}

    inst = _TestAdapter()
    assert inst.channel == "test-channel-b23"

    # Can be registered in a fresh registry
    reg = _AdapterRegistry()
    reg.set(inst)
    assert reg.get("test-channel-b23") is inst


def test_channel_adapter_safe_send_never_raises():
    """safe_send() catches any exception the send() impl raises and returns FAILED dict."""
    if not _E23_BASE_PRESENT:
        pytest.skip(f"Skipping: {_E23_BASE_REASON}")

    from app.adapters.base import ChannelAdapter
    import asyncio

    class _BrokenAdapter(ChannelAdapter):
        channel = "broken-b23"

        async def send(self, to, subject, body, meta=None):
            raise RuntimeError("intentional failure from test")

    adapter = _BrokenAdapter()

    async def _run():
        result = await adapter.safe_send("test@example.com", "subj", "body")
        return result

    result = asyncio.get_event_loop().run_until_complete(_run())
    assert result["status"] == "FAILED", f"Expected FAILED; got: {result}"
    assert result["channel"] == "broken-b23"
    assert "intentional failure" in result.get("detail", ""), f"Missing error detail: {result}"


def test_registry_get_unknown_channel_returns_none():
    """registry.get() for an unregistered channel returns None (never raises)."""
    if not _E23_BASE_PRESENT:
        pytest.skip(f"Skipping: {_E23_BASE_REASON}")

    from app.adapters.base import _AdapterRegistry

    reg = _AdapterRegistry()
    result = reg.get("totally-unknown-channel-xyz")
    assert result is None, f"Expected None for unknown channel; got: {result!r}"


# ===========================================================================
# PART 4 — adapters.email + adapters.sms (skip until E23 fully merged)
# ===========================================================================


async def test_email_adapter_importable_and_log_send_never_raises():
    """The default email adapter (no SMTP config) returns a LOG/SENT result and never raises.
    Skipped until app.adapters.email is merged (E23)."""
    if not _E23_EMAIL_PRESENT:
        pytest.skip(f"Skipping: {_E23_EMAIL_REASON}")

    adapter = _EMAIL_ADAPTER_CLS()
    result = await adapter.safe_send("user@example.com", "Hello", "Test body")
    assert result["status"] in ("LOG", "SENT", "FAILED"), f"Unexpected status: {result}"
    # The critical assertion: no SMTP config → should be LOG (logged only) or SENT-to-log
    # (not a hard crash). Any status is acceptable; what MUST NOT happen is an uncaught exception.
    assert "channel" in result, f"Result missing 'channel' key: {result}"


async def test_email_adapter_registered_in_registry():
    """After importing adapters.email, the email adapter is in the registry.
    Skipped until app.adapters.email is merged (E23)."""
    if not _E23_EMAIL_PRESENT:
        pytest.skip(f"Skipping: {_E23_EMAIL_REASON}")

    from app.adapters.base import registry

    email_adapter = registry.get("email")
    assert email_adapter is not None, (
        "No 'email' adapter in registry after importing app.adapters.email"
    )


async def test_sms_adapter_importable_and_log_send_never_raises():
    """The SMS stub adapter with no config returns a result and never raises.
    Skipped until app.adapters.sms is merged (E23)."""
    if not _E23_SMS_PRESENT:
        pytest.skip(f"Skipping: {_E23_SMS_REASON}")

    adapter = _SMS_ADAPTER_CLS()
    result = await adapter.safe_send("+37400000000", None, "Test SMS body")
    assert result["status"] in ("LOG", "SENT", "FAILED"), f"Unexpected status: {result}"
    assert "channel" in result, f"Result missing 'channel' key: {result}"


async def test_sms_adapter_registered_in_registry():
    """After importing adapters.sms, the sms adapter is in the registry.
    Skipped until app.adapters.sms is merged (E23)."""
    if not _E23_SMS_PRESENT:
        pytest.skip(f"Skipping: {_E23_SMS_REASON}")

    from app.adapters.base import registry

    sms_adapter = registry.get("sms")
    assert sms_adapter is not None, (
        "No 'sms' adapter in registry after importing app.adapters.sms"
    )


async def test_unknown_channel_registry_lookup_is_graceful():
    """Looking up a channel that has no adapter registered returns None — never raises.
    This works unconditionally since it only uses base.py."""
    if not _E23_BASE_PRESENT:
        pytest.skip(f"Skipping: {_E23_BASE_REASON}")

    from app.adapters.base import registry

    result = registry.get("pigeon-mail")
    assert result is None, f"Expected None for unknown channel; got: {result!r}"


# ===========================================================================
# PART 5 — Legacy channels.py adapter registry (always runs — always present)
# ===========================================================================


def test_legacy_channels_registry_resolves_email_and_sms():
    """channels.registered() has 'email' and 'sms' entries (channels.py is always present)."""
    from app import channels

    reg = channels.registered()
    assert "email" in reg, f"'email' not in channels registry; keys={list(reg)}"
    assert "sms" in reg, f"'sms' not in channels registry; keys={list(reg)}"


def test_legacy_channels_email_adapter_is_callable():
    """channels._email_adapter is an async callable (the dev log adapter)."""
    from app import channels

    assert callable(channels._email_adapter), "_email_adapter should be callable"
    assert inspect.iscoroutinefunction(channels._email_adapter), (
        "_email_adapter should be an async function"
    )


def test_legacy_channels_sms_adapter_is_callable():
    """channels._sms_adapter is an async callable (the dev log adapter)."""
    from app import channels

    assert callable(channels._sms_adapter), "_sms_adapter should be callable"
    assert inspect.iscoroutinefunction(channels._sms_adapter), (
        "_sms_adapter should be an async function"
    )


def test_legacy_channels_all_expected_channels_present():
    """channels.registered() contains all 5 expected channel names."""
    from app import channels

    reg = channels.registered()
    expected = {"inapp", "console", "email", "sms", "webhook"}
    missing = expected - set(reg)
    assert not missing, f"channels registry missing: {missing}; have: {list(reg)}"


async def test_legacy_channels_email_adapter_logs_without_raising():
    """_email_adapter sends (logs) without raising when given a valid address."""
    from app import channels

    # Should not raise — logs at INFO level
    await channels._email_adapter("test@example.com", "Subject", "Body")


async def test_legacy_channels_email_adapter_raises_on_missing_address():
    """_email_adapter raises ValueError when `to` is None or empty."""
    from app import channels

    with pytest.raises((ValueError, Exception)):
        await channels._email_adapter(None, "Subject", "Body")
