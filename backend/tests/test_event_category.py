"""EventCategory is a CODE-ENFORCED enum (docs/standards file 14 / E14·E21), not a free-text comment.

The audit flagged that the 16-value EventCategory superset was only documented in a model comment while
the column was a free String(30). It is now enforced: EVENT_CATEGORIES is the canonical set and
workflow.emit() — the single append-only write path — rejects any Event whose category is outside it
(None stays allowed for legacy rows). The whole suite emitting only conforming categories proves the
happy path; these tests pin the set + the rejection.
"""
import re
import uuid

import pytest
from sqlalchemy import select

from app import workflow
from app.db import SessionLocal
from app.models import Tenant
from app.models.event import EVENT_CATEGORIES


def test_event_categories_are_exactly_16_upper_snake():
    assert len(EVENT_CATEGORIES) == 16, sorted(EVENT_CATEGORIES)
    assert all(re.fullmatch(r"[A-Z]+(_[A-Z]+)*", c) for c in EVENT_CATEGORIES), sorted(EVENT_CATEGORIES)
    # spot-check the documented superset members
    assert {"LIFECYCLE", "STATUS", "APPROVAL", "FINANCIAL", "SECURITY", "SYSTEM"} <= EVENT_CATEGORIES


async def test_emit_rejects_category_outside_the_enum():
    async with SessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        # the validation fires before the Event is added, so no real record/commit is needed
        with pytest.raises(ValueError):
            await workflow.emit(s, tenant.id, "TEST", "widget", uuid.uuid4(), None, {}, category="BOGUS")
        with pytest.raises(ValueError):  # case matters — lowercase is not UPPER_SNAKE
            await workflow.emit(s, tenant.id, "TEST", "widget", uuid.uuid4(), None, {}, category="security")


async def test_emit_accepts_a_valid_category_and_none():
    async with SessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        # neither raises (valid 16-set member, and the legacy None) — rolled back, not committed
        await workflow.emit(s, tenant.id, "TEST", "widget", uuid.uuid4(), None, {}, category="SECURITY")
        await workflow.emit(s, tenant.id, "TEST", "widget", uuid.uuid4(), None, {}, category=None)
        await s.rollback()
