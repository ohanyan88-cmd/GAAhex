"""Pack 11/8 — security remediation coverage.

Closes the Critical/High findings flagged in the 2026-06-04 audit:

* **S5** — `/org-tree` was public + cross-tenant under the owner session. Now
  requires auth AND is scoped to the caller's tenant. The first test below
  proves both halves (401 unauth, 200-with-only-my-rows for tenant A).
* **S1 + H3** — `_assert_production_deploy_contract()` extended to refuse
  boot in production when CORS_ORIGINS contains a wildcard, or when any of
  the M1-C provider switches (payment / email / sms / radius) is still set
  to ``mock``. Three tests parametrize across the offending knobs.
* **H4** — every response now carries a restrictive Content-Security-Policy.
* **H13** — every response carries an ``X-Request-ID`` that the middleware
  either echoes from the request or mints (UUIDv7).
* **AC4** — idempotency middleware no longer has a TOCTOU window: two
  concurrent requests with the same Idempotency-Key result in exactly ONE
  handler invocation, the other gets the cached reply.

The deploy-contract tests follow the pattern in ``test_deploy_contract.py``:
they monkeypatch ``settings.environment`` to "production" and assert the
contract function raises with a message that names the offender. They do
not change the live process environment, so the rest of the suite is
unaffected.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from fastapi import Depends
from sqlalchemy import delete, select
from sqlalchemy_utils import Ltree

from app.config import _assert_production_deploy_contract, settings
from app.db import OwnerSessionLocal
from app.models import OrgNode, Tenant, User
from app.models.idempotency_request import IdempotencyRequest
from app.security import create_access_token, hash_password


# ──────────────────────────────────────────────────────────────────────────────
# S5 — /org-tree authentication + tenant scoping
# ──────────────────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture
async def second_tenant_user():
    """Stand up an isolated second tenant + a user under it so we can prove
    cross-tenant data does NOT leak through /org-tree.

    Yields ``(token_header, tenant_id, org_node_id)``. Cleans up after.
    """
    async with OwnerSessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})
        t = Tenant(name="Other ISP (remediation test)")
        s.add(t)
        await s.flush()
        node = OrgNode(
            tenant_id=t.id,
            type="Group",
            name="Other ISP Group",
            code="other_grp",
            path=Ltree("other_grp"),
        )
        s.add(node)
        await s.flush()
        u = User(
            tenant_id=t.id,
            primary_node_id=node.id,
            email=f"other-{uuid.uuid4().hex[:8]}@example.invalid",
            name="Other Tenant User",
            password_hash=hash_password("doesnt-matter"),
        )
        s.add(u)
        await s.commit()
        tenant_id = t.id
        node_id = node.id
        user_id = u.id
        user_email = u.email

    token = create_access_token(
        str(user_id), {"email": user_email, "tenant": str(tenant_id)}
    )
    yield (
        {"Authorization": f"Bearer {token}"},
        tenant_id,
        node_id,
    )

    # Teardown — owner session, audit bypass since we're deliberately
    # cross-tenant in cleanup.
    async with OwnerSessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})
        await s.execute(delete(User).where(User.id == user_id))
        await s.execute(delete(OrgNode).where(OrgNode.tenant_id == tenant_id))
        await s.execute(delete(Tenant).where(Tenant.id == tenant_id))
        await s.commit()


@pytest.mark.asyncio
async def test_org_tree_requires_auth(client, admin, second_tenant_user):
    """Unauth → 401. Authed → only the caller's tenant + its nodes."""
    header_b, tenant_b_id, node_b_id = second_tenant_user

    # 1) Unauth — must be rejected. Before the fix this returned 200 with
    # every tenant's data.
    r = await client.get("/org-tree")
    assert r.status_code == 401, (
        f"/org-tree must require auth (S5); got {r.status_code}: {r.text}"
    )

    # 2) Authed as admin (demo tenant) — must see EXACTLY one tenant entry
    # (admin's own) and zero rows from the second tenant.
    r_admin = await client.get("/org-tree", headers=admin)
    assert r_admin.status_code == 200, r_admin.text
    body_admin = r_admin.json()
    admin_tenant_ids = {t["id"] for t in body_admin["tenants"]}
    admin_node_ids = {n["id"] for n in body_admin["nodes"]}
    assert len(admin_tenant_ids) == 1, (
        f"/org-tree leaked extra tenants: {admin_tenant_ids}"
    )
    assert str(tenant_b_id) not in admin_tenant_ids, "second tenant leaked into admin's view"
    assert str(node_b_id) not in admin_node_ids, "second tenant's org node leaked into admin's view"

    # 3) Authed as the second-tenant user — must see exactly ONE tenant
    # (its own) and the one node we seeded.
    r_b = await client.get("/org-tree", headers=header_b)
    assert r_b.status_code == 200, r_b.text
    body_b = r_b.json()
    b_tenant_ids = {t["id"] for t in body_b["tenants"]}
    b_node_ids = {n["id"] for n in body_b["nodes"]}
    assert b_tenant_ids == {str(tenant_b_id)}
    assert str(node_b_id) in b_node_ids
    # Demo tenant must NOT be present in the second-tenant view.
    assert not (admin_tenant_ids & b_tenant_ids), (
        "second tenant's /org-tree saw the demo tenant — cross-tenant leak"
    )


