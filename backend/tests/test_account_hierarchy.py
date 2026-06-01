"""Phase A.2 — Account parent-child hierarchy + consolidated balance + admin gate.

Materialized path: dot-joined UUIDs. Root: ``id::text``. Child: ``parent.path + "." + id``.

Consolidated balance walks the subtree via ``hierarchy_path`` LIKE ``root_path || '%'`` and falls
back to a recursive ``parent_account_id`` CTE if path is missing.

Admin gate: ``POST /api/accounts/{id}/recompute-balance`` is gated on ``account.edit`` — held by
super_admin via ``*``, but not by the seeded agent → 403.
"""

import uuid
from decimal import Decimal

from sqlalchemy import select

from app.db import SessionLocal
from app.models.billing import Invoice
from app.models.party import Account


# ---------- helpers ----------

async def _party(client, admin) -> str:
    return (await client.post("/api/parties", headers=admin,
                              json={"name": f"P {uuid.uuid4().hex[:6]}", "type": "organization"})).json()["id"]


async def _customer(client, admin) -> str:
    return (await client.post("/api/customers", headers=admin,
                              json={"name": f"C {uuid.uuid4().hex[:6]}"})).json()["id"]


async def _account(client, admin, *, parent_id: str | None = None) -> dict:
    pid = await _party(client, admin)
    payload: dict = {"holder_party_id": pid, "type": "business"}
    if parent_id is not None:
        payload["parent_account_id"] = parent_id
    return (await client.post("/api/accounts", headers=admin, json=payload)).json()


async def _set_balance_directly(account_id: str, balance: Decimal) -> None:
    """Skip the issue-invoice dance for the consolidated-aggregate test — directly poke balance.

    The materialized-path walk in consolidated_balance reads ``current_balance`` straight from
    each row, so this is sufficient for proving the aggregation math.
    """
    async with SessionLocal() as s:
        row = (await s.execute(select(Account).where(Account.id == uuid.UUID(account_id)))).scalar_one()
        row.current_balance = balance
        await s.commit()


# ===================== hierarchy_path: root + children + grandchild =====================

async def test_hierarchy_path_dot_joined_uuids(client, admin):
    root = await _account(client, admin)
    child1 = await _account(client, admin, parent_id=root["id"])
    child2 = await _account(client, admin, parent_id=root["id"])
    grand = await _account(client, admin, parent_id=child1["id"])

    # Root path = its own id.
    assert root["hierarchy_path"] == root["id"]
    # Children = parent.path + "." + child.id
    assert child1["hierarchy_path"] == f"{root['id']}.{child1['id']}"
    assert child2["hierarchy_path"] == f"{root['id']}.{child2['id']}"
    # Grandchild stacks both levels.
    assert grand["hierarchy_path"] == f"{root['id']}.{child1['id']}.{grand['id']}"


# ===================== consolidated balance: subtree aggregation =====================

async def test_consolidated_balance_aggregates_subtree(client, admin):
    root = await _account(client, admin)
    c1 = await _account(client, admin, parent_id=root["id"])
    c2 = await _account(client, admin, parent_id=root["id"])
    g = await _account(client, admin, parent_id=c1["id"])

    # Each account: balance = -100.
    for a in (root, c1, c2, g):
        await _set_balance_directly(a["id"], Decimal("-100"))

    body = (await client.get(f"/api/accounts/{root['id']}/balance/consolidated", headers=admin)).json()
    assert body["subtree_size"] == 4, body
    assert Decimal(body["root_balance"]) == Decimal("-100"), body
    assert Decimal(body["consolidated_balance"]) == Decimal("-400"), body

    # The midpoint c1 alone has c1 + grandchild g = 2 accounts, balance = -200.
    body_c1 = (await client.get(f"/api/accounts/{c1['id']}/balance/consolidated", headers=admin)).json()
    assert body_c1["subtree_size"] == 2, body_c1
    assert Decimal(body_c1["consolidated_balance"]) == Decimal("-200"), body_c1


# ===================== reparent: path updates on node + descendants =====================

async def test_reparent_updates_paths(client, admin):
    root = await _account(client, admin)
    c1 = await _account(client, admin, parent_id=root["id"])
    c2 = await _account(client, admin, parent_id=root["id"])
    g = await _account(client, admin, parent_id=c1["id"])

    # Move g from c1 directly under root.
    moved = await client.patch(f"/api/accounts/{g['id']}", headers=admin,
                               json={"parent_account_id": root["id"]})
    assert moved.status_code == 200, moved.text
    new_g = moved.json()
    assert new_g["parent_account_id"] == root["id"]
    assert new_g["hierarchy_path"] == f"{root['id']}.{g['id']}", new_g

    # c1 unchanged.
    c1_after = (await client.get(f"/api/accounts/{c1['id']}", headers=admin)).json()
    assert c1_after["hierarchy_path"] == f"{root['id']}.{c1['id']}"


async def test_reparent_with_descendants_updates_all(client, admin):
    """Move c1 (which has a grandchild g) to be under c2 — both c1 and g paths must update."""
    root = await _account(client, admin)
    c1 = await _account(client, admin, parent_id=root["id"])
    c2 = await _account(client, admin, parent_id=root["id"])
    g = await _account(client, admin, parent_id=c1["id"])

    moved = await client.patch(f"/api/accounts/{c1['id']}", headers=admin,
                               json={"parent_account_id": c2["id"]})
    assert moved.status_code == 200
    new_c1 = moved.json()
    assert new_c1["hierarchy_path"] == f"{root['id']}.{c2['id']}.{c1['id']}"

    g_after = (await client.get(f"/api/accounts/{g['id']}", headers=admin)).json()
    assert g_after["hierarchy_path"] == f"{root['id']}.{c2['id']}.{c1['id']}.{g['id']}"


# ===================== recompute-balance endpoint flips stale cache =====================

async def test_recompute_balance_endpoint_flips_stale_cache(client, admin):
    """Set a deliberately-wrong cached balance, then verify /recompute-balance restores the
    authoritative value (which, in absence of any invoice/payment, is 0)."""
    acc = await _account(client, admin)
    await _set_balance_directly(acc["id"], Decimal("-99999"))

    # Stale read confirms the broken cache.
    stale = (await client.get(f"/api/accounts/{acc['id']}/balance", headers=admin)).json()
    assert Decimal(stale["current_balance"]) == Decimal("-99999")

    # Authoritative recompute restores 0 (no invoices, no payments → 0 - 0 = 0).
    snap = (await client.post(f"/api/accounts/{acc['id']}/recompute-balance", headers=admin)).json()
    assert Decimal(snap["current_balance"]) == Decimal("0")
    assert snap["balance_updated_at"] is not None


# ===================== admin-gate: non-admin cannot trigger recompute =====================

async def test_recompute_balance_denied_to_non_admin(client, admin, agent):
    acc = await _account(client, admin)
    r = await client.post(f"/api/accounts/{acc['id']}/recompute-balance", headers=agent)
    assert r.status_code == 403, r.text
