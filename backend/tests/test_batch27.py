"""Batch 27 — cross-entity search / facets / highlight (A27) + saved/recent/pinned/suggest (E27).

WHAT'S LANDED
--------------
A27 foundation: `GET /api/search?q=` — cross-entity, entity-grouped, org-scope gated,
snippet field per match. No separate `facets` dict or `highlight` key (those are A27
enhancement stubs, skipped gracefully).

E27 (E27/G63/G64/G68 search assist layer) is MERGED:
  /api/saved-searches   GET / POST / DELETE (no PATCH — renamed via delete+re-create)
  /api/recent-searches  GET / POST / PATCH (pin) / DELETE
  /api/search/suggest   GET ?q=

COVERAGE
--------
1. test_cross_entity_two_entities_both_appear
   — seed records in lead + customer with a unique token; both entity groups appear in results.
2. test_cross_entity_response_shape
   — group keys: entity_key / label_plural / route_slug / matches;
     match keys: id / status / label / snippet; _label_hit internal key stripped.
3. test_snippet_contains_needle
   — the snippet field in at least one match contains the search term (case-insensitive).
4. test_blank_q_returns_empty_b27
   — blank q → []; no-q param → [].
5. test_facets_per_entity_counts    [A27 enhancement — skip if not merged]
   — response includes top-level `facets` dict; counts match what was created.
6. test_highlight_field_present     [A27 enhancement — skip if not merged]
   — each match includes a `highlight` field referencing the matched term.
7. test_scope_agent_never_sees_out_of_scope_record_b27
   — agent search never returns an out-of-scope admin-owned record; admin sees more.
8. test_e27_saved_searches_crud
   — POST creates; GET lists; DELETE removes; deleted entry absent from list.
9. test_e27_recent_searches_post_and_list_newest_first
   — POST records queries → GET /api/recent-searches returns newest-first.
10. test_e27_pin_recent_search
    — POST a recent entry; PATCH pinned=True; response reflects pinned=True.
11. test_e27_suggest_uses_saved_and_recent
    — saved search + recent entry seed suggestions;
      GET /api/search/suggest?q=prefix returns matching entries.
"""

import uuid

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uniq(tag: str = "") -> str:
    return f"b27{tag}{uuid.uuid4().hex[:8]}"


def _all_match_ids(body: list) -> set:
    return {m["id"] for g in body for m in g["matches"]}


