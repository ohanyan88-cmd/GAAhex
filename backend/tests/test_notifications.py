"""Coverage for the Notifications inbox API (read side only).

Per the task: do NOT touch the not-yet-merged emit hook — seed `Notification` rows directly via
SessionLocal, then exercise the inbox endpoints:
  GET /notifications [?unread] · GET /notifications/unread-count ·
  POST /notifications/{id}/read · POST /notifications/read-all

Every endpoint is strictly scoped to the caller's own rows; these tests prove that isolation holds.
The shared session DB accumulates, so all counts are deltas and assertions key on rows we created.
"""

from datetime import datetime, timezone, timedelta

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.models.notification import Notification


_BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)
_seq = 0


async def _user_ids():
    async with SessionLocal() as s:
        admin = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        agent = (await s.execute(select(User).where(User.email == "agent@demo.isp"))).scalar_one()
        # admin and agent share the demo tenant
        return admin.tenant_id, admin.id, agent.id


async def _add_note(tenant_id, user_id, title, *, read=False) -> str:
    """Insert one notification row directly, with an explicit increasing created_at for stable order."""
    global _seq
    _seq += 1
    async with SessionLocal() as s:
        n = Notification(
            tenant_id=tenant_id, def_key="test.seed", user_id=user_id,
            title=title, body="body",
            read_at=(datetime.now(timezone.utc) if read else None),
            created_at=_BASE + timedelta(minutes=_seq),
        )
        s.add(n)
        await s.commit()
        await s.refresh(n)
        return str(n.id)


async def _inbox_ids(client, headers, unread=False):
    url = "/notifications?unread=true" if unread else "/notifications"
    r = await client.get(url, headers=headers)
    assert r.status_code == 200, r.text
    return [n["id"] for n in r.json()]


async def _unread_count(client, headers) -> int:
    r = await client.get("/notifications/unread-count", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["count"]


# ---- inbox returns only the caller's rows, newest first ----

async def test_inbox_is_own_rows_newest_first(client, admin, agent):
    tenant, admin_id, agent_id = await _user_ids()
    a_old = await _add_note(tenant, admin_id, "admin old")
    a_new = await _add_note(tenant, admin_id, "admin new")
    g_one = await _add_note(tenant, agent_id, "agent one")

    admin_ids = await _inbox_ids(client, admin)
    # admin sees its own, not the agent's
    assert a_old in admin_ids and a_new in admin_ids
    assert g_one not in admin_ids
    # newest first: a_new appears before a_old
    assert admin_ids.index(a_new) < admin_ids.index(a_old)

    # and the agent sees only its own
    agent_ids = await _inbox_ids(client, agent)
    assert g_one in agent_ids
    assert a_old not in agent_ids and a_new not in agent_ids


# ---- ?unread filter ----

async def test_unread_filter(client, admin):
    tenant, admin_id, _ = await _user_ids()
    unread = await _add_note(tenant, admin_id, "fresh unread")
    already = await _add_note(tenant, admin_id, "already read", read=True)

    unread_ids = await _inbox_ids(client, admin, unread=True)
    assert unread in unread_ids
    assert already not in unread_ids
    # the read one is still in the full inbox
    assert already in await _inbox_ids(client, admin)


# ---- unread-count is accurate ----

async def test_unread_count_accurate(client, admin):
    tenant, admin_id, _ = await _user_ids()
    before = await _unread_count(client, admin)
    for i in range(3):
        await _add_note(tenant, admin_id, f"count me {i}")
    await _add_note(tenant, admin_id, "read, don't count", read=True)
    assert await _unread_count(client, admin) - before == 3


# ---- mark one read ----

async def test_mark_read_one(client, admin):
    tenant, admin_id, _ = await _user_ids()
    nid = await _add_note(tenant, admin_id, "to read")
    before = await _unread_count(client, admin)

    r = await client.post(f"/notifications/{nid}/read", headers=admin)
    assert r.status_code == 200 and r.json()["read_at"] is not None
    assert before - await _unread_count(client, admin) == 1
    # idempotent — marking again still succeeds and doesn't double-count
    r2 = await client.post(f"/notifications/{nid}/read", headers=admin)
    assert r2.status_code == 200


async def test_mark_read_404_for_others_and_random(client, admin):
    tenant, _, agent_id = await _user_ids()
    import uuid
    agent_note = await _add_note(tenant, agent_id, "agent private")
    # admin cannot mark the agent's notification — scoped to own rows → 404
    assert (await client.post(f"/notifications/{agent_note}/read", headers=admin)).status_code == 404
    # random id → 404
    assert (await client.post(f"/notifications/{uuid.uuid4()}/read", headers=admin)).status_code == 404


# ---- mark all read ----

async def test_read_all_zeros_own_and_leaves_others(client, admin, agent):
    tenant, admin_id, agent_id = await _user_ids()
    # give admin some unread and the agent some unread
    for i in range(2):
        await _add_note(tenant, admin_id, f"admin unread {i}")
    for i in range(2):
        await _add_note(tenant, agent_id, f"agent unread {i}")

    admin_unread_before = await _unread_count(client, admin)
    agent_unread_before = await _unread_count(client, agent)
    assert admin_unread_before >= 2 and agent_unread_before >= 2

    r = await client.post("/notifications/read-all", headers=admin)
    assert r.status_code == 200
    assert r.json()["updated"] == admin_unread_before     # exactly the caller's unread count

    assert await _unread_count(client, admin) == 0          # caller zeroed
    assert await _unread_count(client, agent) == agent_unread_before   # other user untouched