# ──────────────────────────────────────────────────────────────────────────────
# S1 + H3 — production deploy contract refuses mock providers + wildcard CORS
# ──────────────────────────────────────────────────────────────────────────────
def _enter_production(monkeypatch):
    """Stage the minimum settings needed for the contract to run its later
    checks (it short-circuits when environment != production AND when the
    DB URLs are equal). The DB URLs use separate roles so the function
    falls through to the CORS / provider checks we want to exercise."""
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(
        settings, "database_url", "postgresql+asyncpg://gaahex_app:y@h:5432/a"
    )
    monkeypatch.setattr(
        settings, "owner_database_url", "postgresql+asyncpg://gaahex:y@h:5432/a"
    )
    # Default everything to non-mock + a sane CORS so individual tests can
    # flip exactly ONE knob and prove that's what triggered the rejection.
    monkeypatch.setattr(settings, "cors_origins", "https://app.example.com")
    monkeypatch.setattr(settings, "payment_gateway_provider", "stripe")
    monkeypatch.setattr(settings, "email_gateway_provider", "sendgrid")
    monkeypatch.setattr(settings, "sms_gateway_provider", "twilio")
    monkeypatch.setattr(settings, "radius_backend_provider", "freeradius")


def test_prod_contract_refuses_mock_payment_provider(monkeypatch):
    _enter_production(monkeypatch)
    monkeypatch.setattr(settings, "payment_gateway_provider", "mock")
    with pytest.raises(RuntimeError, match="payment_gateway_provider"):
        _assert_production_deploy_contract()


def test_prod_contract_refuses_mock_email_provider(monkeypatch):
    _enter_production(monkeypatch)
    monkeypatch.setattr(settings, "email_gateway_provider", "mock")
    with pytest.raises(RuntimeError, match="email_gateway_provider"):
        _assert_production_deploy_contract()


def test_prod_contract_refuses_mock_sms_provider(monkeypatch):
    """Sibling of the email/payment tests — same shape, different knob."""
    _enter_production(monkeypatch)
    monkeypatch.setattr(settings, "sms_gateway_provider", "mock")
    with pytest.raises(RuntimeError, match="sms_gateway_provider"):
        _assert_production_deploy_contract()


def test_prod_contract_refuses_mock_radius_provider(monkeypatch):
    _enter_production(monkeypatch)
    monkeypatch.setattr(settings, "radius_backend_provider", "mock")
    with pytest.raises(RuntimeError, match="radius_backend_provider"):
        _assert_production_deploy_contract()


def test_prod_contract_refuses_cors_wildcard(monkeypatch):
    _enter_production(monkeypatch)
    monkeypatch.setattr(settings, "cors_origins", "*")
    with pytest.raises(RuntimeError, match="wildcard"):
        _assert_production_deploy_contract()


def test_prod_contract_refuses_cors_wildcard_in_list(monkeypatch):
    """The check must reject wildcard entries even when buried in a list."""
    _enter_production(monkeypatch)
    monkeypatch.setattr(
        settings, "cors_origins", "https://app.example.com, *",
    )
    with pytest.raises(RuntimeError, match="wildcard"):
        _assert_production_deploy_contract()


def test_prod_contract_passes_with_clean_config(monkeypatch):
    """The positive control: with real providers + an explicit origin list
    the contract is silent."""
    _enter_production(monkeypatch)
    _assert_production_deploy_contract()  # must not raise


# ──────────────────────────────────────────────────────────────────────────────
# H4 — Content-Security-Policy header
# ──────────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_csp_header_present(client):
    """CSP must be on every response, JSON or otherwise. We probe /health
    because it's public + always-on, so it doesn't depend on auth fixtures."""
    r = await client.get("/health")
    assert r.status_code == 200
    csp = r.headers.get("Content-Security-Policy")
    assert csp, "CSP header missing"
    # Key clauses from the brief — order-independent assertions so a future
    # refinement of the policy can reorder without breaking this test.
    for clause in (
        "default-src 'self'",
        "script-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
    ):
        assert clause in csp, f"CSP missing clause {clause!r}: {csp!r}"


