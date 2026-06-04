"""Stage 2 remediation — H7 Configuration JSONB schema validation.

The audit flagged: the configurations router accepts ANY JSON for ANY key, so a typo
(string where a bool is expected, an overflowing int, …) silently lands in the JSONB
column. Stage 2 close registers a per-key schema and short-circuits to 422 on mismatch.

Properties covered here:
  * Unknown key (no schema registered) → 200, warning logged (CONFIG_SCHEMALESS_WRITE).
  * Invalid value (schema registered, value rejected) → 422 with the error message.
"""
import logging
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy_utils import Ltree

from app.db import OwnerSessionLocal
from app.models import Tenant, OrgNode, RoleDef, Assignment
from app.models.configuration import Configuration, ConfigurationHistory
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password
from app.services import config_schemas


_PROFILE_KEY = "cfg_schema_manager"
_USER_EMAIL = "cfg-schema@demo.isp"


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _wire_configurations_router():
    """Mount the configurations router so this test can run in isolation."""
    from app.main import app
    from app.routers import configurations as _cfg_router
    if not any(getattr(r, "tags", None) == ["configurations"] for r in app.routes):
        app.include_router(_cfg_router.router)
    yield


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_cfg_schema_user():
    """One config-manager user dedicated to this test module.

    Distinct role key + email from test_configurations.py so the two suites can run in any
    order without role-uniqueness collisions.
    """
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == tenant.id)
                           .order_by(OrgNode.path).limit(1)
        )).scalar_one_or_none()
        if root is None:
            root = OrgNode(tenant_id=tenant.id, type="Group", name="Root",
                           code="grpcs", path=Ltree("grpcs"))
            s.add(root); await s.flush()

        role = (await s.execute(
            select(RoleDef).where(RoleDef.tenant_id == tenant.id, RoleDef.key == _PROFILE_KEY)
        )).scalar_one_or_none()
        if role is None:
            role = RoleDef(tenant_id=tenant.id, key=_PROFILE_KEY, label=_PROFILE_KEY,
                           permissions=["configuration.manage"], scope="tenant")
            s.add(role); await s.flush()
        else:
            role.permissions = ["configuration.manage"]

        u = (await s.execute(
            select(User).where(User.tenant_id == tenant.id, User.email == _USER_EMAIL)
        )).scalar_one_or_none()
        if u is None:
            u = User(tenant_id=tenant.id, email=_USER_EMAIL, name="schema-cfg",
                     password_hash=hash_password("schema-123"), status="active")
            s.add(u); await s.flush()
        if not (await s.execute(
            select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant.id)
        )).scalar_one_or_none():
            s.add(Assignment(tenant_id=tenant.id, user_id=u.id, role_id=role.id,
                             node_id=root.id, region_scope="any"))
        await s.commit()

    yield

    async with OwnerSessionLocal() as s:
        u = (await s.execute(
            select(User).where(User.email == _USER_EMAIL)
        )).scalar_one_or_none()
        if u:
            # Configuration rows created during the test reference this user via
            # configuration.created_by (FK to app_user.id); ConfigurationHistory
            # references it via changed_by. Both must be deleted before the user
            # so the FK constraint doesn't block teardown. This is explicit test
            # cleanup — we do NOT add ON DELETE CASCADE to the FK because in
            # production these rows are operator-trail records that should
            # survive a user-account close-out (governance audit trail).
            await s.execute(
                ConfigurationHistory.__table__.delete()
                .where(ConfigurationHistory.changed_by == u.id)
            )
            await s.execute(
                Configuration.__table__.delete().where(Configuration.created_by == u.id)
            )
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id == u.id))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id == u.id))
            await s.execute(User.__table__.delete().where(User.id == u.id))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key == _PROFILE_KEY))
        await s.commit()


@pytest_asyncio.fixture
async def cfg_schema_user(client):
    r = await client.post("/auth/login", json={"email": _USER_EMAIL, "password": "schema-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ════════════════════════════════════════════════════════════════════════════
# 1. Unknown key (no schema registered) → 200 + CONFIG_SCHEMALESS_WRITE warning logged.
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_unknown_config_key_permits_with_warning(client, cfg_schema_user, caplog):
    """The schema registry ships empty by default. Writes against unregistered keys MUST
    still succeed (we don't want to block the world on the strict invariant) but they
    MUST log a CONFIG_SCHEMALESS_WRITE warning so SuperAdmin can see which keys still
    lack a schema."""
    key = f"unknown.key.{uuid.uuid4().hex[:8]}"
    assert key not in config_schemas.CONFIG_SCHEMAS  # precondition: not registered

    with caplog.at_level(logging.WARNING, logger="gaahex.configurations"):
        r = await client.post(
            "/api/configurations",
            headers=cfg_schema_user,
            json={
                "configurationKey": key,
                "scope": "TENANT",
                "configurationValue": {"anything": "goes"},
            },
        )
    assert r.status_code == 201, r.text
    # The warning message contains the literal key — find it in caplog.
    matching = [rec for rec in caplog.records
                if "CONFIG_SCHEMALESS_WRITE" in rec.getMessage() and key in rec.getMessage()]
    assert matching, (
        f"Expected CONFIG_SCHEMALESS_WRITE warning for key={key!r}; got: "
        f"{[r.getMessage() for r in caplog.records]}"
    )


# ════════════════════════════════════════════════════════════════════════════
# 2. Invalid value (schema registered, value rejected) → 422 with error msg.
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_invalid_config_value_rejected(client, cfg_schema_user):
    """Register a strict-bool schema dynamically against a fresh key, write a non-bool
    value, and expect 422 with the schema's error message. Then write a valid bool and
    expect 201 to prove the gate isn't over-blocking."""
    key = f"strict.bool.{uuid.uuid4().hex[:8]}"

    def _strict_bool(v):
        if isinstance(v, bool):
            return True, None
        return False, f"Expected boolean, got {type(v).__name__}"

    config_schemas.register_schema(key, _strict_bool)
    try:
        # 2a. Non-bool value → 422.
        bad = await client.post(
            "/api/configurations",
            headers=cfg_schema_user,
            json={
                "configurationKey": key,
                "scope": "TENANT",
                "configurationValue": "not-a-bool",
            },
        )
        assert bad.status_code == 422, bad.text
        assert "boolean" in bad.text.lower()

        # 2b. Valid bool → 201.
        good = await client.post(
            "/api/configurations",
            headers=cfg_schema_user,
            json={
                "configurationKey": key,
                "scope": "TENANT",
                "configurationValue": True,
            },
        )
        assert good.status_code == 201, good.text
        cfg_id = good.json()["id"]

        # 2c. PATCH with invalid value also rejected.
        bad_patch = await client.patch(
            f"/api/configurations/{cfg_id}",
            headers=cfg_schema_user,
            json={"configurationValue": 0},  # int 0, not a bool
        )
        assert bad_patch.status_code == 422, bad_patch.text
        assert "boolean" in bad_patch.text.lower()
    finally:
        config_schemas.unregister_schema(key)
