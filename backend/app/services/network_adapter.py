"""Phase B.2 — NetworkAdapter protocol + v1 LoggingAdapter.

Adapters not core: the dunning runner calls a NetworkAdapter for every step that touches a
service. v1 is the LoggingAdapter — it writes a `service_action_log` row and flips
`Service.status` (PENDING/ACTIVE/SUSPENDED/TERMINATED). NO real RADIUS / BNG / vendor calls.
Real-vendor adapters (Huawei OLT, FreeRADIUS, etc.) slot in behind this protocol later.

State doctrine for v1:
  - throttle       → Service.status = 'SUSPENDED' (real adapter would shape via BNG/RADIUS)
  - walled_garden  → Service.status = 'SUSPENDED' (real adapter would redirect via RADIUS-COA)
  - terminate      → Service.status = 'TERMINATED'
  - restore        → Service.status = 'ACTIVE'
  - send_notice    → no Service mutation; log-only (future hook into outbound/notification)

All methods return an ``ActionResult`` dict — `{status, response, error}`. The caller is the
dunning runner; it persists the log row (the adapter only WRITES that row and the Service
mutation; commit ownership stays with the runner).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Protocol, TypedDict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.dunning import ServiceActionLog
from ..models.service import Service


class ActionResult(TypedDict):
    status: str           # 'SUCCESS' | 'FAILED'
    response: dict
    error: str | None


class NetworkAdapter(Protocol):
    """Behavioural contract for any backend that actuates dunning steps. v1 = LoggingAdapter."""

    async def throttle(
        self, session: AsyncSession, *, tenant_id: uuid.UUID, service_id: uuid.UUID, kbps: int,
        dunning_case_id: uuid.UUID | None = None,
    ) -> ActionResult: ...

    async def walled_garden(
        self, session: AsyncSession, *, tenant_id: uuid.UUID, service_id: uuid.UUID,
        redirect_url: str, dunning_case_id: uuid.UUID | None = None,
    ) -> ActionResult: ...

    async def terminate(
        self, session: AsyncSession, *, tenant_id: uuid.UUID, service_id: uuid.UUID,
        dunning_case_id: uuid.UUID | None = None,
    ) -> ActionResult: ...

    async def restore(
        self, session: AsyncSession, *, tenant_id: uuid.UUID, service_id: uuid.UUID,
        dunning_case_id: uuid.UUID | None = None,
    ) -> ActionResult: ...

    async def send_notice(
        self, session: AsyncSession, *, tenant_id: uuid.UUID, account_id: uuid.UUID,
        template: str, dunning_case_id: uuid.UUID | None = None,
    ) -> ActionResult: ...


# ---- v1: LoggingAdapter -------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def _flip_service_status(
    session: AsyncSession, service_id: uuid.UUID, new_status: str,
) -> bool:
    """Set ``Service.status`` to new_status. Returns True if a row was found/updated."""
    svc = (await session.execute(
        select(Service).where(Service.id == service_id)
    )).scalar_one_or_none()
    if svc is None:
        return False
    svc.status = new_status
    await session.flush()
    return True


async def _log_action(
    session: AsyncSession, *, tenant_id: uuid.UUID, service_id: uuid.UUID | None,
    dunning_case_id: uuid.UUID | None, action: str, request_payload: dict,
    response_payload: dict, status: str, error_message: str | None = None,
) -> ServiceActionLog:
    """Write ONE ServiceActionLog row. Returns the persisted (flushed) row."""
    now = _utcnow()
    row = ServiceActionLog(
        tenant_id=tenant_id,
        service_id=service_id,
        dunning_case_id=dunning_case_id,
        action=action,
        adapter="logging",
        request_payload=request_payload,
        response_payload=response_payload,
        status=status,
        requested_at=now,
        completed_at=now if status in ("SUCCESS", "FAILED") else None,
        error_message=error_message,
    )
    session.add(row)
    await session.flush()
    return row


class LoggingAdapter:
    """v1 — writes to ``service_action_log`` + flips ``Service.status``. No real network call."""

    async def throttle(
        self, session: AsyncSession, *, tenant_id: uuid.UUID, service_id: uuid.UUID, kbps: int,
        dunning_case_id: uuid.UUID | None = None,
    ) -> ActionResult:
        request = {"service_id": str(service_id), "kbps": int(kbps)}
        found = await _flip_service_status(session, service_id, "SUSPENDED")
        response = {"applied": found, "service_id": str(service_id), "new_status": "SUSPENDED"}
        result: ActionResult = {"status": "SUCCESS", "response": response, "error": None}
        await _log_action(
            session, tenant_id=tenant_id, service_id=service_id,
            dunning_case_id=dunning_case_id, action="throttle",
            request_payload=request, response_payload=response, status="SUCCESS",
        )
        return result

    async def walled_garden(
        self, session: AsyncSession, *, tenant_id: uuid.UUID, service_id: uuid.UUID,
        redirect_url: str, dunning_case_id: uuid.UUID | None = None,
    ) -> ActionResult:
        request = {"service_id": str(service_id), "redirect_url": str(redirect_url)}
        # A future spec may distinguish; for v1 walled_garden = SUSPENDED with a redirect note.
        found = await _flip_service_status(session, service_id, "SUSPENDED")
        response = {"applied": found, "service_id": str(service_id), "new_status": "SUSPENDED",
                    "redirect_url": str(redirect_url)}
        result: ActionResult = {"status": "SUCCESS", "response": response, "error": None}
        await _log_action(
            session, tenant_id=tenant_id, service_id=service_id,
            dunning_case_id=dunning_case_id, action="walled_garden",
            request_payload=request, response_payload=response, status="SUCCESS",
        )
        return result

    async def terminate(
        self, session: AsyncSession, *, tenant_id: uuid.UUID, service_id: uuid.UUID,
        dunning_case_id: uuid.UUID | None = None,
    ) -> ActionResult:
        request = {"service_id": str(service_id)}
        found = await _flip_service_status(session, service_id, "TERMINATED")
        response = {"applied": found, "service_id": str(service_id), "new_status": "TERMINATED"}
        result: ActionResult = {"status": "SUCCESS", "response": response, "error": None}
        await _log_action(
            session, tenant_id=tenant_id, service_id=service_id,
            dunning_case_id=dunning_case_id, action="terminate",
            request_payload=request, response_payload=response, status="SUCCESS",
        )
        return result

    async def restore(
        self, session: AsyncSession, *, tenant_id: uuid.UUID, service_id: uuid.UUID,
        dunning_case_id: uuid.UUID | None = None,
    ) -> ActionResult:
        request = {"service_id": str(service_id)}
        found = await _flip_service_status(session, service_id, "ACTIVE")
        response = {"applied": found, "service_id": str(service_id), "new_status": "ACTIVE"}
        result: ActionResult = {"status": "SUCCESS", "response": response, "error": None}
        await _log_action(
            session, tenant_id=tenant_id, service_id=service_id,
            dunning_case_id=dunning_case_id, action="restore",
            request_payload=request, response_payload=response, status="SUCCESS",
        )
        return result

    async def send_notice(
        self, session: AsyncSession, *, tenant_id: uuid.UUID, account_id: uuid.UUID,
        template: str, dunning_case_id: uuid.UUID | None = None,
    ) -> ActionResult:
        request = {"account_id": str(account_id), "template": str(template)}
        # Log-only — no Service mutation (notices target the account, not a single service).
        response = {"queued": True, "account_id": str(account_id), "template": str(template)}
        result: ActionResult = {"status": "SUCCESS", "response": response, "error": None}
        await _log_action(
            session, tenant_id=tenant_id, service_id=None,
            dunning_case_id=dunning_case_id, action="notice",
            request_payload=request, response_payload=response, status="SUCCESS",
        )
        return result


# ---- factory ----------------------------------------------------------------------

_DEFAULT_ADAPTER: NetworkAdapter | None = None


def get_network_adapter() -> NetworkAdapter:
    """Single factory. Returns ``LoggingAdapter`` for v1; future env switch picks vendor adapters."""
    global _DEFAULT_ADAPTER
    if _DEFAULT_ADAPTER is None:
        _DEFAULT_ADAPTER = LoggingAdapter()
    return _DEFAULT_ADAPTER
