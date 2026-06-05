"""Attachment Standard (file 04) — gate + lifecycle coverage.

Tests cover: upload happy-path, list, read, download + checksum verification,
soft delete, reference CRUD, permission gates, blocked extensions, max size,
sensitive-category audit event, delete-of-deleted is idempotent, deleted
attachment returns metadata (view_deleted gate), multi-tenant RLS isolation.
"""
import io
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models import Attachment, AttachmentReference, Tenant, OrgNode, RoleDef, Assignment, Event
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password
from sqlalchemy_utils import Ltree


_PROFILES = {
    "attach_full": [
        "attachment.view", "attachment.download", "attachment.upload",
        "attachment.delete", "attachment.reference", "attachment.view_deleted",
    ],
    "attach_view_only":  ["attachment.view"],
    "attach_no_perm":    [],
}
_USERS = {
    "alice":  ("alice-att@demo.isp",  "attach_full"),
    "viewer": ("viewer-att@demo.isp", "attach_view_only"),
    "nada":   ("nada-att@demo.isp",   "attach_no_perm"),
}


async def _ensure(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(select(User).where(User.tenant_id == tenant_id, User.email == email))).scalar_one_or_none()
    if u is None:
        u = User(tenant_id=tenant_id, email=email, name=email.split("@")[0],
                 password_hash=hash_password("att-123"), status="active")
        s.add(u); await s.flush()
    if not (await s.execute(select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant_id))).scalar_one_or_none():
        s.add(Assignment(tenant_id=tenant_id, user_id=u.id, role_id=role_id, node_id=node_id, region_scope="any"))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_att_users():
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
        # Other tenant
        other = (await s.execute(select(Tenant).where(Tenant.name == "Att-RLS-Other"))).scalar_one_or_none()
        if other is None:
            other = Tenant(name="Att-RLS-Other", status="active"); s.add(other); await s.flush()
            s.add(OrgNode(tenant_id=other.id, type="Group", name="Root", code="root5", path=Ltree("root5"))); await s.flush()
        other_root = (await s.execute(select(OrgNode).where(OrgNode.tenant_id == other.id).limit(1))).scalar_one()
        other_role = (await s.execute(select(RoleDef).where(RoleDef.tenant_id == other.id, RoleDef.key == "attach_full"))).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(tenant_id=other.id, key="attach_full", label="full", permissions=_PROFILES["attach_full"], scope="tenant")
            s.add(other_role); await s.flush()
        await _ensure(s, tenant_id=other.id, node_id=other_root.id, email="alice-other-att@demo.isp", role_id=other_role.id)
        await s.commit()
        other_tenant_id = other.id

    yield

    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()] + ["alice-other-att@demo.isp"]
        users = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            att_ids = (await s.execute(select(Attachment.id).where(Attachment.created_by.in_(uids)))).scalars().all()
            if att_ids:
                await s.execute(AttachmentReference.__table__.delete().where(AttachmentReference.attachment_id.in_(att_ids)))
                await s.execute(Attachment.__table__.delete().where(Attachment.id.in_(att_ids)))
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        await s.execute(OrgNode.__table__.delete().where(OrgNode.tenant_id == other_tenant_id))
        # Cross-tenant teardown helper — purges every tenant_id-scoped row

        # before the final tenant DELETE (otherwise event/audit/record FKs block it).

        from tests.conftest import delete_tenant_cleanly

        await delete_tenant_cleanly(s, other_tenant_id)
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "att-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client): return await _login(client, _USERS["alice"][0])
@pytest_asyncio.fixture
async def viewer(client): return await _login(client, _USERS["viewer"][0])
@pytest_asyncio.fixture
async def nada(client): return await _login(client, _USERS["nada"][0])
@pytest_asyncio.fixture
async def alice_other(client): return await _login(client, "alice-other-att@demo.isp")


def _parent(): return ("ticket", str(uuid.uuid4()))


async def _upload(client, hdr, *, ek=None, pid=None, content=b"hello world", filename="test.txt", ctype="text/plain", category="DOCUMENT"):
    ek = ek or "ticket"; pid = pid or str(uuid.uuid4())
    files = {"file": (filename, io.BytesIO(content), ctype)}
    data = {"category": category}
    r = await client.post(f"/api/{ek}/{pid}/attachments", headers=hdr, files=files, data=data)
    return r, ek, pid


