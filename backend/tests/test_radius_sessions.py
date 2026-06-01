"""NOC Phase C — RADIUS session tests.

Covers:
  * POST creates an active session; GET /sessions?status=active returns it
  * PATCH /stop marks session stopped; no longer in active results
  * GET by session_id filter (using username filter for unique lookup)
  * Duplicate session_id in same tenant → 409
  * GET /sessions?service_id= filters correctly
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.service import Service
from app.models.user import User


# ==========================================================================================
# helpers
# ==========================================================================================

async def _admin_tenant_id() -> uuid.UUID:
    async with SessionLocal() as s:
        u = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()
        return u.tenant_id


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _seed_service(tenant_id: uuid.UUID) -> uuid.UUID:
    async with SessionLocal() as s:
        svc = Service(
            tenant_id=tenant_id,
            name=f"RadSvc-{uuid.uuid4().hex[:6]}",
            status="active",
        )
        s.add(svc)
        await s.commit()
        return svc.id


# ==========================================================================================
# tests
# ==========================================================================================

@pytest.mark.asyncio
async def test_create_session_and_appears_in_active(client, admin):
    session_id_val = f"sess-{uuid.uuid4().hex[:12]}"
    username = f"user-{uuid.uuid4().hex[:8]}@isp.am"

    r = await client.post(
        "/api/radius/sessions", headers=admin,
        json={
            "username": username,
            "session_id": session_id_val,
            "nas_ip": "10.0.0.1",
            "framed_ip": "192.168.1.10",
            "acct_start": _now_iso(),
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["username"] == username
    assert body["session_id"] == session_id_val
    assert body["status"] == "active"
    assert body["acct_stop"] is None

    # Should appear in active list
    list_r = await client.get("/api/radius/sessions?status=active", headers=admin)
    assert list_r.status_code == 200, list_r.text
    sessions = list_r.json()
    ids = [s["session_id"] for s in sessions]
    assert session_id_val in ids


@pytest.mark.asyncio
async def test_stop_session_removes_from_active(client, admin):
    session_id_val = f"sess-stop-{uuid.uuid4().hex[:10]}"

    create_r = await client.post(
        "/api/radius/sessions", headers=admin,
        json={
            "username": f"stopuser-{uuid.uuid4().hex[:6]}@isp.am",
            "session_id": session_id_val,
            "acct_start": _now_iso(),
        },
    )
    assert create_r.status_code == 200, create_r.text
    session_pk = create_r.json()["id"]

    # Stop it
    stop_r = await client.patch(
        f"/api/radius/sessions/{session_pk}/stop", headers=admin,
        json={"acct_stop": _now_iso(), "octets_in": 100000, "octets_out": 5000000},
    )
    assert stop_r.status_code == 200, stop_r.text
    stopped = stop_r.json()
    assert stopped["status"] == "stopped"
    assert stopped["acct_stop"] is not None
    assert stopped["octets_in"] == 100000

    # Should NOT appear in active list anymore
    list_r = await client.get("/api/radius/sessions?status=active", headers=admin)
    assert list_r.status_code == 200, list_r.text
    active_ids = [s["session_id"] for s in list_r.json()]
    assert session_id_val not in active_ids


@pytest.mark.asyncio
async def test_get_by_username_filter(client, admin):
    unique_username = f"unique-{uuid.uuid4().hex}@isp.am"
    session_id_val = f"sess-uname-{uuid.uuid4().hex[:10]}"

    r = await client.post(
        "/api/radius/sessions", headers=admin,
        json={
            "username": unique_username,
            "session_id": session_id_val,
            "acct_start": _now_iso(),
        },
    )
    assert r.status_code == 200, r.text

    list_r = await client.get(
        f"/api/radius/sessions?username={unique_username}", headers=admin
    )
    assert list_r.status_code == 200, list_r.text
    items = list_r.json()
    assert len(items) == 1
    assert items[0]["username"] == unique_username
    assert items[0]["session_id"] == session_id_val


@pytest.mark.asyncio
async def test_duplicate_session_id_returns_409(client, admin):
    session_id_val = f"sess-dup-{uuid.uuid4().hex[:10]}"

    r1 = await client.post(
        "/api/radius/sessions", headers=admin,
        json={"username": "dupuser@isp.am", "session_id": session_id_val,
              "acct_start": _now_iso()},
    )
    assert r1.status_code == 200, r1.text

    r2 = await client.post(
        "/api/radius/sessions", headers=admin,
        json={"username": "dupuser2@isp.am", "session_id": session_id_val,
              "acct_start": _now_iso()},
    )
    assert r2.status_code == 409, r2.text


@pytest.mark.asyncio
async def test_filter_by_service_id(client, admin):
    tenant_id = await _admin_tenant_id()
    service_id = await _seed_service(tenant_id)
    session_id_val = f"sess-svc-{uuid.uuid4().hex[:10]}"

    r = await client.post(
        "/api/radius/sessions", headers=admin,
        json={
            "username": f"svcuser-{uuid.uuid4().hex[:6]}@isp.am",
            "session_id": session_id_val,
            "service_id": str(service_id),
            "acct_start": _now_iso(),
        },
    )
    assert r.status_code == 200, r.text

    list_r = await client.get(
        f"/api/radius/sessions?service_id={service_id}", headers=admin
    )
    assert list_r.status_code == 200, list_r.text
    items = list_r.json()
    assert len(items) >= 1
    assert all(item["service_id"] == str(service_id) for item in items)
