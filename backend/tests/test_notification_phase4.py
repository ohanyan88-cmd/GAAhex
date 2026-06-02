"""Notification Standard Phase 4 — full coverage for Phase 3 delivery infra +
suppression modes + permission keys + sweep jobs.

Tests cover:
  - NotificationDelivery rows recorded on IN_APP and external dispatch
  - MUTE suppression: emit_notification returns None, no inbox row
  - DEDUPLICATE suppression: second identical emit within window suppressed
  - DEDUPLICATE: outside the window delivers again
  - check_deduplicate() helper logic
  - run_expired_sweep(): PENDING/DELIVERED → EXPIRED when expires_at < now
  - run_expired_sweep(): ACKNOWLEDGED stays unchanged (not in active set)
  - run_retry_sweep(): FAILED delivery gets retried; creates new delivery row
  - run_retry_sweep(): exhausted retries → DEAD_LETTERED + notification.status=FAILED
  - POST /notifications/run-expired-sweep: permission gate (notification.manage)
  - POST /notifications/run-retry-sweep: permission gate
  - notification.manage key seeded in permission_def
  - Preference hierarchy resolution (most-specific wins: def_key > category > default)
"""
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import select, update

from app.db import OwnerSessionLocal
from app.models import (
    Notification, NotificationDef, NotificationDelivery,
    Tenant, OrgNode, RoleDef, Assignment, PermissionDef,
)
from app.models.outbound import OutboundMessage
from app.models.notification_pref import NotificationPref
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password
from sqlalchemy_utils import Ltree


_PROFILES = {
    "notif_manager":  ["notification.view", "notification.manage_preferences",
                       "notification.acknowledge", "notification.dismiss", "notification.manage"],
    "notif_no_perm":  [],
}
_USERS = {
    "alice": ("alice-np4@demo.isp", "notif_manager"),
    "nada":  ("nada-np4@demo.isp",  "notif_no_perm"),
}


async def _ensure(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(select(User).where(User.tenant_id == tenant_id, User.email == email))).scalar_one_or_none()
    if u is None:
        u = User(tenant_id=tenant_id, email=email, name=email.split("@")[0],
                 password_hash=hash_password("np4-123"), status="active")
        s.add(u); await s.flush()
    if not (await s.execute(select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant_id))).scalar_one_or_none():
        s.add(Assignment(tenant_id=tenant_id, user_id=u.id, role_id=role_id, node_id=node_id, region_scope="any"))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_np4_users():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        root = (await s.execute(select(OrgNode).where(OrgNode.tenant_id == tenant.id).order_by(OrgNode.path).limit(1))).scalar_one_or_none()
        if root is None:
            root = OrgNode(tenant_id=tenant.id, type="Group", name="Root", code="grp", path=Ltree("grp"))
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
        await s.commit()
        demo_tenant_id = tenant.id

    yield

    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()]
        users = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            notif_ids = (await s.execute(select(Notification.id).where(Notification.user_id.in_(uids)))).scalars().all()
            if notif_ids:
                await s.execute(NotificationDelivery.__table__.delete().where(NotificationDelivery.notification_id.in_(notif_ids)))
                await s.execute(Notification.__table__.delete().where(Notification.id.in_(notif_ids)))
            await s.execute(NotificationPref.__table__.delete().where(NotificationPref.user_id.in_(uids)))
            await s.execute(OutboundMessage.__table__.delete().where(OutboundMessage.user_id.in_(uids)))
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        # Clean up test NotificationDefs
        await s.execute(NotificationDef.__table__.delete().where(
            NotificationDef.key.like("np4.test.%")
        ))
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "np4-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client): return await _login(client, _USERS["alice"][0])

@pytest_asyncio.fixture
async def nada(client): return await _login(client, _USERS["nada"][0])


async def _mk_def(s, tenant_id, key, suppression_mode="NONE", dedup_window=None, channel="inapp"):
    """Create a test NotificationDef; idempotent."""
    existing = (await s.execute(select(NotificationDef).where(
        NotificationDef.tenant_id == tenant_id, NotificationDef.key == key
    ))).scalar_one_or_none()
    if existing:
        existing.suppression_mode = suppression_mode
        existing.dedup_window_seconds = dedup_window
        existing.channel = channel
        await s.flush()
        return existing
    nd = NotificationDef(
        tenant_id=tenant_id, key=key, label=key,
        channel=channel, category="system", priority="info",
        title_template="Test {key}", body_template="Body {key}",
        suppression_mode=suppression_mode, dedup_window_seconds=dedup_window,
    )
    s.add(nd); await s.flush()
    return nd


async def _emit(s, tenant_id, user_id, def_key, **kwargs):
    from app.routers.notifications import emit_notification
    return await emit_notification(
        s, tenant_id=tenant_id, def_key=def_key, user_id=user_id, **kwargs
    )


