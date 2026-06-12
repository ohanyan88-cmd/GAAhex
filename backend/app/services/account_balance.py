"""Phase A.2 — Account balance + hierarchy services.

Four pure helpers the routers compose:

* ``recompute_account_balance(session, account_id)`` — authoritative recompute of one leaf
  account's signed balance from its invoices + payments. Idempotent. Returns the new balance.
* ``consolidated_balance(session, root_account_id)`` — walks the materialized-path subtree and
  aggregates current_balance + credit_limit across every descendant (root included).
* ``rebuild_hierarchy_path(session, account_id)`` — recompute the materialized path for ONE node
  by walking up ``parent_account_id``. Used on account create / single-node fix-up.
* ``rebuild_descendants_paths(session, account_id)`` — after a reparent, rebuild paths for the
  moved node AND every descendant beneath it (topological / level-order).

All four are pure helpers — the caller owns ``await session.commit()``. The signed convention is:

    NEGATIVE current_balance = customer owes us
    POSITIVE current_balance = credit on the account

Formula (signed luma, Numeric(14,2)):

    outstanding_invoiced = SUM(invoice.total WHERE account_id=X AND status IN ('ISSUED','OVERDUE','PAID'))
    payments_collected   = SUM(payment.amount - COALESCE(payment.refunded_amount, 0) WHERE account_id=X)
    current_balance      = payments_collected - outstanding_invoiced
    available_credit     = MAX(0, credit_limit + current_balance)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.party import Account
from ..models.billing import Invoice, Payment
from ..utils.billing_constants import BILLED_STATUSES as _BILLED_STATUSES  # BL-6


_ZERO = Decimal("0")


def _utcnow() -> datetime:
    """Tz-aware UTC; matches every other timestamp in the app."""
    return datetime.now(timezone.utc)


async def recompute_account_balance(session: AsyncSession, account_id: uuid.UUID) -> Decimal:
    """Authoritative recompute for ONE leaf account. Mutates + returns the new ``current_balance``.

    Idempotent — safe to call repeatedly. The caller commits.
    """
    acc = (await session.execute(
        select(Account).where(Account.id == account_id)  # tenant-filter-ok: cross-tenant — pure helper; RLS-scoped session; account_id is tenant-anchored FK from caller
    )).scalar_one_or_none()
    if acc is None:
        return _ZERO

    # outstanding_invoiced: sum of Invoice.total (luma INT) for invoices on this account that have
    # been billed (ISSUED / OVERDUE / PAID).
    outstanding = (await session.execute(
        select(func.coalesce(func.sum(Invoice.total), 0)).where(
            Invoice.account_id == account_id,
            Invoice.status.in_(_BILLED_STATUSES),
        )
    )).scalar_one()

    # payments_collected: sum of (amount - refunded_amount) for payments tied to this account.
    payments_collected = (await session.execute(
        select(func.coalesce(func.sum(Payment.amount - func.coalesce(Payment.refunded_amount, 0)), 0))
        .where(Payment.account_id == account_id)
    )).scalar_one()

    # Coerce to Decimal — the Invoice/Payment columns are integer luma but our balance column is
    # Numeric(14,2). The signed math happens once, in Decimal.
    outstanding_d = Decimal(str(outstanding or 0))
    payments_d = Decimal(str(payments_collected or 0))
    new_balance = payments_d - outstanding_d

    # available_credit = max(0, credit_limit + balance). When balance is negative (owe us),
    # credit_limit + balance is the slack room left. When balance is positive (credit), it's
    # capped at credit_limit (a positive balance plus credit_limit is NOT free spending power —
    # the customer's positive balance is theirs, available_credit means "borrowing headroom").
    # Spec example: balance=-50, credit_limit=200 → available_credit=150 (capped, not 250).
    credit_limit = Decimal(acc.credit_limit or 0)
    raw_available = credit_limit + new_balance
    if raw_available < _ZERO:
        available = _ZERO
    elif raw_available > credit_limit:
        available = credit_limit
    else:
        available = raw_available

    acc.current_balance = new_balance
    acc.available_credit = available
    acc.balance_updated_at = _utcnow()
    await session.flush()
    return new_balance


async def consolidated_balance(session: AsyncSession, root_account_id: uuid.UUID) -> dict:
    """Aggregate balance metrics across the subtree rooted at ``root_account_id`` (root included).

    Walks descendants via the ``hierarchy_path`` materialized path when available (LIKE
    ``root_path || '%'``) and falls back to a recursive CTE on ``parent_account_id`` if the path
    is missing (newly created node not yet path-rebuilt). Returns:

        {
            'root_balance':              <root's own current_balance>,
            'consolidated_balance':      <sum across whole subtree, including root>,
            'consolidated_credit_limit': <sum of credit_limit across subtree>,
            'subtree_size':              <count of accounts in subtree, including root>,
        }
    """
    root = (await session.execute(
        select(Account).where(Account.id == root_account_id)  # tenant-filter-ok: cross-tenant — pure helper; RLS-scoped session; root_account_id is tenant-anchored FK from caller
    )).scalar_one_or_none()
    if root is None:
        return {
            "root_balance": _ZERO,
            "consolidated_balance": _ZERO,
            "consolidated_credit_limit": _ZERO,
            "subtree_size": 0,
        }

    rows = []
    if root.hierarchy_path:
        # Path is canonical — LIKE prefix match grabs root + all descendants in one query.
        path_prefix = root.hierarchy_path
        sql = text(
            "SELECT current_balance, credit_limit "
            "FROM account "
            "WHERE hierarchy_path = :p OR hierarchy_path LIKE :pdot"
        )
        result = await session.execute(sql, {"p": path_prefix, "pdot": path_prefix + ".%"})
        rows = result.all()
    else:
        # Fallback: recursive CTE on parent_account_id. Used only when path is missing.
        sql = text(
            "WITH RECURSIVE tree AS ("
            "  SELECT id, current_balance, credit_limit "
            "    FROM account WHERE id = :root_id "
            "  UNION ALL "
            "  SELECT a.id, a.current_balance, a.credit_limit "
            "    FROM account a JOIN tree t ON a.parent_account_id = t.id"
            ") SELECT current_balance, credit_limit FROM tree"
        )
        result = await session.execute(sql, {"root_id": str(root_account_id)})
        rows = result.all()

    total_balance = _ZERO
    total_credit_limit = _ZERO
    for cb, cl in rows:
        total_balance += Decimal(cb or 0)
        total_credit_limit += Decimal(cl or 0)

    return {
        "root_balance": Decimal(root.current_balance or 0),
        "consolidated_balance": total_balance,
        "consolidated_credit_limit": total_credit_limit,
        "subtree_size": len(rows),
    }


async def rebuild_hierarchy_path(session: AsyncSession, account_id: uuid.UUID) -> None:
    """Rebuild the materialized path for ONE node by walking up ``parent_account_id``.

    Idempotent. Called on account create (with parent) and on reparent (for the moved node only —
    use ``rebuild_descendants_paths`` after to fix descendants).
    """
    acc = (await session.execute(
        select(Account).where(Account.id == account_id)  # tenant-filter-ok: cross-tenant — pure helper; RLS-scoped session; account_id is tenant-anchored FK from caller
    )).scalar_one_or_none()
    if acc is None:
        return

    if acc.parent_account_id is None:
        acc.hierarchy_path = str(acc.id)
        await session.flush()
        return

    parent = (await session.execute(
        select(Account).where(Account.id == acc.parent_account_id)  # tenant-filter-ok: cross-tenant — parent FK from already-validated acc; RLS-scoped session
    )).scalar_one_or_none()
    if parent is None:
        # Parent vanished (shouldn't happen — FK protects this) — fall back to standalone.
        acc.hierarchy_path = str(acc.id)
        await session.flush()
        return

    if not parent.hierarchy_path:
        # Parent hasn't been pathed yet — recursive fix-up.
        await rebuild_hierarchy_path(session, parent.id)
        # Re-read parent's now-populated path.
        await session.refresh(parent)

    acc.hierarchy_path = (parent.hierarchy_path or str(parent.id)) + "." + str(acc.id)
    await session.flush()


async def rebuild_descendants_paths(session: AsyncSession, account_id: uuid.UUID) -> None:
    """After a reparent: rebuild the path for ``account_id`` AND every descendant beneath it.

    Strategy: find all descendants via a recursive CTE on ``parent_account_id``, then process the
    moved node first, then descendants level-by-level (children only get rebuilt after their
    parent — topological order). This is O(N) on the subtree size.
    """
    # 1. Fix the moved node first — its own path depends on its (new) parent.
    await rebuild_hierarchy_path(session, account_id)

    # 2. Find all descendants via parent_account_id walk. Order doesn't matter for correctness
    # because rebuild_hierarchy_path recurses up — but processing them grouped by depth (top
    # down) is the natural cheap order.
    sql = text(
        "WITH RECURSIVE tree AS ("
        "  SELECT id, parent_account_id, 1 AS depth FROM account WHERE parent_account_id = :root_id "
        "  UNION ALL "
        "  SELECT a.id, a.parent_account_id, t.depth + 1 "
        "    FROM account a JOIN tree t ON a.parent_account_id = t.id"
        ") SELECT id FROM tree ORDER BY depth"
    )
    result = await session.execute(sql, {"root_id": str(account_id)})
    descendant_ids = [r[0] for r in result.all()]

    for d_id in descendant_ids:
        await rebuild_hierarchy_path(session, d_id)
