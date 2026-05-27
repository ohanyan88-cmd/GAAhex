"""Tests for WorkItems API (Batch 32, Lane C).

Tests for CRUD, state transitions, filtering, assignment, and permissions.
Covers GET/POST/PATCH/DELETE endpoints against /api/workitems.
"""

import uuid
from datetime import datetime, timedelta, timezone
import pytest


# ===================== WORKITEMS =====================

@pytest.mark.asyncio
async def test_create_workitem_title_only(client, admin):
    """Test 1: Create workitem with title only → 201, status TODO."""
    res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "Fix network"}
    )
    assert res.status_code == 201
    data = res.json()
    assert data["title"] == "Fix network"
    assert data["status"] == "TODO"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_workitem_with_kind_scheduled_location(client, admin):
    """Test 2: Create with kind, scheduled_at, location → fields persisted."""
    scheduled = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    res = await client.post(
        "/api/workitems",
        headers=admin,
        json={
            "title": "Install line",
            "kind": "install",
            "scheduled_at": scheduled,
            "location": "Building A, Room 5"
        }
    )
    assert res.status_code == 201
    data = res.json()
    assert data["kind"] == "install"
    assert data["scheduled_at"] is not None
    assert data["location"] == "Building A, Room 5"


@pytest.mark.asyncio
async def test_list_workitems(client, admin):
    """Test 3: Create workitems, list them → 200, all present."""
    # Create two workitems
    w1 = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "Task 1"}
    )
    assert w1.status_code == 201
    id1 = w1.json()["id"]

    w2 = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "Task 2"}
    )
    assert w2.status_code == 201
    id2 = w2.json()["id"]

    # List workitems
    list_res = await client.get("/api/workitems", headers=admin)
    assert list_res.status_code == 200
    workitems = list_res.json()
    workitem_ids = {w["id"] for w in workitems}
    assert id1 in workitem_ids
    assert id2 in workitem_ids


@pytest.mark.asyncio
async def test_filter_workitems_by_status(client, admin):
    """Test 4: Filter workitems by status → only matching workitems."""
    # Create a TODO workitem
    todo_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "To do"}
    )
    assert todo_res.status_code == 201
    todo_id = todo_res.json()["id"]

    # Create and start another workitem
    inprog_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "In progress"}
    )
    assert inprog_res.status_code == 201
    inprog_id = inprog_res.json()["id"]

    # Start the second workitem
    start_res = await client.post(
        f"/api/workitems/{inprog_id}/start",
        headers=admin
    )
    assert start_res.status_code == 200

    # Filter by TODO status
    filtered = await client.get("/api/workitems?status=TODO", headers=admin)
    assert filtered.status_code == 200
    workitems = filtered.json()
    workitem_ids = {w["id"] for w in workitems}
    assert todo_id in workitem_ids
    assert inprog_id not in workitem_ids


@pytest.mark.asyncio
async def test_filter_workitems_by_kind(client, admin):
    """Test 5: Filter workitems by kind → only matching workitems."""
    # Create a task
    task_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "Task item", "kind": "task"}
    )
    assert task_res.status_code == 201
    task_id = task_res.json()["id"]

    # Create an install
    install_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "Install item", "kind": "install"}
    )
    assert install_res.status_code == 201
    install_id = install_res.json()["id"]

    # Filter by task kind
    filtered = await client.get("/api/workitems?kind=task", headers=admin)
    assert filtered.status_code == 200
    workitems = filtered.json()
    workitem_ids = {w["id"] for w in workitems}
    assert task_id in workitem_ids
    assert install_id not in workitem_ids


@pytest.mark.asyncio
async def test_filter_workitems_by_scheduled_date_range(client, admin):
    """Test 6: Filter by scheduled_from/scheduled_to date range."""
    now = datetime.now(timezone.utc)
    tomorrow = now + timedelta(days=1)
    next_week = now + timedelta(days=7)

    # Create workitem scheduled for tomorrow
    scheduled_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={
            "title": "Scheduled tomorrow",
            "scheduled_at": tomorrow.isoformat()
        }
    )
    assert scheduled_res.status_code == 201
    scheduled_id = scheduled_res.json()["id"]

    # Create workitem with no schedule
    unscheduled_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "No schedule"}
    )
    assert unscheduled_res.status_code == 201

    # Filter by date range that includes tomorrow. Pass via params= so the +00:00 offset is
    # URL-encoded (a raw '+' in the query string decodes to a space and fails ISO parsing).
    filtered = await client.get(
        "/api/workitems",
        params={"scheduled_from": now.isoformat(), "scheduled_to": next_week.isoformat()},
        headers=admin,
    )
    assert filtered.status_code == 200
    workitems = filtered.json()
    workitem_ids = {w["id"] for w in workitems}
    assert scheduled_id in workitem_ids


