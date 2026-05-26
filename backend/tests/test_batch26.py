"""Batch 26 — notification preferences (A26) + digests (E26).

WHAT'S LANDED
-------------
A26 model columns (NotificationPref.mode/channels/muted; Notification.digest_pending/archived/
snoozed_until) and the emit-path enforcement are merged.  The dedicated PUT /api/notification-prefs
endpoint and the GET /api/notification-prefs endpoint are NOT yet in the router (A26 lane incomplete);
we write A26 preference rows directly via SessionLocal to exercise the enforce-at-emit logic.

E26 (run-digests endpoint + scheduler integration) is NOT merged; those tests skip gracefully.

COVERAGE
--------
1. test_prefs_crud_round_trip          — PUT then GET /notifications/preferences (existing endpoint):
                                         category, channel, enabled round-trip; upsert idempotent;
                                         user isolation holds.
2. test_inbox_default_user_non_breaking — no pref row → emit_notification still creates the inbox row
                                         (KEY regression guard). Uses the real notify_hooks.fire path
                                         (entity + record transition via the HTTP API).
3. test_mode_off_inbox_only            — A26 pref with mode="off": inbox row still created (in-app
                                         always-on invariant); no external OutboundMessage for the
                                         external channel the def targets.
4. test_mode_digest_inbox_pending      — A26 pref with mode="digest": inbox row created with
                                         digest_pending=True; no external OutboundMessage now.
5. test_run_digests_idempotent         — E26: skipped (run-digests endpoint not yet merged).
6. test_snooze_archive_state           — A26: POST /notifications/{id}/snooze sets snoozed_until;
                                         POST /notifications/{id}/archive sets archived=True;
                                         POST /notifications/{id}/unarchive restores it.
"""

import uuid
from datetime import datetime, timezone, timedelta

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.models.notification import Notification, NotificationDef
from app.models.notification_pref import NotificationPref
from app.models.outbound import OutboundMessage


# ---------------------------------------------------------------------------
# A26 detection — mode on NotificationPref; archived/digest_pending on Notification
# ---------------------------------------------------------------------------

def _has_col(model, col_name: str) -> bool:
    try:
        return col_name in model.__table__.columns
    except Exception:
        return False


_A26_MODELS = (
    _has_col(NotificationPref, "mode") and
    _has_col(Notification, "digest_pending") and
    _has_col(Notification, "archived") and
    _has_col(Notification, "snoozed_until")
)
_A26_REASON = (
    "A26 not merged: NotificationPref.mode / Notification.digest_pending / "
    "Notification.archived / Notification.snoozed_until absent"
)

# Check that snooze/archive endpoints are registered
_A26_ENDPOINTS = False
_A26_EP_REASON = "A26 snooze/archive endpoints not registered"
try:
    from app.main import app as _app
    _routes = {r.path for r in _app.routes}
    if any("snooze" in p for p in _routes) and any("archive" in p for p in _routes):
        _A26_ENDPOINTS = True
    else:
        _A26_EP_REASON = "snooze/archive paths not found in registered routes"
except Exception as _exc:
    _A26_EP_REASON = f"route inspection error: {_exc}"

_A26_PRESENT = _A26_MODELS and _A26_ENDPOINTS

# ---------------------------------------------------------------------------
# E26 detection — /api/notifications/run-digests endpoint
# ---------------------------------------------------------------------------

_E26_PRESENT = False
_E26_REASON = "E26 not merged: app.routers.digests module absent"

try:
    import importlib
    _digests = importlib.import_module("app.routers.digests")
    # Confirm the endpoint is actually registered
    if any("run-digests" in p for p in _routes):
        _E26_PRESENT = True
    else:
        _E26_REASON = "E26: digests module present but run-digests route not registered"
except ModuleNotFoundError:
    pass
except Exception as _exc:
    _E26_REASON = f"app.routers.digests import error: {_exc}"


# PREF_CHANNEL_SENTINEL — the value A26 uses for mode-based pref rows so they coexist with the
# legacy per-channel opt-out rows under the existing unique constraint (tenant,user,category,channel).
PREF_SENTINEL = "*"


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

async def _user_ids():
    async with SessionLocal() as s:
        admin = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()
        agent = (await s.execute(
            select(User).where(User.email == "agent@demo.isp")
        )).scalar_one()
        return admin.tenant_id, admin.id, agent.id