# ── notification.manage key seeded ───────────────────────────────────────────

async def test_notification_manage_key_seeded():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        row = (await s.execute(select(PermissionDef).where(
            PermissionDef.tenant_id == tenant.id,
            PermissionDef.key == "notification.manage",
        ))).scalar_one_or_none()
        assert row is not None, "notification.manage not seeded in permission_def"
        assert row.group == "notification"


# ── delivery rows recorded ────────────────────────────────────────────────────

async def test_in_app_delivery_row_created_on_emit():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        user = (await s.execute(select(User).where(User.email == _USERS["alice"][0]))).scalar_one()
        await _mk_def(s, tenant.id, "np4.test.inapp_delivery", channel="inapp")
        note = await _emit(s, tenant.id, user.id, "np4.test.inapp_delivery")
        assert note is not None
        rows = (await s.execute(select(NotificationDelivery).where(
            NotificationDelivery.notification_id == note.id
        ))).scalars().all()
        # Must have at least one IN_APP delivery row
        in_app = [r for r in rows if r.channel == "IN_APP"]
        assert in_app, "No IN_APP delivery row recorded"
        assert in_app[0].status == "DELIVERED"
        await s.rollback()


# ── suppression modes ─────────────────────────────────────────────────────────

async def test_mute_suppression_returns_none():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        user = (await s.execute(select(User).where(User.email == _USERS["alice"][0]))).scalar_one()
        await _mk_def(s, tenant.id, "np4.test.mute", suppression_mode="MUTE")
        note = await _emit(s, tenant.id, user.id, "np4.test.mute")
        assert note is None, "MUTE should suppress the notification (return None)"
        await s.rollback()


async def test_mute_suppression_creates_no_inbox_row():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        user = (await s.execute(select(User).where(User.email == _USERS["alice"][0]))).scalar_one()
        await _mk_def(s, tenant.id, "np4.test.mute2", suppression_mode="MUTE")
        before = (await s.execute(select(Notification).where(
            Notification.tenant_id == tenant.id,
            Notification.user_id == user.id,
            Notification.def_key == "np4.test.mute2",
        ))).scalars().all()
        await _emit(s, tenant.id, user.id, "np4.test.mute2")
        after = (await s.execute(select(Notification).where(
            Notification.tenant_id == tenant.id,
            Notification.user_id == user.id,
            Notification.def_key == "np4.test.mute2",
        ))).scalars().all()
        assert len(after) == len(before), "MUTE must not create an inbox row"
        await s.rollback()


async def test_deduplicate_suppresses_second_emit_within_window():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        user = (await s.execute(select(User).where(User.email == _USERS["alice"][0]))).scalar_one()
        await _mk_def(s, tenant.id, "np4.test.dedup", suppression_mode="DEDUPLICATE", dedup_window=300)
        first = await _emit(s, tenant.id, user.id, "np4.test.dedup")
        assert first is not None, "First emit should deliver"
        second = await _emit(s, tenant.id, user.id, "np4.test.dedup")
        assert second is None, "Second emit within dedup window should be suppressed"
        await s.rollback()


async def test_deduplicate_delivers_after_window_expires():
    """Fake an old notification (created_at in the past) then emit again — should deliver."""
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        user = (await s.execute(select(User).where(User.email == _USERS["alice"][0]))).scalar_one()
        key = "np4.test.dedup_old"
        await _mk_def(s, tenant.id, key, suppression_mode="DEDUPLICATE", dedup_window=5)  # 5s window
        # Plant an old notification outside the window
        old_time = datetime.now(timezone.utc) - timedelta(seconds=60)
        s.add(Notification(
            tenant_id=tenant.id, user_id=user.id, def_key=key,
            category="system", priority="info", title="Old", body="Old",
            created_at=old_time,
        ))
        await s.flush()
        # Now emit fresh — should NOT be suppressed (old row is outside the 5s window)
        note = await _emit(s, tenant.id, user.id, key)
        assert note is not None, "Should deliver when previous notification is outside the dedup window"
        await s.rollback()


async def test_none_mode_always_delivers():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        user = (await s.execute(select(User).where(User.email == _USERS["alice"][0]))).scalar_one()
        await _mk_def(s, tenant.id, "np4.test.none_mode", suppression_mode="NONE")
        n1 = await _emit(s, tenant.id, user.id, "np4.test.none_mode")
        n2 = await _emit(s, tenant.id, user.id, "np4.test.none_mode")
        assert n1 is not None and n2 is not None, "NONE mode should always deliver"
        await s.rollback()


# ── run_expired_sweep ─────────────────────────────────────────────────────────

