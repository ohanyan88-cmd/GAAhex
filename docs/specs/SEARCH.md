# Search & Discovery — Handoff (D27)

The search system consists of three coordinated layers: global cross-entity search, search assist infrastructure (saved/recent/pinned), and the command palette UI that surfaces everything. All are strictly scoped by tenant + org-node access control.

---

## 1. Global Cross-Entity Search

**Endpoint:** `GET /api/search?q=&limit=`

### Parameters

- `q` (optional): free-text query (case-insensitive substring match over record data)
- `limit` (optional, default=20): cap on total matches across all entities; per-entity ceiling is 5 by default

### Response Shape

Returns an array of **entity groups**, each containing:

```json
[
  {
    "entity_key": "lead",
    "label_plural": "Leads",
    "route_slug": "leads",
    "matches": [
      {
        "id": "<uuid>",
        "status": "NEW" | null,
        "label": "<human-readable name>",
        "snippet": "<120-char context window around match, trimmed>"
      }
    ]
  },
  ...
]
```

### Matching & Ranking

1. **Blanks return nothing:** `q=""` or missing `q` returns `[]` (never dumps the full DB)
2. **Text matching:** case-insensitive substring search over every text-ish field in `data` (excludes status/id fields). Same matching rule as the records engine (`_matches_q`).
3. **Ranking within entity:** records whose name/title/subject field contains the query sort first (natural creation order preserved within tie). Uses internal `_label_hit` field (stripped from response) to rank.
4. **Grouping & capping:** results grouped by entity in EntityDef order; per-entity max is 5 hits; overall max respects the `limit` parameter.

### Scope & Security

**Hard guarantee:** never leaks across tenant or org-scope boundaries.

- **Tenant isolation:** loads grants for caller only; respects `tenant_id` filter on all queries
- **Entity-level gate:** skips any entity where `can(grants, entity_key, "view")` is false (default-deny)
- **Per-record scope:** each record is gated on `can(grants, entity_key, "view", record_path)` using the record's `owner_node_id` and org-node tree
- **No field redaction yet:** all text fields in matching records are searchable (field-level access control is tracked as G61 horizon item)

Implementation lives in `backend/app/routers/search.py` (A27). The engine loads org-node paths once per request for efficient scope lookup.

---

## 2. Search Assist — Saved Views, Recent, Pinned, Suggestions

**Status:** SavedView infrastructure complete; suggest/recent/pinned in the UI layer are not yet wired to dedicated backend endpoints.

### Saved Views

**Endpoints:**
- `GET /api/views?entity=<key>` — list caller's views + shared (tenant-wide) views for one entity
- `POST /api/views` — create a new saved view
- `PATCH /api/views/{id}` — update own view (name or config)
- `DELETE /api/views/{id}` — delete own view

**Model:** `SavedViewDef` in `backend/app/models/saved_view.py`

```python
class SavedViewDef:
    id: UUID
    tenant_id: UUID
    owner_user_id: UUID | None       # None = shared/tenant-wide; else the owner
    entity_key: str                   # "lead", "ticket", etc.
    name: str                          # e.g. "My Q1 Leads"
    config: dict                       # {q?, filter?, sort?, columns?}
    created_at: datetime
```

**Config shape** (mirrors list endpoint params):
- `q` (optional): search string
- `filter` (optional): GXL expression (evaluated strict fail-closed per-record)
- `sort` (optional): field name or `-field` for descending; missing values sort last
- `columns` (optional): array of field keys to show (UI projection, not yet in list endpoint)

**Access control:**
- Create/list gated on entity `view` permission
- Update/delete: **owner-only** (non-owner or shared views → 404)
- Shared views (`owner_user_id=NULL`) are read-only and visible to everyone in the tenant with entity `view` permission

Implementation lives in `backend/app/routers/views.py` and `backend/app/models/saved_view.py`.

---

## 3. Search Assist — Recent / Pinned / Suggestions

**Status:** Fully implemented backend. UI wiring (command-palette dropdown) is in-progress.

### Recent Search History

**Endpoints:**
- `GET /api/recent-searches?limit=` — list caller's history, newest-first (max 50)
- `POST /api/recent-searches` — record a query after execution (`{query, entity?}`)
- `PATCH /api/recent-searches/{id}` — pin or unpin an entry (`{pinned: bool}`)
- `DELETE /api/recent-searches/{id}` — delete one entry

**Model:** `SearchHistory` in `backend/app/models/search_history.py`

**Ring-buffer eviction:** unpinned rows beyond `RECENT_CAP=50` are pruned on each `POST` call (oldest first). Pinned rows are exempt and kept until explicitly deleted or unpinned then evicted.

### Suggestions

**Endpoint:** `GET /api/search/suggest?q=`

Merges three sources (up to `SUGGEST_CAP=10` total):
1. **Saved search names/queries** — prefix match on name or query text
2. **Recent queries** — prefix match on query text (deduped against saved)
3. **Record labels** — prefix match against `name/title/subject` fields across entities (capped at 5, only when `q` is non-empty)

