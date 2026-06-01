"""Phase B.2 — LoggingAdapter v1 tests.

Direct-call tests of ``services.network_adapter.LoggingAdapter``. Each method must:
  * write exactly one ServiceActionLog row with adapter='logging'
  * persist the correct ``action`` enum (notice / throttle / walled_garden / terminate / restore)
  * flip Service.status per the v1 doctrine
      - throttle / walled_garden → SUSPENDED
      - terminate → TERMINATED
      - restore → ACTIVE
      - send_notice → no Service mutation
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.dunning import ServiceActionLog
from app.models.service import Service
from app.models.user import User
from app.services.network_adapter import LoggingAdapter, get_network_adapter


# ---------- helpers ----------

async def _admin_tenant_id() -> uuid.UUID:
    async with SessionLocal() as s:
        u = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        return u.tenant_id


async def _make_service(name: str = "AdapterTest") -> tuple[uuid.UUID, uuid.UUID]:
    """Return (service_id, tenant_id) for a freshly created ACTIVE service."""
    tid = await _admin_tenant_id()
    async with SessionLocal() as s:
        svc = Service(
            tenant_id=tid,
            type="internet",
            name=f"{name}-{uuid.uuid4().hex[:6]}",
            status="ACTIVE",
        )
        s.add(svc)
        await s.commit()
        return svc.id, tid


async def _service_status(service_id: uuid.UUID) -> str:
    async with SessionLocal() as s:
        svc = (await s.execute(select(Service).where(Service.id == service_id))).scalar_one()
        return svc.status


async def _logs_for_service(service_id: uuid.UUID) -> list[ServiceActionLog]:
    async with SessionLocal() as s:
        return list((await s.execute(
            select(ServiceActionLog).where(ServiceActionLog.service_id == service_id)
            .order_by(ServiceActionLog.requested_at)
        )).scalars().all())


# ===================== throttle =====================

async def test_throttle_flips_suspended_and_logs():
    svc_id, tid = await _make_service("throttle")
    adapter = LoggingAdapter()
    async with SessionLocal() as s:
        result = await adapter.throttle(s, tenant_id=tid, service_id=svc_id, kbps=128)
        await s.commit()
    assert result["status"] == "success"

    assert await _service_status(svc_id) == "SUSPENDED"
    logs = await _logs_for_service(svc_id)
    assert len(logs) == 1
    assert logs[0].action == "throttle"
    assert logs[0].adapter == "logging"


# ===================== walled_garden =====================

async def test_walled_garden_flips_suspended_and_logs():
    svc_id, tid = await _make_service("wg")
    adapter = LoggingAdapter()
    async with SessionLocal() as s:
        await adapter.walled_garden(s, tenant_id=tid, service_id=svc_id,
                                    redirect_url="https://pay.example.com")
        await s.commit()

    assert await _service_status(svc_id) == "SUSPENDED"
    logs = await _logs_for_service(svc_id)
    assert len(logs) == 1
    assert logs[0].action == "walled_garden"
    assert logs[0].adapter == "logging"


# ===================== terminate =====================

async def test_terminate_flips_terminated_and_logs():
    svc_id, tid = await _make_service("term")
    adapter = LoggingAdapter()
    async with SessionLocal() as s:
        await adapter.terminate(s, tenant_id=tid, service_id=svc_id)
        await s.commit()

    assert await _service_status(svc_id) == "TERMINATED"
    logs = await _logs_for_service(svc_id)
    assert len(logs) == 1
    assert logs[0].action == "terminate"
    assert logs[0].adapter == "logging"


# ===================== restore =====================

async def test_restore_flips_active_and_logs():
    svc_id, tid = await _make_service("rest")
    # First push it down so restore is meaningful.
    async with SessionLocal() as s:
        svc = (await s.execute(select(Service).where(Service.id == svc_id))).scalar_one()
        svc.status = "SUSPENDED"
        await s.commit()

    adapter = LoggingAdapter()
    async with SessionLocal() as s:
        await adapter.restore(s, tenant_id=tid, service_id=svc_id)
        await s.commit()

    assert await _service_status(svc_id) == "ACTIVE"
    logs = await _logs_for_service(svc_id)
    assert len(logs) == 1
    assert logs[0].action == "restore"
    assert logs[0].adapter == "logging"


# ===================== send_notice writes a log row (no service mutation) =====================

async def test_send_notice_writes_log_no_service_change():
    svc_id, tid = await _make_service("notice")
    # send_notice targets an ACCOUNT, not a service — so the service is untouched.
    adapter = LoggingAdapter()
    account_id = uuid.uuid4()  # fake account id is fine — the row writes service_id=None
    async with SessionLocal() as s:
        await adapter.send_notice(s, tenant_id=tid, account_id=account_id,
                                  template="welcome")
        await s.commit()

    # service untouched
    assert await _service_status(svc_id) == "ACTIVE"

    # one notice log row exists for this tenant with the right action/adapter
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(ServiceActionLog).where(
                ServiceActionLog.tenant_id == tid,
                ServiceActionLog.action == "notice",
            )
        )).scalars().all()
    assert any(r.adapter == "logging" for r in rows)


# ===================== factory returns the canonical LoggingAdapter =====================

async def test_get_network_adapter_returns_logging_adapter():
    a = get_network_adapter()
    assert isinstance(a, LoggingAdapter)


# ===================== adapter status is 'success' on all v1 paths =====================

async def test_all_adapter_methods_report_success_status():
    """Every LoggingAdapter method returns ``status='success'`` and writes a row with the same
    status (v1 never fails — real-vendor adapters will set 'failed' on RADIUS/BNG errors)."""
    svc_id, tid = await _make_service("success")
    adapter = LoggingAdapter()
    async with SessionLocal() as s:
        r1 = await adapter.throttle(s, tenant_id=tid, service_id=svc_id, kbps=64)
        r2 = await adapter.walled_garden(s, tenant_id=tid, service_id=svc_id,
                                         redirect_url="https://x.test")
        r3 = await adapter.terminate(s, tenant_id=tid, service_id=svc_id)
        r4 = await adapter.restore(s, tenant_id=tid, service_id=svc_id)
        r5 = await adapter.send_notice(s, tenant_id=tid, account_id=uuid.uuid4(),
                                        template="dunning_notice_1")
        await s.commit()
    for result in (r1, r2, r3, r4, r5):
        assert result["status"] == "success"
        assert result["error"] is None

    # All persisted rows for THIS service show status='success'.
    logs = await _logs_for_service(svc_id)
    assert len(logs) >= 4  # throttle/walled_garden/terminate/restore (notice targets account, not svc)
    for row in logs:
        assert row.status == "success"
        assert row.adapter == "logging"
