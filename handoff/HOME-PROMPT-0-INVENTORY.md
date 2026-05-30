# HOME-PROMPT-0-INVENTORY
## Workspace → Home Page: Complete Data Source Audit

**Execution Date:** 2026-05-30  
**Scope:** Current DashboardView + backend endpoints + design-system kit spec  
**Doctrine:** Every widget bound to real source; missing data → render nothing.

---

## 1. Current DashboardView Audit

### Widgets Present (Frontend: DashboardView.tsx, lines 69–339)

| Widget | Current State | Data Source | Status |
|--------|---------------|-------------|--------|
| **Active subscribers** KPI | `value: null` initially | `GET /api/subscriptions?status=ACTIVE` | WIRED: endpoint exists; DashboardView fetches it |
| **MRR** KPI | `value: null` initially | `GET /api/invoices?status=OPEN` | WIRED: endpoint exists; fetches & sums total |
| **Open tickets** KPI | `value: null` initially | `GET /api/work-items?status=OPEN` | WIRED: endpoint exists; counts array |
| **Network uptime** KPI | `unavailable: 'No uptime monitor wired yet'` | NONE — hardcoded stub | **NO SOURCE → render nothing** |
| **Revenue vs. churn** chart | Loading state, no data | `GET /api/metrics/revenue?range=${range}` | **NO SOURCE → endpoint does not exist** |
| **Recent activity** feed | Loading state, no data | `GET /api/audit/recent?limit=5` | PARTIAL: endpoint is `/api/activity` (path mismatch) |
| **Tickets needing attention** table | Loading state (first 4 rows) | `GET /api/work-items?limit=4` | WIRED: endpoint exists |

---

## 2. Inventory Table — Target State

### Real Data Source Mapping

| Widget | Endpoint / Query | Permission Required | Notes | Status |
|--------|------------------|---------------------|-------|--------|
| **Active Subscribers** | `GET /api/subscriptions?status=ACTIVE` | `subscription.view` | Backend: billing.py line 201; returns Subscription[] | ✅ EXISTS |
| **MRR** | `GET /api/invoices?status=OPEN` | `invoice.view` | Backend: billing.py; returns Invoice[] with .total (luma); sum all | ✅ EXISTS |
| **Open Tickets** | `GET /api/work-items?status=OPEN` | `workitem.view` | Backend: workitems.py line 94; returns WorkItem[] | ✅ EXISTS |
| **Network Uptime** | **NONE** | N/A | No backend model or endpoint exists | 🔴 NO SOURCE → REMOVE |
| **Revenue vs. Churn** (chart) | **NEEDS NEW ENDPOINT** | `analytics.view` | Not in backend; needs invoice aggregation (revenue + churn) by range | 🔴 NO ENDPOINT |
| **Recent Activity** | `GET /api/activity?limit=5` | Org-scoped | Backend: activity.py line 86; DashboardView uses wrong path `/api/audit/recent` | ⚠️ PATH WRONG |
| **Tickets Needing Attention** | `GET /api/work-items?limit=4` | `workitem.view` | Backend: workitems.py line 94; first 4 rows | ✅ EXISTS |

### Endpoint Details

**`GET /api/subscriptions`** (billing.py:201)
- Params: customer, status, limit, offset
- Returns: [Subscription] with id, customer_id, plan_name, amount, cycle, status, created_at
- Permission: subscription.view per org node

**`GET /api/invoices`** (billing.py:410+)
- Params: status, limit, offset
- Returns: [Invoice] with id, number, customer_id, status, total, issued_at, due_at
- Permission: invoice.view per org node
- For MRR: sum .total of status=OPEN invoices

**`GET /api/workitems`** (workitems.py:94)
- Params: status, assignee, mine, kind, scheduled_from, scheduled_to, limit, offset
- Returns: [WorkItem] with id, title, kind, status, priority, assigned_user_id, due_at, created_at
- Permission: workitem.view per org node

**`GET /api/activity`** (activity.py:86)
- Params: entity, record, limit
- Returns: Global feed by default: [{ id, type, entity_key, record_id, actor_user_id, actor_name, at, summary }]
- Permission: Org-scoped per record owner_node_id
- **ALERT:** DashboardView tries `/api/audit/recent` (wrong path)

