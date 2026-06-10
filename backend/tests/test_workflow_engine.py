"""KT-GXL-1 — cross-record workflow guard evaluation (M1 Phase 1.5).

The killer test for the sealed GXL Extension addendum
(``docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05-GXL-EXTENSION.md``). It proves a
workflow guard can reach ONE hop into a linked record (``customer_account.balance_due == 0``),
refuses the transition when business state forbids it, allows it once the linked state permits,
and does so with at most one extra SQL query (GXL-I2). Everything is config-only: two entities, one
``ref`` field, one cross-record guard — no new model classes, no new routers (baseline I1/I5).

Runs in BOTH the ``backend`` and ``backend-rls`` CI jobs (see ``.github/workflows/ci.yml``); the
latter executes as the NOSUPERUSER ``gaahex_app`` role and so proves RLS engages on the resolver's
pre-fetch query (GXL-I3 / baseline I3).

CONTRACT NOTE — 422 vs the addendum's "409": addendum §6 step 1 (and the §3 I2 row) describe the
guard-blocked transition as a 409 + a ``TRANSITION_REJECTED`` event. The engine's actual, locked
guard-failure contract is **422 with no event emitted** — established by ``records.py`` and the four
pre-extension compatibility tests (``test_workflow.py`` / ``test_api.py``). This test asserts the
real contract; the §6 "409" and the "TRANSITION_REJECTED (existing pattern)" claim are known
addendum errata flagged for correction before D7 seals the file.
"""
import uuid

from sqlalchemy import event

from app.db import engine


def _entity_payloads():
    """Account + Service entity-creation payloads with a unique suffix per test run."""
    suffix = uuid.uuid4().hex[:8]
    acct_key = f"acct_{suffix}"
    svc_key = f"svc_{suffix}"
    acct_slug = f"acct{suffix}"
    svc_slug = f"svc{suffix}"
    account = {
        "key": acct_key, "label": "Account", "label_plural": "Accounts", "route_slug": acct_slug,
        "fields": [
            {"key": "balance_due", "label": "Balance Due", "type": "number"},
            {"key": "status", "label": "Status", "type": "status"},
        ],
        "statuses": [
            {"key": "ACTIVE", "label": "Active", "is_initial": True},
            {"key": "SUSPENDED", "label": "Suspended"},
        ],
        "transitions": [{"from": "ACTIVE", "to": "SUSPENDED", "guard": None}],
    }
    service = {
        "key": svc_key, "label": "Service", "label_plural": "Services", "route_slug": svc_slug,
        "fields": [
            {"key": "name", "label": "Name", "type": "text", "required": True},
            {"key": "customer_account", "label": "Account", "type": "ref",
             "config": {"target": acct_key}},
            {"key": "status", "label": "Status", "type": "status"},
        ],
        "statuses": [
            {"key": "PENDING", "label": "Pending", "is_initial": True},
            {"key": "ACTIVE", "label": "Active"},
        ],
        "transitions": [
            {"from": "PENDING", "to": "ACTIVE", "guard": "customer_account.balance_due == 0"},
        ],
    }
    return acct_slug, svc_slug, account, service


async def test_gxl_cross_record_guard_evaluation(client, admin):
    acct_slug, svc_slug, account, service = _entity_payloads()

    # ── config-only setup ─────────────────────────────────────────────────────
    assert (await client.post("/meta/entities", headers=admin, json=account)).status_code == 201
    r = await client.post("/meta/entities", headers=admin, json=service)
    assert r.status_code == 201, r.text  # cross-record guard accepted at authorship (config.manage)

    # account in arrears (balance_due = 100); one service linked to it
    acct = (await client.post(f"/api/{acct_slug}", headers=admin, json={"balance_due": 100})).json()
    assert acct["status"] == "ACTIVE"
    svc = (await client.post(f"/api/{svc_slug}", headers=admin,
                             json={"name": "Fiber 100", "customer_account": acct["id"]})).json()
    assert svc["status"] == "PENDING", svc

    # ── step 1: guard refuses the move while balance_due != 0 (422 — guard-fail contract) ──
    blocked = await client.post(f"/api/{svc_slug}/{svc['id']}/transition",
                                headers=admin, json={"to": "ACTIVE"})
    assert blocked.status_code == 422, blocked.text
    assert "customer_account.balance_due" in blocked.text

    # ── step 2: status unchanged after the refused transition ──
    still = (await client.get(f"/api/{svc_slug}/{svc['id']}", headers=admin)).json()
    assert still["status"] == "PENDING"

    # ── step 3: pay the account down to 0 via the ordinary PATCH path (no special endpoint) ──
    paid = await client.patch(f"/api/{acct_slug}/{acct['id']}", headers=admin, json={"balance_due": 0})
    assert paid.status_code == 200, paid.text

    # ── step 4: the same transition is now allowed — count the resolver's extra queries (GXL-I2) ──
    resolver_queries: list[str] = []

    def _count(conn, cursor, statement, parameters, context, executemany):
        if "current_setting('gaahex.tenant_id', true)" in statement and "FROM record" in statement:
            resolver_queries.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _count)
    try:
        ok = await client.post(f"/api/{svc_slug}/{svc['id']}/transition",
                               headers=admin, json={"to": "ACTIVE"})
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _count)
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "ACTIVE"
    # GXL-I2 — exactly one pre-fetch for the single linked account the guard references
    assert len(resolver_queries) == 1, \
        f"expected exactly 1 cross-record pre-fetch, saw {len(resolver_queries)}: {resolver_queries}"

    # ── step 5: audit trail — one TRANSITION for the allowed move, none for the blocked attempt ──
    history = (await client.get(f"/api/{svc_slug}/{svc['id']}/history", headers=admin)).json()
    transitions = [e for e in history if e["type"] == "TRANSITION"]
    assert len(transitions) == 1
    assert (transitions[0]["data"]["from"], transitions[0]["data"]["to"]) == ("PENDING", "ACTIVE")


async def test_gxl_cross_tenant_ref_fails_closed(client, admin):
    """A ref value pointing at a non-existent / cross-tenant row resolves to None (fail-closed):
    the guard reads an absent record and refuses the move. Proves GXL-I3 / baseline I3 at the
    evaluation layer without needing a second tenant fixture — a random UUID is, by construction,
    not a row this tenant can see, so RLS (and the explicit tenant predicate) return zero rows."""
    acct_slug, svc_slug, account, service = _entity_payloads()
    assert (await client.post("/meta/entities", headers=admin, json=account)).status_code == 201
    assert (await client.post("/meta/entities", headers=admin, json=service)).status_code == 201

    svc = (await client.post(f"/api/{svc_slug}", headers=admin,
                             json={"name": "Dangling", "customer_account": str(uuid.uuid4())})).json()
    blocked = await client.post(f"/api/{svc_slug}/{svc['id']}/transition",
                                headers=admin, json={"to": "ACTIVE"})
    assert blocked.status_code == 422, blocked.text
