"""Seed supplemental test data: missing records + realistic billing/analytics data.

Fills what the import_test_data script can't cover:
  - Subscriptions with realistic MRR distribution
  - Invoices (ISSUED / PAID / OVERDUE) spread across 24 months
  - Payments matching invoices (for revenue trend chart)
  - Workitems for the Dispatch Board
  - Usage records for Usage Analytics
  - Additional customer records to make the CRM pipeline lively

All amounts in luma (1 AMD = 100 luma). Idempotent per table if run after fresh import.

Usage (from backend/):
    .venv/Scripts/python.exe -m scripts.seed_dashboard_data
"""
import asyncio
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from random import Random

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

rng = Random(42)  # deterministic — same data every run


def _months_ago(n: int) -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(day=1) - timedelta(days=n * 30)


def _rand_date(start_months_ago: int, end_months_ago: int = 0) -> datetime:
    start = _months_ago(start_months_ago)
    end   = _months_ago(end_months_ago)
    delta = int((end - start).total_seconds())
    return start + timedelta(seconds=rng.randint(0, max(1, delta)))


# ---------------------------------------------------------------------------
# Tariff plan pricing in luma (AMD × 100)
# ---------------------------------------------------------------------------
_PLANS = [
    ("GPON 50",   450_000,  50,  10),
    ("GPON 100",  600_000, 100,  20),
    ("GPON 200",  750_000, 200,  50),
    ("GPON 500",  990_000, 500, 100),
    ("Բիզնես Օպտիկա 300", 1_500_000, 300, 100),
    ("Ստանդարտ Ինտերնետ",  350_000,   50,  10),
    ("Ընտանեկան Ինտերնետ+", 550_000,  100,  20),
]

_CUSTOMER_NAMES = [
    "Արման Հակոբյան", "Անի Սարգսյան", "Վարդան Պետրոսյան",
    "Լիլիթ Ղազարյան", "Նարեկ Ավետիսյան", "Տիգրան Մկրտչյան",
    "Մարիամ Կարապետյան", "Արթուր Հովհաննիսյան", "Ռուզան Հայրապետյան",
    "Դավիթ Ասատրյան", "Հայկ Մանուկյան", "Անահիտ Գրիգորյան",
    "Սամվել Մուրադյան", "Գայանե Սարգսյան", "Էլեն Մարտիրոսյան",
    "Կարեն Ախոյան", "Նաիրա Ամիրյան", "Ալեքսandr Ասոյան",
    "Սոնա Ստեփանյան", "Վահե Ներsissyan",
]

_WORKITEM_TITLES = [
    "ONT տեղադրում", "Ֆայբեր ձգում", "Անպայման ստուգում",
    "Ֆայբեր կտրվածք վերականգնում", "Ցանցի կոնֆիգ փոփոխություն",
    "Ուտer պայմանագrի կnelclusion", "CPE փոխl", "IP Հasignmention",
    "ONT firmware թcouldreatement", "Ստoragementumor monitor",
]


