"""Customer Communication Standard (file 12) — gate + lifecycle coverage.

Tests cover: create-201 shape, list filtered by related_entity, get single, send
(DRAFT→QUEUED), mark-delivered (QUEUED→DELIVERED + sent_at), mark-read
(DELIVERED→READ), archive, invalid channel enum, invalid direction enum, invalid
participant_type rejected, send denied without communication.send, list denied
without communication.view, cross-tenant 404, audit emit verified, reference
number is COM-000001 format, second tenant RLS isolation.
"""
import uuid

import pytest_asyncio
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models import Communication, Tenant, OrgNode, RoleDef, Assignment, Event
from app.models.outbound import OutboundMessage
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password
from sqlalchemy_utils import Ltree


_PROFILES = {
    "comm_full":      ["communication.view", "communication.send"],
    "comm_view_only": ["communication.view"],
    "comm_no_perm":   [],
}
_USERS = {
    "alice": ("alice-comm@demo.isp", "comm_full"),
    "bob":   ("bob-comm@demo.isp",   "comm_view_only"),
    "nada":  ("nada-comm@demo.isp",  "comm_no_perm"),
}

_OTHER_TENANT_ID: uuid.UUID | None = None


async def _ensure(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(select(User).where(User.tenant_id == tenant_id, User.email == email))).scalar_one_or_none()
    if u is None:
        u = User(tenant_id=tenant_id, email=email, name=email.split("@")[0],
                 password_hash=hash_password("comm-123"), status="active")
        s.add(u); await s.flush()
    if not (await s.execute(select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant_id))).scalar_one_or_none():
        s.add(Assignment(tenant_id=tenant_id, user_id=u.id, role_id=role_id, node_id=node_id, region_scope="any"))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_comm_users():
    global _OTHER_TENANT_ID
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant).order_by(Tenant.created_at))).scalars().first()
        root = (await s.execute(select(OrgNode).where(OrgNode.tenant_id == tenant.id).order_by(OrgNode.path).limit(1))).scalar_one_or_none()
        if root is None:
            root = OrgNode(tenant_id=tenant.id, type="Group", name="Root", code="grpcomm", path=Ltree("grpcomm"))
            s.add(root); await s.flush()
        role_ids = {}
        for rk, perms in _PROFILES.items():
            row = (await s.execute(select(RoleDef).where(RoleDef.tenant_id == tenant.id, RoleDef.key == rk))).scalar_one_or_none()
            if row is None:
                row = RoleDef(tenant_id=tenant.id, key=rk, label=rk, permissions=perms, scope="tenant")
                s.add(row); await s.flush()
            else:
                row.permissions = perms
            role_ids[rk] = row.id
        for _, (email, rk) in _USERS.items():
            await _ensure(s, tenant_id=tenant.id, node_id=root.id, email=email, role_id=role_ids[rk])

        # Other tenant (RLS isolation).
        other = (await s.execute(select(Tenant).where(Tenant.name == "Comm-RLS-Other"))).scalar_one_or_none()
        if other is None:
            other = Tenant(name="Comm-RLS-Other", status="active"); s.add(other); await s.flush()
            s.add(OrgNode(tenant_id=other.id, type="Group", name="Root", code="commother", path=Ltree("commother"))); await s.flush()
        other_root = (await s.execute(select(OrgNode).where(OrgNode.tenant_id == other.id).limit(1))).scalar_one()
        other_role = (await s.execute(select(RoleDef).where(RoleDef.tenant_id == other.id, RoleDef.key == "comm_full"))).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(tenant_id=other.id, key="comm_full", label="full", permissions=_PROFILES["comm_full"], scope="tenant")
            s.add(other_role); await s.flush()
        await _ensure(s, tenant_id=other.id, node_id=other_root.id, email="alice-other-comm@demo.isp", role_id=other_role.id)
        _OTHER_TENANT_ID = other.id
        await s.commit()

    yield

    # Teardown — delete Communication rows + outbound_message rows + assignments + refresh_tokens
    # BEFORE User delete (file 04 — FK constraint requires child rows gone first).
    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()] + ["alice-other-comm@demo.isp"]
        users = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            await s.execute(Communication.__table__.delete().where(Communication.created_by.in_(uids)))
            await s.execute(OutboundMessage.__table__.delete().where(OutboundMessage.user_id.in_(uids)))
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        if _OTHER_TENANT_ID is not None:
            await s.execute(OrgNode.__table__.delete().where(OrgNode.tenant_id == _OTHER_TENANT_ID))
            # Cross-tenant teardown helper — purges every tenant_id-scoped row

            # before the final tenant DELETE (otherwise event/audit/record FKs block it).

            from tests.conftest import delete_tenant_cleanly

            await delete_tenant_cleanly(s, _OTHER_TENANT_ID)
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "comm-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client): return await _login(client, _USERS["alice"][0])
@pytest_asyncio.fixture
async def bob(client): return await _login(client, _USERS["bob"][0])
@pytest_asyncio.fixture
async def nada(client): return await _login(client, _USERS["nada"][0])
@pytest_asyncio.fixture
async def alice_other(client): return await _login(client, "alice-other-comm@demo.isp")


