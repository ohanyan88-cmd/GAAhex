"""Regression for assert_can_read_region (kernel/invariants.py) — the SPEC §0.6 region-scoped read gate.

The audit caught a latent AttributeError: the wildcard pre-check iterated access.load_grants() results
(Grant dataclasses) and called r.get("permissions") — Grant has no .get(), so the line raised the moment
any caller passed a real region_id. It was dead because every router passes region_id=None today. These
tests exercise the gate WITH a region_id so the dataclass path is actually covered:
  * super_admin ('*') → passes via the wildcard branch (the previously-broken line),
  * a non-wildcard user with no covering region grant → CrossRegionDenied,
  * region_id=None → no-op (legacy unpartitioned data).
"""
import uuid

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.kernel.invariants import assert_can_read_region, CrossRegionDenied
from app.models import User


async def _user(email: str) -> User:
    async with SessionLocal() as s:
        return (await s.execute(select(User).where(User.email == email))).scalar_one()


async def test_region_read_wildcard_admin_passes(client, admin):
    # admin@demo.isp is super_admin ('*'): a region-scoped read PASSES via the wildcard branch and,
    # critically, does NOT raise AttributeError (Grant is a dataclass with a `.permissions` set).
    u = await _user("admin@demo.isp")
    async with SessionLocal() as s:
        await assert_can_read_region(s, u, region_id=uuid.uuid4())  # must not raise


async def test_region_read_none_is_noop(client, admin):
    # Legacy unpartitioned rows (region_id NULL) are pass-through by contract.
    u = await _user("admin@demo.isp")
    async with SessionLocal() as s:
        await assert_can_read_region(s, u, region_id=None)  # must not raise


async def test_region_read_denies_user_without_region_grant(client, admin, agent):
    # agent@demo.isp is a limited role with no '*' and no org-wide ('any') region grant → default-deny.
    u = await _user("agent@demo.isp")
    async with SessionLocal() as s:
        with pytest.raises(CrossRegionDenied):
            await assert_can_read_region(s, u, region_id=uuid.uuid4())
