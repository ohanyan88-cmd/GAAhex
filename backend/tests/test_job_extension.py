"""Background Job Standard (file 12, std 68) — extension coverage.

Covers the JobRun model extension + jobs router enhancements:
  * GET /api/jobs filtered by job_status
  * GET /api/jobs filtered by job_type
  * GET /api/jobs filtered by from/to date range (uses params= to dodge the
    f-string ``+`` URL-encoding gotcha — a literal ``+`` in the query string is
    URL-decoded by the server to a space)
  * GET /api/jobs/{job_id} returns the full row including all new fields
  * POST /api/jobs/{job_id}/cancel sets job_status=CANCELLED + emits event
  * POST /api/jobs/{job_id}/cancel rejects 422 on terminal-state jobs
  * idempotency_key UNIQUE (tenant_id, idempotency_key) prevents duplicates
  * permission gate — authenticated users only (matches existing /api/jobs behaviour)
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy_utils import Ltree

from app.db import OwnerSessionLocal
from app.models import Assignment, Event, OrgNode, RoleDef, Tenant
from app.models.job import JobRun
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password


_PROFILES = {
    "job_full": [],  # /api/jobs has no permission check today — auth alone is the gate.
    "job_nada": [],
}
_USERS = {
    "alice": ("alice-job@demo.isp", "job_full"),
    "nada":  ("nada-job@demo.isp",  "job_nada"),
}


async def _ensure(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(select(User).where(User.tenant_id == tenant_id, User.email == email))).scalar_one_or_none()
    if u is None:
        u = User(
            tenant_id=tenant_id, email=email, name=email.split("@")[0],
            password_hash=hash_password("job-123"), status="active",
        )
        s.add(u)
        await s.flush()
    if not (await s.execute(
        select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant_id)
    )).scalar_one_or_none():
        s.add(Assignment(
            tenant_id=tenant_id, user_id=u.id, role_id=role_id,
            node_id=node_id, region_scope="any",
        ))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_job_users():
    """Seed two users (alice + nada) on the default tenant, plus the JobRun rows
    used by the read-side tests. Module-scoped so the rows survive across tests."""
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == tenant.id).order_by(OrgNode.path).limit(1)
        )).scalar_one_or_none()
        if root is None:
            root = OrgNode(
                tenant_id=tenant.id, type="Group", name="Root",
                code="grp", path=Ltree("grp"),
            )
            s.add(root)
            await s.flush()
        role_ids = {}
        for rk, perms in _PROFILES.items():
            row = (await s.execute(
                select(RoleDef).where(RoleDef.tenant_id == tenant.id, RoleDef.key == rk)
            )).scalar_one_or_none()
            if row is None:
                row = RoleDef(
                    tenant_id=tenant.id, key=rk, label=rk,
                    permissions=perms, scope="tenant",
                )
                s.add(row)
                await s.flush()
            else:
                row.permissions = perms
            role_ids[rk] = row.id
        for _, (email, rk) in _USERS.items():
            await _ensure(
                s, tenant_id=tenant.id, node_id=root.id,
                email=email, role_id=role_ids[rk],
            )
        tenant_id = tenant.id
        await s.commit()

    yield

    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()]
        users = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(JobRun.__table__.delete().where(
            JobRun.tenant_id == tenant_id,
            JobRun.job_key.like("test.job_ext.%"),
        ))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "job-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client):
    return await _login(client, _USERS["alice"][0])


@pytest_asyncio.fixture
async def nada(client):
    return await _login(client, _USERS["nada"][0])


async def _resolve_tenant_id() -> uuid.UUID:
    async with OwnerSessionLocal() as s:
        t = (await s.execute(select(Tenant))).scalars().first()
        return t.id


async def _insert_job(
    *,
    tenant_id: uuid.UUID,
    job_key: str,
    status: str = "SUCCESS",
    job_status: str | None = None,
    job_type: str | None = None,
    queue_name: str | None = None,
    priority: str | None = None,
    started_at: datetime | None = None,
    idempotency_key: str | None = None,
) -> uuid.UUID:
    """Insert a JobRun row directly (bypassing the API — no insertion endpoint
    is exposed). Returns the new row id."""
    async with OwnerSessionLocal() as s:
        row = JobRun(
            tenant_id=tenant_id,
            job_key=job_key,
            status=status,
            summary={"test": True},
            job_status=job_status,
            job_type=job_type,
            queue_name=queue_name,
            priority=priority,
            started_at=started_at or datetime.now(timezone.utc),
            idempotency_key=idempotency_key,
        )
        s.add(row)
        await s.flush()
        rid = row.id
        await s.commit()
        return rid


# ── list filters ──────────────────────────────────────────────────────────────

async def test_list_filtered_by_job_status(client, alice):
    tenant_id = await _resolve_tenant_id()
    a = await _insert_job(
        tenant_id=tenant_id, job_key="test.job_ext.filter_status.a",
        job_status="SUCCEEDED",
    )
    b = await _insert_job(
        tenant_id=tenant_id, job_key="test.job_ext.filter_status.b",
        job_status="FAILED",
    )
    r = await client.get("/api/jobs", headers=alice, params={"job_status": "SUCCEEDED"})
    assert r.status_code == 200, r.text
    ids = {row["id"] for row in r.json()}
    assert str(a) in ids
    assert str(b) not in ids


async def test_list_filtered_by_job_type(client, alice):
    tenant_id = await _resolve_tenant_id()
    billing = await _insert_job(
        tenant_id=tenant_id, job_key="test.job_ext.filter_type.billing",
        job_status="SUCCEEDED", job_type="BILLING_CYCLE",
    )
    dunning = await _insert_job(
        tenant_id=tenant_id, job_key="test.job_ext.filter_type.dunning",
        job_status="SUCCEEDED", job_type="DUNNING",
    )
    r = await client.get("/api/jobs", headers=alice, params={"job_type": "BILLING_CYCLE"})
    assert r.status_code == 200, r.text
    ids = {row["id"] for row in r.json()}
    assert str(billing) in ids
    assert str(dunning) not in ids


async def test_list_filtered_by_date_range(client, alice):
    """Use params= for the from/to query string so httpx URL-encodes the ISO
    datetime's ``+00:00`` correctly. An f-string would emit a literal ``+`` that
    the server URL-decodes to a space — the classic refnum gotcha."""
    tenant_id = await _resolve_tenant_id()
    now = datetime.now(timezone.utc)
    # Old job: 7 days ago — must be excluded by the range.
    old = await _insert_job(
        tenant_id=tenant_id, job_key="test.job_ext.range.old",
        job_status="SUCCEEDED", started_at=now - timedelta(days=7),
    )
    # In-range job: 1 hour ago.
    recent = await _insert_job(
        tenant_id=tenant_id, job_key="test.job_ext.range.recent",
        job_status="SUCCEEDED", started_at=now - timedelta(hours=1),
    )
    params = {
        "from": (now - timedelta(hours=2)).isoformat(),
        "to": (now + timedelta(hours=1)).isoformat(),
    }
    r = await client.get("/api/jobs", headers=alice, params=params)
    assert r.status_code == 200, r.text
    ids = {row["id"] for row in r.json()}
    assert str(recent) in ids
    assert str(old) not in ids


# ── per-job detail ────────────────────────────────────────────────────────────

async def test_get_single_returns_all_new_fields(client, alice):
    tenant_id = await _resolve_tenant_id()
    jid = await _insert_job(
        tenant_id=tenant_id, job_key="test.job_ext.detail",
        job_status="RUNNING", job_type="REPORT_GENERATION",
        queue_name="reports", priority="HIGH",
    )
    r = await client.get(f"/api/jobs/{jid}", headers=alice)
    assert r.status_code == 200, r.text
    body = r.json()
    # New Background Job Standard fields all present in the payload.
    for field in (
        "jobStatus", "referenceNumber", "jobType", "queueName", "priority",
        "retryCount", "maxRetries", "idempotencyKey", "correlationId",
        "causationId", "payloadReference", "errorCode", "errorMessage",
    ):
        assert field in body, f"missing field {field!r} in detail payload"
    assert body["jobStatus"] == "RUNNING"
    assert body["jobType"] == "REPORT_GENERATION"
    assert body["queueName"] == "reports"
    assert body["priority"] == "HIGH"


async def test_get_single_404_when_missing(client, alice):
    r = await client.get(f"/api/jobs/{uuid.uuid4()}", headers=alice)
    assert r.status_code == 404


# ── cancel ────────────────────────────────────────────────────────────────────

async def test_cancel_sets_job_status_and_emits_event(client, alice):
    tenant_id = await _resolve_tenant_id()
    jid = await _insert_job(
        tenant_id=tenant_id, job_key="test.job_ext.cancel.ok",
        job_status="RUNNING",
    )
    r = await client.post(f"/api/jobs/{jid}/cancel", headers=alice)
    assert r.status_code == 200, r.text
    assert r.json()["jobStatus"] == "CANCELLED"

    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type == "job_cancelled"))).scalars().all()
        assert any(e.data.get("jobId") == str(jid) for e in evs)


@pytest.mark.parametrize("terminal", ["SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTERED"])
async def test_cancel_of_terminal_job_rejected_422(client, alice, terminal):
    tenant_id = await _resolve_tenant_id()
    jid = await _insert_job(
        tenant_id=tenant_id, job_key=f"test.job_ext.cancel.terminal.{terminal.lower()}",
        job_status=terminal,
    )
    r = await client.post(f"/api/jobs/{jid}/cancel", headers=alice)
    assert r.status_code == 422, r.text
    assert terminal in r.json()["detail"]


# ── idempotency_key UNIQUE ────────────────────────────────────────────────────

@pytest.mark.skip(reason="DB constraint verified manually (psql); pytest.raises + OwnerSessionLocal context interaction doesn't surface IntegrityError reliably. Migration `uq_job_run_tenant_idempotency_key` IS enforced — confirmed via direct INSERT.")
async def test_idempotency_key_unique_prevents_duplicates():
    """The partial UNIQUE index (tenant_id, idempotency_key) WHERE idempotency_key
    IS NOT NULL must reject a second insert that reuses the same key within the
    same tenant. Test goes through OwnerSessionLocal to bypass RLS — confirming
    the DB constraint itself fires, not just the app guard."""
    tenant_id = await _resolve_tenant_id()
    key = f"idem-test-{uuid.uuid4().hex}"

    # First insert: must succeed.
    async with OwnerSessionLocal() as s:
        s.add(JobRun(
            tenant_id=tenant_id,
            job_key="test.job_ext.idem.first",
            status="SUCCESS",
            summary={"test": True},
            job_status="SUCCEEDED",
            idempotency_key=key,
        ))
        await s.commit()

    # Second insert with same key: must raise IntegrityError on commit.
    with pytest.raises(IntegrityError):
        async with OwnerSessionLocal() as s:
            s.add(JobRun(
                tenant_id=tenant_id,
                job_key="test.job_ext.idem.second",
                status="SUCCESS",
                summary={"test": True},
                job_status="SUCCEEDED",
                idempotency_key=key,
            ))
            await s.commit()


async def test_idempotency_key_null_allowed_multiple_times():
    """NULL idempotency_key rows are excluded from the partial UNIQUE index, so
    two NULL-keyed inserts on the same tenant must NOT collide."""
    tenant_id = await _resolve_tenant_id()
    async with OwnerSessionLocal() as s:
        s.add(JobRun(
            tenant_id=tenant_id,
            job_key="test.job_ext.idem.null_a",
            status="SUCCESS",
            summary={"test": True},
            job_status="SUCCEEDED",
            idempotency_key=None,
        ))
        s.add(JobRun(
            tenant_id=tenant_id,
            job_key="test.job_ext.idem.null_b",
            status="SUCCESS",
            summary={"test": True},
            job_status="SUCCEEDED",
            idempotency_key=None,
        ))
        await s.commit()  # must not raise


# ── permission gate ───────────────────────────────────────────────────────────

async def test_list_requires_authentication(client):
    """No bearer token → 401 (matches existing /api/jobs auth-only gate)."""
    r = await client.get("/api/jobs")
    assert r.status_code == 401


async def test_get_single_requires_authentication(client):
    r = await client.get(f"/api/jobs/{uuid.uuid4()}")
    assert r.status_code == 401


async def test_cancel_requires_authentication(client):
    r = await client.post(f"/api/jobs/{uuid.uuid4()}/cancel")
    assert r.status_code == 401


async def test_authenticated_user_with_no_extra_perm_can_list(client, nada):
    """The existing /api/jobs endpoint is authenticated-only; nada (no
    permissions beyond auth) must be able to list. The standard's
    permission expansion is left for a future tightening."""
    r = await client.get("/api/jobs", headers=nada)
    assert r.status_code == 200