async def _seed_def(tenant_id, key, *, channel="inapp", category="system", enabled=True):
    """Seed a NotificationDef (idempotent by key)."""
    async with SessionLocal() as s:
        existing = (await s.execute(
            select(NotificationDef).where(
                NotificationDef.tenant_id == tenant_id,
                NotificationDef.key == key,
            )
        )).scalar_one_or_none()
        if existing:
            return
        s.add(NotificationDef(
            tenant_id=tenant_id, key=key, label=key,
            channel=channel, category=category, priority="info",
            title_template="Hello {name}", body_template="Body {status}",
            enabled=enabled,
        ))
        await s.commit()


async def _mk_lifecycle_entity(client, admin_hdr, key, slug):
    """Create a minimal entity with OPEN→DONE status transition via the Studio API."""
    body = {
        "key": key,
        "label": key.title(),
        "label_plural": f"{key} items",
        "route_slug": slug,
        "icon": "x",
        "fields": [
            {"key": "name",   "label": "Name",   "type": "text", "required": True},
            {"key": "status", "label": "Status", "type": "status"},
        ],
        "statuses": [
            {"key": "OPEN", "label": "Open", "is_initial": True},
            {"key": "DONE", "label": "Done"},
        ],
        "transitions": [{"from": "OPEN", "to": "DONE", "guard": None}],
    }
    r = await client.post("/meta/entities", headers=admin_hdr, json=body)
    assert r.status_code == 201, f"Entity create failed: {r.text}"


async def _drive(client, admin_hdr, slug) -> str:
    """Create a record and transition it to DONE; return the record id."""
    rid = (await client.post(
        f"/api/{slug}", headers=admin_hdr, json={"name": "Thing"}
    )).json()["id"]
    r = await client.post(
        f"/api/{slug}/{rid}/transition", headers=admin_hdr, json={"to": "DONE"}
    )
    assert r.status_code == 200, f"Transition failed: {r.text}"
    return rid


async def _notifications_for_record(record_id: str):
    async with SessionLocal() as s:
        return (await s.execute(
            select(Notification).where(Notification.record_id == uuid.UUID(record_id))
        )).scalars().all()


async def _outbound_for_def(def_key: str):
    async with SessionLocal() as s:
        return (await s.execute(
            select(OutboundMessage).where(OutboundMessage.def_key == def_key)
        )).scalars().all()


async def _set_a26_pref(tenant_id, user_id, *, category: str, mode: str,
                         channels: list | None = None, muted: bool = False):
    """Directly insert/upsert an A26 mode-based preference row (channel=sentinel).
    Requires A26 model columns (mode, channels, muted) to exist."""
    ch_list = channels if channels is not None else ["inapp"]
    async with SessionLocal() as s:
        existing = (await s.execute(
            select(NotificationPref).where(
                NotificationPref.tenant_id == tenant_id,
                NotificationPref.user_id == user_id,
                NotificationPref.category == category,
                NotificationPref.channel == PREF_SENTINEL,
            )
        )).scalar_one_or_none()
        if existing:
            existing.mode = mode
            existing.channels = ch_list
            existing.muted = muted
        else:
            s.add(NotificationPref(
                tenant_id=tenant_id, user_id=user_id,
                category=category, channel=PREF_SENTINEL,
                enabled=True,   # legacy field: True (mode governs delivery now)
                mode=mode,
                channels=ch_list,
                muted=muted,
            ))
        await s.commit()


# ---------------------------------------------------------------------------
# 1. Prefs CRUD round-trip (existing /notifications/preferences endpoint)
# ---------------------------------------------------------------------------

