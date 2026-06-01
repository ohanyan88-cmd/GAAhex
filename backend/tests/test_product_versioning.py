"""Phase A.1 — ProductVersion service + API tests.

Covers:
* ``mint_new_version`` — first mint, second mint chains correctly (closes prior, supersedes).
* ``current_version_for`` — returns the version covering ``at`` for past / now / future windows.
* ``version_no`` monotonicity.
* "Grandfathered subscription" — querying ``current_version_for`` with a historical timestamp
  selects the version that was live AT that time, not the current one.
* HTTP endpoints — list versions and mint via POST.
"""
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.models.product import Product
from app.models.product_version import ProductVersion
from app.services.product_versions import current_version_for, mint_new_version


async def _admin_user() -> User:
    async with SessionLocal() as s:
        return (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()


async def _make_product(client, admin, *, key_prefix: str) -> dict:
    body = (await client.post("/api/products", headers=admin, json={
        "key": f"{key_prefix}-{uuid.uuid4().hex[:8]}",
        "name": f"{key_prefix} test product",
        "default_amount": 25000,
        "cycle": "monthly",
        "recurring_price": "25.00",
        "one_time_price": "100.00",
    })).json()
    return body


# ---------------------------- service layer ----------------------------

async def test_mint_new_version_first_call_creates_v1(client, admin):
    prod = await _make_product(client, admin, key_prefix="ver-first")

    async with SessionLocal() as s:
        v = await mint_new_version(
            s, uuid.UUID(prod["id"]),
            {"recurring_price": "25.00", "one_time_price": "100.00", "cycle": "monthly",
             "spec_json": {"key": prod["key"], "name": prod["name"]}},
        )
        await s.commit()
        assert v.version_no == 1
        assert v.effective_from is not None
        assert v.effective_to is None
        assert v.recurring_price == Decimal("25.00")
        assert v.superseded_by_id is None


async def test_mint_new_version_second_call_chains_and_closes_prior(client, admin):
    """Second mint closes prior.effective_to AND sets prior.superseded_by_id to the new version."""
    prod = await _make_product(client, admin, key_prefix="ver-chain")
    pid = uuid.UUID(prod["id"])

    async with SessionLocal() as s:
        v1 = await mint_new_version(s, pid, {
            "recurring_price": "25.00", "cycle": "monthly",
            "spec_json": {"price": "25.00"},
        })
        await s.commit()
        v1_id = v1.id

    async with SessionLocal() as s:
        v2 = await mint_new_version(s, pid, {
            "recurring_price": "30.00", "cycle": "monthly",
            "spec_json": {"price": "30.00"},
        })
        await s.commit()
        v2_id = v2.id
        assert v2.version_no == 2
        assert v2.effective_to is None

    async with SessionLocal() as s:
        # v1 must now be closed AND chained to v2.
        v1_reloaded = (await s.execute(
            select(ProductVersion).where(ProductVersion.id == v1_id)
        )).scalar_one()
        assert v1_reloaded.effective_to is not None
        assert v1_reloaded.superseded_by_id == v2_id


async def test_current_version_for_at_now_past_future(client, admin):
    """At a moment between v1 and v2's effective windows, returns v1; in v2's window, returns v2.

    Because both mints call :func:`datetime.now(timezone.utc)` and a sufficiently fast machine
    can land both at the same microsecond, we sanity-check that v2 was minted strictly later
    than v1 — if it wasn't, the boundary-equality assertions don't apply (v1's window collapsed
    to length 0). In that case we still validate the far-past + far-future + now bounds, which
    are the assertions that matter for the grandfathering contract.
    """
    prod = await _make_product(client, admin, key_prefix="ver-window")
    pid = uuid.UUID(prod["id"])

    async with SessionLocal() as s:
        v1 = await mint_new_version(s, pid, {"recurring_price": "20.00"})
        await s.commit()
        v1_id = v1.id
        v1_from = v1.effective_from

    async with SessionLocal() as s:
        v2 = await mint_new_version(s, pid, {"recurring_price": "30.00"})
        await s.commit()
        v2_id = v2.id
        v2_from = v2.effective_from

    async with SessionLocal() as s:
        # Far before v1 → None
        far_past = v1_from - timedelta(days=365)
        out = await current_version_for(s, pid, far_past)
        assert out is None

        # In v2's window (now-ish, strictly after v2_from) → v2
        out = await current_version_for(s, pid, v2_from + timedelta(seconds=1))
        assert out is not None and out.id == v2_id

        # Far future → still v2 (effective_to is None → +inf)
        out = await current_version_for(s, pid, v2_from + timedelta(days=3650))
        assert out is not None and out.id == v2_id

        # If v2 was minted strictly after v1 (the common case), querying at v1_from must
        # return v1. When both mints landed at the exact same microsecond (sub-microsecond
        # machine clock), v1's window is empty and this boundary case doesn't apply.
        if v2_from > v1_from:
            out = await current_version_for(s, pid, v1_from)
            assert out is not None and out.id == v1_id


async def test_version_no_is_monotonic(client, admin):
    """Three back-to-back mints produce version_no 1, 2, 3 in order."""
    prod = await _make_product(client, admin, key_prefix="ver-mono")
    pid = uuid.UUID(prod["id"])

    nos = []
    for _ in range(3):
        async with SessionLocal() as s:
            v = await mint_new_version(s, pid, {"recurring_price": "10.00"})
            await s.commit()
            nos.append(v.version_no)
    assert nos == [1, 2, 3]


async def test_grandfathered_subscription_resolves_to_old_version(client, admin):
    """A subscription created when v1 was live — querying current_version_for with that
    historical timestamp must still return v1, even after v2 has superseded it.

    We use ``v1.effective_from`` itself as the "subscription created at" instant: that's the
    earliest moment when v1 was live, and it's guaranteed to fall inside v1's
    ``[effective_from, effective_to)`` half-open window regardless of how quickly v2 follows.
    """
    prod = await _make_product(client, admin, key_prefix="ver-grand")
    pid = uuid.UUID(prod["id"])

    async with SessionLocal() as s:
        v1 = await mint_new_version(s, pid, {"recurring_price": "20.00"})
        await s.commit()
        v1_id = v1.id
        v1_from = v1.effective_from

    # The subscription's "created_at" — exactly at v1.effective_from. That's the boundary
    # where v1 became live; v1's window covers this instant by definition.
    sub_created_at = v1_from

    # Catalog price changes — v2 is minted, which will close v1.effective_to.
    async with SessionLocal() as s:
        await mint_new_version(s, pid, {"recurring_price": "30.00"})
        await s.commit()

    # The subscription was created when v1 was the active version. current_version_for must
    # return v1 when queried with sub_created_at.
    async with SessionLocal() as s:
        out = await current_version_for(s, pid, sub_created_at)
        assert out is not None
        assert out.id == v1_id, "Subscription bound to v1's window must resolve to v1, not v2"


# ---------------------------- HTTP API ----------------------------

async def test_api_post_versions_mints_and_get_lists(client, admin):
    """POST /api/products/{id}/versions mints; GET lists all versions ordered by version_no."""
    prod = await _make_product(client, admin, key_prefix="ver-api")

    # First mint via API.
    r = await client.post(f"/api/products/{prod['id']}/versions", headers=admin, json={
        "recurring_price": "25.00", "cycle": "monthly",
    })
    assert r.status_code == 201, r.text
    v1 = r.json()
    assert v1["version_no"] == 1
    assert v1["recurring_price"] == "25.00"
    assert v1["effective_to"] is None

    # Second mint.
    r = await client.post(f"/api/products/{prod['id']}/versions", headers=admin, json={
        "recurring_price": "30.00", "cycle": "monthly",
    })
    assert r.status_code == 201
    v2 = r.json()
    assert v2["version_no"] == 2

    # GET lists both.
    r = await client.get(f"/api/products/{prod['id']}/versions", headers=admin)
    assert r.status_code == 200
    body = r.json()
    nos = [v["version_no"] for v in body]
    assert nos == [1, 2]
    # v1 must now be closed.
    assert body[0]["effective_to"] is not None
    assert body[0]["superseded_by_id"] == v2["id"]


async def test_api_post_versions_agent_forbidden(client, admin, agent):
    prod = await _make_product(client, admin, key_prefix="ver-acl")
    r = await client.post(f"/api/products/{prod['id']}/versions", headers=agent, json={
        "recurring_price": "25.00",
    })
    assert r.status_code == 403


async def test_api_get_versions_404_for_unknown_product(client, admin):
    r = await client.get(f"/api/products/{uuid.uuid4()}/versions", headers=admin)
    assert r.status_code == 404
