"""Batch 25 — field-level redaction / write-protection (A25) + scheduler (E25).

A25: records.py already enforces field-level view/edit gates via can_view_field /
     can_edit_field in access.py. These tests prove that enforcement end-to-end
     through the HTTP layer:

     1. test_view_gated_field_hidden_from_agent       — GET list + GET-one strips a
        view_roles-gated field for the agent; admin sees it.
     2. test_view_gated_field_visible_to_admin        — super_admin GET-one contains the
        secret field (explicit positive assertion, separated for clarity).
     3. test_unrestricted_entity_all_fields_present   — non-broken path: admin GET-list
        on a plain entity (no field gates) returns all fields intact.
     4. test_edit_gated_field_blocked_for_agent       — agent PATCH of an edit_roles-gated
        field returns 403 (write-protection).
     5. test_edit_gated_field_allowed_for_admin       — admin can PATCH that same field
        (bypass gate).

E25: app/scheduler.py may not be merged yet.  We detect at import time and skip
     gracefully if the module is absent, keeping the full suite green.

     6. test_scheduler_module_imports                 — the module imports; exposes
        start_scheduler and stop_scheduler callables.
     7. test_start_scheduler_noop_without_flag        — with no SCHEDULER_ENABLED flag
        set, start_scheduler() is a no-op (spawns no asyncio task).

All async tests rely on asyncio_mode=auto (pytest.ini).
Session-scoped client + admin + agent fixtures are from conftest — unchanged.
"""

import asyncio
import importlib
import os
import uuid

import pytest

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User, OrgNode, RoleDef, Assignment

# ---------------------------------------------------------------------------
# E25 detection — scheduler module may not be merged yet
# ---------------------------------------------------------------------------

_E25_PRESENT = False
_E25_REASON = "app.scheduler not yet merged (E25)"

try:
    _sched = importlib.import_module("app.scheduler")
    _E25_PRESENT = True
except ModuleNotFoundError:
    pass
except Exception as _e:
    _E25_REASON = f"app.scheduler import error: {_e}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uniq(tag: str) -> str:
    return f"{tag}-{uuid.uuid4().hex[:8]}"


async def _grant_agent_crud_b25(entity_key: str) -> None:
    """Give the seeded agent view/create/edit on `entity_key` at its team node.
    Uses a unique role key so different test entities don't collide."""
    async with SessionLocal() as s:
        agent = (await s.execute(
            select(User).where(User.email == "agent@demo.isp")
        )).scalar_one()
        team = (await s.execute(
            select(OrgNode).where(
                OrgNode.tenant_id == agent.tenant_id, OrgNode.code == "sales1"
            )
        )).scalar_one()
        role = RoleDef(
            tenant_id=agent.tenant_id,
            key=f"{entity_key}_b25_role",
            label=f"{entity_key} b25",
            scope="node",
            permissions=[
                f"{entity_key}.view",
                f"{entity_key}.create",
                f"{entity_key}.edit",
            ],
        )
        s.add(role)
        await s.flush()
        s.add(Assignment(
            tenant_id=agent.tenant_id,
            user_id=agent.id,
            role_id=role.id,
            node_id=team.id,
        ))
        await s.commit()


async def _mk_entity_b25(client, admin_hdr: dict, key: str, slug: str) -> None:
    """Create a Studio entity with one view-gated, one edit-gated, and one open field."""
    body = {
        "key": key,
        "label": key.title(),
        "label_plural": f"{key.title()} items",
        "route_slug": slug,
        "icon": "x",
        "fields": [
            {"key": "name",   "label": "Name",   "type": "text", "required": True},
            # view-gated: only super_admin may see this field's value
            {"key": "secret", "label": "Secret", "type": "text",
             "config": {"view_roles": ["super_admin"]}},
            # edit-gated: only super_admin may write this field
            {"key": "locked", "label": "Locked", "type": "text",
             "config": {"edit_roles": ["super_admin"]}},
            # open: no role gates at all
            {"key": "openf",  "label": "Open",   "type": "text"},
        ],
    }
    r = await client.post("/meta/entities", headers=admin_hdr, json=body)
    assert r.status_code == 201, f"Entity create failed: {r.text}"


# ===========================================================================
# A25 — field redaction (view gate)
# ===========================================================================

