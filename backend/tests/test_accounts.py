"""Coverage for the Party / Account CRUD (accounts.py, doc 17a Stage 1 — additive, dormant).

Small tenant + owner-scoped CRUD beside the flat CRM customer. Permissions party.* / account.* —
admin holds `*`. Account defaults: currency AMD, billing_cycle monthly. Unique names per test (the
shared session DB accumulates).
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User, Tenant
from app.models.party import Party, Account


async def _party(client, admin, *, ptype="organization"):
    name = f"Party {uuid.uuid4().hex[:8]}"
    return await client.post("/api/parties", headers=admin, json={"name": name, "type": ptype})


# ===================== create party + account (defaults) =====================

async def test_create_party_then_account_with_defaults(client, admin):
    p = await _party(client, admin)
    assert p.status_code == 201 and p.json()["type"] == "organization"
    pid = p.json()["id"]

    a = await client.post("/api/accounts", headers=admin, json={"holder_party_id": pid, "type": "business"})
    assert a.status_code == 201
    acc = a.json()
    assert acc["holder_party_id"] == pid and acc["type"] == "business"
    assert acc["currency"] == "AMD" and acc["billing_cycle"] == "monthly"   # defaults


# ===================== list / filter / get / 404 =====================

async def test_list_filter_get_and_404(client, admin):
    pid1 = (await _party(client, admin)).json()["id"]
    pid2 = (await _party(client, admin)).json()["id"]
    a1 = (await client.post("/api/accounts", headers=admin, json={"holder_party_id": pid1})).json()
    a2 = (await client.post("/api/accounts", headers=admin, json={"holder_party_id": pid2})).json()

    party_ids = {p["id"] for p in (await client.get("/api/parties", headers=admin)).json()}
    assert {pid1, pid2} <= party_ids

    acct_ids = {a["id"] for a in (await client.get("/api/accounts", headers=admin)).json()}
    assert {a1["id"], a2["id"]} <= acct_ids

    # ?party= filters to that holder only
    filtered = (await client.get(f"/api/accounts?party={pid1}", headers=admin)).json()
    assert [a["id"] for a in filtered] == [a1["id"]]

    # get one by id
    assert (await client.get(f"/api/accounts/{a1['id']}", headers=admin)).json()["id"] == a1["id"]

    # bogus ids → 404
    assert (await client.get(f"/api/accounts/{uuid.uuid4()}", headers=admin)).status_code == 404
    assert (await client.get(f"/api/parties/{uuid.uuid4()}", headers=admin)).status_code == 404


# ===================== validation =====================

async def test_validation_422(client, admin):
    # missing name on party → 422
    assert (await client.post("/api/parties", headers=admin, json={"type": "organization"})).status_code == 422
    # bad party type → 422
    assert (await client.post("/api/parties", headers=admin, json={"name": "X", "type": "alien"})).status_code == 422
    # account with unknown holder_party_id → 422
    assert (await client.post("/api/accounts", headers=admin,
                              json={"holder_party_id": str(uuid.uuid4())})).status_code == 422
    # account missing holder_party_id → 422; bad account type → 422
    assert (await client.post("/api/accounts", headers=admin, json={})).status_code == 422
    pid = (await _party(client, admin)).json()["id"]
    assert (await client.post("/api/accounts", headers=admin,
                              json={"holder_party_id": pid, "type": "galactic"})).status_code == 422


# ===================== tenant isolation =====================

async def test_tenant_isolation(client, admin):
    # a party + account living under another tenant never list / resolve for this tenant
    async with SessionLocal() as s:
        other = Tenant(name=f"Other ISP {uuid.uuid4().hex[:6]}")
        s.add(other)
        await s.flush()
        fp = Party(tenant_id=other.id, type="organization", name="Foreign Co")
        s.add(fp)
        await s.flush()
        fa = Account(tenant_id=other.id, holder_party_id=fp.id, type="business")
        s.add(fa)
        await s.commit()
        foreign_pid, foreign_aid = str(fp.id), str(fa.id)

    party_ids = {p["id"] for p in (await client.get("/api/parties", headers=admin)).json()}
    assert foreign_pid not in party_ids
    assert (await client.get(f"/api/accounts?party={foreign_pid}", headers=admin)).json() == []
    assert (await client.get(f"/api/parties/{foreign_pid}", headers=admin)).status_code == 404
    assert (await client.get(f"/api/accounts/{foreign_aid}", headers=admin)).status_code == 404
