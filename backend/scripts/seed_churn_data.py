"""Seed churned subscriptions and time-windowed activity for dashboard testing.

Creates data so that ALL four range filters show non-zero values:
  7d  = last 7 days      (2026-05-25 → today)
  30d = last 30 days     (2026-05-02 → today)
  QTD = Q2-2026          (2026-04-01 → today)
  YTD = year-to-date     (2026-01-01 → today)

What is added
─────────────
• Churned subscriptions with Event audit rows (→ churn chart in metrics/revenue)
  Distributed: 3 in last 7d, 5 in 8-30d, 7 in QTD-not-30d, 10 in YTD-not-QTD
• Cancelled / terminated customers (Record rows with status TERMINATED/SUSPENDED)
• Invoices + payments inside each window so the revenue chart has points at every
  granularity level
• Lead Records created inside each window (new-leads KPI tile)

BL-11 — Numbering: this script writes invoices with the ``INV-C…`` (churned-
historic) and ``INV-R…`` (revenue-window) prefixes deliberately, so seed rows are
visually distinguishable from production invoices (``INV-NNNNN`` from the
per-tenant SEQUENCE). The seed prefix never collides with the prod prefix, so it
does not need to consume the SEQUENCE. Keep this split when adding new seed data.

Usage (from backend/):
    .venv/Scripts/python.exe -m scripts.seed_churn_data
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from random import Random

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

rng = Random(99)

# ── current time anchor ─────────────────────────────────────────────────────
NOW     = datetime.now(timezone.utc)
_7D     = NOW - timedelta(days=7)
_30D    = NOW - timedelta(days=30)
_QTD    = NOW.replace(month=((NOW.month - 1) // 3) * 3 + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
_YTD    = NOW.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)


def _ts(since: datetime, until: datetime | None = None) -> datetime:
    until = until or NOW
    secs = int((until - since).total_seconds())
    return since + timedelta(seconds=rng.randint(0, max(1, secs - 1)))


_PLANS = [
    ("GPON 50",    450_000),
    ("GPON 100",   600_000),
    ("GPON 200",   750_000),
    ("GPON 500",   990_000),
    ("Բիznes 300", 1_500_000),
]
_CUSTOMER_NAMES = [
    "Armen Hakobyan", "Lusine Petrosyan", "Tigran Sargsyan",
    "Narine Avagyan", "Vahe Mkrtchyan", "Mane Grigoryan",
    "Gor Khachatryan", "Sona Davtyan", "Narek Barseghyan",
    "Anahit Poghosyan", "Karen Simonyan", "Lilit Asatryan",
    "Samvel Hovhannisyan", "Gayane Harutyunyan", "Artur Nikolyan",
    "Elen Arakelyan", "Hayk Shahverdyan", "Mariam Petrosyan",
    "Ruzan Galstyan", "Davit Mkhitaryan",
]


# ── churn windows: (window_start, window_end, count) ─────────────────────────
_CHURN_WINDOWS = [
    (_7D,           NOW,    4),   # last 7 days
    (_30D,          _7D,    6),   # 8-30 days ago
    (_QTD,          _30D,   8),   # QTD not in last 30d
    (_YTD,          _QTD,  10),   # YTD not in QTD
    (_YTD - timedelta(days=365), _YTD, 8),  # prior year for comparison
]

# ── revenue windows: extra invoices+payments so each filter bucket is non-zero
_REV_WINDOWS = [
    (_7D,   NOW,    8,   "last-7d"),
    (_30D,  _7D,   12,   "30d-not-7d"),
    (_QTD,  _30D,  15,   "QTD-not-30d"),
    (_YTD,  _QTD,  20,   "YTD-not-QTD"),
]


async def main():
    from app.db import OwnerSessionLocal
    from app.models.tenant import Tenant
    from app.models.billing import Subscription, Invoice, InvoiceLine, Payment
    from app.models.record import Record
    from app.models.event import Event
    from sqlalchemy import select, func, text

    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(
            select(Tenant).order_by(Tenant.created_at)
        )).scalars().first()
        if not tenant:
            print("ERROR: no tenant")
            return
        t = tenant.id
        print(f"[seed_churn_data] Tenant: {t}  NOW={NOW:%Y-%m-%d %H:%M} UTC")

        # ── Churned subscriptions ─────────────────────────────────────────
        total_churn = 0
        print("\n[1] Churned subscriptions")
        for win_start, win_end, count in _CHURN_WINDOWS:
            for i in range(count):
                plan_name, amount = rng.choice(_PLANS)
                cust_name = _CUSTOMER_NAMES[rng.randint(0, len(_CUSTOMER_NAMES) - 1)]

                # Customer record — already terminated
                cust = Record(
                    tenant_id=t, entity_key="customer", status="TERMINATED",
                    data={
                        "name": cust_name + f" (churn-{total_churn})",
                        "email": f"churn{total_churn}@haynet.am",
                        "phone": f"+374 9{rng.randint(1,9)} 5{total_churn:02d} 000",
                        "customer_type": rng.choice(["residential","business"]),
                        "notes": "Պայման fesired due to service issues.",
                    },
                )
                s.add(cust)
                await s.flush()

                # Subscription — started some months before churn, now CANCELLED
                churn_at = _ts(win_start, win_end)
                months_active = rng.randint(3, 18)
                started_at = churn_at - timedelta(days=30 * months_active)

                sub = Subscription(
                    tenant_id=t, customer_id=cust.id, plan_name=plan_name,
                    amount=amount, cycle="monthly", status="CANCELLED",
                    started_at=started_at,
                )
                s.add(sub)
                await s.flush()

                # Historical invoices while active (paid)
                for m in range(months_active):
                    inv_date = started_at + timedelta(days=30 * m)
                    if inv_date >= churn_at:
                        break
                    # BL-11 — INV-C{churn_idx}-{month} is a deliberate seed-data prefix,
                    # never collides with the prod INV-NNNNN sequence (see module docstring).
                    inv = Invoice(
                        tenant_id=t, customer_id=cust.id,
                        number=f"INV-C{total_churn:04d}-{m:02d}",
                        period_start=inv_date,
                        period_end=inv_date + timedelta(days=30),
                        status="PAID", total=amount,
                        issued_at=inv_date,
                        due_at=inv_date + timedelta(days=14),
                    )
                    s.add(inv)
                    await s.flush()
                    s.add(InvoiceLine(
                        tenant_id=t, invoice_id=inv.id,
                        kind="charge", description=f"{plan_name} ամnot",
                        quantity=1, unit_amount=amount, line_total=amount,
                    ))
                    s.add(Payment(
                        tenant_id=t, invoice_id=inv.id, amount=amount,
                        method=rng.choice(["card","transfer","cash"]),
                        paid_at=inv_date + timedelta(days=rng.randint(1, 8)),
                    ))

                # Audit Event: subscription transition → CANCELLED.
                # event table is append-only (SPEC §0.4 — no UPDATE or DELETE).
                # Insert directly via raw SQL so we can supply the exact created_at timestamp
                # instead of accepting the server's now().
                import json as _json, uuid as _uuid
                from sqlalchemy.dialects.postgresql import insert as _pg_insert
                await s.execute(
                    _pg_insert(Event).values(
                        id=_uuid.uuid4(),
                        tenant_id=t,
                        type="transition",
                        entity_key="subscription",
                        record_id=sub.id,
                        actor_user_id=None,
                        data={"from": "ACTIVE", "to": "CANCELLED",
                              "plan": plan_name, "reason": "customer_request"},
                        created_at=churn_at,
                    )
                )

                total_churn += 1

            await s.flush()
            print(f"  window {win_start:%Y-%m-%d} to {win_end:%Y-%m-%d}: +{count} churns")

        # ── Extra revenue data per window ─────────────────────────────────
        total_rev = 0
        print("\n[2] Revenue data per window")
        for win_start, win_end, count, label in _REV_WINDOWS:
            for i in range(count):
                plan_name, amount = rng.choice(_PLANS)
                cust_name = _CUSTOMER_NAMES[rng.randint(0, len(_CUSTOMER_NAMES) - 1)]

                cust = Record(
                    tenant_id=t, entity_key="customer", status="ACTIVE",
                    data={"name": cust_name + f" (rev-{total_rev})",
                          "email": f"rev{total_rev}@haynet.am",
                          "phone": f"+374 9{rng.randint(1,9)} 6{total_rev:02d} 000",
                          "customer_type": "residential"},
                )
                s.add(cust)
                await s.flush()

                # BL-11 — INV-R{rev_idx} is a deliberate seed-data prefix; see docstring.
                inv_date = _ts(win_start, win_end)
                status = "PAID" if (NOW - inv_date).days > 5 else "ISSUED"
                inv = Invoice(
                    tenant_id=t, customer_id=cust.id,
                    number=f"INV-R{total_rev:04d}",
                    period_start=inv_date,
                    period_end=inv_date + timedelta(days=30),
                    status=status, total=amount,
                    issued_at=inv_date,
                    due_at=inv_date + timedelta(days=14),
                )
                s.add(inv)
                await s.flush()
                s.add(InvoiceLine(
                    tenant_id=t, invoice_id=inv.id,
                    kind="charge", description=f"{plan_name} ամnot",
                    quantity=1, unit_amount=amount, line_total=amount,
                ))
                if status == "PAID":
                    s.add(Payment(
                        tenant_id=t, invoice_id=inv.id, amount=amount,
                        method=rng.choice(["card","transfer","cash"]),
                        paid_at=inv_date + timedelta(days=rng.randint(1, 4)),
                    ))
                total_rev += 1

            await s.flush()
            print(f"  {label}: +{count} invoices/payments")

        # ── New leads per window (for overview KPI tile) ──────────────────
        print("\n[3] Lead records per window")
        lead_windows = [
            (_7D,  NOW, 5,  "7d"),
            (_30D, _7D, 8,  "30d"),
            (_QTD, _30D,10, "QTD"),
            (_YTD, _QTD,15, "YTD"),
        ]
        from sqlalchemy import bindparam  # noqa: F811 — re-import is fine in local scope
        total_leads = 0
        for win_start, win_end, count, label in lead_windows:
            for i in range(count):
                cust_name = _CUSTOMER_NAMES[rng.randint(0, len(_CUSTOMER_NAMES) - 1)]
                lead = Record(
                    tenant_id=t, entity_key="lead", status="NEW",
                    data={"name": cust_name + f" (lead-{total_leads})",
                          "email": f"lead{total_leads}@haynet.am",
                          "phone": f"+374 9{rng.randint(1,9)} 7{total_leads:02d} 000",
                          "source": rng.choice(["web","referral","social","cold_call"])},
                )
                s.add(lead)
                # Override created_at via raw SQL
                await s.flush()
                lead_ts = _ts(win_start, win_end)
                lead.created_at = lead_ts
                total_leads += 1
            print(f"  {label}: +{count} leads")

        await s.commit()

    # ── Final summary ────────────────────────────────────────────────────────
    async with OwnerSessionLocal() as s:
        from app.models.billing import Subscription, Invoice, Payment
        from app.models.event import Event
        t_id = tenant.id
        windows = {"7d": _7D, "30d": _30D, "QTD": _QTD, "YTD": _YTD}
        print("\n=== FINAL STATE ===")
        print("\nPayments per window:")
        for name, since in windows.items():
            cnt = (await s.execute(select(func.count()).select_from(Payment).where(Payment.tenant_id==t_id, Payment.paid_at>=since))).scalar_one()
            amt = (await s.execute(select(func.coalesce(func.sum(Payment.amount),0)).where(Payment.tenant_id==t_id, Payment.paid_at>=since))).scalar_one()
            print(f"  {name:<5}  pays={cnt:>4}   AMD={int(amt)/100:>12,.0f}")
        print("\nChurn events per window:")
        for name, since in windows.items():
            churns = (await s.execute(select(func.count()).select_from(Event).where(Event.tenant_id==t_id, Event.entity_key=="subscription", Event.type=="transition", Event.data["to"].astext=="CANCELLED", Event.created_at>=since))).scalar_one()
            print(f"  {name:<5}  churn_events={churns}")
        subs = (await s.execute(select(func.count()).select_from(Subscription).where(Subscription.tenant_id==t_id))).scalar_one()
        cancelled = (await s.execute(select(func.count()).select_from(Subscription).where(Subscription.tenant_id==t_id, Subscription.status=="CANCELLED"))).scalar_one()
        total_inv = (await s.execute(select(func.count()).select_from(Invoice).where(Invoice.tenant_id==t_id))).scalar_one()
        total_pay = (await s.execute(select(func.count()).select_from(Payment).where(Payment.tenant_id==t_id))).scalar_one()
        mrr = (await s.execute(select(func.coalesce(func.sum(Subscription.amount),0)).where(Subscription.tenant_id==t_id, Subscription.status=="ACTIVE"))).scalar_one()
        print(f"\nSubscriptions: {subs} total ({cancelled} churned / {subs-cancelled} active)")
        print(f"Invoices: {total_inv}  Payments: {total_pay}")
        print(f"MRR: {int(mrr)/100:,.0f} AMD")
        print("\n[seed_churn_data] Done.")


if __name__ == "__main__":
    asyncio.run(main())
