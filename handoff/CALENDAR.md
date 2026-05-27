# Calendar — Handoff (Batch 30)

This document covers GAAex's calendar system: how calendars are created and shared, how events
are managed, and how the frontend renders a month and week view.

---

## 1. Overview

The calendar system allows users to create named calendars (personal or shared), add events to them,
and view them in a month or week layout. Calendars are tenant-scoped; each user can create their own
calendars and optionally share them with the organization.

---

## 2. Data Models

### UserCalendar

**Model:** `backend/app/models/calendar.py:UserCalendar`

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Tenant scope |
| `owner_node_id` | UUID | Org node (for access control); nullable |
| `created_by_id` | UUID | User who created the calendar; nullable |
| `name` | String(160) | Display name (required) |
| `color` | String(20) | Hex color code; default `#3A6FB5` (cobalt) |
| `is_shared` | Boolean | If true, visible to entire tenant; default false |
| `created_at` | DateTime | Server timestamp |

### CalendarEvent

**Model:** `backend/app/models/calendar.py:CalendarEvent`

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Tenant scope |
| `owner_node_id` | UUID | Org node; nullable |
| `calendar_id` | UUID | Which calendar this event belongs to; nullable |
| `created_by_id` | UUID | User who created the event; nullable |
| `title` | String(255) | Event name (required) |
| `start_at` | DateTime | Event start time (required, ISO string with timezone) |
| `end_at` | DateTime | Event end time; nullable, must be >= start_at if provided |
| `all_day` | Boolean | If true, time portion is ignored in display; default false |
| `description` | Text | Optional event details |
| `location` | String(255) | Optional location |
| `color` | String(20) | Hex override; if null, inherits from calendar color |
| `created_at` | DateTime | Server timestamp |

---

## 3. API Endpoints

### GET /api/calendar/calendars

Retrieve all calendars for this tenant.

**Auth:** Any authenticated user (no specific permission gate).

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Work Calendar",
    "color": "#3A6FB5",
    "is_shared": true,
    "created_by_id": "uuid or null",
    "created_at": "2026-05-27T10:30:00+00:00"
  }
]
```

<!-- TODO: update after A30 — confirm endpoint is implemented in backend/app/routers/calendar.py -->

### POST /api/calendar/calendars

Create a new calendar.

**Auth:** Any authenticated user.

**Request Body:**
```json
{
  "name": "Project X",
  "color": "#C5A059",
  "is_shared": false
}
```

**Validation:**
- `name` required, non-empty string.
- `color` optional, defaults to `#3A6FB5`.
- `is_shared` optional, defaults to false.

**Behavior:**
- Sets `created_by_id` to the current user's ID.
- Sets `owner_node_id` to the user's primary node.
- Emits audit event: `entity="calendar"`, `type="create"`.

**Response:** 201, serialized calendar (same shape as GET response).

<!-- TODO: update after A30 — confirm audit emission and response shape -->

### GET /api/calendar/events

Retrieve events for a time range.

**Auth:** Any authenticated user.

**Query Parameters:**

| Parameter | Type | Notes |
|-----------|------|-------|
| `calendar` | UUID | Optional; filter by calendar_id |
| `start` | String | Optional ISO date (YYYY-MM-DD); filter start_at >= start |
| `end` | String | Optional ISO date (YYYY-MM-DD); filter start_at <= end |
| `limit` | Integer | Default 100; max results returned |

**Response:**
```json
[
  {
    "id": "uuid",
    "title": "Team standup",
    "start_at": "2026-05-27T09:00:00+00:00",
    "end_at": "2026-05-27T09:30:00+00:00",
    "all_day": false,
    "description": "Daily sync",
    "location": "Conference room A",
    "color": null,
    "calendar_id": "uuid",
    "created_by_id": "uuid or null",
    "created_at": "2026-05-27T08:00:00+00:00"
  }
]
```

**Order:** Ascending by `start_at`.

<!-- TODO: update after A30 — confirm filtering logic and pagination -->

### POST /api/calendar/events

Create a new event.

**Auth:** Any authenticated user.

**Request Body:**
```json
{
  "title": "All-hands meeting",
  "start_at": "2026-05-27T14:00:00+00:00",
  "end_at": "2026-05-27T15:00:00+00:00",
  "all_day": false,
  "description": "Quarterly company update",
  "location": "Main auditorium",
  "color": "#E63946",
  "calendar_id": "uuid or null"
}
```