def _payload(**overrides) -> dict:
    p = {
        "channel": "EMAIL",
        "direction": "OUTBOUND",
        "relatedEntityType": "ticket",
        "relatedEntityId": str(uuid.uuid4()),
        "participantType": "CUSTOMER",
        "participantId": str(uuid.uuid4()),
        "subject": "Service update",
        "messageBody": "Hello — your service was upgraded.",
    }
    p.update(overrides)
    return p


# ── happy paths ───────────────────────────────────────────────────────────────

async def test_create_returns_201_and_shape(client, alice):
    r = await client.post("/api/communications", headers=alice, json=_payload())
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["status"] == "DRAFT"
    assert b["channel"] == "EMAIL"
    assert b["direction"] == "OUTBOUND"
    assert b["relatedEntityType"] == "ticket"
    assert b["participantType"] == "CUSTOMER"
    assert b["referenceNumber"].startswith("COM-")
    assert len(b["referenceNumber"]) == len("COM-000001")
    assert b["sentAt"] is None
    assert b["receivedAt"] is None


async def test_reference_number_is_com_format(client, alice):
    r = await client.post("/api/communications", headers=alice, json=_payload())
    assert r.status_code == 201
    ref = r.json()["referenceNumber"]
    assert ref.startswith("COM-")
    assert ref[4:].isdigit()
    assert len(ref[4:]) == 6  # COM-000001


async def test_list_filtered_by_related_entity(client, alice):
    pid = str(uuid.uuid4())
    await client.post("/api/communications", headers=alice, json=_payload(relatedEntityType="customer", relatedEntityId=pid))
    await client.post("/api/communications", headers=alice, json=_payload(relatedEntityType="customer", relatedEntityId=pid))
    # Unrelated row — should not appear in the filtered list.
    await client.post("/api/communications", headers=alice, json=_payload(relatedEntityType="customer", relatedEntityId=str(uuid.uuid4())))

    r = await client.get(
        f"/api/communications?related_entity_type=customer&related_entity_id={pid}",
        headers=alice,
    )
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 2
    for row in rows:
        assert row["relatedEntityType"] == "customer"
        assert row["relatedEntityId"] == pid


async def test_get_single(client, alice):
    c = (await client.post("/api/communications", headers=alice, json=_payload())).json()
    g = await client.get(f"/api/communications/{c['id']}", headers=alice)
    assert g.status_code == 200 and g.json()["id"] == c["id"]


async def test_send_moves_draft_to_queued(client, alice):
    c = (await client.post("/api/communications", headers=alice, json=_payload())).json()
    s = await client.post(f"/api/communications/{c['id']}/send", headers=alice)
    assert s.status_code == 200
    assert s.json()["status"] == "QUEUED"


async def test_mark_delivered_sets_sent_at(client, alice):
    c = (await client.post("/api/communications", headers=alice, json=_payload())).json()
    await client.post(f"/api/communications/{c['id']}/send", headers=alice)
    d = await client.post(f"/api/communications/{c['id']}/mark-delivered", headers=alice)
    assert d.status_code == 200
    b = d.json()
    assert b["status"] == "DELIVERED"
    assert b["sentAt"] is not None