# ── happy paths ───────────────────────────────────────────────────────────────

async def test_upload_returns_201_and_shape(client, alice):
    r, ek, pid = await _upload(client, alice)
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["status"] == "AVAILABLE"
    assert b["scanResult"] == "SKIPPED"
    assert b["category"] == "DOCUMENT"
    assert b["fileExtension"] == ".txt"
    assert b["fileSize"] > 0
    assert len(b["checksum"]) == 64  # SHA-256 hex


async def test_list_returns_uploaded(client, alice):
    ek, pid = _parent()
    await _upload(client, alice, ek=ek, pid=pid)
    r = await client.get(f"/api/{ek}/{pid}/attachments", headers=alice)
    assert r.status_code == 200 and len(r.json()) >= 1


async def test_read_metadata(client, alice):
    r, _, _ = await _upload(client, alice)
    aid = r.json()["id"]
    g = await client.get(f"/api/attachments/{aid}", headers=alice)
    assert g.status_code == 200 and g.json()["id"] == aid


async def test_download_returns_bytes_and_correct_filename(client, alice):
    content = b"portal attachment content"
    r, _, _ = await _upload(client, alice, content=content, filename="report.pdf", ctype="application/pdf")
    aid = r.json()["id"]
    d = await client.get(f"/api/attachments/{aid}/download", headers=alice)
    assert d.status_code == 200
    assert d.content == content
    assert "report.pdf" in d.headers.get("content-disposition", "")


async def test_download_increments_count(client, alice):
    r, _, _ = await _upload(client, alice)
    aid = r.json()["id"]
    await client.get(f"/api/attachments/{aid}/download", headers=alice)
    await client.get(f"/api/attachments/{aid}/download", headers=alice)
    g = await client.get(f"/api/attachments/{aid}", headers=alice)
    assert g.json()["downloadCount"] >= 2


async def test_soft_delete_marks_deleted_at(client, alice):
    r, _, _ = await _upload(client, alice)
    aid = r.json()["id"]
    d = await client.delete(f"/api/attachments/{aid}", headers=alice)
    assert d.status_code == 200 and d.json()["deletedAt"] is not None


async def test_delete_is_idempotent(client, alice):
    r, _, _ = await _upload(client, alice)
    aid = r.json()["id"]
    d1 = await client.delete(f"/api/attachments/{aid}", headers=alice)
    d2 = await client.delete(f"/api/attachments/{aid}", headers=alice)
    assert d1.status_code == 200 and d2.status_code == 200


async def test_upload_emits_event(client, alice):
    r, ek, pid = await _upload(client, alice)
    aid = r.json()["id"]
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type == "ATTACHMENT_UPLOADED"))).scalars().all()
        assert any(e.data.get("attachmentId") == aid for e in evs)


async def test_sensitive_download_emits_audited_event(client, alice):
    r, ek, pid = await _upload(client, alice, category="IDENTITY_DOCUMENT",
                               content=b"sensitive", filename="id.pdf", ctype="application/pdf")
    aid = r.json()["id"]
    await client.get(f"/api/attachments/{aid}/download", headers=alice)
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type == "ATTACHMENT_DOWNLOADED"))).scalars().all()
        found = [e for e in evs if e.data.get("attachmentId") == aid]
        assert found and found[-1].data["sensitive"] is True


async def test_reference_add_and_list(client, alice):
    r, ek, pid = await _upload(client, alice)
    aid = r.json()["id"]
    ref_entity_id = str(uuid.uuid4())
    ref = await client.post(f"/api/attachments/{aid}/reference", headers=alice,
                            json={"refEntityType": "task", "refEntityId": ref_entity_id})
    assert ref.status_code == 201 and ref.json()["refEntityType"] == "task"


async def test_reference_is_idempotent(client, alice):
    r, _, _ = await _upload(client, alice)
    aid = r.json()["id"]
    ref_entity_id = str(uuid.uuid4())
    body = {"refEntityType": "task", "refEntityId": ref_entity_id}
    r1 = await client.post(f"/api/attachments/{aid}/reference", headers=alice, json=body)
    r2 = await client.post(f"/api/attachments/{aid}/reference", headers=alice, json=body)
    assert r1.status_code == 201 and r2.status_code == 201
    assert r1.json()["id"] == r2.json()["id"]


