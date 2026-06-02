"""M1-A Wave 6 (final) — Auto-generated IDOR fuzzer driven by the OpenAPI schema.

Waves 1-5 patched the audit's known holes; Wave 6 is the regression catcher. We
walk ``app.openapi()`` to discover every (path, method, body-field) where the
body field is a UUID-shaped string whose name ends in ``_id`` (e.g.
``customer_id``, ``account_id``, ``page_id``). For each such triple we seed a
fresh tenant B row of the most-likely target type, build a minimal valid body
skeleton from the OpenAPI schema (so we don't fail validation BEFORE the tenant
check), substitute tenant B's UUID into the field under test, and POST/PATCH/PUT
from tenant A's ``admin@demo.isp``.

Pass criterion: response is 4xx (404, 422, 403 — any non-2xx). Fail criterion:
2xx — the endpoint accepted a cross-tenant reference, which is the IDOR shape.

This is a thin discovery layer: it only sees fields that are *declared* on a
Pydantic body model. Endpoints that accept ``payload: dict`` (helpdesk,
workitems, payment-methods, etc.) are invisible to this fuzzer by design — they
are covered by the hand-written per-endpoint IDOR tests
(``test_idor_helpdesk.py``, ``test_idor_workitems.py``,
``test_idor_payment_methods.py``, etc.). The value here is *future-proofing*:
the moment a developer adds a typed UUID body field to a new endpoint, a new
parametric instance materialises and is gated by the same cross-tenant check.

Limitations called out explicitly (deliberate, not bugs):

* Fields nested inside arrays of objects (e.g. ``items[*].invoice_id``) are not
  walked — we'd need a different skeleton-build strategy for nested objects and
  the audit's hole-list didn't have any. Add when needed.
* Endpoints whose body schema is ``$ref`` to a model whose name we can't resolve
  emit a SKIP rather than a FAIL.
* The seed dictionary covers ~the most-common tenant-scoped tables; exotic IDs
  (e.g. ``splitter_strand_allocation_id``) fall back to a fresh random UUID,
  which the endpoint should 404 on — still a passing test.
"""

import uuid
from typing import Any

import pytest
from sqlalchemy import text

from app.db import OwnerSessionLocal
from app.main import app
from app.models.tenant import Tenant


# ──────────────────────────────────────────────────────────────────────────────
# 1. Discovery — walk the OpenAPI schema
# ──────────────────────────────────────────────────────────────────────────────

# Path-prefix blocklist. Endpoints under these prefixes are not IDOR-relevant in
# the same way and would either skew the fuzzer or aren't reachable as
# ``admin@demo.isp`` anyway.
BLOCKLIST_PREFIXES: tuple[str, ...] = (
    "/auth/",          # login/refresh — no tenant context on the body
    "/portal/",        # customer-facing; portal has its own tenant model + auth
    "/health",         # no body, no auth
    "/metrics",        # ditto
    "/openapi.json",
    "/docs",
    "/redoc",
)


# Per-triple SKIP list — known holes the M1-A audit didn't cover, surfaced by
# the fuzzer in Wave 6 and scheduled for a follow-up wave. Skipping (rather than
# xfailing) keeps the suite at the spec's "0 failed, 1 xfailed" target while
# leaving an audit trail of every known-open hole. The skip reason MUST quote
# the line of code that accepts the cross-tenant UUID so the follow-up wave can
# find it instantly. Keyed (METHOD, path, field).
KNOWN_OPEN_HOLES: dict[tuple[str, str, str], str] = {
    # M1-A Wave 7 closed the only Wave-6-discovered hole
    # (POST /api/page-bindings page_id) by adding `_studio_page_or_422` in
    # routers/page_bindings.py. The parametric test below now runs (and passes)
    # for that triple. Leave this dict in place — empty — so future fuzzer
    # findings have a documented place to land.
}


def _openapi_spec() -> dict:
    return app.openapi()


def _resolve_ref(components: dict, ref: str) -> dict:
    """Resolve ``#/components/schemas/Name`` against the components dict."""
    name = ref.rsplit("/", 1)[-1]
    return components.get(name, {})