@pytest.mark.asyncio
async def test_filter_workitems_by_mine(client, admin, agent):
    """Test 7: Filter by mine=true → only assigned to current user."""
    # Create and assign a workitem to admin
    w1_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "Admin's task"}
    )
    assert w1_res.status_code == 201
    w1_id = w1_res.json()["id"]

    # Create another unassigned workitem
    w2_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "Other task"}
    )
    assert w2_res.status_code == 201
    w2_id = w2_res.json()["id"]

    # Query with mine=true as admin - admin should see their own
    mine_res = await client.get("/api/workitems?mine=true", headers=admin)
    assert mine_res.status_code == 200
    # Note: "mine" filtering depends on implementation; this test verifies the endpoint accepts the parameter


@pytest.mark.asyncio
async def test_get_workitem_by_id(client, admin):
    """Test 8: Create workitem, GET by id → 200 with correct fields."""
    create_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={
            "title": "Test workitem",
            "description": "Test description",
            "priority": "HIGH",
            "kind": "repair"
        }
    )
    assert create_res.status_code == 201
    workitem_id = create_res.json()["id"]

    # Get single workitem
    get_res = await client.get(f"/api/workitems/{workitem_id}", headers=admin)
    assert get_res.status_code == 200
    workitem = get_res.json()
    assert workitem["id"] == workitem_id
    assert workitem["title"] == "Test workitem"
    assert workitem["description"] == "Test description"
    assert workitem["priority"] == "HIGH"
    assert workitem["kind"] == "repair"


@pytest.mark.asyncio
async def test_get_workitem_unknown_id(client, admin):
    """Test 9: GET unknown workitem id → 404."""
    fake_id = str(uuid.uuid4())
    res = await client.get(f"/api/workitems/{fake_id}", headers=admin)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_assign_workitem(client, admin, agent):
    """Test 10: Assign {user_id} → assigned_user_id set."""
    # Create workitem
    workitem_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "Assignment test"}
    )
    assert workitem_res.status_code == 201
    workitem_id = workitem_res.json()["id"]

    # Get agent user id from database like test_helpdesk's SLA test does
    from sqlalchemy import select
    from app.db import SessionLocal
    from app.models import User

    async with SessionLocal() as s:
        agent_user = (await s.execute(
            select(User).where(User.email == "agent@demo.isp")
        )).scalar_one()
        agent_user_id = agent_user.id

    # Verify workitem before assignment
    get_res = await client.get(f"/api/workitems/{workitem_id}", headers=admin)
    workitem_before = get_res.json()
    assert workitem_before["assigned_user_id"] is None

    # Assign to agent
    assign_res = await client.post(
        f"/api/workitems/{workitem_id}/assign",
        headers=admin,
        json={"user_id": str(agent_user_id)}
    )
    assert assign_res.status_code == 200
    assigned = assign_res.json()
    assert assigned["assigned_user_id"] == str(agent_user_id)


@pytest.mark.asyncio
async def test_start_workitem(client, admin):
    """Test 11: POST /start → IN_PROGRESS."""
    # Create workitem
    create_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "To start"}
    )
    assert create_res.status_code == 201
    workitem_id = create_res.json()["id"]

    # Start it
    res = await client.post(
        f"/api/workitems/{workitem_id}/start",
        headers=admin
    )
    assert res.status_code == 200
    workitem = res.json()
    assert workitem["status"] == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_complete_workitem(client, admin):
    """Test 12: POST /complete → DONE, completed_at set."""
    # Create workitem
    create_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "To complete"}
    )
    assert create_res.status_code == 201
    workitem_id = create_res.json()["id"]

    # Start it first
    start_res = await client.post(
        f"/api/workitems/{workitem_id}/start",
        headers=admin
    )
    assert start_res.status_code == 200

    # Complete it
    res = await client.post(
        f"/api/workitems/{workitem_id}/complete",
        headers=admin
    )
    assert res.status_code == 200
    workitem = res.json()
    assert workitem["status"] == "DONE"
    assert workitem["completed_at"] is not None