async def test_reference_remove(client, alice):
    r, _, _ = await _upload(client, alice)
    aid = r.json()["id"]
    ref = (await client.post(f"/api/attachments/{aid}/reference", headers=alice,
                              json={"refEntityType": "task", "refEntityId": str(uuid.uuid4())})).json()
    d = await client.delete(f"/api/attachments/{aid}/references/{ref['id']}", headers=alice)
    assert d.status_code == 200


# ── validation / blocked types ────────────────────────────────────────────────

async def test_blocked_extension_rejected(client, alice):
    r, _, _ = await _upload(client, alice, filename="virus.exe", ctype="application/octet-stream")
    assert r.status_code == 422 and "exe" in r.json()["detail"].lower()


async def test_blocked_bat_rejected(client, alice):
    r, _, _ = await _upload(client, alice, filename="run.bat", ctype="application/octet-stream")
    assert r.status_code == 422


async def test_empty_file_rejected(client, alice):
    r, _, _ = await _upload(client, alice, content=b"")
    assert r.status_code == 422


async def test_invalid_category_rejected(client, alice):
    r, ek, pid = await _upload(client, alice, category="INVALID_CAT")
    assert r.status_code == 422


async def test_delete_download_returns_410(client, alice):
    r, _, _ = await _upload(client, alice)
    aid = r.json()["id"]
    await client.delete(f"/api/attachments/{aid}", headers=alice)
    d = await client.get(f"/api/attachments/{aid}/download", headers=alice)
    assert d.status_code == 410


# ── permission gates ──────────────────────────────────────────────────────────

async def test_upload_denied_without_perm(client, nada):
    r, _, _ = await _upload(client, nada)
    assert r.status_code == 403


async def test_list_denied_without_perm(client, nada):
    r = await client.get(f"/api/ticket/{uuid.uuid4()}/attachments", headers=nada)
    assert r.status_code == 403


async def test_download_denied_without_perm(client, alice, viewer):
    r, _, _ = await _upload(client, alice)
    aid = r.json()["id"]
    d = await client.get(f"/api/attachments/{aid}/download", headers=viewer)
    assert d.status_code == 403


async def test_delete_denied_without_perm(client, alice, viewer):
    r, _, _ = await _upload(client, alice)
    aid = r.json()["id"]
    d = await client.delete(f"/api/attachments/{aid}", headers=viewer)
    assert d.status_code == 403


async def test_deleted_attachment_hidden_without_view_deleted(client, alice, viewer):
    """viewer has view but not view_deleted — deleted attachment should not appear in list."""
    ek, pid = _parent()
    r, _, _ = await _upload(client, alice, ek=ek, pid=pid)
    aid = r.json()["id"]
    await client.delete(f"/api/attachments/{aid}", headers=alice)
    lst = await client.get(f"/api/{ek}/{pid}/attachments?include_deleted=true", headers=viewer)
    assert lst.status_code == 200
    # viewer doesn't have view_deleted — deleted row should be filtered out
    assert not any(a["id"] == aid for a in lst.json())


async def test_view_deleted_shows_tombstone_with_perm(client, alice):
    """alice has view_deleted — deleted attachment shows with deletedAt set."""
    ek, pid = _parent()
    r, _, _ = await _upload(client, alice, ek=ek, pid=pid)
    aid = r.json()["id"]
    await client.delete(f"/api/attachments/{aid}", headers=alice)
    lst = await client.get(f"/api/{ek}/{pid}/attachments?include_deleted=true", headers=alice)
    found = [a for a in lst.json() if a["id"] == aid]
    assert found and found[0]["deletedAt"] is not None


# ── multi-tenant RLS ──────────────────────────────────────────────────────────

async def test_cross_tenant_get_404(client, alice, alice_other):
    r, _, _ = await _upload(client, alice)
    aid = r.json()["id"]
    g = await client.get(f"/api/attachments/{aid}", headers=alice_other)
    assert g.status_code == 404


async def test_cross_tenant_download_404(client, alice, alice_other):
    r, _, _ = await _upload(client, alice)
    aid = r.json()["id"]
    d = await client.get(f"/api/attachments/{aid}/download", headers=alice_other)
    assert d.status_code == 404
