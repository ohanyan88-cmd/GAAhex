"""Idempotency-Key middleware (API Standard file 12, standard 66) — behavioral coverage.

Covers the four canonical cases from the spec:
  1. Same key + same body  → cached response replayed, X-Idempotent-Replay: true.
  2. Same key + different body → 422 (key reused with different request body).
  3. Expired row → handler runs fresh + cache row refreshed.
  4. No Idempotency-Key header → middleware bypassed, every call runs fresh.

We mount a tiny test-only POST route that returns a monotonically increasing
counter; if the middleware replays correctly the counter should NOT advance on
a cache hit. The route requires JWT auth so the middleware can resolve a
tenant_id from the bearer's `tenant` claim — matching the real auth path.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from fastapi import Depends
from sqlalchemy import select, delete

from app.db import OwnerSessionLocal
from app.models.idempotency_request import IdempotencyRequest  # registers on Base.metadata
from app.security import decode_token


# ── self-wire a test route + the middleware so this test file is hermetic ─────
# The orchestrator wires `IdempotencyMiddleware` into main.py at integration
# time (see RETURN block). For tests we mount it on the running FastAPI app and
# stand up a tiny mutating endpoint to exercise it.
_COUNTER = {"n": 0}


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _wire_middleware_and_route():
    from app.main import app
    from app.middleware.idempotency import IdempotencyMiddleware

    # Idempotent re-wire: only add if not already present (orchestrator may
    # have added it in main.py by the time the suite runs).
    already_mounted = any(
        getattr(m, "cls", None) is IdempotencyMiddleware
        for m in getattr(app, "user_middleware", [])
    )
    if not already_mounted:
        # Note: add_middleware AFTER startup is unsupported by FastAPI's normal
        # flow, so we splice it into the user_middleware list directly and
        # rebuild the stack. The ASGITransport in conftest builds the stack on
        # first request, so this is safe at module-scope before any request fires.
        from starlette.middleware import Middleware
        app.user_middleware.insert(0, Middleware(IdempotencyMiddleware))
        app.middleware_stack = app.build_middleware_stack()

    # Mount a tiny POST route that returns an incrementing counter. The
    # middleware's "cache replay" property is observable as: same key+body
    # twice → counter advances only once.
    @app.post("/api/_test/idem-echo")
    async def _echo(payload: dict):
        _COUNTER["n"] += 1
        return {"counter": _COUNTER["n"], "echo": payload}

    yield

    # Best-effort cleanup of test-created idempotency_request rows.
    async with OwnerSessionLocal() as o:
        await o.execute(
            delete(IdempotencyRequest).where(
                IdempotencyRequest.path == "/api/_test/idem-echo"
            )
        )
        await o.commit()


@pytest_asyncio.fixture
async def _reset_counter():
    _COUNTER["n"] = 0
    yield
    _COUNTER["n"] = 0


def _new_key() -> str:
    return f"test-idem-{uuid.uuid4()}"


# ──────────────────────────────────────────────────────────────────────────────
# 1) Same key + same body → cached response replayed.
# ──────────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_same_key_same_body_replays_cached_response(client, admin, _reset_counter):
    key = _new_key()
    body = {"foo": "bar", "n": 1}

    r1 = await client.post(
        "/api/_test/idem-echo",
        json=body,
        headers={**admin, "Idempotency-Key": key},
    )
    assert r1.status_code == 200, r1.text
    first = r1.json()
    assert first["counter"] == 1
    assert first["echo"] == body

    # Replay: same key + same body. The handler must NOT run again, so the
    # counter on the response must still be 1 and the replay header must be set.
    r2 = await client.post(
        "/api/_test/idem-echo",
        json=body,
        headers={**admin, "Idempotency-Key": key},
    )
    assert r2.status_code == 200, r2.text
    assert r2.headers.get("X-Idempotent-Replay") == "true"
    assert r2.json() == first  # exact same response replayed
    # In-process counter never advanced past 1.
    assert _COUNTER["n"] == 1


# ──────────────────────────────────────────────────────────────────────────────
# 2) Same key + different body → 422.
# ──────────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_same_key_different_body_rejected_422(client, admin, _reset_counter):
    key = _new_key()
    body_a = {"foo": "bar"}
    body_b = {"foo": "DIFFERENT"}

    r1 = await client.post(
        "/api/_test/idem-echo",
        json=body_a,
        headers={**admin, "Idempotency-Key": key},
    )
    assert r1.status_code == 200, r1.text

    r2 = await client.post(
        "/api/_test/idem-echo",
        json=body_b,
        headers={**admin, "Idempotency-Key": key},
    )
    assert r2.status_code == 422, r2.text
    assert "different request body" in r2.json()["detail"].lower()
    # The handler ran exactly once (first call); the second was rejected pre-handler.
    assert _COUNTER["n"] == 1


# ──────────────────────────────────────────────────────────────────────────────
# 3) Expired row → fresh request runs + cache refreshed.
# ──────────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_expired_row_triggers_fresh_request(client, admin, _reset_counter):
    key = _new_key()
    body = {"foo": "bar"}

    r1 = await client.post(
        "/api/_test/idem-echo",
        json=body,
        headers={**admin, "Idempotency-Key": key},
    )
    assert r1.status_code == 200, r1.text
    assert _COUNTER["n"] == 1

    # Resolve the admin's tenant_id from the JWT (mirrors what the middleware
    # would have stored) so we can target the cache row directly.
    token = admin["Authorization"].split(" ", 1)[1]
    tenant_id = uuid.UUID(decode_token(token)["tenant"])

    # Force the cache row to "already expired" — the middleware should then
    # treat the next call as a MISS, re-run the handler, and refresh the row.
    async with OwnerSessionLocal() as o:
        row = (await o.execute(
            select(IdempotencyRequest).where(
                IdempotencyRequest.tenant_id == tenant_id,
                IdempotencyRequest.idempotency_key == key,
            )
        )).scalar_one()
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await o.commit()

    r2 = await client.post(
        "/api/_test/idem-echo",
        json=body,
        headers={**admin, "Idempotency-Key": key},
    )
    assert r2.status_code == 200, r2.text
    # Fresh handler run: counter advanced.
    assert r2.json()["counter"] == 2
    assert _COUNTER["n"] == 2
    # Replay header MUST NOT be set on a fresh response.
    assert r2.headers.get("X-Idempotent-Replay") is None


# ──────────────────────────────────────────────────────────────────────────────
# 4) No Idempotency-Key header → middleware bypassed.
# ──────────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_no_key_header_bypasses_middleware(client, admin, _reset_counter):
    body = {"foo": "bar"}

    r1 = await client.post("/api/_test/idem-echo", json=body, headers=admin)
    r2 = await client.post("/api/_test/idem-echo", json=body, headers=admin)
    assert r1.status_code == 200 and r2.status_code == 200
    # No replay header, and the handler ran TWICE (no caching).
    assert r1.headers.get("X-Idempotent-Replay") is None
    assert r2.headers.get("X-Idempotent-Replay") is None
    assert r1.json()["counter"] == 1
    assert r2.json()["counter"] == 2
    assert _COUNTER["n"] == 2
