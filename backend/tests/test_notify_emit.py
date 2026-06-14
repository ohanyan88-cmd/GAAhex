"""Coverage for notify_hooks.fire wired into records.py (M9).

conftest does NOT run seed_notifications, so the test DB has zero NotificationDefs — each test
seeds exactly the def(s) it needs directly via SessionLocal (unique key per test; the def's
(tenant,key) is unique). We then drive a real record event and assert on the materialized
Notification rows.

Recipient model (notify_hooks.resolve_recipients): a record owned by the group node `grp` resolves
to BOTH demo users (admin owns it directly; the agent's team node is under `grp`), minus the actor.
So an admin-driven event on a grp-owned record notifies the AGENT, never the admin (actor).
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.models.notification import NotificationDef, Notification


# ---- helpers ----

async def _user_ids():
    async with SessionLocal() as s:
        admin = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        agent = (await s.execute(select(User).where(User.email == "agent@demo.isp"))).scalar_one()
        return admin.tenant_id, admin.id, agent.id


async def _seed_def(tenant_id, key, *, enabled=True, gxl_condition=None,
                    title="Notify {name}", body="Status {status}"):
    async with SessionLocal() as s:
        s.add(NotificationDef(
            tenant_id=tenant_id, key=key, label=key, title_template=title, body_template=body,
            enabled=enabled, gxl_condition=gxl_condition,
        ))
        await s.commit()


async def _notes_for(record_id, user_id=None):
    """Notifications for a record. When `user_id` is given, filter to that user's
    notes — see test_notif_a26._notes_for for the rationale (full-suite users
    leak into the recipient set; per-user filtering keeps assertions stable)."""
    async with SessionLocal() as s:
        q = select(Notification).where(Notification.record_id == uuid.UUID(record_id))
        if user_id is not None:
            q = q.where(Notification.user_id == user_id)
        return (await s.execute(q)).scalars().all()


async def _lifecycle_entity(client, admin, key, slug):
    """A minimal entity with a status field and an OPEN->DONE transition (so a transition fires)."""
    body = {
        "key": key, "label": key.title(), "label_plural": f"{key} items", "route_slug": slug, "icon": "x",
        "fields": [
            {"key": "name", "label": "Name", "type": "text", "required": True},
            {"key": "status", "label": "Status", "type": "status"},
        ],
        "statuses": [{"key": "OPEN", "label": "Open", "is_initial": True}, {"key": "DONE", "label": "Done"}],
        "transitions": [{"from": "OPEN", "to": "DONE", "guard": None}],
    }
    assert (await client.post("/meta/entities", headers=admin, json=body)).status_code == 201


async def _create_and_advance(client, admin, slug):
    rec = (await client.post(f"/api/{slug}", headers=admin, json={"name": "Thing"})).json()
    assert rec["status"] == "OPEN"
    r = await client.post(f"/api/{slug}/{rec['id']}/transition", headers=admin, json={"to": "DONE"})
    return rec["id"], r.status_code


# ---- recipient gets it; actor is excluded ----

async def test_recipient_gets_notification_actor_excluded(client, admin, agent):
    tenant, admin_id, agent_id = await _user_ids()
    await _seed_def(tenant, "lead.validated_lead", title="Lead {name} qualified", body="Now {status}")

    lead = (await client.post("/api/leads", headers=admin, json={"name": "Notify Target", "phone": "+37491"})).json()
    lid = lead["id"]
    assert (await client.post(f"/api/leads/{lid}/transition", headers=admin, json={"to": "VALIDATED_LEAD"})).status_code == 200
    assert (await client.post(f"/api/leads/{lid}/transition", headers=admin, json={"to": "ASSIGNED"})).status_code == 200

    notes = await _notes_for(lid, user_id=agent_id)
    # exactly one — to the agent (recipient), not the admin (actor); only lead.validated_lead has a def
    assert len(notes) == 1
    n = notes[0]
    assert n.user_id == agent_id and n.user_id != admin_id
    assert n.def_key == "lead.validated_lead"
    assert n.entity_key == "lead" and str(n.record_id) == lid
    assert n.title == "Lead Notify Target qualified" and n.body == "Now VALIDATED_LEAD"

    # and it's visible through the inbox API for the agent
    agent_inbox_ids = {x["id"] for x in (await client.get("/notifications", headers=agent)).json()}
    assert str(n.id) in agent_inbox_ids
    # admin (actor) has nothing for this record
    assert not any(x["record_id"] == lid for x in (await client.get("/notifications", headers=admin)).json())


# ---- gating: enabled flag ----

async def test_disabled_def_emits_nothing(client, admin):
    tenant, _, agent_id = await _user_ids()
    await _seed_def(tenant, "ntfa.done", enabled=False)
    await _lifecycle_entity(client, admin, "ntfa", "ntf-a")
    rid, code = await _create_and_advance(client, admin, "ntf-a")
    assert code == 200
    assert await _notes_for(rid, user_id=agent_id) == []


# ---- gating: GXL condition ----

async def test_gxl_condition_false_emits_nothing(client, admin):
    tenant, _, agent_id = await _user_ids()
    await _seed_def(tenant, "ntfb.done", gxl_condition="to == 'NEVER'")
    await _lifecycle_entity(client, admin, "ntfb", "ntf-b")
    rid, code = await _create_and_advance(client, admin, "ntf-b")
    assert code == 200
    assert await _notes_for(rid, user_id=agent_id) == []


async def test_gxl_condition_true_emits(client, admin):
    tenant, _, agent_id = await _user_ids()
    await _seed_def(tenant, "ntfc.done", gxl_condition="to == 'DONE'")
    await _lifecycle_entity(client, admin, "ntfc", "ntf-c")
    rid, code = await _create_and_advance(client, admin, "ntf-c")
    assert code == 200
    notes = await _notes_for(rid, user_id=agent_id)
    assert len(notes) == 1 and notes[0].user_id == agent_id


# ---- gating: no matching def ----

async def test_no_matching_def_emits_nothing(client, admin):
    # never seed a def for this entity — no def_key match means no notes emitted at all
    # (no need to filter by user_id; the assertion is "zero notes anywhere for this record")
    await _lifecycle_entity(client, admin, "ntfd", "ntf-d")
    rid, code = await _create_and_advance(client, admin, "ntf-d")
    assert code == 200
    assert await _notes_for(rid) == []


# ---- fail-soft: a bad template never breaks the transition ----

async def test_bad_template_is_failsoft(client, admin):
    tenant, _, agent_id = await _user_ids()
    # an unbalanced brace makes str.format_map raise; _render swallows it and returns the template verbatim
    await _seed_def(tenant, "ntfe.done", title="{", body="ok")
    await _lifecycle_entity(client, admin, "ntfe", "ntf-e")
    rid, code = await _create_and_advance(client, admin, "ntf-e")
    assert code == 200                       # transition still succeeds — notification problems never break it
    notes = await _notes_for(rid, user_id=agent_id)
    assert len(notes) == 1 and notes[0].title == "{"   # rendered verbatim, not crashed