**`GET /api/metrics/revenue`** (DOES NOT EXIST)
- Needed for: Revenue vs. Churn chart
- Suggested: Aggregate invoices by range (30d/qtd/ytd); return { values: [day1_rev, day2_rev, ...] }
- Where to add: New endpoint in reports.py or analytics.py

---

## 3. Button Inventory

| Button / Control | Destination | Status |
|------------------|-------------|--------|
| **30d / QTD / YTD** | Refetch revenue chart for selected range | ✅ WIRED (DashboardView lines 196–198) |
| **Configure page** | Opens Studio (if onGoStudio callback exists) | ✅ CONDITIONAL (line 200–203) |
| **Export** | Export dashboard data | 🔴 DEAD (no onClick handler, line 205) |
| **View all** (Tickets) | Navigate to full work-items list | 🔴 DEAD (no route, line 300) |

---

## 4. Permission Scoping

| Widget | Entity | Verb | Visibility Rule |
|--------|--------|------|-----------------|
| **Active subscribers** | subscription | view | Show if user can view any subscription |
| **MRR** | invoice | view | Show if user can view any invoice |
| **Open tickets** | workitem | view | Show if user can view any work-item |
| **Revenue chart** | analytics | (none) | Would be finance/admin only |
| **Activity feed** | (per record) | view | Org-scoped; filtered by caller's grants |
| **Needs attention** | workitem | view | Same as open tickets |

**ALERT:** DashboardView does NOT call `fetchCapabilities()`, so all widgets render regardless of role.

---

## 5. Hide-If-Missing Rules

| Widget | Missing Defined As | Behavior | Exception |
|--------|-------------------|----------|-----------|
| **Active Subscribers** | 404, 5xx, parse error | Render `—` + "Subscribers endpoint unreachable" | 200 with count=0 → show 0 |
| **MRR** | 404, 5xx, no .total | Render `—` + "No invoice data" | 200 with empty array → show $0 |
| **Open Tickets** | 404, 5xx, unparseable array | Render `—` + "Tickets endpoint unreachable" | 200 with empty array → show 0 |
| **Network Uptime** | No endpoint, hardcoded | Always `—` + "No uptime monitor wired yet" | Remove in P1 or defer to P2 |
| **Revenue Chart** | 404, 5xx, no .values | Show error stub; hint to wire `/api/metrics/revenue` | Implement endpoint in P1 or remove |
| **Activity Feed** | 404, 5xx, unparseable | Show error stub; hint message | Endpoint exists; fix fetch path |
| **Tickets Table** | 404, 5xx, unparseable | Show error stub | Empty array → "No open tickets." |

---

## 6. Loading / Error / Empty States

| Widget | Loading | Error | Empty |
|--------|---------|-------|-------|
| **All KPIs** | Skeleton bar CSS | `—` + unavailable hint | N/A |
| **Revenue chart** | "Loading…" text | Error stub + code hint | Shows error if no data |
| **Activity feed** | "Loading…" text | Error stub + hint | "No recent activity." |
| **Tickets table** | "Loading…" text | Error stub | "No open tickets." |

---

## 7. Risks + Open Questions for Gev

### Top 5 Blockers for P1

1. **Activity Feed Endpoint Path Mismatch**
   - DashboardView line 147: `/api/audit/recent` (404)
   - Correct: `/api/activity?limit=5`
   - **Action:** Fix fetch URL

2. **Revenue vs. Churn Chart — No Endpoint**
   - Frontend tries `/api/metrics/revenue`; always errors
   - **Decision:** P1 scope or defer to P2?

3. **Network Uptime KPI — No Source**
   - Kit shows it; no backend model; hardcoded unavailable message
   - **Decision:** Remove in P1 or defer?

4. **Permissions Not Enforced**
   - DashboardView doesn't call `fetchCapabilities()`; all widgets visible to all roles
   - **Decision:** P1 (wire capabilities check) or P2?

5. **Dead Buttons: Export + View All**
   - Export (line 205): no onClick
   - View All (line 300): no route
   - **Decision:** Remove now or implement?

---

**Widget Status Summary:**

| Category | Count | Action |
|----------|-------|--------|
| **Real data, ready** | 5 (subscribers, MRR, open tickets, activity, table) | Wire permissions; fix activity path |
| **No source, remove** | 1 (uptime KPI) | Delete or defer to P2 |
| **No endpoint, defer** | 1 (revenue chart) | Decide: P1 or P2 |
| **Dead buttons, remove** | 2 (export, view all) | Delete now or implement |

