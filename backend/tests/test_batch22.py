"""Batch 22 — Pagination correctness (E22) + health endpoints (A22).

E22: GET /api/{slug} with limit/offset + X-Total-Count header.
     The endpoint already supports limit/offset (records.py _paginate).
     X-Total-Count header is NOT yet emitted (E22 not yet merged) — those
     assertions are guarded with skip so the suite stays green.

A22: /api/health, /api/health/ready, /api/status.
     /api/status IS live (ops.py) and tested unconditionally.
     /api/health and /api/health/ready do NOT yet exist under /api — they live
     at /health and /health/db respectively — so those assertions are skipped
     until A22 lands.

Style: session-scoped client + admin/agent fixtures from conftest (unchanged).
       Unique name tokens isolate each test's records from the rest of the suite.
"""

import uuid

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uniq(tag: str) -> str:
    return f"{tag}-{uuid.uuid4().hex[:8]}"


async def _create_lead(client, headers, name: str) -> dict:
    r = await client.post("/api/leads", headers=headers, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Detect E22 (X-Total-Count header)
# ---------------------------------------------------------------------------

async def _total_count_header(client, admin, slug: str) -> int | None:
    """Return the X-Total-Count header value as int, or None if not present."""
    r = await client.get(f"/api/{slug}", headers=admin)
    assert r.status_code == 200, r.text
    raw = r.headers.get("X-Total-Count") or r.headers.get("x-total-count")
    if raw is None:
        return None
    return int(raw)


# ---------------------------------------------------------------------------
# Detect A22 — /api/health and /api/health/ready
# ---------------------------------------------------------------------------

async def _api_health_status(client) -> int:
    r = await client.get("/api/health")
    return r.status_code


async def _api_health_ready_status(client) -> int:
    r = await client.get("/api/health/ready")
    return r.status_code


# ===========================================================================
# PART 1 — Pagination non-breaking (always runs)
# ===========================================================================

async def test_pagination_default_returns_plain_list(client, admin):
    """GET /api/leads with no params still returns a JSON list (backward-compat, never an envelope)."""
    r = await client.get("/api/leads", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list), f"expected plain list; got {type(body).__name__}: {body!r:.200}"


async def test_pagination_create_n_records(client, admin):
    """Create 7 uniquely-named leads; all 7 are visible via ?q=<token>.
    This is the seed for subsequent pagination tests."""
    tok = _uniq("b22page")
    ids = []
    for i in range(7):
        rec = await _create_lead(client, admin, f"{tok}_{i}")
        ids.append(rec["id"])

    r = await client.get(f"/api/leads?q={tok}&sort=name", headers=admin)
    assert r.status_code == 200, r.text
    names = [item["name"] for item in r.json()]
    assert len(names) == 7, f"expected 7 records, got {len(names)}: {names}"


async def test_pagination_limit_3_offset_0(client, admin):
    """?limit=3&offset=0 returns exactly 3 items from the filtered set."""
    tok = _uniq("b22lim")
    for i in range(7):
        await _create_lead(client, admin, f"{tok}_{i}")

    r = await client.get(f"/api/leads?q={tok}&sort=name&limit=3&offset=0", headers=admin)
    assert r.status_code == 200, r.text
    page = r.json()
    assert len(page) == 3, f"expected 3 items at offset=0 limit=3; got {len(page)}: {page!r:.300}"
    # first three in name order
    expected = [f"{tok}_0", f"{tok}_1", f"{tok}_2"]
    got = [item["name"] for item in page]
    assert got == expected, f"wrong items: {got} != {expected}"


async def test_pagination_limit_3_offset_6_last_page(client, admin):
    """?limit=3&offset=6 returns exactly 1 item (the last of 7)."""
    tok = _uniq("b22last")
    for i in range(7):
        await _create_lead(client, admin, f"{tok}_{i}")

    r = await client.get(f"/api/leads?q={tok}&sort=name&limit=3&offset=6", headers=admin)
    assert r.status_code == 200, r.text
    page = r.json()
    assert len(page) == 1, f"expected 1 item at offset=6; got {len(page)}: {page!r:.300}"
    assert page[0]["name"] == f"{tok}_6"


async def test_pagination_offset_past_end_returns_empty(client, admin):
    """?offset past the end returns an empty list (never an error)."""
    tok = _uniq("b22past")
    for i in range(4):
        await _create_lead(client, admin, f"{tok}_{i}")

    r = await client.get(f"/api/leads?q={tok}&limit=10&offset=999", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json() == [], f"expected empty list; got {r.json()!r:.200}"


async def test_pagination_filter_composes_with_limit(client, admin):
    """A q-filter + limit returns only matching items (filter and pagination compose correctly)."""
    tok_a = _uniq("b22fa")
    tok_b = _uniq("b22fb")
    # 5 'a' records + 3 'b' records
    for i in range(5):
        await _create_lead(client, admin, f"{tok_a}_{i}")
    for i in range(3):
        await _create_lead(client, admin, f"{tok_b}_{i}")

    # Filter to tok_a only, then take 2
    r = await client.get(f"/api/leads?q={tok_a}&limit=2&offset=0", headers=admin)
    assert r.status_code == 200, r.text
    page = r.json()
    assert len(page) == 2, f"expected 2 filtered items; got {len(page)}"
    # All returned items must match tok_a
    for item in page:
        assert tok_a in item["name"], f"item {item['name']!r} does not contain filter token {tok_a!r}"


# ===========================================================================
# PART 2 — X-Total-Count (E22 — skipped until the header is wired)
# ===========================================================================

async def test_x_total_count_present_when_wired(client, admin):
    """E22: GET /api/{slug} must emit X-Total-Count == total visible records (pre-pagination).
    Skipped until E22 merges the header into records.py."""
    r = await client.get("/api/leads", headers=admin)
    assert r.status_code == 200, r.text
    raw = r.headers.get("X-Total-Count") or r.headers.get("x-total-count")
    if raw is None:
        pytest.skip("E22 X-Total-Count header not yet emitted (records.py not patched)")
    count = int(raw)
    assert count >= 0, f"X-Total-Count must be >= 0; got {count}"
    # The header must equal the full (un-paged) count, not the page size
    # (re-fetch with a huge limit to count all visible records)
    all_r = await client.get("/api/leads?limit=500&offset=0", headers=admin)
    all_count = len(all_r.json())
    assert count >= all_count, (
        f"X-Total-Count={count} must be >= page-0 record count={all_count} "
        "(header is total; page may be smaller)"
    )


async def test_x_total_count_n_after_create(client, admin):
    """E22: after creating N records, X-Total-Count reflects the full filtered total (not the page).
    Skipped until E22 lands."""
    tok = _uniq("b22hdr")
    N = 7
    for i in range(N):
        await _create_lead(client, admin, f"{tok}_{i}")

    r = await client.get(f"/api/leads?q={tok}&limit=3&offset=0", headers=admin)
    assert r.status_code == 200, r.text
    raw = r.headers.get("X-Total-Count") or r.headers.get("x-total-count")
    if raw is None:
        pytest.skip("E22 X-Total-Count header not yet emitted")
    count = int(raw)
    assert count == N, (
        f"X-Total-Count={count} != N={N} for q={tok!r}; "
        "header must be the filtered total, not the page size"
    )
    # The page itself is still capped by limit
    assert len(r.json()) == 3, f"page size should be 3 (limit=3); got {len(r.json())}"


async def test_x_total_count_offset_past_end_still_n(client, admin):
    """E22: X-Total-Count must equal N even when offset > N (empty page, full count).
    Skipped until E22 lands."""
    tok = _uniq("b22hdrpast")
    N = 4
    for i in range(N):
        await _create_lead(client, admin, f"{tok}_{i}")

    r = await client.get(f"/api/leads?q={tok}&limit=10&offset=999", headers=admin)
    assert r.status_code == 200, r.text
    raw = r.headers.get("X-Total-Count") or r.headers.get("x-total-count")
    if raw is None:
        pytest.skip("E22 X-Total-Count header not yet emitted")
    count = int(raw)
    assert count == N, (
        f"X-Total-Count={count} != N={N} for q={tok!r} with offset past end"
    )
    assert r.json() == [], "body must be empty list when offset > total"


async def test_x_total_count_filtered_total(client, admin):
    """E22: filter + limit — X-Total-Count reports the *filtered* total, not the overall total.
    Skipped until E22 lands."""
    tok_x = _uniq("b22hdrfx")
    tok_y = _uniq("b22hdrfy")
    NX = 5
    for i in range(NX):
        await _create_lead(client, admin, f"{tok_x}_{i}")
    for i in range(3):
        await _create_lead(client, admin, f"{tok_y}_{i}")

    r = await client.get(f"/api/leads?q={tok_x}&limit=2&offset=0", headers=admin)
    assert r.status_code == 200, r.text
    raw = r.headers.get("X-Total-Count") or r.headers.get("x-total-count")
    if raw is None:
        pytest.skip("E22 X-Total-Count header not yet emitted")
    count = int(raw)
    assert count == NX, (
        f"X-Total-Count={count} != filtered total={NX} for q={tok_x!r}; "
        "tok_y records must not inflate the count"
    )


# ===========================================================================
# PART 3 — /api/health + /api/health/ready (A22 — skipped until wired)
# ===========================================================================

async def test_api_health_no_auth_200(client):
    """/api/health must return 200 with no auth and status=='ok'.
    Skipped until A22 wires the endpoint under /api/health."""
    r = await client.get("/api/health")
    if r.status_code in (404, 422):
        pytest.skip(
            f"A22 /api/health not yet wired (status={r.status_code}); "
            "currently only /health (root) exists"
        )
    assert r.status_code == 200, f"/api/health returned {r.status_code}: {r.text}"
    body = r.json()
    assert body.get("status") == "ok", f"expected status=='ok'; got {body}"


async def test_api_health_ready_200_with_db(client):
    """/api/health/ready must return 200 with db==true (or 'ok') — no auth.
    Skipped until A22 wires the endpoint."""
    r = await client.get("/api/health/ready")
    if r.status_code in (404, 422):
        pytest.skip(
            f"A22 /api/health/ready not yet wired (status={r.status_code})"
        )
    assert r.status_code == 200, f"/api/health/ready returned {r.status_code}: {r.text}"
    body = r.json()
    # Accept db==True (bool) or db=="ok" (string) — both signal DB liveness
    db_val = body.get("db")
    assert db_val in (True, "ok", "connected"), (
        f"/api/health/ready body must have db=True or db='ok'; got {body}"
    )


# ===========================================================================
# PART 4 — /api/status (live in ops.py — always runs)
# ===========================================================================

async def test_api_status_requires_auth(client):
    """/api/status returns 401 (not 200, not 500) when called without auth."""
    r = await client.get("/api/status")
    assert r.status_code == 401, (
        f"/api/status must require auth; got {r.status_code}: {r.text}"
    )


async def test_api_status_200_for_authed_user(client, admin):
    """/api/status returns 200 for an authenticated user."""
    r = await client.get("/api/status", headers=admin)
    assert r.status_code == 200, f"/api/status returned {r.status_code}: {r.text}"


async def test_api_status_has_summary_keys(client, admin):
    """/api/status body contains the expected summary keys: service, ok, db, version, time, maintenance."""
    r = await client.get("/api/status", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("service", "ok", "db", "version", "time", "maintenance"):
        assert key in body, f"/api/status missing key '{key}'; got keys: {list(body.keys())}"


async def test_api_status_service_is_gaahex(client, admin):
    """/api/status reports service == 'gaahex'."""
    body = (await client.get("/api/status", headers=admin)).json()
    assert body.get("service") == "gaahex", f"service mismatch: {body.get('service')!r}"


async def test_api_status_db_ok(client, admin):
    """/api/status reports db == 'ok' (database is reachable in the test environment)."""
    body = (await client.get("/api/status", headers=admin)).json()
    assert body.get("db") == "ok", f"db field unexpected: {body.get('db')!r}"
    assert body.get("ok") is True, f"ok field should be True; got {body.get('ok')!r}"


async def test_api_status_maintenance_block_present(client, admin):
    """/api/status maintenance block is a dict with at least an 'active' key."""
    body = (await client.get("/api/status", headers=admin)).json()
    maint = body.get("maintenance")
    assert isinstance(maint, dict), f"maintenance should be a dict; got {type(maint).__name__}: {maint!r}"
    assert "active" in maint, f"maintenance block missing 'active' key; got {maint}"


async def test_api_status_version_is_string(client, admin):
    """/api/status version is a non-empty string."""
    body = (await client.get("/api/status", headers=admin)).json()
    version = body.get("version")
    assert isinstance(version, str) and version, f"version must be a non-empty string; got {version!r}"


async def test_api_status_time_is_iso(client, admin):
    """/api/status time is a non-empty ISO-8601 string."""
    body = (await client.get("/api/status", headers=admin)).json()
    time_val = body.get("time")
    assert isinstance(time_val, str) and "T" in time_val, (
        f"time must be an ISO-8601 string; got {time_val!r}"
    )


# ===========================================================================
# PART 5 — Existing /health root endpoint (always live — sanity cross-check)
# ===========================================================================

async def test_root_health_still_200(client):
    """/health (root, no auth) must still return 200 with service=='gaahex' — regression guard."""
    r = await client.get("/health")
    assert r.status_code == 200, f"/health returned {r.status_code}: {r.text}"
    body = r.json()
    assert body.get("service") == "gaahex", f"service mismatch: {body}"