# ──────────────────────────────────────────────────────────────────────────────
# H13 — X-Request-ID middleware
# ──────────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_request_id_propagated_in_response_header(client):
    """When the client sends X-Request-ID the middleware echoes it back; when
    the client omits it the middleware mints a UUID and returns it. Both
    branches must always populate the response header so log correlation
    works."""
    # Branch 1: client-supplied id is echoed verbatim.
    sent_id = "req-test-" + uuid.uuid4().hex[:12]
    r = await client.get("/health", headers={"X-Request-ID": sent_id})
    assert r.status_code == 200
    assert r.headers.get("X-Request-ID") == sent_id, (
        "X-Request-ID must echo the client-supplied id"
    )

    # Branch 2: no header → server mints one. Different request → different id.
    r2 = await client.get("/health")
    assert r2.status_code == 200
    minted = r2.headers.get("X-Request-ID")
    assert minted, "X-Request-ID must be set even when the client omits it"
    assert minted != sent_id, "minted id must not collide with a prior request id"
    # Loosely shaped like a UUID — 8-4-4-4-12 hex with dashes.
    assert len(minted) == 36 and minted.count("-") == 4


# ──────────────────────────────────────────────────────────────────────────────
# AC4 — idempotency middleware: TOCTOU race → exactly one handler invocation
# ──────────────────────────────────────────────────────────────────────────────
# We reuse the test-only POST route mounted by test_idempotency.py
# (`/api/_test/idem-echo`). To avoid coupling order, we re-mount it here on a
# DIFFERENT path so this file is self-contained.
_CONCURRENT_COUNTER = {"n": 0}


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _mount_concurrent_echo():
    from app.main import app

    @app.post("/api/_test/idem-concurrent-echo")
    async def _concurrent_echo(payload: dict):
        # Sleep just long enough that two concurrent calls overlap inside
        # the handler — without the TOCTOU fix BOTH would observe "no row"
        # and BOTH would increment.
        await asyncio.sleep(0.15)
        _CONCURRENT_COUNTER["n"] += 1
        return {"counter": _CONCURRENT_COUNTER["n"], "echo": payload}

    yield

    async with OwnerSessionLocal() as o:
        await o.execute(
            delete(IdempotencyRequest).where(
                IdempotencyRequest.path == "/api/_test/idem-concurrent-echo"
            )
        )
        await o.commit()


@pytest.mark.asyncio
async def test_idempotency_concurrent_requests_run_handler_once(client, admin):
    """Two simultaneous POSTs with the same Idempotency-Key must result in
    exactly one handler invocation. The loser either gets the winner's reply
    replayed (X-Idempotent-Replay: true) or, in the slowest case, a 409 — but
    NEVER a second counter increment. Before the AC4 fix both requests saw
    "no row" in the lookup and both ran the handler → duplicate side-effects."""
    _CONCURRENT_COUNTER["n"] = 0
    key = f"test-concurrent-{uuid.uuid4()}"
    body = {"foo": "race", "n": 1}

    async def _send():
        return await client.post(
            "/api/_test/idem-concurrent-echo",
            json=body,
            headers={**admin, "Idempotency-Key": key},
        )

    # Fire two requests as close in time as asyncio allows. With the old
    # SELECT-then-INSERT pattern + the 150 ms in-handler sleep above, both
    # would see "no row" and both would run the handler. The new
    # INSERT ... ON CONFLICT pattern lets exactly one win; the other polls
    # for the cached reply.
    r1, r2 = await asyncio.gather(_send(), _send())

    # Both should return 2xx — neither should error out.
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text

    # The handler ran EXACTLY once.
    assert _CONCURRENT_COUNTER["n"] == 1, (
        f"AC4 TOCTOU: handler ran {_CONCURRENT_COUNTER['n']} times under "
        f"concurrent identical Idempotency-Keys (must be exactly 1)"
    )

    # Both responses report the same counter value (1).
    assert r1.json()["counter"] == 1
    assert r2.json()["counter"] == 1

    # Exactly one of the two responses is a replay (the loser). The winner's
    # response does NOT carry the replay header.
    replay_flags = [
        r1.headers.get("X-Idempotent-Replay") == "true",
        r2.headers.get("X-Idempotent-Replay") == "true",
    ]
    assert sum(replay_flags) == 1, (
        f"expected exactly one X-Idempotent-Replay response among the two; "
        f"got replay_flags={replay_flags}"
    )

    # Sanity: a third call with the same key + body must still hit the cache
    # (the COMPLETED row now lives in the DB) and the counter must not advance.
    r3 = await client.post(
        "/api/_test/idem-concurrent-echo",
        json=body,
        headers={**admin, "Idempotency-Key": key},
    )
    assert r3.status_code == 200, r3.text
    assert r3.headers.get("X-Idempotent-Replay") == "true"
    assert r3.json()["counter"] == 1
    assert _CONCURRENT_COUNTER["n"] == 1