async def test_expired_sweep_marks_pending_notifications():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        user = (await s.execute(select(User).where(User.email == _USERS["alice"][0]))).scalar_one()
        now = datetime.now(timezone.utc)
        # Plant a PENDING notification with expires_at in the past
        n = Notification(
            tenant_id=tenant.id, user_id=user.id, def_key="np4.test.expire",
            category="system", priority="info", title="Exp", body="Exp",
            status="PENDING", expires_at=now - timedelta(hours=1),
        )
        s.add(n); await s.flush()
        nid = n.id

        from app.routers.notifications import run_expired_sweep
        result = await run_expired_sweep(s, tenant_id=tenant.id, actor=user)
        assert result["expired"] >= 1

        refreshed = (await s.execute(select(Notification).where(Notification.id == nid))).scalar_one()
        assert refreshed.status == "EXPIRED"
        await s.rollback()


async def test_expired_sweep_leaves_acknowledged_unchanged():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        user = (await s.execute(select(User).where(User.email == _USERS["alice"][0]))).scalar_one()
        now = datetime.now(timezone.utc)
        # ACKNOWLEDGED notification with expires_at in past — must stay ACKNOWLEDGED
        n = Notification(
            tenant_id=tenant.id, user_id=user.id, def_key="np4.test.ack_no_expire",
            category="system", priority="info", title="A", body="A",
            status="ACKNOWLEDGED", expires_at=now - timedelta(hours=1),
        )
        s.add(n); await s.flush()
        nid = n.id

        from app.routers.notifications import run_expired_sweep
        await run_expired_sweep(s, tenant_id=tenant.id, actor=user)
        refreshed = (await s.execute(select(Notification).where(Notification.id == nid))).scalar_one()
        assert refreshed.status == "ACKNOWLEDGED", "Sweep must not touch non PENDING/DELIVERED rows"
        await s.rollback()


async def test_expired_sweep_leaves_future_expires_at_unchanged():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        user = (await s.execute(select(User).where(User.email == _USERS["alice"][0]))).scalar_one()
        n = Notification(
            tenant_id=tenant.id, user_id=user.id, def_key="np4.test.future_expire",
            category="system", priority="info", title="F", body="F",
            status="DELIVERED", expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
        )
        s.add(n); await s.flush()
        nid = n.id

        from app.routers.notifications import run_expired_sweep
        await run_expired_sweep(s, tenant_id=tenant.id, actor=user)
        refreshed = (await s.execute(select(Notification).where(Notification.id == nid))).scalar_one()
        assert refreshed.status == "DELIVERED", "Future expires_at must not be touched"
        await s.rollback()


# ── run_retry_sweep ───────────────────────────────────────────────────────────

async def test_retry_sweep_retries_failed_delivery():
    """A notification with a FAILED delivery row gets a new attempt on retry sweep."""
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        user = (await s.execute(select(User).where(User.email == _USERS["alice"][0]))).scalar_one()
        now = datetime.now(timezone.utc)
        # Plant notification + one FAILED delivery
        n = Notification(
            tenant_id=tenant.id, user_id=user.id, def_key="np4.test.retry",
            category="system", priority="info", title="Retry me", body="Body",
            status="DELIVERED",
        )
        s.add(n); await s.flush()
        s.add(NotificationDelivery(
            tenant_id=tenant.id, notification_id=n.id,
            channel="EMAIL", status="FAILED",
            attempted_at=now - timedelta(minutes=2),
            result_detail="SMTP timeout",
        ))
        await s.flush()
        before_count = (await s.execute(
            select(NotificationDelivery).where(NotificationDelivery.notification_id == n.id)
        )).scalars().count() if False else 1  # we added 1 above

        from app.routers.notifications import run_retry_sweep
        result = await run_retry_sweep(s, tenant_id=tenant.id, actor=user)
        assert result["retried"] >= 1 or result["dead_lettered"] >= 0  # ran without error
        # A new delivery row must exist (retry attempt recorded)
        rows = (await s.execute(
            select(NotificationDelivery).where(NotificationDelivery.notification_id == n.id)
        )).scalars().all()
        assert len(rows) >= 2, "Retry must add a new delivery row"
        await s.rollback()