async def main():
    from app.db import OwnerSessionLocal
    from app.models.tenant import Tenant
    from app.models.billing import Subscription, Invoice, InvoiceLine, Payment
    from app.models.record import Record
    from app.models.workitem import WorkItem
    from app.models.usage import UsageRecord
    from sqlalchemy import select, func

    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(
            select(Tenant).order_by(Tenant.created_at)
        )).scalars().first()
        if not tenant:
            print("ERROR: no tenant — run seed first")
            return
        t = tenant.id
        print(f"[seed_dashboard_data] Tenant: {t}")

        # ── check existing ──────────────────────────────────────────────
        existing_subs = (await s.execute(
            select(func.count()).select_from(Subscription).where(Subscription.tenant_id == t)
        )).scalar_one()

        # ── Subscriptions + Invoices + Payments (if thin) ───────────────
        if existing_subs < 30:
            print(f"[seed_dashboard_data] Adding subscriptions/invoices/payments …")
            sub_count = inv_count = pay_count = 0

            for i in range(50):
                plan_name, amount, _, _ = rng.choice(_PLANS)
                cust_name = _CUSTOMER_NAMES[i % len(_CUSTOMER_NAMES)]

                # find or create a customer Record
                cust = Record(
                    tenant_id=t, entity_key="customer", status="ACTIVE",
                    data={"name": cust_name, "email": f"test{i}@haynet.am",
                          "phone": f"+374 9{rng.randint(1,9)} {100+i} {200+i}",
                          "customer_type": rng.choice(["residential","business"]),
                          "address": f"Երévand, փnr. {i+1}"},
                )
                s.add(cust)
                await s.flush()

                started = _rand_date(23, 1)
                sub = Subscription(
                    tenant_id=t, customer_id=cust.id, plan_name=plan_name,
                    amount=amount, cycle="monthly", status="ACTIVE",
                    started_at=started,
                )
                s.add(sub)
                await s.flush()
                sub_count += 1

                # 6–18 monthly invoices per subscription
                inv_months = rng.randint(6, 18)
                for m in range(inv_months):
                    inv_date = started + timedelta(days=30 * m)
                    if inv_date > datetime.now(timezone.utc):
                        break

                    age_days = (datetime.now(timezone.utc) - inv_date).days
                    if age_days > 60:
                        status = "PAID"
                    elif age_days > 30:
                        status = rng.choice(["PAID", "OVERDUE"])
                    else:
                        status = rng.choice(["ISSUED", "PAID"])

                    n_count = (await s.execute(
                        select(func.count()).select_from(Invoice).where(Invoice.tenant_id == t)
                    )).scalar_one()
                    inv = Invoice(
                        tenant_id=t, customer_id=cust.id,
                        number=f"INV-{n_count + 1:05d}",
                        period_start=inv_date,
                        period_end=inv_date + timedelta(days=30),
                        status=status, total=amount,
                        issued_at=inv_date,
                        due_at=inv_date + timedelta(days=14),
                    )
                    s.add(inv)
                    await s.flush()
                    inv_count += 1

                    s.add(InvoiceLine(
                        tenant_id=t, invoice_id=inv.id,
                        kind="charge", description=f"{plan_name} ամnot. vճar",
                        quantity=1, unit_amount=amount, line_total=amount,
                    ))

                    if status == "PAID":
                        pay = Payment(
                            tenant_id=t, invoice_id=inv.id, amount=amount,
                            method=rng.choice(["card","transfer","cash"]),
                            paid_at=inv_date + timedelta(days=rng.randint(1, 10)),
                        )
                        s.add(pay)
                        pay_count += 1

            await s.flush()
            print(f"  + {sub_count} subscriptions, {inv_count} invoices, {pay_count} payments")

        # ── WorkItems for Dispatch Board ────────────────────────────────
        wi_count = (await s.execute(
            select(func.count()).select_from(WorkItem).where(WorkItem.tenant_id == t)
        )).scalar_one()

        if wi_count < 20:
            print("[seed_dashboard_data] Adding workitems for dispatch board …")
            added = 0
            statuses = ["TODO", "TODO", "IN_PROGRESS", "IN_PROGRESS", "BLOCKED", "DONE"]
            kinds    = ["task", "install", "repair", "survey", "maintenance"]
            for i in range(30):
                wi = WorkItem(
                    tenant_id=t,
                    title=_WORKITEM_TITLES[i % len(_WORKITEM_TITLES)] + f" #{i+1}",
                    kind=rng.choice(kinds),
                    status=rng.choice(statuses),
                    priority=rng.choice(["NORMAL","NORMAL","HIGH","LOW"]),
                    scheduled_at=_rand_date(3, 0),
                )
                s.add(wi)
                added += 1
            await s.flush()
            print(f"  + {added} workitems")

        # ── Usage Records for Usage Analytics ───────────────────────────
        ur_count = (await s.execute(
            select(func.count()).select_from(UsageRecord).where(UsageRecord.tenant_id == t)
        )).scalar_one()

        if ur_count < 50:
            print("[seed_dashboard_data] Adding usage records …")
            added = 0
            # Fetch some real service IDs if any exist
            from app.models.service import Service
            services = (await s.execute(
                select(Service).where(Service.tenant_id == t).limit(10)
            )).scalars().all()

            for day_offset in range(90):
                ts = datetime.now(timezone.utc) - timedelta(days=day_offset)
                for j in range(rng.randint(2, 8)):
                    svc = rng.choice(services) if services else None
                    qty = float(rng.randint(10, 500))
                    ur = UsageRecord(
                        tenant_id=t,
                        service_id=svc.id if svc else None,
                        metric="gb",
                        quantity=qty,
                        unit_rate=100,
                        amount=int(qty * 100),
                        period_start=ts.replace(hour=0, minute=0, second=0),
                        period_end=ts.replace(hour=23, minute=59, second=59),
                    )
                    s.add(ur)
                    added += 1
                if added > 500:
                    break
            await s.flush()
            print(f"  + {added} usage records")

        await s.commit()

    # ── Summary ─────────────────────────────────────────────────────────
    async with OwnerSessionLocal() as s:
        from app.models.billing import Subscription, Invoice, Payment
        t_id = tenant.id
        subs = (await s.execute(select(func.count()).select_from(Subscription).where(Subscription.tenant_id == t_id))).scalar_one()
        invs = (await s.execute(select(func.count()).select_from(Invoice).where(Invoice.tenant_id == t_id))).scalar_one()
        pays = (await s.execute(select(func.count()).select_from(Payment).where(Payment.tenant_id == t_id))).scalar_one()
        mrr  = (await s.execute(select(func.coalesce(func.sum(Subscription.amount), 0)).where(Subscription.tenant_id == t_id, Subscription.status == "ACTIVE"))).scalar_one()
        paid = (await s.execute(select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.tenant_id == t_id))).scalar_one()
        print(f"\n[seed_dashboard_data] Final state:")
        print(f"  Subscriptions: {subs}")
        print(f"  Invoices: {invs}")
        print(f"  Payments: {pays}")
        print(f"  MRR: {int(mrr)/100:,.0f} AMD")
        print(f"  Total collected: {int(paid)/100:,.0f} AMD")
        print("\n[seed_dashboard_data] Done.")


if __name__ == "__main__":
    asyncio.run(main())
