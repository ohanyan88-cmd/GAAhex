"""Comment Standard (file 04) — full Phase 4 gate coverage.

Tests are scoped to: route happy-paths, every permission gate (no-perm, view_*
visibility, edit author-self-only, delete self-or-moderate, moderate-cant-edit),
hold-blocks-everything (edit/delete/resolve/reopen for everyone incl. moderate),
SYSTEM-as-view_internal-only, reply-depth-2, edit-window, mention validation,
content sanitization, soft-delete render, audit emit + byModerator flag,
multi-tenant RLS isolation.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select, update
from sqlalchemy_utils import Ltree

from app.db import OwnerSessionLocal
from app.models import (
    Comment, CommentMention, Tenant, OrgNode, PermissionDef, RoleDef, Assignment, Event,
)
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password


# ──────────────────────────────────────────────────────────────────────────────
# Module-scoped setup: create one "comment_test" demo workspace with users
# at every permission profile we need to exercise.
# ──────────────────────────────────────────────────────────────────────────────

_PROFILES = {
    # role_key            : permission list
    "comment_standard_user": [
        "comment.create", "comment.view_internal", "comment.view_external",
        "comment.view_private", "comment.edit", "comment.delete",
    ],
    "comment_moderator": [
        "comment.create", "comment.view_internal", "comment.view_external",
        "comment.view_private", "comment.edit", "comment.delete", "comment.moderate",
    ],
    "comment_view_internal_only": ["comment.view_internal"],
    "comment_view_external_only": ["comment.view_external"],
    "comment_no_perm": [],
}

# Per-test users; key = label, value = (email, role_key)
_USERS = {
    "alice":   ("alice-cmt@demo.isp",   "comment_standard_user"),
    "bob":     ("bob-cmt@demo.isp",     "comment_standard_user"),
    "charlie": ("charlie-cmt@demo.isp", "comment_moderator"),
    "vi_only": ("vi-cmt@demo.isp",      "comment_view_internal_only"),
    "ve_only": ("ve-cmt@demo.isp",      "comment_view_external_only"),
    "nada":    ("nada-cmt@demo.isp",    "comment_no_perm"),
}


async def _ensure_user_role_assignment(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    existing = (await s.execute(
        select(User).where(User.tenant_id == tenant_id, User.email == email)
    )).scalar_one_or_none()
    if existing is None:
        u = User(
            tenant_id=tenant_id, email=email, name=email.split("@")[0],
            password_hash=hash_password("cmt-test-123"), status="active",
        )
        s.add(u)
        await s.flush()
        existing = u
    has_assignment = (await s.execute(
        select(Assignment).where(Assignment.tenant_id == tenant_id, Assignment.user_id == existing.id)
    )).scalar_one_or_none()
    if has_assignment is None:
        s.add(Assignment(
            tenant_id=tenant_id, user_id=existing.id, role_id=role_id, node_id=node_id,
            region_scope="any",
        ))
        await s.flush()
    return existing.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_comment_users():
    """Build the 6 test users + a second tenant + cross-tenant user."""
    async with OwnerSessionLocal() as s:
        # Resolve demo tenant + root node.
        tenant = (await s.execute(select(Tenant))).scalars().first()
        root_node = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == tenant.id).order_by(OrgNode.path).limit(1)
        )).scalar_one()
        # Create the 5 role profiles in the demo tenant (idempotent).
        role_ids: dict[str, uuid.UUID] = {}
        for role_key, perms in _PROFILES.items():
            row = (await s.execute(
                select(RoleDef).where(RoleDef.tenant_id == tenant.id, RoleDef.key == role_key)
            )).scalar_one_or_none()
            if row is None:
                row = RoleDef(
                    tenant_id=tenant.id, key=role_key, label=role_key.replace("_", " ").title(),
                    permissions=perms, scope="tenant",
                )
                s.add(row)
                await s.flush()
            else:
                # keep the perm list in sync if a later test profile changes
                row.permissions = perms
            role_ids[role_key] = row.id
        # Build users + assignments in demo tenant.
        for _label, (email, role_key) in _USERS.items():
            await _ensure_user_role_assignment(
                s, tenant_id=tenant.id, node_id=root_node.id,
                email=email, role_id=role_ids[role_key],
            )
        # Second tenant + cross-tenant alice for the RLS test.
        other = (await s.execute(
            select(Tenant).where(Tenant.name == "Comment-RLS-Other-Tenant")
        )).scalar_one_or_none()
        if other is None:
            other = Tenant(name="Comment-RLS-Other-Tenant", status="active")
            s.add(other)
            await s.flush()
            s.add(OrgNode(tenant_id=other.id, type="Group", name="Root", code="root", path=Ltree("root")))
            await s.flush()
        other_root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == other.id).order_by(OrgNode.path).limit(1)
        )).scalar_one()
        other_role = (await s.execute(
            select(RoleDef).where(RoleDef.tenant_id == other.id, RoleDef.key == "comment_standard_user")
        )).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(
                tenant_id=other.id, key="comment_standard_user", label="Standard",
                permissions=_PROFILES["comment_standard_user"], scope="tenant",
            )
            s.add(other_role)
            await s.flush()
        await _ensure_user_role_assignment(
            s, tenant_id=other.id, node_id=other_root.id,
            email="alice-other-cmt@demo.isp", role_id=other_role.id,
        )
        await s.commit()
        demo_tenant_id = tenant.id
        other_tenant_id = other.id

    yield

    # Teardown — our users sit on the demo tenant's root node with region_scope=any, so
    # without this they get resolved as recipients by other modules' notify_emit tests
    # (1 expected agent + 6 of ours = 7 notifications). Drop everything we added.
    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()] + ["alice-other-cmt@demo.isp"]
        user_rows = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        user_ids = [u.id for u in user_rows]
        if user_ids:
            # Drop dependents that FK to app_user before the user rows themselves.
            await s.execute(Comment.__table__.delete().where(Comment.author_id.in_(user_ids)))
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(user_ids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(user_ids)))
            await s.execute(User.__table__.delete().where(User.id.in_(user_ids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        # Other-tenant cleanup (its OrgNode + tenant row).
        await s.execute(OrgNode.__table__.delete().where(OrgNode.tenant_id == other_tenant_id))
        await s.execute(Tenant.__table__.delete().where(Tenant.id == other_tenant_id))
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "cmt-test-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client):
    return await _login(client, _USERS["alice"][0])


@pytest_asyncio.fixture
async def bob(client):
    return await _login(client, _USERS["bob"][0])


@pytest_asyncio.fixture
async def charlie(client):
    return await _login(client, _USERS["charlie"][0])


@pytest_asyncio.fixture
async def vi_only(client):
    return await _login(client, _USERS["vi_only"][0])


@pytest_asyncio.fixture
async def ve_only(client):
    return await _login(client, _USERS["ve_only"][0])


@pytest_asyncio.fixture
async def nada(client):
    return await _login(client, _USERS["nada"][0])


@pytest_asyncio.fixture
async def alice_other(client):
    return await _login(client, "alice-other-cmt@demo.isp")


# helpers ───────────────────────────────────────────────────────────────────────

def _parent():
    return ("customer", str(uuid.uuid4()))


async def _create(client, hdr, *, parent=None, ctype="INTERNAL", content="hello", parent_comment_id=None, mentions=None):
    ek, pid = parent or _parent()
    body = {"commentType": ctype, "content": content}
    if parent_comment_id:
        body["parentCommentId"] = parent_comment_id
    if mentions is not None:
        body["mentions"] = mentions
    r = await client.post(f"/api/{ek}/{pid}/comments", headers=hdr, json=body)
    return r, ek, pid


# ──────────────────────────────────────────────────────────────────────────────
# Happy paths
# ──────────────────────────────────────────────────────────────────────────────

async def test_create_returns_201_and_shape(client, alice):
    r, ek, pid = await _create(client, alice, content="first one")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "ACTIVE"
    assert body["commentType"] == "INTERNAL"
    assert body["content"] == "first one"
    assert body["parentObjectType"] == ek
    assert body["parentObjectId"] == pid
    assert body["hold"] is False


async def test_list_includes_visible_rows(client, alice):
    r1, ek, pid = await _create(client, alice, content="one")
    r2, _, _ = await _create(client, alice, parent=(ek, pid), content="two")
    lst = await client.get(f"/api/{ek}/{pid}/comments", headers=alice)
    assert lst.status_code == 200
    contents = [c["content"] for c in lst.json()]
    assert "one" in contents and "two" in contents


async def test_get_single_returns_row(client, alice):
    r, _, _ = await _create(client, alice)
    cid = r.json()["id"]
    g = await client.get(f"/api/comments/{cid}", headers=alice)
    assert g.status_code == 200


async def test_self_edit_sets_status_edited_and_emits_event(client, alice):
    r, ek, pid = await _create(client, alice, content="orig")
    cid = r.json()["id"]
    p = await client.patch(f"/api/comments/{cid}", headers=alice, json={"content": "updated"})
    assert p.status_code == 200, p.text
    assert p.json()["status"] == "EDITED"
    assert p.json()["content"] == "updated"
    # event substrate emit
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(Event.type == "comment_edited")
        )).scalars().all()
        assert any(e.data.get("commentId") == cid and e.data["before"]["content"] == "orig"
                   and e.data["after"]["content"] == "updated" for e in evs)


async def test_self_delete_sets_status_deleted_and_emits_bymoderator_false(client, alice):
    r, _, _ = await _create(client, alice, content="bye")
    cid = r.json()["id"]
    d = await client.delete(f"/api/comments/{cid}", headers=alice)
    assert d.status_code == 200
    assert d.json()["status"] == "DELETED"
    assert d.json()["content"] == "Comment Deleted"
    async with OwnerSessionLocal() as s:
        ev = (await s.execute(
            select(Event).where(Event.type == "comment_deleted")
        )).scalars().all()
        found = [e for e in ev if e.data.get("commentId") == cid]
        assert found, "comment_deleted event missing"
        assert found[-1].data["byModerator"] is False


async def test_resolve_then_reopen_round_trip(client, alice):
    r, _, _ = await _create(client, alice)
    cid = r.json()["id"]
    a = await client.post(f"/api/comments/{cid}/resolve", headers=alice)
    assert a.status_code == 200 and a.json()["resolution"] == "RESOLVED"
    b = await client.post(f"/api/comments/{cid}/reopen", headers=alice)
    assert b.status_code == 200 and b.json()["resolution"] == "UNRESOLVED"


# ──────────────────────────────────────────────────────────────────────────────
# Permission gate denials
# ──────────────────────────────────────────────────────────────────────────────

async def test_create_denied_without_comment_create(client, nada):
    r, _, _ = await _create(client, nada)
    assert r.status_code == 403


async def test_list_denied_when_no_view_perm(client, nada):
    ek, pid = _parent()
    r = await client.get(f"/api/{ek}/{pid}/comments", headers=nada)
    assert r.status_code == 403


async def test_edit_other_user_denied_403(client, alice, bob):
    """Alice creates → Bob (no moderate, has edit) tries to edit → 403 (author-self only)."""
    r, _, _ = await _create(client, alice, content="alice's words")
    cid = r.json()["id"]
    p = await client.patch(f"/api/comments/{cid}", headers=bob, json={"content": "bob's edit"})
    assert p.status_code == 403


async def test_moderate_cannot_edit_other_user_content(client, alice, charlie):
    """Moderation deletes; it doesn't ghost-edit. Charlie (moderator) PATCHing Alice's
    comment must be 403 — file 04 lock: no admin/moderate bypass for edit."""
    r, _, _ = await _create(client, alice, content="alice's words")
    cid = r.json()["id"]
    p = await client.patch(f"/api/comments/{cid}", headers=charlie, json={"content": "modified by charlie"})
    assert p.status_code == 403


async def test_delete_other_user_denied_without_moderate(client, alice, bob):
    r, _, _ = await _create(client, alice)
    cid = r.json()["id"]
    d = await client.delete(f"/api/comments/{cid}", headers=bob)
    assert d.status_code == 403


async def test_moderate_can_delete_other_user_byModerator_true(client, alice, charlie):
    r, _, _ = await _create(client, alice, content="goodbye")
    cid = r.json()["id"]
    d = await client.delete(f"/api/comments/{cid}", headers=charlie)
    assert d.status_code == 200 and d.json()["status"] == "DELETED"
    async with OwnerSessionLocal() as s:
        ev = (await s.execute(
            select(Event).where(Event.type == "comment_deleted")
        )).scalars().all()
        found = [e for e in ev if e.data.get("commentId") == cid]
        assert found and found[-1].data["byModerator"] is True


async def test_moderate_can_resolve_other_user(client, alice, charlie):
    r, _, _ = await _create(client, alice)
    cid = r.json()["id"]
    a = await client.post(f"/api/comments/{cid}/resolve", headers=charlie)
    assert a.status_code == 200 and a.json()["resolution"] == "RESOLVED"


async def test_moderate_can_reopen_other_user(client, alice, charlie):
    r, _, _ = await _create(client, alice)
    cid = r.json()["id"]
    await client.post(f"/api/comments/{cid}/resolve", headers=alice)
    a = await client.post(f"/api/comments/{cid}/reopen", headers=charlie)
    assert a.status_code == 200 and a.json()["resolution"] == "UNRESOLVED"


# ──────────────────────────────────────────────────────────────────────────────
# Visibility — SYSTEM is gated by view_internal specifically
# ──────────────────────────────────────────────────────────────────────────────

async def test_mixed_type_thread_view_internal_only_sees_only_internal_and_system(client, alice, vi_only):
    """Alice (full perms) seeds a thread with one of each type; vi_only sees only INTERNAL + SYSTEM."""
    ek, pid = _parent()
    for ctype, content in [
        ("INTERNAL", "i-msg"), ("EXTERNAL", "e-msg"),
        ("PRIVATE", "p-msg"), ("SYSTEM", "s-msg"),
    ]:
        r, _, _ = await _create(client, alice, parent=(ek, pid), ctype=ctype, content=content)
        assert r.status_code == 201
    lst = await client.get(f"/api/{ek}/{pid}/comments", headers=vi_only)
    assert lst.status_code == 200
    types_seen = {c["commentType"] for c in lst.json()}
    assert types_seen == {"INTERNAL", "SYSTEM"}, f"got {types_seen}"
    # length sanity — exactly 2, no count leak
    assert len(lst.json()) == 2


async def test_get_single_returns_404_not_403_for_unviewable_type(client, alice, ve_only):
    """ve_only holds only view_external. GET a SYSTEM comment → 404 (no existence leak)."""
    r, _, _ = await _create(client, alice, ctype="SYSTEM", content="system notice")
    cid = r.json()["id"]
    g = await client.get(f"/api/comments/{cid}", headers=ve_only)
    assert g.status_code == 404, g.text


# ──────────────────────────────────────────────────────────────────────────────
# Hold blocks edit + delete + resolve + reopen for EVERYONE (incl. moderate)
# ──────────────────────────────────────────────────────────────────────────────

async def _set_hold(comment_id, value: bool):
    async with OwnerSessionLocal() as s:
        await s.execute(update(Comment).where(Comment.id == uuid.UUID(comment_id)).values(hold=value))
        await s.commit()


async def test_hold_blocks_self_edit(client, alice):
    r, _, _ = await _create(client, alice)
    cid = r.json()["id"]
    await _set_hold(cid, True)
    p = await client.patch(f"/api/comments/{cid}", headers=alice, json={"content": "nope"})
    assert p.status_code == 422 and "hold" in p.json()["detail"].lower()


async def test_hold_blocks_self_delete(client, alice):
    r, _, _ = await _create(client, alice)
    cid = r.json()["id"]
    await _set_hold(cid, True)
    d = await client.delete(f"/api/comments/{cid}", headers=alice)
    assert d.status_code == 422


async def test_hold_blocks_moderate_delete(client, alice, charlie):
    """Hold beats every role including comment.moderate."""
    r, _, _ = await _create(client, alice)
    cid = r.json()["id"]
    await _set_hold(cid, True)
    d = await client.delete(f"/api/comments/{cid}", headers=charlie)
    assert d.status_code == 422


async def test_hold_blocks_resolve(client, alice):
    r, _, _ = await _create(client, alice)
    cid = r.json()["id"]
    await _set_hold(cid, True)
    a = await client.post(f"/api/comments/{cid}/resolve", headers=alice)
    assert a.status_code == 422


async def test_hold_blocks_reopen(client, alice):
    r, _, _ = await _create(client, alice)
    cid = r.json()["id"]
    await client.post(f"/api/comments/{cid}/resolve", headers=alice)
    await _set_hold(cid, True)
    a = await client.post(f"/api/comments/{cid}/reopen", headers=alice)
    assert a.status_code == 422


async def test_hold_blocks_moderate_resolve(client, alice, charlie):
    r, _, _ = await _create(client, alice)
    cid = r.json()["id"]
    await _set_hold(cid, True)
    a = await client.post(f"/api/comments/{cid}/resolve", headers=charlie)
    assert a.status_code == 422


# ──────────────────────────────────────────────────────────────────────────────
# Reply-depth ceiling = 2
# ──────────────────────────────────────────────────────────────────────────────

async def test_reply_depth_two_ok_then_third_rejected(client, alice):
    top, ek, pid = await _create(client, alice, content="top")
    top_id = top.json()["id"]
    reply, _, _ = await _create(client, alice, parent=(ek, pid),
                                content="reply", parent_comment_id=top_id)
    assert reply.status_code == 201
    reply_id = reply.json()["id"]
    nested, _, _ = await _create(client, alice, parent=(ek, pid),
                                 content="too deep", parent_comment_id=reply_id)
    assert nested.status_code == 422
    assert "depth" in nested.json()["detail"].lower()


# ──────────────────────────────────────────────────────────────────────────────
# Edit window
# ──────────────────────────────────────────────────────────────────────────────

async def test_edit_after_window_rejected_422(client, alice):
    r, _, _ = await _create(client, alice)
    cid = r.json()["id"]
    # Backdate created_at well past the 15-minute window.
    backdate = datetime.now(timezone.utc) - timedelta(minutes=20)
    async with OwnerSessionLocal() as s:
        await s.execute(update(Comment).where(Comment.id == uuid.UUID(cid)).values(created_at=backdate))
        await s.commit()
    p = await client.patch(f"/api/comments/{cid}", headers=alice, json={"content": "late"})
    assert p.status_code == 422
    assert "window" in p.json()["detail"].lower()


# ──────────────────────────────────────────────────────────────────────────────
# Mentions
# ──────────────────────────────────────────────────────────────────────────────

async def test_mentions_stored_with_valid_principal_types(client, alice):
    r, _, _ = await _create(client, alice, mentions=[
        {"mentionedEntityType": "EMPLOYEE", "mentionedEntityId": str(uuid.uuid4())},
        {"mentionedEntityType": "DEPARTMENT", "mentionedEntityId": str(uuid.uuid4())},
    ])
    assert r.status_code == 201
    cid = uuid.UUID(r.json()["id"])
    async with OwnerSessionLocal() as s:
        rows = (await s.execute(
            select(CommentMention).where(CommentMention.comment_id == cid)
        )).scalars().all()
        types = sorted(m.mentioned_entity_type for m in rows)
        assert types == ["DEPARTMENT", "EMPLOYEE"]
        # mention_added event per mention
        evs = (await s.execute(
            select(Event).where(Event.type == "mention_added")
        )).scalars().all()
        assert sum(1 for e in evs if e.data.get("commentId") == str(cid)) == 2


async def test_mention_invalid_principal_type_rejected(client, alice):
    """CUSTOMER is on ActorType but NOT in PrincipalType (D5/D12); QUEUE is a Principal in
    other contexts but Comment's mention-target subset excludes it (file 04)."""
    for bad in ("CUSTOMER", "QUEUE", "USER", "INVALID"):
        r, _, _ = await _create(client, alice, mentions=[
            {"mentionedEntityType": bad, "mentionedEntityId": str(uuid.uuid4())}
        ])
        assert r.status_code == 422, f"{bad} should have been rejected"