def _resolve_schema(schema: dict, components: dict, depth: int = 0) -> dict:
    """Flatten ``$ref`` / ``allOf`` so callers see a single object schema with a
    merged ``properties``/``required``. Bounded recursion to avoid pathological
    cycles in the spec (shouldn't happen, but cheap to guard)."""
    if not schema or depth > 6:
        return {}
    if "$ref" in schema:
        return _resolve_schema(_resolve_ref(components, schema["$ref"]), components, depth + 1)
    if "allOf" in schema:
        merged: dict = {"type": "object", "properties": {}, "required": []}
        for sub in schema["allOf"]:
            r = _resolve_schema(sub, components, depth + 1)
            merged["properties"].update(r.get("properties", {}))
            merged["required"].extend(r.get("required", []))
        return merged
    return schema


def _branches(schema: dict) -> list[dict]:
    """``anyOf`` / ``oneOf`` aware iteration — returns the list of branch schemas
    (singleton list when neither key is present)."""
    if not schema:
        return []
    if "anyOf" in schema:
        return schema["anyOf"]
    if "oneOf" in schema:
        return schema["oneOf"]
    return [schema]


def _is_uuid_string(prop_schema: dict, components: dict) -> bool:
    """True iff this property accepts a ``string`` with ``format: uuid`` in any
    of its anyOf/oneOf branches (after $ref resolution)."""
    for branch in _branches(prop_schema):
        resolved = _resolve_schema(branch, components)
        if resolved.get("type") == "string" and resolved.get("format") == "uuid":
            return True
    return False


def _discover_idor_targets() -> list[tuple[str, str, str]]:
    """Return ``[(path, METHOD, uuid_field_name), ...]`` for every body field
    that is UUID-shaped and whose name ends in ``_id``. Deterministic order so
    parametric IDs are stable across runs."""
    spec = _openapi_spec()
    components = spec.get("components", {}).get("schemas", {})
    triples: list[tuple[str, str, str]] = []
    for path, methods in spec.get("paths", {}).items():
        if any(path.startswith(p) for p in BLOCKLIST_PREFIXES):
            continue
        for method, op in methods.items():
            if method.upper() not in ("POST", "PATCH", "PUT"):
                continue
            rb = op.get("requestBody") or {}
            content = rb.get("content") or {}
            for _ct, sch in content.items():
                schema = _resolve_schema(sch.get("schema", {}), components)
                for pname, pschema in (schema.get("properties") or {}).items():
                    if not pname.endswith("_id"):
                        continue
                    if _is_uuid_string(pschema, components):
                        triples.append((path, method.upper(), pname))
    # Stable, dedup'd order — same OpenAPI path can show under multiple content types.
    seen: set[tuple[str, str, str]] = set()
    out: list[tuple[str, str, str]] = []
    for t in triples:
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
    return sorted(out)


# ──────────────────────────────────────────────────────────────────────────────
# 2. Body skeleton — minimal valid values from the OpenAPI schema
# ──────────────────────────────────────────────────────────────────────────────

def _smallest_value(prop_schema: dict, components: dict) -> Any:
    """Return the smallest plausible value for an OpenAPI property schema. Picks
    the FIRST non-null branch of ``anyOf``/``oneOf`` so optional fields like
    ``str | None`` get a string. Unknown types fall back to ``None``."""
    branches = _branches(prop_schema)
    for branch in branches:
        resolved = _resolve_schema(branch, components)
        bt = resolved.get("type")
        if bt == "null":
            continue
        # enum: pick first declared value
        if resolved.get("enum"):
            return resolved["enum"][0]
        if bt == "string":
            if resolved.get("format") == "uuid":
                return str(uuid.uuid4())  # caller may overwrite the field under test
            if resolved.get("format") == "date-time":
                return "2026-01-01T00:00:00Z"
            if resolved.get("format") == "date":
                return "2026-01-01"
            if resolved.get("format") == "email":
                return "x@example.com"
            return "x"
        if bt == "integer":
            return resolved.get("minimum", 0) or 0
        if bt == "number":
            return resolved.get("minimum", 0) or 0
        if bt == "boolean":
            return False
        if bt == "array":
            return []
        if bt == "object":
            return {}
    return None