async def test_prefs_crud_round_trip(client, admin, agent):
    """PUT then GET /notifications/preferences (existing endpoint): category + channel + enabled
    round-trip correctly.  Upsert is idempotent (no duplicate rows). User isolation holds."""
    category = f"b26cat_{uuid.uuid4().hex[:8]}"

    # PUT: disable a category on the inapp channel
    put_r = await client.put(
        "/notifications/preferences", headers=admin,
        json={"preferences": [{"category": category, "channel": "inapp", "enabled": False}]},
    )
    assert put_r.status_code == 200, f"PUT prefs failed: {put_r.text}"
    by_cat = {p["category"]: p for p in put_r.json()}
    assert category in by_cat, "newly set category must appear in PUT response"
    assert by_cat[category]["enabled"] is False
    assert by_cat[category]["channel"] == "inapp"

    # GET: persisted correctly
    get_r = await client.get("/notifications/preferences", headers=admin)
    assert get_r.status_code == 200, get_r.text
    by_cat_get = {p["category"]: p for p in get_r.json()}
    assert category in by_cat_get, "category must be readable via GET after PUT"
    assert by_cat_get[category]["enabled"] is False

    # Upsert: flip back to enabled — exactly ONE row, no duplicate
    flip_r = await client.put(
        "/notifications/preferences", headers=admin,
        json={"preferences": [{"category": category, "channel": "inapp", "enabled": True}]},
    )
    assert flip_r.status_code == 200, flip_r.text
    matching = [
        p for p in flip_r.json()
        if p["category"] == category and p["channel"] == "inapp"
    ]
    assert len(matching) == 1, "upsert must not create duplicate rows"
    assert matching[0]["enabled"] is True

    # Isolation: agent must NOT see admin's preference
    agent_cats = {
        p["category"]
        for p in (await client.get("/notifications/preferences", headers=agent)).json()
    }
    assert category not in agent_cats, "agent must not see admin's preference (user isolation)"


# ---------------------------------------------------------------------------
# 2. Non-breaking inbox regression guard (default user — no A26 pref row)
# ---------------------------------------------------------------------------

async def test_inbox_default_user_non_breaking(client, admin, agent):
    """With NO preference row for a category, emitting a notification must still create the inbox
    row exactly as before.  KEY regression guard — must always pass, A26 merged or not.

    Drives a real record transition via the HTTP API so the full notify_hooks.fire path fires.
    The def_key matches the notify_hooks.derive_def_key convention: "{entity_key}.done"."""
    tenant, admin_id, agent_id = await _user_ids()
    # Use a unique entity_key per session to avoid conflicts with other tests
    ek = f"b26nb{uuid.uuid4().hex[:6]}"
    slug = f"b26-nb-{uuid.uuid4().hex[:5]}"
    category = f"b26nb_cat_{uuid.uuid4().hex[:5]}"

    # Seed the def with key="{entity_key}.done" (the derived key for a transition to DONE)
    def_key = f"{ek}.done"
    await _seed_def(tenant, def_key, channel="inapp", category=category)
    await _mk_lifecycle_entity(client, admin, ek, slug)
    rid = await _drive(client, admin, slug)

    # The notification must be created for the agent (resolved recipient, not the admin actor)
    notes = await _notifications_for_record(rid)
    assert len(notes) == 1, (
        f"Expected exactly 1 inbox notification for record {rid!r}, got {len(notes)}.\n"
        "This is the KEY regression guard: default user with no pref must still receive notifications."
    )
    note = notes[0]
    assert note.user_id == agent_id, (
        f"Notification must be for the agent (resolved recipient), not the admin actor. "
        f"Got user_id={note.user_id!r}, agent_id={agent_id!r}"
    )
    assert note.category == category
    assert note.def_key == def_key

    # Verify visibility via the inbox API
    inbox_ids = {n["id"] for n in (await client.get("/notifications", headers=agent)).json()}
    assert str(note.id) in inbox_ids, "notification must appear in the agent's inbox via GET /notifications"

    # Admin (actor) must NOT receive a notification for their own action
    admin_rec = [
        n for n in (await client.get("/notifications", headers=admin)).json()
        if n.get("record_id") == rid
    ]
    assert admin_rec == [], "actor (admin) must not be notified of their own action (actor exclusion)"