**Validation:**
- `title` required, non-empty.
- `start_at` required, ISO datetime string.
- `end_at` optional; if provided, must be >= start_at. Returns 422 if not.
- `all_day` optional, defaults to false.
- Other fields optional.

**Behavior:**
- Sets `created_by_id` to current user, `owner_node_id` to user's primary node.
- Emits audit event: `entity="calendar_event"`, `type="create"`.

**Response:** 201, serialized event.

<!-- TODO: update after A30 — confirm validation errors (422) and audit event -->

### GET /api/calendar/events/{event_id}

Retrieve a single event.

**Auth:** Any authenticated user.

**Response:** Serialized event (same shape as POST response) or 404 if not found.

### PATCH /api/calendar/events/{event_id}

Update an event (partial).

**Auth:** Any authenticated user (reads owner_node_id from event; should add permission check).

**Request Body:**
```json
{
  "title": "Updated meeting",
  "start_at": "2026-05-28T14:00:00+00:00",
  "end_at": "2026-05-28T14:30:00+00:00"
}
```

**Validation:**
- Any field provided is validated as in POST (title non-empty, end_at >= start_at, etc.).
- Omitted fields are left unchanged.

**Behavior:**
- Emits audit event: `entity="calendar_event"`, `type="update"`, with `{"changed": {...}}` payload
  indicating which fields were modified.

**Response:** 200, serialized updated event.

<!-- TODO: update after A30 — confirm changed field tracking in audit event -->

### DELETE /api/calendar/events/{event_id}

Delete an event.

**Auth:** Any authenticated user (should check owner_node_id permission).

**Response:** 200 with `{"ok": true}`.

**Behavior:**
- Emits audit event: `entity="calendar_event"`, `type="delete"`.

<!-- TODO: update after A30 — confirm soft-delete vs hard delete, audit behavior -->

---

## 4. Permission Model

Calendar access is currently **open to any authenticated user** — no granular permission gates
are implemented in A30. Tenant isolation is enforced via RLS on both tables (NULLIF-guarded
`tenant_isolation` policy on `user_calendar` and `calendar_event`).

**Future:** Add permission checks per `owner_node_id` (creator can edit/delete own events;
shared calendars visible to tenant).

---

## 5. Frontend — CalendarView

**File:** `frontend/src/CalendarView.tsx` (B30/C30)

<!-- TODO: update after B30 — confirm file exists and structure matches below -->

### Overview

CalendarView is a React component that renders a calendar in either **month view** or **week view**.
Users can navigate between months/weeks, create/edit/delete events, and toggle which calendars are visible.

### Month View

The month view is a 7-column grid (Mon–Sun):
- **Rows:** 4–6 depending on the month, padded to align weeks.
- **Day cells:** Show the date number and event chips (colored, truncated, max 3 per cell with "+N more").
- **Current month days:** Full opacity; other-month days: faded (0.6 opacity).
- **Today's date:** Highlighted with `var(--accent)` color and bold text.
- **Current day cell:** Background `var(--accent-soft)` with `var(--accent)` border.

#### Day Cell Layout

```
┌─────────────────────┐
│ 27                  │  (date, small, muted if other month; bold + accent if today)
├─────────────────────┤
│ [Event 1 chip]      │  (event title, 11px, colored by event.color or calendar.color)
│ [Event 2 chip]      │
│ [+3 more]           │  (if more than 3 events)
└─────────────────────┘
```

#### Event Chip Styling

- **Background:** Inherits from `event.color` (if set) or `calendar.color` (fallback) or
  `var(--primary-soft)` (default).
- **Text:** `var(--text)` (or white if background is dark enough).
- **Font:** 11px, weight 500, ellipsis truncation.
- **Click:** Opens event detail/edit modal.

#### Navigation

- **Prev/Next buttons:** Move month backward/forward (wraps year boundary).
- **Today button:** Jump to current month.
- **Month/Week toggle:** Select which view to display.

### Week View