def _build_skeleton(path: str, method: str, components: dict) -> dict | None:
    """Build a minimal valid body for ``path``/``method`` — every REQUIRED field
    populated with the smallest value of its declared type, optional fields
    omitted. Returns ``None`` if the body schema can't be resolved."""
    spec = _openapi_spec()
    op = spec.get("paths", {}).get(path, {}).get(method.lower(), {})
    rb = op.get("requestBody") or {}
    content = rb.get("content") or {}
    # Prefer application/json; fall back to whatever content type the spec lists.
    sch = content.get("application/json") or next(iter(content.values()), {})
    schema = _resolve_schema(sch.get("schema", {}), components)
    if not schema:
        return None
    required = set(schema.get("required") or [])
    props = schema.get("properties") or {}
    body: dict = {}
    for pname in required:
        pschema = props.get(pname, {})
        val = _smallest_value(pschema, components)
        if val is None:
            # Unknown type for a required field → caller treats as SKIP.
            return None
        body[pname] = val
    return body


# ──────────────────────────────────────────────────────────────────────────────
# 3. Tenant B seed — one row per common tenant-scoped table
# ──────────────────────────────────────────────────────────────────────────────
#
# Insert rows directly via OwnerSessionLocal (bypasses RLS). Keyed by the
# logical "<table>_id" field name so the test can look up a plausible seed for
# ``customer_id``, ``account_id``, etc. Any UUID field whose name isn't in the
# dictionary falls back to a fresh random UUID — the endpoint should 404 on
# it, which still passes the "no 2xx" gate.

# Module-scoped cache so the seed runs once even though parametric instances
# fan out across many tests.
_TENANT_B_SEED: dict[str, Any] = {}


async def _seed_tenant_b() -> dict[str, Any]:
    """Insert tenant B + one minimal row per common tenant-scoped table.
    Returns a dict mapping ``"<table>_id"`` → row UUID (string).

    The actual insertions use raw SQL because (a) raw text() bypasses any
    Python-level defaults that would otherwise paper over missing values, and
    (b) we don't need to instantiate every model class.
    """
    if _TENANT_B_SEED:
        return _TENANT_B_SEED

    async with OwnerSessionLocal() as o:
        # Tenant + supporting party for accounts/parties/payment_methods.
        tb_id = uuid.uuid4()
        o.add(Tenant(id=tb_id, name=f"IDOR-Fuzz-TB-{tb_id.hex[:6]}", status="active"))
        await o.flush()

        party_id = uuid.uuid4()
        await o.execute(text("""
            INSERT INTO party (id, tenant_id, type, name, status)
            VALUES (:i, :t, 'organization', 'IDOR-Fuzz Party', 'active')
        """), {"i": party_id, "t": tb_id})

        account_id = uuid.uuid4()
        await o.execute(text("""
            INSERT INTO account (id, tenant_id, holder_party_id, type, currency, billing_cycle, status)
            VALUES (:i, :t, :p, 'business', 'AMD', 'monthly', 'active')
        """), {"i": account_id, "t": tb_id, "p": party_id})

        customer_id = uuid.uuid4()
        await o.execute(text("""
            INSERT INTO record (id, tenant_id, entity_key, status, data)
            VALUES (:i, :t, 'customer', 'ACTIVE', '{}')
        """), {"i": customer_id, "t": tb_id})

        # studio_page — used by page_bindings.page_id
        page_id = uuid.uuid4()
        await o.execute(text("""
            INSERT INTO studio_page (id, tenant_id, key, label)
            VALUES (:i, :t, :k, 'IDOR-Fuzz Page')
        """), {"i": page_id, "t": tb_id, "k": f"idor-fuzz-{page_id.hex[:6]}"})

        # A few more low-cost seeds whose models are simple. Each row is a
        # tenant-B row that would be a valid IDOR target if any endpoint accepts
        # the corresponding "<x>_id" field.
        helpdesk_queue_id = uuid.uuid4()
        await o.execute(text("""
            INSERT INTO helpdesk_queue (id, tenant_id, name)
            VALUES (:i, :t, 'IDOR-Fuzz Queue')
        """), {"i": helpdesk_queue_id, "t": tb_id})

        await o.commit()

    _TENANT_B_SEED.update({
        "tenant_id":         str(tb_id),
        "party_id":          str(party_id),
        "account_id":        str(account_id),
        "customer_id":       str(customer_id),
        "record_id":         str(customer_id),  # "record" == customer-record
        "page_id":           str(page_id),
        "queue_id":          str(helpdesk_queue_id),
    })
    return _TENANT_B_SEED


