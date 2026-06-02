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

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# Methods that MAY have side-effects → eligible for idempotent replay.
_MUTATING_METHODS = frozenset({"POST", "PATCH", "DELETE"})

# Default retention window for cached responses. Spec calls for 24h.
_RETENTION = timedelta(hours=24)

# Max idempotency_key length (matches the model column).
_MAX_KEY_LEN = 200


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

        # --- lookup existing row -----------------------------------------
        from ..db import SessionLocal, set_tenant_guc  # local import: avoid app-startup cycles
        from ..models.idempotency_request import IdempotencyRequest

        now = datetime.now(timezone.utc)
        async with SessionLocal() as s:
            # Bind RLS for this lookup so the row is tenant-scoped.
            await set_tenant_guc(s, tenant_id)
            existing = (
                await s.execute(
                    select(IdempotencyRequest).where(
                        IdempotencyRequest.tenant_id == tenant_id,
                        IdempotencyRequest.idempotency_key == idem_key,
                        IdempotencyRequest.method == method,
                        IdempotencyRequest.path == path,
                    )
                )
            ).scalar_one_or_none()

            if existing is not None and existing.expires_at > now:
                if existing.request_fingerprint != fingerprint:
                    return JSONResponse(
                        status_code=422,
                        content={
                            "detail": "Idempotency-Key reused with different request body",
                        },
                    )
                # HIT + matching fingerprint → replay the cached response.
                return JSONResponse(
                    status_code=existing.response_status,
                    content=existing.response_body,
                    headers={"X-Idempotent-Replay": "true"},
                )

        # --- MISS (or expired): run the handler with a replayable body ----
        async def _replay_receive():
            return {"type": "http.request", "body": body, "more_body": False}

        request._receive = _replay_receive  # type: ignore[attr-defined]

        response = await call_next(request)

        # Only cache 2xx responses — failures should not replay.
        if not (200 <= response.status_code < 300):
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
            return Response(
                content=full_body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )

        # Write the cache row. Use a fresh session because the response is
        # already on its way and we don't want to entangle errors.
        try:
            async with SessionLocal() as s:
                await set_tenant_guc(s, tenant_id)
                if existing is not None:
                    # Stale row past expiry — refresh it in place.
                    existing.request_fingerprint = fingerprint
                    existing.response_status = response.status_code
                    existing.response_body = parsed
                    existing.expires_at = now + _RETENTION
                    s.add(existing)
                else:
                    s.add(IdempotencyRequest(
                        tenant_id=tenant_id,
                        idempotency_key=idem_key,
                        method=method,
                        path=path,
                        request_fingerprint=fingerprint,
                        response_status=response.status_code,
                        response_body=parsed,
                        expires_at=now + _RETENTION,
                    ))
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