The week view is a 7-column card layout (one column per day):
- **Width:** Each column is equal width (grid layout).
- **Day header:** Day name (abbreviated) and date number (16px, bold if today).
- **Events:** Listed vertically in chronological order, same chip styling as month view.
- **Click:** On empty area, opens event create modal pre-filled with that date.

#### Week Navigation

- **Prev/Week Next buttons:** Move one week backward/forward.
- **Range label:** Shows the week date range (e.g., "26 May – 1 Jun 2026").

### Event Modal

Triggered by:
1. **New Event button** in nav bar (creates new event for today).
2. **Clicking a day cell** in month or week view (pre-fills date).
3. **Clicking an event chip** (opens existing event for editing).

#### Modal Title

- `"Edit event"` if editing an existing event.
- `"New event"` if creating.

#### Fields

| Field | Type | Notes |
|-------|------|-------|
| Title | Text input | Required, non-empty |
| Date | Date input | Pre-filled from clicked day |
| Start time | Time input | Hidden if all_day is true |
| End time | Time input | Hidden if all_day is true |
| All day | Checkbox | Toggles time input visibility |
| Description | Textarea | Optional, 3 rows |
| Calendar | Select | Choose which calendar to assign the event |
| Color | Color swatch buttons | 6 predefined colors; overrides calendar color |

#### Color Swatches

Six color buttons (24px circles), each clickable to select:
- `#3A6FB5` (cobalt) — default
- `#C5A059` (gold)
- `#2ECC71` (green)
- `#E63946` (red)
- `#F5A623` (orange)
- `#AEB7C2` (slate)

**Selected state:** `outline: 2px solid var(--accent); outline-offset: 2px`

#### Modal Footer

- **Delete button** (left, only if editing): `btn-danger btn-sm` → opens confirmation → DELETE event.
- **Cancel button** (center): Close modal without saving.
- **Save button** (right): POST (new) or PATCH (edit) the event, then reload and close.

### Calendar Sidebar

**Left sidebar (200px):**
- **Month label:** Current month/year, bold.
- **Calendar list:** Checkboxes for each calendar with colored dot (left of name).
  - Toggling controls visibility in the grid.
  - Check toggle status in localStorage (future: save to backend).
- **+ New Calendar button:** Ghost style, opens calendar create modal.

<!-- TODO: update after B30 — confirm sidebar implementation and localStorage behavior -->

### Data Loading

On component mount and when `year`, `month`, `calView`, or `weekStart` change:
1. Fetch `GET /api/calendar/calendars` → populate sidebar.
2. Fetch `GET /api/calendar/events?start=...&end=...&limit=500` → populate grid.
   - **Month view:** `start` = 1st of month, `end` = last day of month.
   - **Week view:** `start` = first day of week, `end` = last day of week.

### Event Color Precedence

When rendering an event chip:
1. Use `event.color` if set.
2. Else, use `calendar.color` (from the calendar the event belongs to).
3. Else, default to `var(--primary-soft)`.

---

## 6. Code → Doc Summary

| Endpoint | Method | Auth | Route | Status |
|----------|--------|------|-------|--------|
| `/api/calendar/calendars` | GET | (any) | calendar.py | <!-- TODO: A30 --> |
| `/api/calendar/calendars` | POST | (any) | calendar.py | <!-- TODO: A30 --> |
| `/api/calendar/events` | GET | (any) | calendar.py | <!-- TODO: A30 --> |
| `/api/calendar/events` | POST | (any) | calendar.py | <!-- TODO: A30 --> |
| `/api/calendar/events/{event_id}` | GET | (any) | calendar.py | <!-- TODO: A30 --> |
| `/api/calendar/events/{event_id}` | PATCH | (any) | calendar.py | <!-- TODO: A30 --> |
| `/api/calendar/events/{event_id}` | DELETE | (any) | calendar.py | <!-- TODO: A30 --> |

**Frontend (B30/C30):**

| Component | File | Status |
|-----------|------|--------|
| CalendarView (month + week) | frontend/src/CalendarView.tsx | <!-- TODO: B30 + C30 --> |
| Event modal | (inline in CalendarView) | <!-- TODO: B30 --> |
| Calendar sidebar | (inline in CalendarView) | <!-- TODO: B30 --> |

---

## 7. Key Algorithms & Conventions

### Month Grid Calculation

The month view renders a 7-column grid aligned to weeks (Monday through Sunday):

