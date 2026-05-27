"""Calendar API tests (Batch 30).

Tests for calendars and calendar events. Tenant-scoped, RLS-enforced.
All operations emit audit Events through workflow.emit.
"""

import uuid
from datetime import datetime, timezone

import pytest


# ===================== CALENDARS =====================

@pytest.mark.asyncio
async def test_create_calendar(client, admin):
    """Test 1: Create calendar with name and color → 201."""
    res = await client.post(
        "/api/calendar/calendars",
        headers=admin,
        json={"name": "Work", "color": "#3A6FB5"}
    )
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "Work"
    assert data["color"] == "#3A6FB5"
    assert "id" in data


@pytest.mark.asyncio
async def test_list_calendars(client, admin):
    """Test 2: Create calendar, then list it → 200."""
    # Create a calendar
    create_res = await client.post(
        "/api/calendar/calendars",
        headers=admin,
        json={"name": "Personal", "color": "#FF5733"}
    )
    assert create_res.status_code == 201
    created_id = create_res.json()["id"]

    # List calendars
    list_res = await client.get("/api/calendar/calendars", headers=admin)
    assert list_res.status_code == 200
    calendars = list_res.json()
    ids = {c["id"] for c in calendars}
    assert created_id in ids


@pytest.mark.asyncio
async def test_create_calendar_missing_name(client, admin):
    """Test 3: Create calendar without name → 422."""
    res = await client.post(
        "/api/calendar/calendars",
        headers=admin,
        json={"color": "#fff"}
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_calendar_unauthenticated(client):
    """Test 4: Unauthenticated request to calendars → 401 or 403."""
    res = await client.post(
        "/api/calendar/calendars",
        json={"name": "Test", "color": "#3A6FB5"}
    )
    assert res.status_code in (401, 403)


# ===================== EVENTS =====================

@pytest.mark.asyncio
async def test_create_event(client, admin):
    """Test 5: Create event with title and start_at → 201."""
    res = await client.post(
        "/api/calendar/events",
        headers=admin,
        json={
            "title": "Meeting",
            "start_at": "2026-06-01T10:00:00Z"
        }
    )
    assert res.status_code == 201
    data = res.json()
    assert data["title"] == "Meeting"
    assert data["start_at"] == "2026-06-01T10:00:00+00:00"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_all_day_event(client, admin):
    """Test 6: Create all-day event with all_day=true → 201."""
    res = await client.post(
        "/api/calendar/events",
        headers=admin,
        json={
            "title": "Holiday",
            "start_at": "2026-06-15T00:00:00Z",
            "all_day": True
        }
    )
    assert res.status_code == 201
    data = res.json()
    assert data["title"] == "Holiday"
    assert data["all_day"] is True


@pytest.mark.asyncio
async def test_list_events(client, admin):
    """Test 7: Create 2 events, list them → 200, both present."""
    # Create first event
    evt1 = await client.post(
        "/api/calendar/events",
        headers=admin,
        json={"title": "Event 1", "start_at": "2026-06-01T10:00:00Z"}
    )
    assert evt1.status_code == 201
    id1 = evt1.json()["id"]

    # Create second event
    evt2 = await client.post(
        "/api/calendar/events",
        headers=admin,
        json={"title": "Event 2", "start_at": "2026-06-02T14:00:00Z"}
    )
    assert evt2.status_code == 201
    id2 = evt2.json()["id"]

    # List events
    list_res = await client.get("/api/calendar/events", headers=admin)
    assert list_res.status_code == 200
    events = list_res.json()
    event_ids = {e["id"] for e in events}
    assert id1 in event_ids
    assert id2 in event_ids


@pytest.mark.asyncio
async def test_filter_events_by_date_range(client, admin):
    """Test 8: Create events on June 1 and July 1, filter by June → only June event."""
    # Create June event
    june_evt = await client.post(
        "/api/calendar/events",
        headers=admin,
        json={"title": "June Event", "start_at": "2026-06-01T10:00:00Z"}
    )
    assert june_evt.status_code == 201

    # Create July event
    july_evt = await client.post(
        "/api/calendar/events",
        headers=admin,
        json={"title": "July Event", "start_at": "2026-07-01T10:00:00Z"}
    )
    assert july_evt.status_code == 201

    # Filter by June date range
    filtered = await client.get(
        "/api/calendar/events?start=2026-06-01&end=2026-06-30",
        headers=admin
    )
    assert filtered.status_code == 200
    events = filtered.json()
    titles = {e["title"] for e in events}
    assert "June Event" in titles
    assert "July Event" not in titles


@pytest.mark.asyncio
async def test_filter_events_by_calendar(client, admin):
    """Test 9: Create 2 calendars, 1 event each, filter by calendar_id."""
    # Create first calendar
    cal1_res = await client.post(
        "/api/calendar/calendars",
        headers=admin,
        json={"name": "Cal1", "color": "#AAA"}
    )
    assert cal1_res.status_code == 201
    cal1_id = cal1_res.json()["id"]

    # Create second calendar
    cal2_res = await client.post(
        "/api/calendar/calendars",
        headers=admin,
        json={"name": "Cal2", "color": "#BBB"}
    )
    assert cal2_res.status_code == 201
    cal2_id = cal2_res.json()["id"]

    # Create event in cal1
    evt1 = await client.post(
        "/api/calendar/events",
        headers=admin,
        json={
            "title": "Cal1 Event",
            "start_at": "2026-06-01T10:00:00Z",
            "calendar_id": cal1_id
        }
    )
    assert evt1.status_code == 201

    # Create event in cal2
    evt2 = await client.post(
        "/api/calendar/events",
        headers=admin,
        json={
            "title": "Cal2 Event",
            "start_at": "2026-06-02T10:00:00Z",
            "calendar_id": cal2_id
        }
    )
    assert evt2.status_code == 201

    # Filter by cal1_id
    filtered = await client.get(
        f"/api/calendar/events?calendar={cal1_id}",
        headers=admin
    )
    assert filtered.status_code == 200
    events = filtered.json()
    titles = {e["title"] for e in events}
    assert "Cal1 Event" in titles
    assert "Cal2 Event" not in titles


@pytest.mark.asyncio
async def test_get_single_event(client, admin):
    """Test 10: Create event, GET /events/{id} → 200 with correct fields."""
    # Create event
    create_res = await client.post(
        "/api/calendar/events",
        headers=admin,
        json={
            "title": "Single Event",
            "start_at": "2026-06-05T15:30:00Z",
            "description": "A test event",
            "location": "Room 42"
        }
    )
    assert create_res.status_code == 201
    event_id = create_res.json()["id"]

    # Get single event
    get_res = await client.get(f"/api/calendar/events/{event_id}", headers=admin)
    assert get_res.status_code == 200
    event = get_res.json()
    assert event["id"] == event_id
    assert event["title"] == "Single Event"
    assert event["description"] == "A test event"
    assert event["location"] == "Room 42"


@pytest.mark.asyncio
async def test_patch_event(client, admin):
    """Test 11: Create event, PATCH to change title → 200."""
    # Create event
    create_res = await client.post(
        "/api/calendar/events",
        headers=admin,
        json={"title": "Original Title", "start_at": "2026-06-10T09:00:00Z"}
    )
    assert create_res.status_code == 201
    event_id = create_res.json()["id"]

    # Patch event
    patch_res = await client.patch(
        f"/api/calendar/events/{event_id}",
        headers=admin,
        json={"title": "Updated"}
    )
    assert patch_res.status_code == 200
    updated = patch_res.json()
    assert updated["title"] == "Updated"
    assert updated["id"] == event_id


@pytest.mark.asyncio
async def test_delete_event(client, admin):
    """Test 12: Create event, DELETE it → 200 {ok:true}, then GET → 404."""
    # Create event
    create_res = await client.post(
        "/api/calendar/events",
        headers=admin,
        json={"title": "To Delete", "start_at": "2026-06-12T11:00:00Z"}
    )
    assert create_res.status_code == 201
    event_id = create_res.json()["id"]

    # Delete event
    del_res = await client.delete(f"/api/calendar/events/{event_id}", headers=admin)
    assert del_res.status_code == 200
    assert del_res.json() == {"ok": True}

    # Verify it's gone
    get_res = await client.get(f"/api/calendar/events/{event_id}", headers=admin)
    assert get_res.status_code == 404


@pytest.mark.asyncio
async def test_create_event_missing_title(client, admin):
    """Test 13: Create event without title → 422."""
    res = await client.post(
        "/api/calendar/events",
        headers=admin,
        json={"start_at": "2026-06-01T10:00:00Z"}
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_events_unauthenticated(client):
    """Test 14: Unauthenticated request to events → 401 or 403."""
    res = await client.get("/api/calendar/events")
    assert res.status_code in (401, 403)