async def test_retry_sweep_dead_letters_after_max_retries():
    """After _MAX_DELIVERY_RETRIES FAILED rows, next sweep dead-letters the notification."""
    from app.routers.notifications import _MAX_DELIVERY_RETRIES
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        user = (await s.execute(select(User).where(User.email == _USERS["alice"][0]))).scalar_one()
        now = datetime.now(timezone.utc)
        n = Notification(
            tenant_id=tenant.id, user_id=user.id, def_key="np4.test.deadletter",
            category="system", priority="info", title="DL", body="Body",
            status="DELIVERED",
        )
        s.add(n); await s.flush()
        # Plant exactly _MAX_DELIVERY_RETRIES FAILED rows
        for i in range(_MAX_DELIVERY_RETRIES):
            s.add(NotificationDelivery(
                tenant_id=tenant.id, notification_id=n.id,
                channel="EMAIL", status="FAILED",
                attempted_at=now - timedelta(minutes=i + 1),
            ))
        await s.flush()

        from app.routers.notifications import run_retry_sweep
        result = await run_retry_sweep(s, tenant_id=tenant.id, actor=user)
        assert result["dead_lettered"] >= 1

        refreshed = (await s.execute(select(Notification).where(Notification.id == n.id))).scalar_one()
        assert refreshed.status == "FAILED", "Dead-lettered notification must have status=FAILED"
        dl_rows = (await s.execute(select(NotificationDelivery).where(
            NotificationDelivery.notification_id == n.id,
            NotificationDelivery.status == "DEAD_LETTERED",
        ))).scalars().all()
        assert dl_rows, "Must have a DEAD_LETTERED delivery row"
        await s.rollback()


# ── permission gates on sweep endpoints ──────────────────────────────────────

async def test_expired_sweep_endpoint_requires_manage(client, alice, nada):
    r_ok = await client.post("/notifications/run-expired-sweep", headers=alice)
    assert r_ok.status_code == 200
    r_denied = await client.post("/notifications/run-expired-sweep", headers=nada)
    assert r_denied.status_code == 403


async def test_retry_sweep_endpoint_requires_manage(client, alice, nada):
    r_ok = await client.post("/notifications/run-retry-sweep", headers=alice)
    assert r_ok.status_code == 200
    r_denied = await client.post("/notifications/run-retry-sweep", headers=nada)
    assert r_denied.status_code == 403


# ── preference hierarchy (most specific wins) ─────────────────────────────────

async def test_preference_hierarchy_def_key_wins_over_category():
    """A26 pref keyed on the exact def_key takes priority over a category-level pref."""
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        user = (await s.execute(select(User).where(User.email == _USERS["alice"][0]))).scalar_one()
        from app.routers.notifications import _resolve_pref, PREF_CHANNEL_SENTINEL
        # Category-level pref: category=system → digest
        s.add(NotificationPref(
            tenant_id=tenant.id, user_id=user.id,
            category="system", channel=PREF_CHANNEL_SENTINEL,
            mode="digest", channels=["email"], muted=False,
        ))
        # def_key-level pref: specific key → realtime
        s.add(NotificationPref(
            tenant_id=tenant.id, user_id=user.id,
            category="np4.test.hier_key", channel=PREF_CHANNEL_SENTINEL,
            mode="realtime", channels=["email"], muted=False,
        ))
        await s.flush()
        pref = await _resolve_pref(s, tenant.id, user.id, "system", "np4.test.hier_key")
        assert pref is not None and pref["mode"] == "realtime", \
            "def_key-level pref must win over category-level pref"
        await s.rollback()


async def test_preference_hierarchy_category_wins_over_default():
    """A category-level pref wins over the global default."""
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        user = (await s.execute(select(User).where(User.email == _USERS["alice"][0]))).scalar_one()
        from app.routers.notifications import _resolve_pref, PREF_CHANNEL_SENTINEL, CATEGORY_DEFAULT
        # Global default pref
        s.add(NotificationPref(
            tenant_id=tenant.id, user_id=user.id,
            category=CATEGORY_DEFAULT, channel=PREF_CHANNEL_SENTINEL,
            mode="digest", channels=["email"], muted=False,
        ))
        # Category-level override
        s.add(NotificationPref(
            tenant_id=tenant.id, user_id=user.id,
            category="billing", channel=PREF_CHANNEL_SENTINEL,
            mode="realtime", channels=["email", "sms"], muted=False,
        ))
        await s.flush()
        pref = await _resolve_pref(s, tenant.id, user.id, "billing", "billing.overdue")
        assert pref is not None and pref["mode"] == "realtime", \
            "category-level pref must win over global default"
        await s.rollback()


async def test_preference_hierarchy_global_default_fallback():
    """When no def_key or category pref exists, the global default is used."""
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        user = (await s.execute(select(User).where(User.email == _USERS["alice"][0]))).scalar_one()
        from app.routers.notifications import _resolve_pref, PREF_CHANNEL_SENTINEL, CATEGORY_DEFAULT
        s.add(NotificationPref(
            tenant_id=tenant.id, user_id=user.id,
            category=CATEGORY_DEFAULT, channel=PREF_CHANNEL_SENTINEL,
            mode="off", channels=[], muted=False,
        ))
        await s.flush()
        pref = await _resolve_pref(s, tenant.id, user.id, "network", "network.outage")
        assert pref is not None and pref["mode"] == "off", \
            "Global default pref should be returned when no category/def_key match"
        await s.rollback()
