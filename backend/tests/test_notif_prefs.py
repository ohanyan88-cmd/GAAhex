"""Coverage for notification depth: category/priority on the inbox + per-user preferences.

NotificationDef/Notification carry `category` + `priority`; the inbox filters on `?category=` /
`?priority=`. emit_notification is also preference-gated: a *disabled* NotificationPref matching the
def's category OR its def_key (on the def's channel) suppresses delivery; default-on otherwise.

Delivery is driven through real events: admin creates a record (owned by group `grp`) and transitions
it, so the resolved recipient is the AGENT (its team node is under `grp`); the admin actor is excluded.
Unique def keys / categories / entity keys per test (shared session DB accumulates).
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.models.notification import NotificationDef, Notification
from app.models.notification_pref import NotificationPref


async def _user_ids():
    async with SessionLocal() as s:
        admin = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        agent = (await s.execute(select(User).where(User.email == "agent@demo.isp"))).scalar_one()
        return admin.tenant_id, admin.id, agent.id


async def _add_note(tenant_id, user_id, *, category, priority, title="t", body="b") -> str:
    async with SessionLocal() as s:
        n = Notification(tenant_id=tenant_id, def_key="seed.test", user_id=user_id,
                         category=category, priority=priority, title=title, body=body)
        s.add(n)
        await s.commit()
        await s.refresh(n)
        return str(n.id)


async def _seed_def(tenant_id, key, *, category, channel="inapp", enabled=True):
    async with SessionLocal() as s:
        s.add(NotificationDef(tenant_id=tenant_id, key=key, label=key, channel=channel,
                              category=category, priority="info",
                              title_template="Hello {name}", body_template="Body {status}", enabled=enabled))
        await s.commit()


async def _mk_lifecycle_entity(client, admin, key, slug):
    body = {
        "key": key, "label": key.title(), "label_plural": f"{key} items", "route_slug": slug, "icon": "x",
        "fields": [{"key": "name", "label": "Name", "type": "text", "required": True},
                   {"key": "status", "label": "Status", "type": "status"}],
        "statuses": [{"key": "OPEN", "label": "Open", "is_initial": True}, {"key": "DONE", "label": "Done"}],
        "transitions": [{"from": "OPEN", "to": "DONE", "guard": None}],
    }
    assert (await client.post("/meta/entities", headers=admin, json=body)).status_code == 201


async def _drive(client, admin, slug) -> str:
    rid = (await client.post(f"/api/{slug}", headers=admin, json={"name": "Thing"})).json()["id"]
    assert (await client.post(f"/api/{slug}/{rid}/transition", headers=admin, json={"to": "DONE"})).status_code == 200
    return rid


async def _notes_for(record_id, user_id=None):
    """Notifications for a record. When `user_id` is given, filter to that user's
    notes — see test_notif_a26._notes_for for the rationale (full-suite users
    leak into the recipient set; per-user filtering keeps assertions stable)."""
    async with SessionLocal() as s:
        q = select(Notification).where(Notification.record_id == uuid.UUID(record_id))
        if user_id is not None:
            q = q.where(Notification.user_id == user_id)
        return (await s.execute(q)).scalars().all()


# ===================== inbox category / priority filters =====================

async def test_inbox_category_filter_and_isolation(client, admin, agent):
    tenant, admin_id, agent_id = await _user_ids()
    mine_a = await _add_note(tenant, admin_id, category="tcatA", priority="info")
    mine_b = await _add_note(tenant, admin_id, category="tcatB", priority="info")
    theirs = await _add_note(tenant, agent_id, category="tcatA", priority="info")

    got = {n["id"] for n in (await client.get("/notifications?category=tcatA", headers=admin)).json()}
    assert mine_a in got                    # admin's tcatA row
    assert mine_b not in got                 # different category excluded
    assert theirs not in got                 # another user's row never leaks


async def test_inbox_priority_filter(client, admin):
    tenant, admin_id, _ = await _user_ids()
    crit = await _add_note(tenant, admin_id, category="tprioC", priority="critical")
    info = await _add_note(tenant, admin_id, category="tprioC", priority="info")

    crit_results = {n["id"] for n in (await client.get("/notifications?priority=critical", headers=admin)).json()}
    assert crit in crit_results and info not in crit_results
    info_results = {n["id"] for n in (await client.get("/notifications?priority=info", headers=admin)).json()}
    assert info in info_results and crit not in info_results
    # the rows also carry category/priority in the payload
    one = next(n for n in (await client.get("/notifications?category=tprioC", headers=admin)).json() if n["id"] == crit)
    assert one["priority"] == "critical" and one["category"] == "tprioC"


# ===================== preferences GET/PUT =====================

async def test_get_and_put_preferences(client, admin, agent):
    # PUT a disable, read it back
    put = await client.put("/notifications/preferences", headers=admin,
                           json={"preferences": [{"category": "tpref_x", "channel": "inapp", "enabled": False}]})
    assert put.status_code == 200
    by_cat = {p["category"]: p for p in put.json()}
    assert by_cat["tpref_x"]["enabled"] is False and by_cat["tpref_x"]["channel"] == "inapp"

    got = {p["category"]: p for p in (await client.get("/notifications/preferences", headers=admin)).json()}
    assert got["tpref_x"]["enabled"] is False

    # upsert flips it back on (no duplicate row)
    again = await client.put("/notifications/preferences", headers=admin,
                             json={"preferences": [{"category": "tpref_x", "channel": "inapp", "enabled": True}]})
    cats = [p for p in again.json() if p["category"] == "tpref_x"]
    assert len(cats) == 1 and cats[0]["enabled"] is True

    # isolation: the agent never sees the admin's preference
    assert "tpref_x" not in {p["category"] for p in (await client.get("/notifications/preferences", headers=agent)).json()}


# ===================== preference gating of delivery =====================

async def test_default_on_delivers(client, admin):
    tenant, _, agent_id = await _user_ids()
    await _seed_def(tenant, "nprefon.done", category="tcat_on")
    await _mk_lifecycle_entity(client, admin, "nprefon", "npref-on")
    rid = await _drive(client, admin, "npref-on")
    notes = await _notes_for(rid, user_id=agent_id)
    assert len(notes) == 1 and notes[0].user_id == agent_id      # no pref ⇒ delivered to the agent
    assert notes[0].category == "tcat_on"


async def test_disabled_category_suppresses(client, admin, agent):
    tenant, _, agent_id = await _user_ids()
    await _seed_def(tenant, "nprefoff.done", category="tcat_off")
    # the recipient (agent) opts out of the whole category
    assert (await client.put("/notifications/preferences", headers=agent,
                             json={"preferences": [{"category": "tcat_off", "channel": "inapp", "enabled": False}]})).status_code == 200
    await _mk_lifecycle_entity(client, admin, "nprefoff", "npref-off")
    rid = await _drive(client, admin, "npref-off")
    assert await _notes_for(rid, user_id=agent_id) == []                            # suppressed by the disabled category pref


async def test_disabled_by_def_key_suppresses(client, admin, agent):
    tenant, _, agent_id = await _user_ids()
    await _seed_def(tenant, "nprefdk.done", category="tcat_dk")
    # opt out by the specific def_key (not the category) — _pref_opted_out matches either
    assert (await client.put("/notifications/preferences", headers=agent,
                             json={"preferences": [{"category": "nprefdk.done", "channel": "inapp", "enabled": False}]})).status_code == 200
    await _mk_lifecycle_entity(client, admin, "nprefdk", "npref-dk")
    rid = await _drive(client, admin, "npref-dk")
    assert await _notes_for(rid, user_id=agent_id) == []