Empty `q` returns the user's most-recent queries as warm suggestions. Each result carries a `kind` field (`"saved"` | `"recent"` | `"record"`) so the UI can style and route them differently.

Implementation: `backend/app/routers/search_assist.py` (register before `records.router` in `main.py`).

---

## 4. Command Palette UI

**Component:** `frontend/src/CommandPalette.tsx`

The command palette is a ⌘K / Ctrl+K overlay that combines navigation and search in a single unified interface.

### Behavior

- **Keyboard-driven:** Up/Down to navigate, Enter to select, Esc to close
- **Live debounced search:** 200ms debounce on typing; calls `GET /api/search?q=<query>`
- **Two item types:**
  1. **Search results** (from `/api/search`): grouped by entity, each match shows label + snippet
  2. **Navigation items** (filtered by query): 
     - Built-in routes: Org tree, Dashboards, Reports, Messages, Studio (if user can configure)
     - All entities: Leads, Customers, Tickets, etc. (as defined in config)

### Response Rendering

The component does NOT apply custom HTML sanitization on snippets; it trusts the backend to return safe plaintext. The snippet field is returned as a substring extract with window trimming (`…` prefix if truncated), safe for direct render.

### Item Layout

Items are rendered in groups:
- **Search Result groups:** entity name as group header (e.g. "Leads", "Customers")
- **Navigation group:** labeled "Go to"

Within each group, items maintain a single running index for keyboard navigation; mouse hover syncs to keyboard state.

---

## 5. Highlighting, Faceting, Advanced Filtering

**Status:** Foundational only; advanced features in horizon.

### Highlighting

The `snippet` field in search results is a pre-computed context window (120 chars) around the first matching text, trimmed with `…` prefix if truncated from the start. No server-side HTML markup; the frontend renders plaintext directly.

Future enhancements (G66):
- Rich HTML snippets with `<mark>` tags around the match (requires safe sanitization on the UI)
- Byte-offset highlights for structured fields

### Faceting

No dedicated facet endpoint yet. Future (G67):
- Per-entity facet counts (e.g. "Status: NEW (5), CONTACTED (3), CLOSED (2)")
- Facet filtering UI in the command palette or dedicated search page

### Advanced Filtering

Saved views support a `filter` field (GXL expression on each record); full query-builder UI is G65 (not yet wired).

---

## 6. Storage Design

Two tables back the search assist layer:

| Table | Purpose |
|-------|---------|
| `saved_view_def` | Saved searches (reused with `entity_key='__search__'` sentinel; `config` holds `{q, entity?}`) |
| `search_history` | Per-user recent/pinned history with `queried_at` + `pinned` columns |

Using `saved_view_def` for saved searches avoids a schema change and keeps the auth/ownership model consistent with entity saved views. The `search_history` table was introduced for recent/pinned because `SavedViewDef` has no `queried_at` or eviction logic.

---

## 7. Code→Doc Summary

| Feature | Backend | Frontend | Tests | Status |
|---------|---------|----------|-------|--------|
| Cross-entity search (`GET /api/search`) | `search.py` (A27) | `CommandPalette.tsx` | `test_global_search.py` | ✅ Complete |
| Saved views CRUD (`/api/views`) | `views.py` + `SavedViewDef` | (stored in views, not UI yet) | `test_search.py` | ✅ Complete |
| Saved searches (`/api/saved-searches`) | `search_assist.py` | (UI in progress) | `test_search.py` | ✅ Backend complete |
| Recent history (`/api/recent-searches`) | `search_assist.py` + `SearchHistory` | (UI in progress) | `test_search.py` | ✅ Backend complete |
| Suggestions (`/api/search/suggest`) | `search_assist.py` | `crossSearch` adapter | `test_search.py` | ✅ Backend complete |
| Field-level redaction in search | — | — | — | Horizon (G61) |
| Faceted filtering UI | — | — | — | Horizon (G67) |
| Search analytics | — | — | — | Horizon (G70) |

---

## 8. Horizon & Future Work

**Query builder (G65):** Dedicated UI to build filters visually; no backend changes needed (uses existing GXL filter field on SavedView).

**Cross-entity dedup/ranking tuning (G66–G67):** Current search ranks within entity; future work would merge and deduplicate across entities, with tunable scoring (e.g. "weight Leads higher than Tickets").

**Search analytics (G70):** Track popular queries, user search patterns, and result click-through rates for insights. Would require a new `SearchQuery` event type in the audit log.

---

## Test Coverage

All features are tested:

- **test_global_search.py:** cross-entity grouping, scope isolation, tenant isolation, limit capping, blank query behavior
- **test_search.py:** saved view CRUD, ownership rules, permission gating (entity + field), view route shadowing (must not be shadowed by generic records router)

---

## Run & Verify

```bash
# Start backend + frontend
docker compose up -d
cd backend && python -m uvicorn app.main:app --port 8099

# In browser, press ⌘K / Ctrl+K to open the command palette
# Type to search across all entities
# Create and save views via the entity list UI (future: dedicated saved-view management page)
```

Swagger docs: http://127.0.0.1:8099/docs → `/api/search`, `/api/views`