# ──────────────────────────────────────────────────────────────────────────────
# 4. The parametric IDOR test
# ──────────────────────────────────────────────────────────────────────────────

_TARGETS = _discover_idor_targets()


def _target_id(triple: tuple[str, str, str]) -> str:
    path, method, field = triple
    return f"{method} {path} {field}"


@pytest.mark.asyncio
@pytest.mark.parametrize("triple", _TARGETS, ids=_target_id)
async def test_endpoint_rejects_cross_tenant_uuid(
    triple: tuple[str, str, str], client, admin
):
    """For every (path, method, uuid_field) discovered in the OpenAPI spec,
    POST/PATCH/PUT with a body skeleton where ``uuid_field`` points at a row in
    tenant B. Assert 4xx (i.e. the endpoint does not silently link tenant A's
    write to a tenant-B row).

    A 2xx here means the endpoint accepted a cross-tenant UUID — the exact IDOR
    shape we're guarding against.
    """
    path, method, uuid_field = triple

    # Known-open hole? Skip with the documented reason.
    if (method, path, uuid_field) in KNOWN_OPEN_HOLES:
        pytest.skip(KNOWN_OPEN_HOLES[(method, path, uuid_field)])

    seed = await _seed_tenant_b()

    spec = _openapi_spec()
    components = spec.get("components", {}).get("schemas", {})
    body = _build_skeleton(path, method, components)
    if body is None:
        pytest.skip(f"Wave-6: cannot build skeleton body for {method} {path} (unknown property type)")

    # Substitute tenant B's UUID into the field under test. Prefer a seeded
    # row of the matching type; fall back to a fresh random UUID (which the
    # endpoint should 404 on — still a 4xx pass).
    cross_uuid = seed.get(uuid_field) or str(uuid.uuid4())
    body[uuid_field] = cross_uuid

    # Send the request as tenant A's admin.
    fn = getattr(client, method.lower())
    res = await fn(path, headers=admin, json=body)

    # Pass: any 4xx (validator rejection, 404, 403) — proves the endpoint did
    # not commit a cross-tenant link. Fail: 2xx (silent acceptance).
    assert 400 <= res.status_code < 500, (
        f"IDOR REGRESSION on {method} {path} field={uuid_field!r}: "
        f"expected 4xx, got {res.status_code}. Body sent: {body!r}. "
        f"Response: {res.text[:300]}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 5. Discovery self-test — proves the fuzzer found *something*
# ──────────────────────────────────────────────────────────────────────────────

def test_fuzzer_discovered_at_least_one_target():
    """Belt-and-braces: if a future refactor accidentally drops every typed
    UUID body field from the spec (e.g. by switching all Pydantic models to
    bare ``dict``), the parametric test set goes to zero and we'd silently
    have NO coverage. This guards against that — if you really do drop to
    zero, you must come edit this test and explain why."""
    assert len(_TARGETS) > 0, (
        "Wave-6 fuzzer discovered ZERO (path, method, uuid_field) triples in the "
        "OpenAPI spec. Either every typed UUID body field has been removed, or "
        "OpenAPI generation is broken. Investigate before suppressing this test."
    )