# ---------------------------------------------------------------------------
# 3. Mode=off → inbox row created, NO external OutboundMessage (A26)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _A26_PRESENT, reason=_A26_REASON)
async def test_mode_off_inbox_only(client, admin, agent):
    """A26: mode=off for a category → inbox row always created (in-app invariant is unconditional);
    NO external OutboundMessage on the channel the def targets.

    The A26 pref is inserted directly via SessionLocal (dedicated PUT endpoint not yet wired)."""
    tenant, admin_id, agent_id = await _user_ids()
    ek = f"b26off{uuid.uuid4().hex[:6]}"
    slug = f"b26-off-{uuid.uuid4().hex[:5]}"
    category = f"b26off_cat_{uuid.uuid4().hex[:5]}"
    def_key = f"{ek}.done"

    # Def targets the email channel — so without a pref there would be an OutboundMessage
    await _seed_def(tenant, def_key, channel="email", category=category)

    # Set agent's A26 pref: mode=off for this category (inbox only, no external)
    await _set_a26_pref(tenant, agent_id, category=category, mode="off", channels=["email"])

    await _mk_lifecycle_entity(client, admin, ek, slug)
    rid = await _drive(client, admin, slug)

    # Inbox row must still be created (in-app always-on invariant)
    notes = await _notifications_for_record(rid)
    assert len(notes) == 1, (
        f"mode=off must NOT suppress the inbox row; got {len(notes)} rows for record {rid!r}"
    )
    assert notes[0].user_id == agent_id

    # digest_pending must be False (off means inbox-only, not digest-queued)
    assert notes[0].digest_pending is False or notes[0].digest_pending is None, (
        "mode=off must not set digest_pending=True"
    )

    # No external OutboundMessage
    outbound = await _outbound_for_def(def_key)
    assert len(outbound) == 0, (
        f"mode=off must suppress all external delivery; got {len(outbound)} OutboundMessage row(s)"
    )


# ---------------------------------------------------------------------------
# 4. Mode=digest → inbox row + digest_pending=True, no external send (A26/E26)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _A26_PRESENT, reason=_A26_REASON)
async def test_mode_digest_inbox_pending(client, admin, agent):
    """A26/E26: mode=digest for a category → inbox row created with digest_pending=True; NO external
    OutboundMessage sent immediately (E26 will batch these later).

    The A26 pref is inserted directly via SessionLocal."""
    tenant, admin_id, agent_id = await _user_ids()
    ek = f"b26dig{uuid.uuid4().hex[:6]}"
    slug = f"b26-dig-{uuid.uuid4().hex[:5]}"
    category = f"b26dig_cat_{uuid.uuid4().hex[:5]}"
    def_key = f"{ek}.done"

    # Def targets email so there would normally be an OutboundMessage for realtime delivery
    await _seed_def(tenant, def_key, channel="email", category=category)

    # Set agent's A26 pref: mode=digest for this category
    await _set_a26_pref(tenant, agent_id, category=category, mode="digest", channels=["email"])

    await _mk_lifecycle_entity(client, admin, ek, slug)
    rid = await _drive(client, admin, slug)

    # Inbox row must be created (in-app invariant holds regardless of mode)
    notes = await _notifications_for_record(rid)
    assert len(notes) == 1, (
        f"mode=digest must still create an inbox row; got {len(notes)} for record {rid!r}"
    )
    note = notes[0]
    assert note.user_id == agent_id

    # digest_pending must be True (A26 flags this for E26 to pick up later)
    assert note.digest_pending is True, (
        "mode=digest must set digest_pending=True on the Notification row so E26 can batch it"
    )

    # No immediate external OutboundMessage
    outbound = await _outbound_for_def(def_key)
    assert len(outbound) == 0, (
        f"mode=digest must NOT send an external message now; "
        f"got {len(outbound)} OutboundMessage row(s)"
    )


# ---------------------------------------------------------------------------
# 5. Digests: run-digests sends summary + clears digest_pending; idempotent (E26)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _E26_PRESENT, reason=_E26_REASON)
async def test_run_digests_idempotent(client, admin, agent):
    """E26: seed digest-pending notifications → POST /api/notifications/run-digests sends one
    summary + clears digest_pending.  A second run sends nothing (idempotent guard)."""
    tenant, admin_id, agent_id = await _user_ids()

    # Seed 2 digest-pending notifications directly
    async with SessionLocal() as s:
        for i in range(2):
            n = Notification(
                tenant_id=tenant,
                def_key=f"b26.digest.seed.{uuid.uuid4().hex[:4]}",
                user_id=agent_id,
                category="b26_digest_seed",
                priority="info",
                title=f"Digest item {i}",
                body=f"Body {i}",
                digest_pending=True,
            )
            s.add(n)
        await s.commit()

    # Trigger run-digests (first run)
    run_r = await client.post("/api/notifications/run-digests", headers=admin)
    assert run_r.status_code == 200, f"run-digests failed: {run_r.text}"

    # digest_pending must be cleared after first run
    async with SessionLocal() as s:
        still_pending = (await s.execute(
            select(Notification).where(
                Notification.user_id == agent_id,
                Notification.category == "b26_digest_seed",
                Notification.digest_pending.is_(True),
            )
        )).scalars().all()
    assert len(still_pending) == 0, (
        f"run-digests must clear digest_pending; {len(still_pending)} row(s) still pending"
    )

    # Second run (idempotent): must not crash, no new pending rows
    run2_r = await client.post("/api/notifications/run-digests", headers=admin)
    assert run2_r.status_code == 200, f"Second run-digests call failed: {run2_r.text}"

    async with SessionLocal() as s:
        pending_after_2 = (await s.execute(
            select(Notification).where(
                Notification.user_id == agent_id,
                Notification.category == "b26_digest_seed",
                Notification.digest_pending.is_(True),
            )
        )).scalars().all()
    assert len(pending_after_2) == 0, "Second run: no new digest_pending rows must appear"


