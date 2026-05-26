"""Coverage for executive analytics (analytics.py) — fixed cross-domain KPIs over live BSS data.

Gated on analytics.view (admin holds `*`). Money stays raw integer luma (the frontend divides by
100), so every monetary value must be an int. Read-only; we assert documented keys + shapes rather
than exact figures (the shared session DB accumulates rows from the whole suite).
"""

import uuid


async def _active_subscription(client, admin):
    """Guarantee at least one ACTIVE subscription so subscription-mix has a row to shape-check."""
    cust = (await client.post("/api/customers", headers=admin,
                              json={"name": f"An Cust {uuid.uuid4().hex[:8]}"})).json()["id"]
    return (await client.post("/api/subscriptions", headers=admin, json={
        "plan_name": f"Plan {uuid.uuid4().hex[:6]}", "amount": 30000, "cycle": "monthly",
        "customer_id": cust})).json()


_MONEY_INT_KEYS = ("mrr", "active_subscriptions", "ar_outstanding", "overdue_total", "overdue_count",
                   "collected_this_month", "collected_prev_month", "new_leads_30d", "new_leads_prev_30d")


async def test_overview_keys_and_integer_money(client, admin):
    ov = (await client.get("/api/analytics/overview", headers=admin)).json()
    for k in _MONEY_INT_KEYS:
        assert k in ov and isinstance(ov[k], int), f"{k} missing or not int"
    assert ov["lead_entity"] == "lead"                        # the seeded CRM lead entity


async def test_revenue_trend_is_zero_filled_n_points(client, admin):
    pts = (await client.get("/api/analytics/revenue-trend?months=3", headers=admin)).json()
    assert isinstance(pts, list) and len(pts) == 3
    for p in pts:
        assert set(p) == {"month", "collected", "invoiced"}
        assert isinstance(p["collected"], int) and isinstance(p["invoiced"], int)   # zero-filled ints
    months = [p["month"] for p in pts]
    assert months == sorted(months)                           # oldest → newest


async def test_subscription_mix_shape(client, admin):
    await _active_subscription(client, admin)
    mix = (await client.get("/api/analytics/subscription-mix", headers=admin)).json()
    assert isinstance(mix, list) and len(mix) >= 1
    for row in mix:
        assert set(row) == {"product_id", "product_name", "count", "mrr"}
        assert isinstance(row["count"], int) and isinstance(row["mrr"], int)
        assert isinstance(row["product_name"], str)


async def test_ar_aging_shape(client, admin):
    aging = (await client.get("/api/analytics/ar-aging", headers=admin)).json()
    assert set(aging) == {"current", "d1_30", "d31_60", "d61_90", "d90_plus"}
    assert all(isinstance(v, int) for v in aging.values())    # all buckets are integer luma