# ──────────────────────────────────────────────────────────────────────────────
# Content sanitization (deny-list)
# ──────────────────────────────────────────────────────────────────────────────

async def test_script_tag_stripped(client, alice):
    r, _, _ = await _create(client, alice, content='hi <script>alert(1)</script> there')
    assert r.status_code == 201
    assert "<script" not in r.json()["content"]
    assert "alert(1)" not in r.json()["content"]


async def test_javascript_uri_neutralized(client, alice):
    r, _, _ = await _create(client, alice, content='click [here](javascript:steal())')
    assert r.status_code == 201
    assert "javascript:" not in r.json()["content"]
    assert "blocked:" in r.json()["content"]


async def test_safe_rich_text_preserved(client, alice):
    md = "Heads up:\n\n- item\n- item\n\n```python\nprint('ok')\n```\n\n[ok link](https://example.com)"
    r, _, _ = await _create(client, alice, content=md)
    assert r.status_code == 201
    body = r.json()["content"]
    assert "```python" in body and "[ok link]" in body and "- item" in body


# ──────────────────────────────────────────────────────────────────────────────
# Soft delete render
# ──────────────────────────────────────────────────────────────────────────────

async def test_soft_deleted_shows_placeholder_and_row_persists(client, alice):
    r, _, _ = await _create(client, alice, content="sensitive content")
    cid = r.json()["id"]
    await client.delete(f"/api/comments/{cid}", headers=alice)
    g = await client.get(f"/api/comments/{cid}", headers=alice)
    assert g.status_code == 200
    body = g.json()
    assert body["status"] == "DELETED"
    assert body["content"] == "Comment Deleted"
    assert body["deletedAt"] is not None and body["deletedBy"] is not None
    # row physically persists — content still in DB, just not surfaced
    async with OwnerSessionLocal() as s:
        row = (await s.execute(select(Comment).where(Comment.id == uuid.UUID(cid)))).scalar_one()
        assert row.content == "sensitive content"


# ──────────────────────────────────────────────────────────────────────────────
# Multi-tenant RLS isolation
# ──────────────────────────────────────────────────────────────────────────────

async def test_cross_tenant_get_returns_404(client, alice, alice_other):
    """Alice in tenant A creates; alice_other (tenant B) GETs → 404, RLS-isolated."""
    r, _, _ = await _create(client, alice)
    cid = r.json()["id"]
    g = await client.get(f"/api/comments/{cid}", headers=alice_other)
    assert g.status_code == 404