```
1. Find the 1st day of the month.
2. Determine the day of the week (0 = Sunday; 6 = Saturday).
3. Pad before: if Monday is day 1, insert 0 blanks; if Tuesday, insert 1 blank, etc.
4. Add all days 1 through month_length.
5. Pad after: fill remaining cells to complete the last week (multiples of 7).
6. Split into rows of 7 (each row is a week).
```

Result: 4–6 rows depending on the month and starting day.

### Week Range Calculation

When in week view, derive the Monday of the week containing today:

```
today = new Date()
dayOfWeek = today.getDay()  // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1  // days since Monday
weekStart = new Date(today)
weekStart.setDate(today.getDate() - daysBack)
```

Then navigate backward/forward by ±7 days.

### Event-to-Calendar Color Binding

When rendering an event:
```
color = event.color
      || (cals.find(c => c.id === event.calendar_id)?.color)
      || "#3A6FB5"  // or var(--primary-soft) for CSS vars
```

---

## 8. Deferred Features (Future Work)

**Recurring events:** Events repeat on a schedule (daily, weekly, monthly). Requires a `recurrence_rule`
field (iCalendar RRULE format) and backend expansion of recurring instances at query time.

**Drag-to-reschedule:** UI for dragging event chips to a new date/time. Requires frontend gesture handling
and PATCH endpoint with transactional safety.

**Attendees & RSVP:** Associate users with events, track RSVP status (yes, no, maybe). Requires new
`event_attendee` table and notification flow.

**iCal import/export:** Import `.ics` files, export calendars as iCal format. Requires iCal parser
and serializer library (e.g., `ics` npm package).

**Time-grid week view:** Replace 7-column card layout with a true time grid (hours down the left,
7 columns for days, event blocks positioned by hour). Requires hourly row structure and complex layout math.

**Reminders & notifications:** Notify users before an event (15 min, 1 hour, 1 day). Requires
`event_reminder` table and background job for triggering notifications.

**Calendar sharing & permissions:** Granular controls (owner, editor, viewer). Requires a new
`calendar_share` table linking users/org nodes and roles.

**Search:** Find events by title, description, location. Can be added to the existing search system
(currently handles org nodes, records).

---

## 9. Run & Verify

```bash
# Prerequisites
docker compose up -d                                   # Postgres(:5433) + Redis(:6380)
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8099

# Swagger UI
# http://127.0.0.1:8099/docs  →  look for /api/calendar/* endpoints

# Type-check frontend
cd frontend && npx tsc --noEmit

# Manual: list calendars
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8099/api/calendar/calendars

# Manual: create a calendar
curl -X POST http://127.0.0.1:8099/api/calendar/calendars \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Personal","color":"#3A6FB5","is_shared":false}'

# Manual: list events for May 2026
curl -H "Authorization: Bearer <token>" \
  "http://127.0.0.1:8099/api/calendar/events?start=2026-05-01&end=2026-05-31&limit=500"

# Manual: create an event
curl -X POST http://127.0.0.1:8099/api/calendar/events \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Team meeting",
    "start_at": "2026-05-27T14:00:00+00:00",
    "end_at": "2026-05-27T15:00:00+00:00",
    "all_day": false,
    "description": "Weekly sync"
  }'

# Manual: update an event (replace event_id with real UUID)
curl -X PATCH http://127.0.0.1:8099/api/calendar/events/{event_id} \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated title"}'

# Manual: delete an event
curl -X DELETE http://127.0.0.1:8099/api/calendar/events/{event_id} \
  -H "Authorization: Bearer <token>"
```

---

## 10. Horizon & Notes

**A30 Status:** Models and migration complete. Router implementation pending.

**B30 Status:** CalendarView component (month view) pending.

**C30 Status:** Week view toggle pending (depends on B30).

All endpoints emit audit Events via `workflow.emit`. All dates are ISO 8601 strings with timezone info.
Frontend requests include `Authorization: Bearer ${token}` header (token from React context or localStorage).

Calendar events are not currently linked to WorkItems or Records — they stand alone. Future integration
could tie events to work schedules and record lifecycles.

RLS is enabled on both tables (`user_calendar` and `calendar_event`); all queries are automatically
scoped to the current tenant via the `gaaex.tenant_id` session setting.