async def test_mark_read_from_delivered(client, alice):
    c = (await client.post("/api/communications", headers=alice, json=_payload())).json()
    await client.post(f"/api/communications/{c['id']}/send", headers=alice)
    await client.post(f"/api/communications/{c['id']}/mark-delivered", headers=alice)
    r = await client.post(f"/api/communications/{c['id']}/mark-read", headers=alice)
    assert r.status_code == 200 and r.json()["status"] == "READ"


async def test_archive_any_state(client, alice):
    c = (await client.post("/api/communications", headers=alice, json=_payload())).json()
    r = await client.post(f"/api/communications/{c['id']}/archive", headers=alice)
    assert r.status_code == 200 and r.json()["status"] == "ARCHIVED"


# ── validation ────────────────────────────────────────────────────────────────

async def test_invalid_channel_rejected(client, alice):
    r = await client.post("/api/communications", headers=alice, json=_payload(channel="CARRIER_PIGEON"))
    assert r.status_code == 422


async def test_invalid_direction_rejected(client, alice):
    r = await client.post("/api/communications", headers=alice, json=_payload(direction="SIDEWAYS"))
    assert r.status_code == 422


async def test_invalid_participant_type_rejected(client, alice):
    r = await client.post("/api/communications", headers=alice, json=_payload(participantType="ALIEN"))
    assert r.status_code == 422


async def test_send_from_queued_rejected(client, alice):
    """Send only moves DRAFT → QUEUED. A second send call must 422."""
    c = (await client.post("/api/communications", headers=alice, json=_payload())).json()
    await client.post(f"/api/communications/{c['id']}/send", headers=alice)
    r = await client.post(f"/api/communications/{c['id']}/send", headers=alice)
    assert r.status_code == 422


# ── permission gates ──────────────────────────────────────────────────────────

async def test_create_denied_without_send(client, bob):
    """bob has only communication.view — create requires communication.send."""
    r = await client.post("/api/communications", headers=bob, json=_payload())
    assert r.status_code == 403


async def test_send_denied_without_send_perm(client, alice, bob):
    c = (await client.post("/api/communications", headers=alice, json=_payload())).json()
    r = await client.post(f"/api/communications/{c['id']}/send", headers=bob)
    assert r.status_code == 403


async def test_list_denied_without_view(client, nada):
    r = await client.get("/api/communications", headers=nada)
    assert r.status_code == 403


async def test_get_denied_without_view(client, alice, nada):
    c = (await client.post("/api/communications", headers=alice, json=_payload())).json()
    r = await client.get(f"/api/communications/{c['id']}", headers=nada)
    assert r.status_code == 403


# ── audit emit ────────────────────────────────────────────────────────────────

async def test_create_emits_communication_created_event(client, alice):
    c = (await client.post("/api/communications", headers=alice, json=_payload())).json()
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type == "COMMUNICATION_CREATED"))).scalars().all()
        assert any(e.data.get("communicationId") == c["id"] for e in evs)


# ── multi-tenant RLS ──────────────────────────────────────────────────────────

async def test_cross_tenant_get_404(client, alice, alice_other):
    c = (await client.post("/api/communications", headers=alice, json=_payload())).json()
    r = await client.get(f"/api/communications/{c['id']}", headers=alice_other)
    assert r.status_code == 404


async def test_second_tenant_rls_isolation(client, alice, alice_other):
    """A list call from the other tenant must not return the first tenant's rows."""
    pid = str(uuid.uuid4())
    await client.post("/api/communications", headers=alice, json=_payload(relatedEntityType="ticket", relatedEntityId=pid))
    r = await client.get("/api/communications", headers=alice_other)
    assert r.status_code == 200
    # The other tenant sees only its own rows (none created here for them).
    other_rows = r.json()
    assert all(row["tenantId"] != str(alice) for row in other_rows)
    # Affirmative isolation: filter by the same related id should return 0 rows for the other tenant.
    r2 = await client.get(
        f"/api/communications?related_entity_type=ticket&related_entity_id={pid}",
        headers=alice_other,
    )
    assert r2.status_code == 200 and r2.json() == []