# ---------------------------------------------------------------------------
# 6. Snooze / archive state endpoints (A26)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _A26_PRESENT, reason=_A26_REASON)
async def test_snooze_archive_state(client, admin, agent):
    """A26 inbox state:
    - POST /notifications/{id}/archive  → archived=True
    - POST /notifications/{id}/unarchive → archived=False (restored)
    - POST /notifications/{id}/snooze   → snoozed_until set
    Authorization is user-scoped: admin cannot archive the agent's notification (404)."""
    tenant, admin_id, agent_id = await _user_ids()

    # Seed one notification for the agent directly
    async with SessionLocal() as s:
        n = Notification(
            tenant_id=tenant,
            def_key="b26.archive.test",
            user_id=agent_id,
            category="b26_archive_cat",
            priority="info",
            title="Archive me",
            body="Body",
        )
        s.add(n)
        await s.commit()
        await s.refresh(n)
        nid = str(n.id)

    # Admin cannot archive the agent's notification (user-scoped → 404)
    auth_r = await client.post(f"/notifications/{nid}/archive", headers=admin)
    assert auth_r.status_code == 404, (
        f"Admin must not be able to archive another user's notification; got {auth_r.status_code}"
    )

    # Agent archives their own notification
    arch_r = await client.post(f"/notifications/{nid}/archive", headers=agent)
    assert arch_r.status_code == 200, f"archive failed: {arch_r.text}"
    arch_data = arch_r.json()
    assert arch_data.get("archived") is True, "archived must be True in the archive response"

    # Verify DB row
    async with SessionLocal() as s:
        row = (await s.execute(
            select(Notification).where(Notification.id == uuid.UUID(nid))
        )).scalar_one()
    assert row.archived is True, "Notification.archived must be True in DB after archive"

    # Unarchive restores the notification
    unarch_r = await client.post(f"/notifications/{nid}/unarchive", headers=agent)
    assert unarch_r.status_code == 200, f"unarchive failed: {unarch_r.text}"
    assert unarch_r.json().get("archived") is False, "archived must be False after unarchive"

    # Snooze a fresh notification
    async with SessionLocal() as s:
        n2 = Notification(
            tenant_id=tenant,
            def_key="b26.snooze.test",
            user_id=agent_id,
            category="b26_snooze_cat",
            priority="info",
            title="Snooze me",
            body="Body",
        )
        s.add(n2)
        await s.commit()
        await s.refresh(n2)
        nid2 = str(n2.id)

    # Snooze for 60 minutes using the `minutes` field
    snooze_r = await client.post(
        f"/notifications/{nid2}/snooze", headers=agent,
        json={"minutes": 60},
    )
    assert snooze_r.status_code == 200, f"snooze failed: {snooze_r.text}"
    snooze_data = snooze_r.json()
    assert snooze_data.get("snoozed_until") is not None, (
        "snoozed_until must be set in the snooze response"
    )

    # Verify DB row
    async with SessionLocal() as s:
        row2 = (await s.execute(
            select(Notification).where(Notification.id == uuid.UUID(nid2))
        )).scalar_one()
    assert row2.snoozed_until is not None, "Notification.snoozed_until must be set in DB after snooze"

    # Clear snooze (unsnooze) using empty body / snoozed_until=None
    unsnooze_r = await client.post(
        f"/notifications/{nid2}/snooze", headers=agent,
        json={"snoozed_until": None},
    )
    assert unsnooze_r.status_code == 200, f"unsnooze failed: {unsnooze_r.text}"
    assert unsnooze_r.json().get("snoozed_until") is None, (
        "snoozed_until must be null after clearing the snooze"
    )
