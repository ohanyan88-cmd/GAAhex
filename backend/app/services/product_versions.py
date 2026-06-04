"""Phase A.1 — ProductVersion service helpers.

Two functions:

* ``current_version_for(session, product_id, at)`` — returns the ProductVersion whose
  ``[effective_from, effective_to)`` window contains ``at``. ``effective_to=NULL`` means "still
  current"; the function treats NULL as +infinity. Returns ``None`` if no version covers ``at``
  (e.g. ``at`` is before the first version's ``effective_from``).
* ``mint_new_version(session, product_id, attrs, actor=None)`` — closes the prior open version's
  ``effective_to`` to ``now``, points its ``superseded_by_id`` at the new row, and inserts a new
  version with ``version_no = max(prior) + 1`` and ``effective_from = now``. ``attrs`` is the
  pricing snapshot (recurring_price / one_time_price / cycle + a free-form spec_json blob the
  caller fills with whatever else needs to round-trip).

Both functions are pure helpers — the caller owns commit/rollback. The session is whatever the
caller has (router-scoped or a fresh ``SessionLocal()``); we don't open one.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.product import Product
from ..models.product_version import ProductVersion


def _utcnow() -> datetime:
    """Single source of "now" — tz-aware UTC, matches every other timestamp in the app."""
    return datetime.now(timezone.utc)


def _to_decimal(value: Any) -> Decimal | None:
    """Coerce caller input (string / int / Decimal / None) into a Decimal — None passes through."""
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


async def current_version_for(
    session: AsyncSession,
    product_id: uuid.UUID,
    at: datetime,
) -> ProductVersion | None:
    """Return the ProductVersion whose window covers ``at``.

    Rule: ``effective_from <= at`` AND (``effective_to`` IS NULL OR ``at < effective_to``).
    The half-open right edge means a freshly-minted version replaces its predecessor at the
    same instant without any "double-cover" ambiguity. Returns ``None`` if ``at`` is before
    the first version or no version exists for the product.
    """
    rows = (await session.execute(
        select(ProductVersion).where(ProductVersion.product_id == product_id)
        .order_by(ProductVersion.version_no)
    )).scalars().all()
    for v in rows:
        if v.effective_from is None:
            continue
        if v.effective_from <= at and (v.effective_to is None or at < v.effective_to):
            return v
    return None


async def mint_new_version(
    session: AsyncSession,
    product_id: uuid.UUID,
    attrs: dict,
    actor: Any = None,  # noqa: ARG001 - reserved for future audit hookup
) -> ProductVersion:
    """Close the prior open version and mint a fresh one for ``product_id``.

    ``attrs`` may contain ``recurring_price``, ``one_time_price``, ``cycle``, ``spec_json``;
    anything else is ignored at the column level but preserved if it's already part of the
    caller's ``spec_json`` blob.

    The new version's ``version_no`` is ``max(prior.version_no) + 1`` (1 for the first version).
    ``effective_from`` is set to ``now``; ``effective_to`` stays NULL (it's the live version).
    The prior open version's ``effective_to`` is closed to the same ``now`` instant and its
    ``superseded_by_id`` is wired to the new row.

    The caller is responsible for ``await session.commit()``.
    """
    now = _utcnow()

    # Single source of truth for the version's tenant: the parent Product's tenant_id. Anchoring
    # here (vs. accepting it from the caller) keeps it FK-consistent and prevents cross-tenant mints.
    tenant_id = (await session.execute(
        select(Product.tenant_id).where(Product.id == product_id)
    )).scalar_one()

    # max version_no so far + the still-open version (if any) — one round-trip each, both cheap.
    max_no_row = (await session.execute(
        select(func.max(ProductVersion.version_no)).where(ProductVersion.product_id == product_id)
    )).scalar_one()
    next_no = (max_no_row or 0) + 1

    open_prior = (await session.execute(
        select(ProductVersion).where(
            ProductVersion.product_id == product_id,
            ProductVersion.effective_to.is_(None),
        ).order_by(ProductVersion.version_no.desc())
    )).scalars().first()

    spec_json = dict(attrs.get("spec_json") or {})
    new_version = ProductVersion(
        tenant_id=tenant_id,
        product_id=product_id,
        version_no=next_no,
        effective_from=now,
        effective_to=None,
        recurring_price=_to_decimal(attrs.get("recurring_price")),
        one_time_price=_to_decimal(attrs.get("one_time_price")),
        cycle=attrs.get("cycle"),
        spec_json=spec_json,
    )
    session.add(new_version)
    await session.flush()  # populate new_version.id so we can wire superseded_by_id below

    if open_prior is not None:
        open_prior.effective_to = now
        open_prior.superseded_by_id = new_version.id
        await session.flush()

    return new_version
