"""Idempotency-Key middleware (API Standard file 12, standard 66).

Mutating endpoints (POST/PATCH/DELETE) MAY carry an ``Idempotency-Key`` HTTP
header so a client can safely retry a request after a network blip without
risking a duplicate side-effect (a second charge, a second order, a second
ticket reply). When the header is present and the request authenticates to a
tenant, this middleware:

  1. Computes a SHA-256 fingerprint of the request body.
  2. Looks up an ``idempotency_request`` row keyed on
     ``(tenant_id, idempotency_key, method, path)`` not past ``expires_at``.
  3. HIT + same fingerprint → return the cached ``response_status`` +
     ``response_body`` immediately with header ``X-Idempotent-Replay: true``.
  4. HIT + different fingerprint → 422 ``Idempotency-Key reused with different
     request body`` (the conflict response per the standard).
  5. MISS (or expired) → run the handler. On a 2xx response, INSERT a row with
     ``expires_at = now + 24h``. Non-2xx responses are NEVER cached — only
     successful operations should replay.

Tenant resolution: the middleware runs BEFORE the per-request auth dependency
sets the RLS GUC, so we decode the JWT (or X-API-Key → user lookup) ourselves.
If neither is present / valid, we treat the request as un-tenanted and SKIP
the middleware entirely — the downstream auth dependency will handle the
401 in its usual place. This keeps the middleware off the request path for
all unauthed traffic (login, health, vendor webhooks, etc.).

GET/HEAD/OPTIONS requests are always passed through unchanged (idempotent by
HTTP definition).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# Methods that MAY have side-effects → eligible for idempotent replay.
_MUTATING_METHODS = frozenset({"POST", "PATCH", "DELETE"})

# Default retention window for cached responses. Spec calls for 24h.
_RETENTION = timedelta(hours=24)

# Max idempotency_key length (matches the model column).
_MAX_KEY_LEN = 200

# AC4 — TOCTOU fix: PENDING-row sentinel. The current IdempotencyRequest model
# has no `status` column (adding one is a migration concern, not a code-only
# change), so we encode PENDING into the existing `response_status` integer:
# `0` means "handler in flight" — never a real HTTP status. Real responses
# overwrite it with the 2xx/3xx/etc. status code on completion. See the
# remediation note in the PR description for the migration follow-up.
_PENDING_STATUS_SENTINEL = 0

# Poll budget when a concurrent request owns the slot (status==PENDING).
_PENDING_POLL_TRIES = 25
_PENDING_POLL_DELAY_SECONDS = 0.2  # → 25 × 200 ms = 5 s total before 409


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """Starlette HTTP middleware. Inert when:
      - method is not POST/PATCH/DELETE, or
      - no ``Idempotency-Key`` header is present, or
      - the request cannot be associated with a tenant (unauthed).

    Active otherwise: replays cached 2xx responses, rejects mismatched-body
    re-uses with 422, and caches new 2xx responses for 24h.
    """

    async def dispatch(self, request: Request, call_next):
        # Fast path: non-mutating verbs are never intercepted.
        if request.method not in _MUTATING_METHODS:
            return await call_next(request)

        raw_key = request.headers.get("idempotency-key")
        if not raw_key:
            return await call_next(request)

        # Defensive: keep key bounded to column width — silently treat oversize
        # keys as absent so a misbehaving client can't break the request.
        idem_key = raw_key.strip()
        if not idem_key or len(idem_key) > _MAX_KEY_LEN:
            return await call_next(request)

        # Resolve tenant from the bearer JWT or X-API-Key. If we can't, skip
        # (the downstream auth dep will handle un-tenanted requests as usual).
        tenant_id = await self._resolve_tenant_id(request)
        if tenant_id is None:
            return await call_next(request)

        # Read + restore the body so the downstream handler can re-read it.
        # Starlette caches receive() once consumed, but we re-wire receive()
        # below to replay the bytes after we've fingerprinted them.
        body = await request.body()
        fingerprint = hashlib.sha256(body).hexdigest()

        method = request.method
        path = request.url.path

        # --- AC4 TOCTOU fix: atomic claim-the-slot via INSERT ... ON CONFLICT ----
        # The old shape was: SELECT → (no row) → run handler → INSERT. Two
        # simultaneous requests with the same Idempotency-Key both saw "no row"
        # and both ran the handler → duplicate side-effects (double charge /
        # order / etc.). The fix: race for the row up front. Postgres'
        # INSERT ... ON CONFLICT DO NOTHING RETURNING id atomically gives the
        # winner a row, and tells losers (via "no rows returned") that someone
        # else owns this slot. Losers then either replay the cached response
        # (winner finished) or poll until it does (bounded 5s) or 409.
        from ..db import SessionLocal, set_tenant_guc  # local import: avoid app-startup cycles
        from ..models.idempotency_request import IdempotencyRequest

        now = datetime.now(timezone.utc)
        expires_at = now + _RETENTION

        async def _fetch_existing(sess) -> IdempotencyRequest | None:
            return (
                await sess.execute(
                    select(IdempotencyRequest).where(
                        IdempotencyRequest.tenant_id == tenant_id,
                        IdempotencyRequest.idempotency_key == idem_key,
                        IdempotencyRequest.method == method,
                        IdempotencyRequest.path == path,
                    )
                )
            ).scalar_one_or_none()

        won_the_slot: bool
        slot_row_id: uuid.UUID | None = None
        async with SessionLocal() as s:
            await set_tenant_guc(s, tenant_id)

            # First, drop any clearly-expired row so we can claim its slot.
            # This is best-effort: if a concurrent request already replaced
            # it, ON CONFLICT below still handles the race correctly.
            existing = await _fetch_existing(s)
            if existing is not None and existing.expires_at <= now:
                await s.delete(existing)
                await s.commit()
                # New transaction for the upsert below.
                await set_tenant_guc(s, tenant_id)
                existing = None

            # Atomic claim. PENDING marker = response_status==0, body=={}.
            # Random id so two concurrent inserters never collide on PK.
            new_row_id = uuid.uuid4()
            insert_stmt = (
                pg_insert(IdempotencyRequest)
                .values(
                    id=new_row_id,
                    tenant_id=tenant_id,
                    idempotency_key=idem_key,
                    method=method,
                    path=path,
                    request_fingerprint=fingerprint,
                    response_status=_PENDING_STATUS_SENTINEL,
                    response_body={},
                    expires_at=expires_at,
                )
                .on_conflict_do_nothing(
                    constraint="uq_idempotency_request",
                )
                .returning(IdempotencyRequest.id)
            )
            inserted = (await s.execute(insert_stmt)).scalar_one_or_none()
            await s.commit()

            if inserted is not None:
                won_the_slot = True
                slot_row_id = inserted
            else:
                # Lost the race — someone else owns the slot. Resolve by
                # looking up the existing row and either replay/422/409/poll.
                won_the_slot = False
                slot_row_id = None

        if not won_the_slot:
            # ── path B: another request owns the slot ──
            for attempt in range(_PENDING_POLL_TRIES):
                async with SessionLocal() as s:
                    await set_tenant_guc(s, tenant_id)
                    other = await _fetch_existing(s)

                if other is None:
                    # Row vanished (expiry race + cleanup). Treat as MISS:
                    # fall through to a fresh attempt by recursing once via
                    # a direct call_next — accepting the (tiny) duplicate
                    # window rather than spinning further.
                    break

                if other.response_status != _PENDING_STATUS_SENTINEL:
                    # Winner has finished. Decide reply.
                    if other.request_fingerprint != fingerprint:
                        return JSONResponse(
                            status_code=422,
                            content={
                                "detail": "Idempotency-Key reused with different request body",
                            },
                        )
                    return JSONResponse(
                        status_code=other.response_status,
                        content=other.response_body,
                        headers={"X-Idempotent-Replay": "true"},
                    )

                # Still PENDING — wait a beat and retry.
                await asyncio.sleep(_PENDING_POLL_DELAY_SECONDS)
            else:
                # Exhausted the poll budget — winner is taking too long.
                # Refuse the duplicate rather than risk a second side-effect.
                return JSONResponse(
                    status_code=409,
                    content={
                        "detail": "Idempotency request still in flight",
                    },
                )

            # Row vanished mid-poll → fall through and run the handler fresh.

        # ── path A (winner) OR the rare vanished-row fallback: run the handler ──
        async def _replay_receive():
            return {"type": "http.request", "body": body, "more_body": False}

        request._receive = _replay_receive  # type: ignore[attr-defined]

        response = await call_next(request)

        # Only cache 2xx responses — failures should not replay.
        if not (200 <= response.status_code < 300):
            # Non-2xx: roll the PENDING row back so subsequent retries get a
            # fresh chance instead of being permanently locked out by a 5xx.
            if won_the_slot and slot_row_id is not None:
                try:
                    async with SessionLocal() as s:
                        await set_tenant_guc(s, tenant_id)
                        slot = await _fetch_existing(s)
                        if slot is not None and slot.response_status == _PENDING_STATUS_SENTINEL:
                            await s.delete(slot)
                            await s.commit()
                except Exception:
                    pass
            return response

        # Buffer the response body so we can both cache it AND forward it.
        # StreamingResponse / regular Response both expose body_iterator.
        chunks: list[bytes] = []
        async for chunk in response.body_iterator:  # type: ignore[attr-defined]
            chunks.append(chunk)
        full_body = b"".join(chunks)

        # Attempt to parse JSON; if the handler returned non-JSON (rare on
        # mutating endpoints), don't cache — fall through and forward raw.
        try:
            parsed = json.loads(full_body) if full_body else {}
        except json.JSONDecodeError:
            # Non-JSON: also free the PENDING slot so we don't lock the key.
            if won_the_slot:
                try:
                    async with SessionLocal() as s:
                        await set_tenant_guc(s, tenant_id)
                        slot = await _fetch_existing(s)
                        if slot is not None and slot.response_status == _PENDING_STATUS_SENTINEL:
                            await s.delete(slot)
                            await s.commit()
                except Exception:
                    pass
            return Response(
                content=full_body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )

        # Flip the PENDING row to COMPLETED with the real response.
        try:
            async with SessionLocal() as s:
                await set_tenant_guc(s, tenant_id)
                slot = await _fetch_existing(s)
                if slot is not None:
                    slot.response_status = response.status_code
                    slot.response_body = parsed
                    slot.request_fingerprint = fingerprint
                    slot.expires_at = expires_at
                    s.add(slot)
                    await s.commit()
                else:
                    # Row missing entirely (vanished-row fallback path) —
                    # insert a fresh COMPLETED row. Ignore conflict if a
                    # concurrent winner already wrote one.
                    insert_done = (
                        pg_insert(IdempotencyRequest)
                        .values(
                            tenant_id=tenant_id,
                            idempotency_key=idem_key,
                            method=method,
                            path=path,
                            request_fingerprint=fingerprint,
                            response_status=response.status_code,
                            response_body=parsed,
                            expires_at=expires_at,
                        )
                        .on_conflict_do_nothing(constraint="uq_idempotency_request")
                    )
                    await s.execute(insert_done)
                    await s.commit()
        except Exception:
            # Caching is best-effort — never break a successful request because
            # the cache write failed (race with another retry, transient DB hiccup).
            pass

        return Response(
            content=full_body,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
        )

    # ------------------------------------------------------------------
    # Tenant resolution helpers
    # ------------------------------------------------------------------
    async def _resolve_tenant_id(self, request: Request) -> uuid.UUID | None:
        """Best-effort tenant-id resolver for the middleware path.

        Tries (in order):
          1. ``request.state.tenant_id`` — in case another middleware set it.
          2. The Bearer JWT's ``tenant`` claim (decode locally, no DB hit).
          3. The X-API-Key header → ApiKey row → user.tenant_id (DB hit).

        Returns None when none of the above yields a tenant. Never raises.
        """
        # 1) State already populated.
        cached = getattr(request.state, "tenant_id", None)
        if cached is not None:
            try:
                return cached if isinstance(cached, uuid.UUID) else uuid.UUID(str(cached))
            except (ValueError, TypeError):
                pass

        # 2) JWT bearer — decode locally, just for the tenant claim.
        auth_header = request.headers.get("authorization") or ""
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()
            try:
                from ..security import decode_token
                payload = decode_token(token)
                tclaim = payload.get("tenant")
                if tclaim:
                    return uuid.UUID(str(tclaim))
            except Exception:
                return None  # invalid token → let the downstream dep 401

        # 3) X-API-Key — look up the key row owner-side and read its tenant.
        api_key = request.headers.get("x-api-key")
        if api_key:
            try:
                from ..db import OwnerSessionLocal
                from ..models.apikey import ApiKey
                key_hash = hashlib.sha256(api_key.encode()).hexdigest()
                async with OwnerSessionLocal() as o:
                    # Pre-auth owner session: API-key hash is cluster-unique.
                    await o.connection(execution_options={"audit_tenant_filter": False})
                    row = (await o.execute(
                        select(ApiKey).where(ApiKey.key_hash == key_hash)
                    )).scalar_one_or_none()
                    if row is not None and row.revoked_at is None:
                        return row.tenant_id
            except Exception:
                return None

        return None
