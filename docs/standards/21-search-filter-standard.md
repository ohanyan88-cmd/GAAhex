# Search & Filter Standard (file 21)

LOCKED. Resolves SOURCE NOT PROVIDED for **Search & Filter** (display-order #24; file 21). Written
code-accurate against `routers/search.py`, `models/saved_view.py`, `models/search_history.py`.

## 1. Global cross-entity search (`GET /api/search?q=`)
One query spans every entity the caller can view. It is **org-scope filtered exactly like the
records engine**: load grants + node paths once, gate each entity on `{key}.view`, gate each
record on `can(..., "view", record_path)`. Read-only; never leaks across tenant or scope.

## 2. Field-view redaction
Search uses the same `can_view_field` gate as the records engine: a field a caller's roles may not
see is **never** used as a label, snippet, or highlight source. Search can't be turned into a way
to read a value the record API would hide.

## 3. Matching + ranking
Match = case-insensitive substring over a record's **viewable** text-ish `data` values. Results
are ranked: a hit on the record's label (`name`/`title`/`subject`) outranks a body-only hit; an
exact whole-value label match tops it; more occurrences slightly outrank fewer (capped so count
can't dominate). Results are capped per entity and overall.

## 4. Response shapes (additive / non-breaking)
- **default** → grouped list: `[{entity_key, label_plural, route_slug, matches:[{…, highlight,
  score}]}]`, where `highlight` is a safe `<mark>`-wrapped snippet.
- **`?view=hits`** (or `?facets=true`) → a flat globally-ranked envelope
  `{query, total, hits:[...], facets:{by entity_key, by status}}`.
- **`?entity=<key|route_slug>`** scopes either shape to a single entity.

## 5. Saved views (`saved_view_def`)
A reusable list configuration for an entity: `entityKey, ownerUserId, name, config`.
- `config` = `{q?, filter?, sort?, columns?}` — the **same shape the list endpoint reads**.
- `ownerUserId = NULL` ⇒ a shared/tenant-wide view; otherwise it belongs to that user.

## 6. List filter/sort/columns
The list endpoint (`GET /api/{entity}`) takes the same `{q, filter, sort, columns}` config as a
saved view; all params are optional and backward-compatible. Sort places `null` values last;
list results are org-scope + field-redaction filtered identically to search.

## 7. Search history (`search_history`)
Per-user recent searches: `query, entity (optional scope), pinned, queried_at`. Newest-first by
`queried_at`; a user can pin an entry (`pinned=true`) so it survives the cap-based eviction that
trims unpinned rows to `RECENT_CAP`. Tenant- and user-scoped (RLS).

## 8. Cross-references
Org-scope + permission gating: Security/Permission Standard (file 17). Field redaction: file 17
§8. Entity/field definitions searched: `entity_def`/`field_def` (file 16/20).
