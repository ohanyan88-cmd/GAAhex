"""Per-tenant per-prefix reference-number generator backed by Postgres SEQUENCEs.

Standard 8 (ID) / Standard 5 (S5) — every business-visible record carries a
human-friendly reference number of the form ``{PREFIX}-{NNNNNN}`` (REL-000042,
TSK-000017, INV-001234, …). Historically each call site computed the next number
with ``SELECT COUNT(*) + 1``: correct under load by sheer luck of the per-table
UNIQUE constraint, but it races — two concurrent inserts read the same count,
both try to write the same reference number, one wins and the other gets a
constraint violation that surfaces as a 500 the caller has to retry.

This module replaces the count-and-pray pattern with a true atomic source:
one Postgres SEQUENCE per ``(tenant_id, prefix)`` pair, created lazily on first
use and read with ``nextval()``. Postgres SEQUENCEs are MVCC-exempt and serve
distinct values to every caller — no app-side lock, no retry, no race.

Sequence name shape::

    refnum_{prefix_lower}_{tenant_uuid_hex32}

The hex32 form of the tenant id (UUID with dashes stripped, all lowercase)
keeps the identifier under Postgres' 63-byte ``NAMEDATALEN`` limit even with a
long prefix and stays valid as a bare SQL identifier.

Per-tenant isolation: tenant A's TSK counter and tenant B's TSK counter live in
different SEQUENCEs and advance independently. Two tenants can both be at
TSK-000042 at the same time without conflict — the per-tenant UNIQUE
``(tenant_id, reference_number)`` index every refnumbered table carries is the
visible boundary, and the sequence layout matches it exactly.

Cross-tenant ordering is NOT preserved — only per-(tenant, prefix) monotonicity
is guaranteed, which is all the UI / receipts contract cares about.

Usage::

    from app.utils.refnum import next_reference_number
    ref = await next_reference_number(s, tenant_id=user.tenant_id, prefix='TSK')
    # -> 'TSK-000001' on first call for this tenant/prefix, 'TSK-000002' on the next, ...
"""
from __future__ import annotations

import re
import uuid as _uuid
from typing import Union

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# Prefixes are short ASCII tokens (REL, TSK, INV, CRD, PAY, …). Reject anything
# that isn't ``[A-Za-z0-9_]+`` so the value is safe to interpolate into a SQL
# identifier even though we never let user input reach this argument today.
_PREFIX_RE = re.compile(r"^[A-Za-z0-9_]+$")


def _sequence_name(tenant_id: Union[_uuid.UUID, str], prefix: str) -> str:
    """Build the deterministic SEQUENCE name for a (tenant_id, prefix) pair.

    Identifier shape: ``refnum_{prefix_lower}_{tenant_uuid_hex32}``. We strip the
    dashes from the UUID (``str(uuid).replace('-', '')``) to keep the name under
    Postgres' 63-byte identifier cap even with longer prefixes.

    Raises ``ValueError`` for prefixes that aren't a clean identifier token —
    defence-in-depth in case a caller ever forwards user input by accident.
    """
    if not isinstance(prefix, str) or not _PREFIX_RE.match(prefix):
        raise ValueError(
            f"refnum prefix must match {_PREFIX_RE.pattern!r}, got {prefix!r}"
        )
    tid_hex = str(tenant_id).replace("-", "").lower()
    return f"refnum_{prefix.lower()}_{tid_hex}"


async def next_reference_number(
    s: AsyncSession,
    *,
    tenant_id: Union[_uuid.UUID, str],
    prefix: str,
    width: int = 6,
) -> str:
    """Return the next reference number for (tenant_id, prefix), e.g. 'TSK-000042'.

    Lazily creates a per-tenant per-prefix Postgres SEQUENCE on first call
    (``CREATE SEQUENCE IF NOT EXISTS`` is idempotent and safe to call on every
    invocation; Postgres skips the work when the sequence already exists).

    The returned string is::

        f"{prefix}-{n:0{width}d}"

    where ``n`` is the value ``nextval()`` returned — guaranteed distinct across
    concurrent transactions because SEQUENCE allocation lives outside MVCC.

    The caller MUST be inside an active transaction the session will commit
    later (no implicit ``s.commit()`` here — that's the call site's job, same
    as the rest of the unit of work).

    Args:
        s: an active ``AsyncSession`` bound to the target Postgres database.
        tenant_id: tenant UUID — accepted as either ``uuid.UUID`` or string.
        prefix: short identifier prefix (``REL``, ``TSK``, ``INV``, …); must
            match ``[A-Za-z0-9_]+``.
        width: zero-padding width for the numeric portion (default 6 ⇒
            ``TSK-000001``).
    """
    name = _sequence_name(tenant_id, prefix)
    # CREATE SEQUENCE IF NOT EXISTS is idempotent and very cheap when the sequence
    # already exists (single catalog lookup, no lock). Inlining the call keeps
    # this helper stateless — no per-process cache to invalidate when the DB is
    # reset (matters for tests; conftest DROP/CREATEs the database).
    await s.execute(text(f'CREATE SEQUENCE IF NOT EXISTS "{name}"'))
    n = (await s.execute(text(f"SELECT nextval('{name}')"))).scalar_one()
    return f"{prefix}-{int(n):0{width}d}"
