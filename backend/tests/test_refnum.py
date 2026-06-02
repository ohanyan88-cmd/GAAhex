"""Tests for ``app.utils.refnum.next_reference_number`` — the per-tenant
per-prefix Postgres-SEQUENCE-backed reference-number generator.

The helper is meant to replace the legacy ``SELECT COUNT(*) + 1`` pattern at
every reference-number call site (REL-000042, TSK-000017, …). These tests
cover the three properties that ``COUNT(*) + 1`` had to fake and the SEQUENCE
gets for free:

1. **Monotonicity per (tenant, prefix)** — consecutive calls return strictly
   ascending integers (1, 2, 3, …).
2. **Tenant isolation** — different tenants share the same prefix but advance
   independently.
3. **Prefix isolation + format** — different prefixes within the same tenant
   don't share state, and the rendered string matches ``{PREFIX}-{6-digit-pad}``.

Each test uses a freshly-minted random tenant id (a bare UUID — no FK is hit
because the SEQUENCEs live in the global ``public`` schema, not a tenant-FK
table) so cross-test contamination via the shared test DB is impossible.
"""
import re
import uuid

import pytest

from app.db import OwnerSessionLocal
from app.utils.refnum import next_reference_number


_FORMAT_RE = re.compile(r"^([A-Z0-9_]+)-(\d{6})$")


@pytest.mark.asyncio
async def test_returns_ascending_values_per_tenant_per_prefix():
    """A run of calls with the same (tenant_id, prefix) must produce strictly
    increasing numeric tails — 1, 2, 3, … — and the prefix portion must match
    on every value."""
    tenant_id = uuid.uuid4()
    async with OwnerSessionLocal() as s:
        refs = [
            await next_reference_number(s, tenant_id=tenant_id, prefix="TSK")
            for _ in range(5)
        ]
        await s.commit()

    nums = []
    for ref in refs:
        m = _FORMAT_RE.match(ref)
        assert m is not None, f"unexpected refnum shape: {ref!r}"
        assert m.group(1) == "TSK"
        nums.append(int(m.group(2)))

    # Strictly ascending — every call increments by exactly 1 from the previous.
    assert nums == sorted(nums)
    assert all(b - a == 1 for a, b in zip(nums, nums[1:])), nums
    # Fresh sequence — first call returns 1.
    assert nums[0] == 1


@pytest.mark.asyncio
async def test_different_tenants_have_independent_sequences():
    """Two distinct tenants pulling the same prefix must each see their own
    counter — both start at 1 even though they share the prefix string."""
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()

    async with OwnerSessionLocal() as s:
        a1 = await next_reference_number(s, tenant_id=tenant_a, prefix="INV")
        a2 = await next_reference_number(s, tenant_id=tenant_a, prefix="INV")
        b1 = await next_reference_number(s, tenant_id=tenant_b, prefix="INV")
        b2 = await next_reference_number(s, tenant_id=tenant_b, prefix="INV")
        await s.commit()

    assert a1 == "INV-000001"
    assert a2 == "INV-000002"
    # Tenant B's counter is untouched by tenant A's traffic.
    assert b1 == "INV-000001"
    assert b2 == "INV-000002"


@pytest.mark.asyncio
async def test_format_is_prefix_dash_six_digit_zero_padded_and_prefix_isolated():
    """The rendered string must be ``{PREFIX}-{6 digits, zero-padded}``, and
    two distinct prefixes within the SAME tenant must NOT share state — each
    prefix gets its own sequence."""
    tenant_id = uuid.uuid4()

    async with OwnerSessionLocal() as s:
        tsk = await next_reference_number(s, tenant_id=tenant_id, prefix="TSK")
        rel = await next_reference_number(s, tenant_id=tenant_id, prefix="REL")
        # Pull TSK again to confirm the REL call didn't bump it.
        tsk2 = await next_reference_number(s, tenant_id=tenant_id, prefix="TSK")
        await s.commit()

    # Exact format check.
    assert tsk == "TSK-000001"
    assert rel == "REL-000001"
    assert tsk2 == "TSK-000002"

    for ref in (tsk, rel, tsk2):
        m = _FORMAT_RE.match(ref)
        assert m is not None, f"refnum {ref!r} does not match {{PREFIX}}-NNNNNN"
        # Zero-padded to width 6 exactly — never 5 digits, never 7.
        assert len(m.group(2)) == 6