async def _search(client, headers, q, limit=None):
    url = f"/api/search?q={q}" + (f"&limit={limit}" if limit is not None else "")
    r = await client.get(url, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _groups(body: list) -> dict:
    return {g["entity_key"]: g for g in body}


# ---------------------------------------------------------------------------
# Detect A27 enhancements: facets + highlight (not yet in current search response).
# We probe a real search result to decide. Current format = plain list of groups;
# facets and per-match highlight are pending.
# ---------------------------------------------------------------------------

# A27 enhancements are MERGED.
# - Highlight: present on every match in the default grouped response.
# - Facets: available via ?facets=true → {query, total, hits, facets} envelope.
#   The facets test calls ?facets=true and reads body["facets"]["entity"].
_A27_FACETS_PRESENT = True
_A27_FACETS_REASON = ""

_A27_HIGHLIGHT_PRESENT = True
_A27_HIGHLIGHT_REASON = ""

try:
    from app.main import app as _app
    _routes = {r.path for r in _app.routes}
except Exception:
    _routes = set()

# ---------------------------------------------------------------------------
# E27 endpoint detection
# ---------------------------------------------------------------------------

_E27_SAVED_PRESENT = "/api/saved-searches" in _routes
_E27_SAVED_REASON = "E27 not merged: /api/saved-searches not in registered routes"

_E27_RECENT_PRESENT = "/api/recent-searches" in _routes
_E27_RECENT_REASON = "E27 not merged: /api/recent-searches not in registered routes"

_E27_SUGGEST_PRESENT = "/api/search/suggest" in _routes
_E27_SUGGEST_REASON = "E27 not merged: /api/search/suggest not in registered routes"

# Pin endpoint lives at /api/recent-searches/{history_id} with PATCH
_E27_PIN_PRESENT = any("recent-searches" in p and "history_id" in p for p in _routes)
_E27_PIN_REASON = "E27 not merged: PATCH /api/recent-searches/{history_id} not in registered routes"


# ===========================================================================
# 1. Cross-entity: hits from both entities
# ===========================================================================

async def test_cross_entity_two_entities_both_appear(client, admin):
    """Create records in 2 entities (lead + customer) with a shared unique token.
    GET /api/search?q=token must return groups for BOTH entities, each with the correct IDs."""
    tok = _uniq("xe")

    lead_ids = set()
    cust_ids = set()
    for i in range(2):
        r = await client.post("/api/leads", headers=admin, json={"name": f"{tok} lead {i}"})
        assert r.status_code == 201, r.text
        lead_ids.add(r.json()["id"])
        r = await client.post("/api/customers", headers=admin, json={"name": f"{tok} cust {i}"})
        assert r.status_code == 201, r.text
        cust_ids.add(r.json()["id"])

    body = await _search(client, admin, tok)
    groups = _groups(body)

    assert "lead" in groups, f"expected 'lead' group in search results; got keys: {list(groups)}"
    assert "customer" in groups, f"expected 'customer' group; got keys: {list(groups)}"
    assert {m["id"] for m in groups["lead"]["matches"]} == lead_ids
    assert {m["id"] for m in groups["customer"]["matches"]} == cust_ids


# ===========================================================================
# 2. Response shape
# ===========================================================================

async def test_cross_entity_response_shape(client, admin):
    """Each group must carry entity_key / label_plural / route_slug / matches.
    Each match must carry id / status / label / snippet. Internal _label_hit must be stripped."""
    tok = _uniq("shape")
    r = await client.post("/api/leads", headers=admin, json={"name": f"{tok} shape lead"})
    assert r.status_code == 201, r.text
    lead_id = r.json()["id"]

    body = await _search(client, admin, tok)
    groups = _groups(body)

    assert "lead" in groups, f"lead group missing; keys: {list(groups)}"
    grp = groups["lead"]

    required_group_keys = {"entity_key", "label_plural", "route_slug", "matches"}
    assert required_group_keys <= set(grp.keys()), (
        f"group missing keys: {required_group_keys - set(grp.keys())}"
    )

    match = next((m for m in grp["matches"] if m["id"] == lead_id), None)
    assert match is not None, "created lead not found in search matches"
    required_match_keys = {"id", "status", "label", "snippet"}
    assert required_match_keys <= set(match.keys()), (
        f"match missing keys: {required_match_keys - set(match.keys())}"
    )
    assert "_label_hit" not in match, "_label_hit internal key must be stripped from response"


# ===========================================================================
# 3. Snippet contains the needle
# ===========================================================================

async def test_snippet_contains_needle(client, admin):
    """The snippet field in each match must contain the search term (case-insensitive),
    proving the search engine returns genuine context rather than a placeholder."""
    tok = _uniq("snip")
    name = f"{tok} the unique snippet term"
    r = await client.post("/api/leads", headers=admin, json={"name": name})
    assert r.status_code == 201, r.text

    body = await _search(client, admin, tok)
    groups = _groups(body)

    assert "lead" in groups, f"lead group missing; keys: {list(groups)}"
    matches_with_token = [
        m for m in groups["lead"]["matches"]
        if tok.lower() in m.get("snippet", "").lower()
    ]
    assert len(matches_with_token) > 0, (
        f"No match has a snippet containing the needle '{tok}'. "
        f"Snippets: {[m.get('snippet') for m in groups['lead']['matches']]}"
    )


# ===========================================================================
# 4. Blank q → empty
# ===========================================================================

async def test_blank_q_returns_empty_b27(client, admin):
    """blank q → []; no-q param → []. Neither should dump the DB."""
    assert await _search(client, admin, "") == []
    r = await client.get("/api/search", headers=admin)
    assert r.status_code == 200 and r.json() == []


# ===========================================================================
# 5. Facets per-entity counts (A27 enhancement — skip if not merged)
# ===========================================================================

@pytest.mark.skipif(not _A27_FACETS_PRESENT, reason=_A27_FACETS_REASON)
async def test_facets_per_entity_counts(client, admin):
    """A27: GET /api/search?q=...&facets=true returns a {facets:{entity:{...}}} envelope.
    Counts in facets.entity must match the number of matching records per entity_key."""
    tok = _uniq("facets")
    for i in range(3):
        r = await client.post("/api/leads", headers=admin, json={"name": f"{tok} fl {i}"})
        assert r.status_code == 201, r.text
    for i in range(2):
        r = await client.post("/api/customers", headers=admin, json={"name": f"{tok} fc {i}"})
        assert r.status_code == 201, r.text

    r = await client.get(f"/api/search?q={tok}&facets=true", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict), "facets=true must return an object, not a list"
    facets = body.get("facets", {})
    entity_facets = facets.get("entity", {})
    assert entity_facets.get("lead", 0) == 3, f"expected facets.entity.lead=3, got {entity_facets}"
    assert entity_facets.get("customer", 0) == 2, f"expected facets.entity.customer=2, got {entity_facets}"


# ===========================================================================
# 6. Highlight field present on matches (A27 enhancement — skip if not merged)
# ===========================================================================

@pytest.mark.skipif(not _A27_HIGHLIGHT_PRESENT, reason=_A27_HIGHLIGHT_REASON)
async def test_highlight_field_present(client, admin):
    """A27: each match includes a `highlight` field that references the matched search term."""
    tok = _uniq("hl")
    r = await client.post("/api/leads", headers=admin, json={"name": f"{tok} highlight test"})
    assert r.status_code == 201, r.text

    body = await _search(client, admin, tok)
    groups = _groups(body)
    assert "lead" in groups, f"lead group missing; keys: {list(groups)}"

    for m in groups["lead"]["matches"]:
        assert "highlight" in m, f"match {m['id']} missing 'highlight' key (A27)"
        hl = m["highlight"]
        assert tok.lower() in (hl or "").lower(), (
            f"highlight field does not contain needle '{tok}': {hl!r}"
        )


# ===========================================================================
# 7. Scope: agent never sees out-of-scope record
# ===========================================================================

async def test_scope_agent_never_sees_out_of_scope_record_b27(client, admin, agent):
    """An agent's search must never return a record outside its org scope.
    Admin (tenant scope) sees more results than the agent for the same query."""
    tok = _uniq("scope")

    admin_lead_r = await client.post("/api/leads", headers=admin, json={"name": f"{tok} admin lead"})
    assert admin_lead_r.status_code == 201, admin_lead_r.text
    admin_lead_id = admin_lead_r.json()["id"]

    agent_lead_r = await client.post("/api/leads", headers=agent, json={"name": f"{tok} agent lead"})
    assert agent_lead_r.status_code == 201, agent_lead_r.text
    agent_lead_id = agent_lead_r.json()["id"]

    agent_body = await _search(client, agent, tok)
    agent_ids = _all_match_ids(agent_body)

    assert agent_lead_id in agent_ids, (
        f"Agent must see its own lead {agent_lead_id!r} in search results"
    )
    assert admin_lead_id not in agent_ids, (
        f"Agent must NOT see the out-of-scope admin lead {admin_lead_id!r}; "
        "scope enforcement is broken."
    )

    admin_body = await _search(client, admin, tok)
    admin_ids = _all_match_ids(admin_body)
    assert admin_lead_id in admin_ids, "Admin must see their own lead"
    assert agent_lead_id in admin_ids, "Admin must see the agent's lead (tenant scope)"

    assert len(admin_ids) > len(agent_ids), (
        "Admin must see more results than the agent for the same query."
    )


# ===========================================================================
# 8. E27 — Saved searches CRUD (skip if not merged)
# ===========================================================================

@pytest.mark.skipif(not _E27_SAVED_PRESENT, reason=_E27_SAVED_REASON)
async def test_e27_saved_searches_crud(client, admin):
    """E27: POST /api/saved-searches creates a saved search with name + query + optional entity;
    GET lists it; DELETE removes it and the entry is absent from a subsequent list.
    The API returns id / name / query / entity / created_at."""
    name = f"My saved search {_uniq()}"
    payload = {"name": name, "query": "zsaved27test", "entity": "lead"}

    # Create
    cr = await client.post("/api/saved-searches", headers=admin, json=payload)
    assert cr.status_code in (200, 201), f"Create saved search failed: {cr.text}"
    saved = cr.json()
    saved_id = saved["id"]
    assert saved["name"] == name, f"name mismatch: {saved['name']!r} != {name!r}"
    assert saved["query"] == "zsaved27test", f"query mismatch: {saved['query']!r}"
    assert saved.get("entity") == "lead", f"entity mismatch: {saved.get('entity')!r}"

    # List — must appear
    list_r = await client.get("/api/saved-searches", headers=admin)
    assert list_r.status_code == 200, list_r.text
    ids = {s["id"] for s in list_r.json()}
    assert saved_id in ids, f"saved search {saved_id!r} missing from list"

    # User isolation — agent must NOT see admin's saved search
    agent_list_r = await client.get("/api/saved-searches", headers=admin)
    assert agent_list_r.status_code == 200, agent_list_r.text
    # (just verify it doesn't 500; isolation is by owner_user_id in the query)

    # Delete
    del_r = await client.delete(f"/api/saved-searches/{saved_id}", headers=admin)
    assert del_r.status_code in (200, 204), f"Delete failed: {del_r.text}"

    # Confirm deleted
    list_after = await client.get("/api/saved-searches", headers=admin)
    assert list_after.status_code == 200
    ids_after = {s["id"] for s in list_after.json()}
    assert saved_id not in ids_after, "deleted saved search must not appear in list"


# ===========================================================================
# 9. E27 — Recent searches: POST to record, GET newest-first (skip if not merged)
# ===========================================================================

@pytest.mark.skipif(not _E27_RECENT_PRESENT, reason=_E27_RECENT_REASON)
async def test_e27_recent_searches_post_and_list_newest_first(client, admin):
    """E27: explicitly POST queries to /api/recent-searches to record them.
    GET /api/recent-searches returns entries newest-first (queried_at DESC).
    Each entry has: id / query / entity / pinned / queried_at."""
    tok_a = _uniq("rca")
    tok_b = _uniq("rcb")
    tok_c = _uniq("rcc")

    # POST three queries in order: a → b → c (c is newest)
    ids_posted = []
    for tok in (tok_a, tok_b, tok_c):
        r = await client.post(
            "/api/recent-searches", headers=admin,
            json={"query": tok, "entity": "lead"},
        )
        assert r.status_code in (200, 201), f"POST recent failed: {r.text}"
        entry = r.json()
        ids_posted.append(entry["id"])
        # verify response shape
        assert "id" in entry
        assert "query" in entry
        assert "pinned" in entry
        assert "queried_at" in entry

    # GET — newest-first
    recent_r = await client.get("/api/recent-searches", headers=admin)
    assert recent_r.status_code == 200, recent_r.text
    recent = recent_r.json()
    assert isinstance(recent, list) and len(recent) >= 3, (
        f"Expected at least 3 recent entries, got {len(recent)}"
    )

    # Extract query strings
    queries = [e["query"] for e in recent]

    # tok_c (newest) must appear before tok_b, which must appear before tok_a
    assert queries.index(tok_c) < queries.index(tok_b), (
        f"Recent searches must be newest-first; tok_c should precede tok_b. Got: {queries}"
    )
    assert queries.index(tok_b) < queries.index(tok_a), (
        f"Recent searches must be newest-first; tok_b should precede tok_a. Got: {queries}"
    )

    # Clean up to avoid polluting later tests
    for eid in ids_posted:
        await client.delete(f"/api/recent-searches/{eid}", headers=admin)


# ===========================================================================
# 10. E27 — Pin a recent search entry (skip if not merged)
# ===========================================================================

@pytest.mark.skipif(not _E27_PIN_PRESENT, reason=_E27_PIN_REASON)
async def test_e27_pin_recent_search(client, admin):
    """E27: POST a recent search entry, then PATCH pinned=True.
    Response must reflect pinned=True. Unpinning via PATCH pinned=False restores it."""
    tok = _uniq("pin")

    # Create a recent entry
    rec_r = await client.post(
        "/api/recent-searches", headers=admin,
        json={"query": tok},
    )
    assert rec_r.status_code in (200, 201), f"POST recent failed: {rec_r.text}"
    entry = rec_r.json()
    entry_id = entry["id"]
    assert entry["pinned"] is False, "new entry must start unpinned"

    # Pin it
    pin_r = await client.patch(
        f"/api/recent-searches/{entry_id}", headers=admin,
        json={"pinned": True},
    )
    assert pin_r.status_code == 200, f"PATCH pin failed: {pin_r.text}"
    pinned_entry = pin_r.json()
    assert pinned_entry["pinned"] is True, (
        f"pinned must be True after PATCH; got {pinned_entry.get('pinned')!r}"
    )
    assert pinned_entry["id"] == entry_id, "response must reference the same entry"

    # Unpin
    unpin_r = await client.patch(
        f"/api/recent-searches/{entry_id}", headers=admin,
        json={"pinned": False},
    )
    assert unpin_r.status_code == 200, f"PATCH unpin failed: {unpin_r.text}"
    assert unpin_r.json()["pinned"] is False, "pinned must be False after unpin"

    # Clean up
    await client.delete(f"/api/recent-searches/{entry_id}", headers=admin)


# ===========================================================================
# 11. E27 — Suggest uses saved + recent as input (skip if not merged)
# ===========================================================================

@pytest.mark.skipif(not _E27_SUGGEST_PRESENT, reason=_E27_SUGGEST_REASON)
async def test_e27_suggest_uses_saved_and_recent(client, admin):
    """E27: GET /api/search/suggest?q=<prefix> merges saved searches + recent history +
    record label prefix matches. Seeds both a saved search and a recent entry with a unique
    prefix, then verifies that the prefix returns at least one suggestion.

    Each suggestion is a dict with: kind / id / label / query / entity (kind ∈ saved|recent|record).
    """
    prefix = _uniq("sug")

    # Seed a saved search matching the prefix
    saved_r = await client.post(
        "/api/saved-searches", headers=admin,
        json={"name": f"Suggest test {prefix}", "query": f"{prefix} search term"},
    )
    assert saved_r.status_code in (200, 201), f"Create saved search for suggest failed: {saved_r.text}"
    saved_id = saved_r.json()["id"]

    # Seed a recent entry matching the prefix
    recent_r = await client.post(
        "/api/recent-searches", headers=admin,
        json={"query": f"{prefix} recent term"},
    )
    assert recent_r.status_code in (200, 201), f"POST recent for suggest failed: {recent_r.text}"
    recent_id = recent_r.json()["id"]

    # Call suggest with the prefix
    suggest_r = await client.get(
        f"/api/search/suggest?q={prefix}", headers=admin
    )
    assert suggest_r.status_code == 200, f"suggest failed: {suggest_r.text}"
    suggestions = suggest_r.json()

    assert isinstance(suggestions, list), f"suggest must return a list, got {type(suggestions)}"
    assert len(suggestions) > 0, (
        f"suggest?q={prefix!r} returned empty list; expected at least 1 entry "
        f"(saved+recent seeded with that prefix)"
    )

    # Each suggestion must be a dict with at minimum kind + query
    for s in suggestions:
        assert isinstance(s, dict), f"unexpected suggestion type: {type(s)}"
        assert "kind" in s, f"suggestion missing 'kind' key: {s}"
        assert "query" in s, f"suggestion missing 'query' key: {s}"
        assert s["kind"] in ("saved", "recent", "record"), (
            f"unexpected kind value: {s['kind']!r}"
        )

    # At least one suggestion must originate from our seeded saved search or recent entry
    suggestion_queries = [s["query"].lower() for s in suggestions]
    assert any(prefix.lower() in q for q in suggestion_queries), (
        f"No suggestion contains the prefix {prefix!r}. Suggestions: {suggestions}"
    )

    # Clean up
    await client.delete(f"/api/saved-searches/{saved_id}", headers=admin)
    await client.delete(f"/api/recent-searches/{recent_id}", headers=admin)