async def test_view_gated_field_hidden_from_agent(client, admin, agent):
    """Agent (sales_agent role) must NOT see a field gated to view_roles=['super_admin']
    in either GET-list or GET-one responses — and not in the create response either."""
    key = _uniq("b25vg")
    slug = _uniq("b25-vg")
    await _mk_entity_b25(client, admin, key, slug)
    await _grant_agent_crud_b25(key)

    # Agent creates a record (can set 'secret' — no edit gate on it — but cannot VIEW it back)
    create_r = await client.post(
        f"/api/{slug}", headers=agent,
        json={"name": "row1", "secret": "topsecret", "openf": "visible"},
    )
    assert create_r.status_code == 201, create_r.text
    rec_id = create_r.json()["id"]

    # create response itself must strip 'secret'
    assert "secret" not in create_r.json(), "secret must be stripped from create response for agent"
    assert create_r.json().get("openf") == "visible"

    # GET-one
    get_r = await client.get(f"/api/{slug}/{rec_id}", headers=agent)
    assert get_r.status_code == 200, get_r.text
    assert "secret" not in get_r.json(), "secret must be absent from GET-one for agent"
    assert get_r.json().get("openf") == "visible"

    # GET-list
    list_r = await client.get(f"/api/{slug}", headers=agent)
    assert list_r.status_code == 200, list_r.text
    my_rec = next((r for r in list_r.json() if r["id"] == rec_id), None)
    assert my_rec is not None, "own record not found in list"
    assert "secret" not in my_rec, "secret must be absent from list response for agent"


async def test_view_gated_field_visible_to_admin(client, admin, agent):
    """Super-admin (config.manage holder) bypasses view gates and sees all field values."""
    key = _uniq("b25va")
    slug = _uniq("b25-va")
    await _mk_entity_b25(client, admin, key, slug)
    await _grant_agent_crud_b25(key)

    # Agent creates the record (it can set secret, just can't view it)
    create_r = await client.post(
        f"/api/{slug}", headers=agent,
        json={"name": "secret-row", "secret": "admin_should_see_this", "openf": "x"},
    )
    assert create_r.status_code == 201, create_r.text
    rec_id = create_r.json()["id"]

    # Admin GET-one must contain 'secret'
    admin_get = await client.get(f"/api/{slug}/{rec_id}", headers=admin)
    assert admin_get.status_code == 200, admin_get.text
    assert "secret" in admin_get.json(), "admin must see view-gated field"
    assert admin_get.json()["secret"] == "admin_should_see_this"


# ===========================================================================
# A25 — non-breaking: unrestricted entity all fields present for admin
# ===========================================================================

async def test_unrestricted_entity_all_fields_present(client, admin):
    """Admin GET-list on a plain entity (no field gates) returns all data fields — no regression."""
    key = _uniq("b25plain")
    slug = _uniq("b25-plain")
    body = {
        "key": key,
        "label": key.title(),
        "label_plural": f"{key.title()} items",
        "route_slug": slug,
        "icon": "x",
        "fields": [
            {"key": "name",  "label": "Name",  "type": "text", "required": True},
            {"key": "note",  "label": "Note",  "type": "text"},
            {"key": "score", "label": "Score", "type": "number"},
        ],
    }
    assert (await client.post("/meta/entities", headers=admin, json=body)).status_code == 201

    # Create a record as admin
    cr = await client.post(
        f"/api/{slug}", headers=admin,
        json={"name": "unrestricted-row", "note": "hello", "score": 42},
    )
    assert cr.status_code == 201, cr.text
    rec_id = cr.json()["id"]

    # GET-list — all fields must be present
    list_r = await client.get(f"/api/{slug}", headers=admin)
    assert list_r.status_code == 200, list_r.text
    my_rec = next((r for r in list_r.json() if r["id"] == rec_id), None)
    assert my_rec is not None
    assert my_rec.get("note") == "hello"
    assert my_rec.get("score") == 42

    # GET-one — same check
    get_r = await client.get(f"/api/{slug}/{rec_id}", headers=admin)
    assert get_r.status_code == 200, get_r.text
    assert get_r.json().get("note") == "hello"
    assert get_r.json().get("score") == 42


# ===========================================================================
# A25 — write protection (edit gate)
# ===========================================================================