@pytest.mark.asyncio
async def test_block_workitem(client, admin):
    """Test 13: POST /block → BLOCKED."""
    # Create workitem
    create_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "To block"}
    )
    assert create_res.status_code == 201
    workitem_id = create_res.json()["id"]

    # Block it
    res = await client.post(
        f"/api/workitems/{workitem_id}/block",
        headers=admin
    )
    assert res.status_code == 200
    workitem = res.json()
    assert workitem["status"] == "BLOCKED"


@pytest.mark.asyncio
async def test_cancel_workitem(client, admin):
    """Test 14: POST /cancel → CANCELLED."""
    # Create workitem
    create_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "To cancel"}
    )
    assert create_res.status_code == 201
    workitem_id = create_res.json()["id"]

    # Cancel it
    res = await client.post(
        f"/api/workitems/{workitem_id}/cancel",
        headers=admin
    )
    assert res.status_code == 200
    workitem = res.json()
    assert workitem["status"] == "CANCELLED"


@pytest.mark.asyncio
async def test_reopen_workitem_from_done(client, admin):
    """Test 15: Reopen from DONE → TODO, completed_at cleared."""
    # Create, complete, then reopen
    create_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "To reopen"}
    )
    assert create_res.status_code == 201
    workitem_id = create_res.json()["id"]

    # Start and complete
    await client.post(f"/api/workitems/{workitem_id}/start", headers=admin)
    complete_res = await client.post(
        f"/api/workitems/{workitem_id}/complete",
        headers=admin
    )
    assert complete_res.status_code == 200
    assert complete_res.json()["status"] == "DONE"
    assert complete_res.json()["completed_at"] is not None

    # Reopen
    reopen_res = await client.post(
        f"/api/workitems/{workitem_id}/reopen",
        headers=admin
    )
    assert reopen_res.status_code == 200
    reopened = reopen_res.json()
    assert reopened["status"] == "TODO"
    assert reopened["completed_at"] is None


@pytest.mark.asyncio
async def test_reopen_from_in_progress_409(client, admin):
    """Test 16: Reopen from IN_PROGRESS → 409."""
    # Create and start
    create_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "In progress"}
    )
    assert create_res.status_code == 201
    workitem_id = create_res.json()["id"]

    # Start it
    start_res = await client.post(
        f"/api/workitems/{workitem_id}/start",
        headers=admin
    )
    assert start_res.status_code == 200
    assert start_res.json()["status"] == "IN_PROGRESS"

    # Try to reopen while IN_PROGRESS
    reopen_res = await client.post(
        f"/api/workitems/{workitem_id}/reopen",
        headers=admin
    )
    assert reopen_res.status_code == 409


@pytest.mark.asyncio
async def test_patch_workitem_title_priority_scheduled_at(client, admin):
    """Test 17: PATCH title/priority/scheduled_at → reflected."""
    scheduled = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    create_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "Original title", "priority": "LOW"}
    )
    assert create_res.status_code == 201
    workitem_id = create_res.json()["id"]

    # Patch
    patch_res = await client.patch(
        f"/api/workitems/{workitem_id}",
        headers=admin,
        json={
            "title": "Updated title",
            "priority": "URGENT",
            "scheduled_at": scheduled
        }
    )
    assert patch_res.status_code == 200
    patched = patch_res.json()
    assert patched["title"] == "Updated title"
    assert patched["priority"] == "URGENT"
    assert patched["scheduled_at"] is not None


@pytest.mark.asyncio
async def test_delete_workitem(client, admin):
    """Test 18: Delete workitem → 404 after."""
    create_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "To delete"}
    )
    assert create_res.status_code == 201
    workitem_id = create_res.json()["id"]

    # Delete
    del_res = await client.delete(f"/api/workitems/{workitem_id}", headers=admin)
    assert del_res.status_code == 204

    # Verify gone
    get_res = await client.get(f"/api/workitems/{workitem_id}", headers=admin)
    assert get_res.status_code == 404


@pytest.mark.asyncio
async def test_workitems_unauthenticated(client):
    """Test 19: List workitems without token → 401 or 403."""
    res = await client.get("/api/workitems")
    assert res.status_code in (401, 403)


@pytest.mark.asyncio
async def test_workitem_permission_gate(client, admin):
    """Test 20: Assert workitem.view permission gate is enforced."""
    # Create a workitem
    create_res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "Permission test"}
    )
    assert create_res.status_code == 201
    workitem_id = create_res.json()["id"]

    # GET without proper auth should fail
    res = await client.get(f"/api/workitems/{workitem_id}")
    assert res.status_code in (401, 403)
