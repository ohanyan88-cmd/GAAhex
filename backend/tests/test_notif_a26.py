"""Coverage for A26: per-user delivery preferences (mode/channels/muted) governing EXTERNAL
delivery, the digest hand-off flag, and inbox snooze/archive state.

THE NON-BREAKING INVARIANT under test: every notification still lands in the in-app inbox exactly
as today; preferences only gate EXTERNAL channel delivery (outbound rows) and mark digest items.

Delivery is driven through real events (admin creates+transitions a group-owned record → recipient
is the AGENT; the admin actor is excluded), so we exercise the actual emit path. An `email`-channel
NotificationDef both lands an inbox Notification AND fans out an OutboundMessage — A26 gates only the
latter. Unique def/entity keys per test (shared session DB accumulates).
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.models.notification import NotificationDef, Notification
from app.models.outbound import OutboundMessage


async def _user_ids():
    async with SessionLocal() as s:
        admin = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        agent = (await s.execute(select(User).where(User.email == "agent@demo.isp"))).scalar_one()
        return admin.tenant_id, admin.id, agent.id


async def _seed_def(tenant_id, key, *, channel, category):
    async with SessionLocal() as s:
        s.add(NotificationDef(tenant_id=tenant_id, key=key, label=key, channel=channel,
                              category=category, priority="info",
                              title_template="Hi {name}", body_template="Body {status}", enabled=True))
        await s.commit()


async def _mk_entity(client, admin, key, slug):
    body = {
        "key": key, "label": key.title(), "label_plural": f"{key}s", "route_slug": slug, "icon": "x",
        "fields": [{"key": "name", "label": "Name", "type": "text", "required": True},
                   {"key": "status", "label": "Status", "type": "status"}],
        "statuses": [{"key": "OPEN", "label": "Open", "is_initial": True}, {"key": "DONE", "label": "Done"}],
        "transitions": [{"from": "OPEN", "to": "DONE", "guard": None}],
    }
    assert (await client.post("/meta/entities", headers=admin, json=body)).status_code == 201


async def _drive(client, admin, slug):
    rid = (await client.post(f"/api/{slug}", headers=admin, json={"name": "Thing"})).json()["id"]
    assert (await client.post(f"/api/{slug}/{rid}/transition", headers=admin, json={"to": "DONE"})).status_code == 200
    return rid


async def _notes_for(record_id, user_id=None):
    """Notifications for a record. When `user_id` is given, filter to that user's
    notes — needed because the full suite may have other tenant users with
    primary_node_id at/under the record's owner_node, who also become
    recipients (the kernel correctly notifies all covering users). The
    A26 invariants are per-user; pass user_id to make assertions stable."""
    async with SessionLocal() as s:
        q = select(Notification).where(Notification.record_id == uuid.UUID(record_id))
        if user_id is not None:
            q = q.where(Notification.user_id == user_id)
        return (await s.execute(q)).scalars().all()


async def _outbound_for(def_key, user_id=None):
    """OutboundMessages for a def_key. When `user_id` is given, filter to that
    user's outbound rows — same rationale as `_notes_for`: full-suite users
    leak into the recipient set, so per-user filtering keeps the count-based
    assertions stable.

    For tests asserting `== []` (no external delivery), filtering by user_id
    is still correct — if the recipient under test was suppressed, the list
    for THEIR rows should be empty regardless of how many other recipients
    might exist."""
    async with SessionLocal() as s:
        q = select(OutboundMessage).where(OutboundMessage.def_key == def_key)
        if user_id is not None:
            q = q.where(OutboundMessage.user_id == user_id)
        return (await s.execute(q)).scalars().all()


# ===================== A26 prefs CRUD =====================

async def test_delivery_prefs_get_put_roundtrip_and_isolation(client, admin, agent):
    put = await client.put("/api/notification-prefs", headers=admin, json={"preferences": [
        {"category": "a26cat", "mode": "digest", "channels": ["inapp", "email"], "muted": False},
    ]})
    assert put.status_code == 200
    by_cat = {p["category"]: p for p in put.json()}
    assert by_cat["a26cat"]["mode"] == "digest"
    assert by_cat["a26cat"]["channels"] == ["inapp", "email"]
    assert by_cat["a26cat"]["muted"] is False

    got = {p["category"]: p for p in (await client.get("/api/notification-prefs", headers=admin)).json()}
    assert got["a26cat"]["mode"] == "digest"

    # upsert (no duplicate row) flips mode
    again = await client.put("/api/notification-prefs", headers=admin, json={"preferences": [
        {"category": "a26cat", "mode": "off", "channels": ["inapp"], "muted": True},
    ]})
    rows = [p for p in again.json() if p["category"] == "a26cat"]
    assert len(rows) == 1 and rows[0]["mode"] == "off" and rows[0]["muted"] is True

    # the agent never sees the admin's pref
    assert "a26cat" not in {p["category"] for p in (await client.get("/api/notification-prefs", headers=agent)).json()}


async def test_invalid_mode_rejected(client, admin):
    r = await client.put("/api/notification-prefs", headers=admin, json={"preferences": [
        {"category": "a26bad", "mode": "sometimes", "channels": ["inapp"]},
    ]})
    assert r.status_code == 422


# ===================== emit gating: inbox ALWAYS, external gated =====================

async def test_default_user_inbox_and_external_unchanged(client, admin):
    """No A26 pref → inbox row AND outbound row exactly as today (the non-breaking baseline)."""
    tenant, _, agent_id = await _user_ids()
    await _seed_def(tenant, "a26def.done", channel="email", category="a26_default")
    await _mk_entity(client, admin, "a26def", "a26-def")
    rid = await _drive(client, admin, "a26-def")

    notes = await _notes_for(rid, user_id=agent_id)
    assert len(notes) == 1 and notes[0].user_id == agent_id        # inbox unchanged
    assert notes[0].digest_pending is False
    assert len(await _outbound_for("a26def.done", user_id=agent_id)) == 1            # external unchanged


async def test_mode_off_inbox_only_no_external(client, admin, agent):
    tenant, _, agent_id = await _user_ids()
    await _seed_def(tenant, "a26off.done", channel="email", category="a26_off")
    # the recipient (agent) sets mode=off for the category
    assert (await client.put("/api/notification-prefs", headers=agent, json={"preferences": [
        {"category": "a26_off", "mode": "off", "channels": ["inapp"]},
    ]})).status_code == 200
    await _mk_entity(client, admin, "a26off", "a26-off")
    rid = await _drive(client, admin, "a26-off")

    notes = await _notes_for(rid, user_id=agent_id)
    assert len(notes) == 1 and notes[0].user_id == agent_id        # INBOX STILL LANDS
    assert notes[0].digest_pending is False
    assert await _outbound_for("a26off.done", user_id=agent_id) == []               # NO external delivery


async def test_mode_digest_inbox_plus_flag_no_external(client, admin, agent):
    tenant, _, agent_id = await _user_ids()
    await _seed_def(tenant, "a26dig.done", channel="email", category="a26_dig")
    assert (await client.put("/api/notification-prefs", headers=agent, json={"preferences": [
        {"category": "a26_dig", "mode": "digest", "channels": ["inapp", "email"]},
    ]})).status_code == 200
    await _mk_entity(client, admin, "a26dig", "a26-dig")
    rid = await _drive(client, admin, "a26-dig")

    notes = await _notes_for(rid, user_id=agent_id)
    assert len(notes) == 1 and notes[0].user_id == agent_id        # INBOX STILL LANDS
    assert notes[0].digest_pending is True                        # flagged for lane E
    assert await _outbound_for("a26dig.done", user_id=agent_id) == []               # NO external send now


async def test_realtime_channel_excluded_no_external(client, admin, agent):
    tenant, _, agent_id = await _user_ids()
    await _seed_def(tenant, "a26chx.done", channel="email", category="a26_chx")
    # realtime, but email is NOT in the allowed channels list → no external email
    assert (await client.put("/api/notification-prefs", headers=agent, json={"preferences": [
        {"category": "a26_chx", "mode": "realtime", "channels": ["inapp"]},
    ]})).status_code == 200
    await _mk_entity(client, admin, "a26chx", "a26-chx")
    rid = await _drive(client, admin, "a26-chx")

    assert len(await _notes_for(rid, user_id=agent_id)) == 1                        # INBOX STILL LANDS
    assert await _outbound_for("a26chx.done", user_id=agent_id) == []              # channel excluded → no external


async def test_realtime_channel_allowed_delivers_external(client, admin, agent):
    tenant, _, agent_id = await _user_ids()
    await _seed_def(tenant, "a26ok.done", channel="email", category="a26_ok")
    assert (await client.put("/api/notification-prefs", headers=agent, json={"preferences": [
        {"category": "a26_ok", "mode": "realtime", "channels": ["inapp", "email"]},
    ]})).status_code == 200
    await _mk_entity(client, admin, "a26ok", "a26-ok")
    rid = await _drive(client, admin, "a26-ok")

    assert len(await _notes_for(rid, user_id=agent_id)) == 1                        # inbox lands
    assert len(await _outbound_for("a26ok.done", user_id=agent_id)) == 1           # realtime + allowed → external sent


async def test_muted_suppresses_external_keeps_inbox(client, admin, agent):
    tenant, _, agent_id = await _user_ids()
    await _seed_def(tenant, "a26mut.done", channel="email", category="a26_mut")
    assert (await client.put("/api/notification-prefs", headers=agent, json={"preferences": [
        {"category": "a26_mut", "mode": "realtime", "channels": ["inapp", "email"], "muted": True},
    ]})).status_code == 200
    await _mk_entity(client, admin, "a26mut", "a26-mut")
    rid = await _drive(client, admin, "a26-mut")

    assert len(await _notes_for(rid, user_id=agent_id)) == 1                        # INBOX STILL LANDS
    assert await _outbound_for("a26mut.done", user_id=agent_id) == []             # muted → no external


async def test_def_key_beats_category_in_resolution(client, admin, agent):
    """Most specific wins: a def_key=off pref overrides a category=realtime pref."""
    tenant, _, agent_id = await _user_ids()
    await _seed_def(tenant, "a26spec.done", channel="email", category="a26_spec")
    assert (await client.put("/api/notification-prefs", headers=agent, json={"preferences": [
        {"category": "a26_spec", "mode": "realtime", "channels": ["inapp", "email"]},
        {"category": "a26spec.done", "mode": "off", "channels": ["inapp"]},
    ]})).status_code == 200
    await _mk_entity(client, admin, "a26spec", "a26-spec")
    rid = await _drive(client, admin, "a26-spec")

    assert len(await _notes_for(rid, user_id=agent_id)) == 1                        # inbox lands
    assert await _outbound_for("a26spec.done", user_id=agent_id) == []            # def_key=off wins → no external


# ===================== inbox state: snooze / archive =====================

async def _seed_inbox(tenant_id, user_id) -> str:
    async with SessionLocal() as s:
        n = Notification(tenant_id=tenant_id, def_key="a26.state", user_id=user_id,
                         category="a26state", priority="info", title="t", body="b")
        s.add(n)
        await s.commit()
        await s.refresh(n)
        return str(n.id)


async def test_snooze_set_and_clear(client, admin):
    tenant, admin_id, _ = await _user_ids()
    nid = await _seed_inbox(tenant, admin_id)

    snoozed = await client.post(f"/notifications/{nid}/snooze", headers=admin, json={"minutes": 60})
    assert snoozed.status_code == 200 and snoozed.json()["snoozed_until"] is not None

    cleared = await client.post(f"/notifications/{nid}/snooze", headers=admin, json={"snoozed_until": None})
    assert cleared.status_code == 200 and cleared.json()["snoozed_until"] is None


async def test_archive_hides_from_default_inbox(client, admin):
    tenant, admin_id, _ = await _user_ids()
    nid = await _seed_inbox(tenant, admin_id)

    arch = await client.post(f"/notifications/{nid}/archive", headers=admin)
    assert arch.status_code == 200 and arch.json()["archived"] is True

    default_ids = {n["id"] for n in (await client.get("/notifications", headers=admin)).json()}
    assert nid not in default_ids                                 # hidden from default view
    archived_ids = {n["id"] for n in (await client.get("/notifications?archived=true", headers=admin)).json()}
    assert nid in archived_ids                                    # but kept, visible in archive view

    un = await client.post(f"/notifications/{nid}/unarchive", headers=admin)
    assert un.status_code == 200 and un.json()["archived"] is False
    assert nid in {n["id"] for n in (await client.get("/notifications", headers=admin)).json()}


async def test_snooze_archive_isolation(client, admin, agent):
    tenant, _, agent_id = await _user_ids()
    nid = await _seed_inbox(tenant, agent_id)                     # belongs to the agent
    # admin cannot touch the agent's row
    assert (await client.post(f"/notifications/{nid}/archive", headers=admin)).status_code == 404
    assert (await client.post(f"/notifications/{nid}/snooze", headers=admin, json={"minutes": 5})).status_code == 404