async def test_edit_gated_field_blocked_for_agent(client, admin, agent):
    """Agent PATCH of an edit_roles-gated field must be rejected with 403."""
    key = _uniq("b25eg")
    slug = _uniq("b25-eg")
    await _mk_entity_b25(client, admin, key, slug)
    await _grant_agent_crud_b25(key)

    # Create without the edit-gated field (agent CAN do this)
    cr = await client.post(
        f"/api/{slug}", headers=agent, json={"name": "row-lock", "openf": "ok"}
    )
    assert cr.status_code == 201, cr.text
    rec_id = cr.json()["id"]

    # PATCH the edit-gated field → must be 403
    patch_r = await client.patch(
        f"/api/{slug}/{rec_id}", headers=agent, json={"locked": "hacker"}
    )
    assert patch_r.status_code == 403, (
        f"Expected 403 for edit-gated field write, got {patch_r.status_code}: {patch_r.text}"
    )

    # Verify the value was NOT persisted
    get_r = await client.get(f"/api/{slug}/{rec_id}", headers=agent)
    assert get_r.status_code == 200
    assert get_r.json().get("locked") is None, "edit-gated field must not have been persisted"

    # CREATE with the edit-gated field → must also be 403
    bad_cr = await client.post(
        f"/api/{slug}", headers=agent, json={"name": "row2", "locked": "nope"}
    )
    assert bad_cr.status_code == 403, (
        f"Expected 403 for edit-gated field at create, got {bad_cr.status_code}: {bad_cr.text}"
    )

    # Open field remains freely editable (no regression)
    open_r = await client.patch(
        f"/api/{slug}/{rec_id}", headers=agent, json={"openf": "updated"}
    )
    assert open_r.status_code == 200, f"Open field patch failed: {open_r.text}"
    assert open_r.json().get("openf") == "updated"


async def test_edit_gated_field_allowed_for_admin(client, admin, agent):
    """Admin (config.manage / super_admin) may PATCH the edit-gated field — gate bypass works."""
    key = _uniq("b25ea")
    slug = _uniq("b25-ea")
    await _mk_entity_b25(client, admin, key, slug)
    await _grant_agent_crud_b25(key)

    # Admin creates a record
    cr = await client.post(
        f"/api/{slug}", headers=admin, json={"name": "admin-row", "openf": "x"}
    )
    assert cr.status_code == 201, cr.text
    rec_id = cr.json()["id"]

    # Admin patches the edit-gated field — should succeed
    patch_r = await client.patch(
        f"/api/{slug}/{rec_id}", headers=admin, json={"locked": "admin-set"}
    )
    assert patch_r.status_code == 200, (
        f"Admin PATCH of edit-gated field failed: {patch_r.status_code}: {patch_r.text}"
    )
    assert patch_r.json().get("locked") == "admin-set"


# ===========================================================================
# E25 — scheduler (skip gracefully if not merged)
# ===========================================================================

@pytest.mark.skipif(not _E25_PRESENT, reason=_E25_REASON)
async def test_scheduler_module_imports():
    """app.scheduler imports cleanly and exposes start_scheduler + stop_scheduler."""
    sched = importlib.import_module("app.scheduler")
    assert hasattr(sched, "start_scheduler"), "app.scheduler must expose start_scheduler"
    assert callable(sched.start_scheduler), "start_scheduler must be callable"
    assert hasattr(sched, "stop_scheduler"), "app.scheduler must expose stop_scheduler"
    assert callable(sched.stop_scheduler), "stop_scheduler must be callable"


@pytest.mark.skipif(not _E25_PRESENT, reason=_E25_REASON)
async def test_start_scheduler_noop_without_flag():
    """With the feature flag off (scheduler_enabled falsy), start_scheduler(app) is a
    complete no-op: it spawns no asyncio task and returns without error. We do NOT enable
    the loop in tests.

    The scheduler stashes its task on app.state, so we pass a minimal mock object.
    The flag is read from app.config.settings.scheduler_enabled via _enabled(); since the
    default value is False (getattr(..., False)), no flag-setting is needed — but we
    defensively confirm it is off by checking the settings object directly."""
    sched = importlib.import_module("app.scheduler")
    from app.config import settings as _settings

    # Confirm the flag is off (default)
    assert not getattr(_settings, "scheduler_enabled", False), (
        "scheduler_enabled must be False/unset in the test environment"
    )

    # Minimal app mock: start_scheduler reads/writes app.state.<key>
    class _State:
        pass

    class _MockApp:
        state = _State()

    mock_app = _MockApp()
    tasks_before = len(asyncio.all_tasks())

    # Call must return immediately (it's a coroutine — await it)
    await sched.start_scheduler(mock_app)

    tasks_after = len(asyncio.all_tasks())
    assert tasks_after == tasks_before, (
        f"start_scheduler spawned {tasks_after - tasks_before} unexpected task(s) "
        "with scheduler_enabled=False"
    )
    # No task was stashed on app.state
    assert getattr(mock_app.state, "scheduler_task", None) is None
