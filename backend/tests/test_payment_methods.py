"""Phase B.1 — PaymentMethod router + LoggingGateway adapter tests.

Covers:
  * vault a card via POST → row created with gateway='logging', last4 matches input, brand
    inferred correctly across the supported IIN ranges
  * is_default invariant — vaulting a second default flips the first off
  * PATCH status→removed forces is_default=False
  * DELETE soft-deletes (status='removed' + is_default=False; row preserved)
  * GET list filters by customer_id + status
  * Non-admin gets 403 on POST / PATCH / DELETE
  * Raw card_number / cvc / cardholder_name are NEVER stored on the row
"""
from __future__ import annotations

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models.payment_method import PaymentMethod


async def _customer(client, admin, name) -> str:
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _vault(client, admin, customer_id: str, *,
                 card_number: str = "4242424242424242", exp_month: int = 12,
                 exp_year: int = 2030, cvc: str = "123",
                 cardholder_name: str | None = None, is_default: bool = False) -> dict:
    body = {
        "customer_id": customer_id,
        "card_number": card_number,
        "exp_month": exp_month,
        "exp_year": exp_year,
        "cvc": cvc,
        "is_default": is_default,
    }
    if cardholder_name is not None:
        body["cardholder_name"] = cardholder_name
    r = await client.post("/api/payment-methods", headers=admin, json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ===================== POST: vault a card =====================

async def test_vault_visa_card_creates_row(client, admin):
    cust = await _customer(client, admin, "PM Visa Cust")
    pm = await _vault(client, admin, cust, card_number="4242424242424242")
    assert pm["gateway"] == "logging"
    assert pm["last4"] == "4242"
    assert pm["brand"] == "visa"
    assert pm["exp_month"] == 12 and pm["exp_year"] == 2030
    assert pm["status"] == "active"
    assert pm["is_default"] is False
    assert pm["gateway_token"].startswith("tok_log_")


async def test_vault_brand_inference_across_iin_ranges(client, admin):
    """LoggingGateway/infer_brand_from_iin: 4xxx→visa, 5500..→mastercard, 3700..→amex, 9999..→other."""
    cust = await _customer(client, admin, "PM Brand Cust")
    cases = [
        ("4111111111111111", "visa"),
        ("5500000000000004", "mastercard"),
        ("370000000000002", "amex"),
        ("6011000000000004", "discover"),
        ("9999999999999999", "other"),
        ("2221000000000009", "mastercard"),  # new MC range
    ]
    for i, (card, expected_brand) in enumerate(cases):
        pm = await _vault(
            client, admin, cust,
            card_number=card,
            exp_month=((i % 12) + 1),
            exp_year=2031 + i,
        )
        assert pm["brand"] == expected_brand, f"card={card!r} got brand={pm['brand']!r}"
        assert pm["last4"] == card[-4:]


# ===================== is_default invariant =====================

async def test_is_default_invariant_flips_prior_default_off(client, admin):
    cust = await _customer(client, admin, "PM Default Cust")
    pm1 = await _vault(client, admin, cust, card_number="4242424242424242",
                       exp_year=2030, is_default=True)
    assert pm1["is_default"] is True

    # Vault a second card with is_default=True — pm1 should flip OFF.
    pm2 = await _vault(client, admin, cust, card_number="5500000000000004",
                       exp_year=2031, is_default=True)
    assert pm2["is_default"] is True

    # Re-fetch pm1 and verify it's no longer default.
    r = await client.get(f"/api/payment-methods/{pm1['id']}", headers=admin)
    assert r.status_code == 200
    assert r.json()["is_default"] is False


async def test_patch_is_default_flips_prior(client, admin):
    cust = await _customer(client, admin, "PM Default Cust 2")
    pm1 = await _vault(client, admin, cust, card_number="4242424242424242",
                       exp_year=2030, is_default=True)
    pm2 = await _vault(client, admin, cust, card_number="5500000000000004",
                       exp_year=2031, is_default=False)
    assert pm1["is_default"] is True
    assert pm2["is_default"] is False

    # Flip pm2 to default via PATCH — pm1 should flip OFF.
    r = await client.patch(f"/api/payment-methods/{pm2['id']}", headers=admin,
                           json={"is_default": True})
    assert r.status_code == 200
    assert r.json()["is_default"] is True

    pm1_after = (await client.get(f"/api/payment-methods/{pm1['id']}", headers=admin)).json()
    assert pm1_after["is_default"] is False


# ===================== PATCH status=removed forces is_default=False =====================

async def test_patch_status_removed_clears_default(client, admin):
    cust = await _customer(client, admin, "PM Remove Cust")
    pm = await _vault(client, admin, cust, card_number="4242424242424242",
                      exp_year=2030, is_default=True)
    assert pm["is_default"] is True

    r = await client.patch(f"/api/payment-methods/{pm['id']}", headers=admin,
                           json={"status": "removed"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "removed"
    assert body["is_default"] is False


# ===================== DELETE soft-deletes =====================

async def test_delete_soft_deletes(client, admin):
    cust = await _customer(client, admin, "PM Delete Cust")
    pm = await _vault(client, admin, cust, card_number="4242424242424242",
                      exp_year=2030, is_default=True)
    r = await client.delete(f"/api/payment-methods/{pm['id']}", headers=admin)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "removed"
    assert body["is_default"] is False

    # Row still exists.
    fetch = await client.get(f"/api/payment-methods/{pm['id']}", headers=admin)
    assert fetch.status_code == 200
    assert fetch.json()["status"] == "removed"


# ===================== GET list filters =====================

async def test_list_filters_by_customer_and_status(client, admin):
    cust_a = await _customer(client, admin, "PM List Cust A")
    cust_b = await _customer(client, admin, "PM List Cust B")

    pm_a1 = await _vault(client, admin, cust_a, card_number="4242424242424242", exp_year=2030)
    pm_a2 = await _vault(client, admin, cust_a, card_number="5500000000000004", exp_year=2031)
    await _vault(client, admin, cust_b, card_number="4111111111111111", exp_year=2032)

    # Mark one of A's cards as removed.
    await client.patch(f"/api/payment-methods/{pm_a1['id']}", headers=admin,
                       json={"status": "removed"})

    # Filter: customer=A, status=active → only pm_a2 (pm_a1 is removed).
    r = await client.get(f"/api/payment-methods?customer_id={cust_a}&status=active",
                         headers=admin)
    assert r.status_code == 200
    body = r.json()
    pm_ids = {item["id"] for item in body["items"]}
    assert pm_a2["id"] in pm_ids
    assert pm_a1["id"] not in pm_ids

    # Filter: customer=A (no status) → both rows.
    r2 = await client.get(f"/api/payment-methods?customer_id={cust_a}", headers=admin)
    assert r2.status_code == 200
    body2 = r2.json()
    pm_ids2 = {item["id"] for item in body2["items"]}
    assert pm_a1["id"] in pm_ids2 and pm_a2["id"] in pm_ids2


# ===================== Auth: non-admin 403 =====================

async def test_non_admin_gets_403_on_writes(client, admin, agent):
    cust = await _customer(client, admin, "PM Auth Cust")
    pm = await _vault(client, admin, cust)

    # POST — 403
    r_post = await client.post("/api/payment-methods", headers=agent, json={
        "customer_id": cust, "card_number": "4242424242424242",
        "exp_month": 12, "exp_year": 2030, "cvc": "123",
    })
    assert r_post.status_code == 403

    # PATCH — 403
    r_patch = await client.patch(f"/api/payment-methods/{pm['id']}", headers=agent,
                                 json={"is_default": True})
    assert r_patch.status_code == 403

    # DELETE — 403
    r_del = await client.delete(f"/api/payment-methods/{pm['id']}", headers=agent)
    assert r_del.status_code == 403


# ===================== Raw card data is NEVER stored =====================

async def test_raw_card_data_never_stored(client, admin):
    """Vault a card and verify the DB row does NOT contain the raw PAN, CVV, or cardholder
    name in ANY field. Only safe display bits (last4, brand) + opaque token survive."""
    import re
    cust = await _customer(client, admin, "PM Privacy Cust")
    # Use distinctive non-hex/non-numeric values for CVV + name so substring matching
    # is reliable. A 3-digit numeric CVV like "987" sporadically appears inside the
    # random hex of gateway_token (`tok_log_<uuid4hex>`), creating a flaky test:
    # ~30 hex-positions × 1/4096 = ~0.7% per-run false-positive rate. Use values that
    # contain non-hex characters so a UUID hex collision is mathematically impossible.
    raw_pan = "4242424242424242"
    raw_cvc = "PRIVTEST-CVV-Z"
    raw_name = "PRIVACY-TEST-CARDHOLDER"
    pm = await _vault(
        client, admin, cust,
        card_number=raw_pan, cvc=raw_cvc, cardholder_name=raw_name,
        exp_year=2030,
    )

    # gateway_token shape is `tok_log_<uuid4hex>` by construction. Verify the shape
    # independently; substring scanning the random hex is what makes the naive
    # raw_cvc-in-sv test flaky.
    token_pattern = re.compile(r"^tok_log_[0-9a-f]{32}$")

    # Pull the actual DB row and scan every column for any of the raw fields.
    async with SessionLocal() as s:
        row = (await s.execute(
            select(PaymentMethod).where(PaymentMethod.id == uuid.UUID(pm["id"]))
        )).scalar_one()
        assert token_pattern.match(row.gateway_token), (
            f"gateway_token does not have the expected `tok_log_<uuid4hex>` shape: {row.gateway_token!r}"
        )
        for col in PaymentMethod.__table__.columns:
            v = getattr(row, col.name)
            if v is None:
                continue
            sv = str(v)
            # The raw PAN must NEVER appear in any field. (last4 is OK; full PAN is not.)
            assert raw_pan not in sv, f"raw PAN leaked into {col.name}: {sv!r}"
            # The raw CVV must NEVER appear in any field.
            assert raw_cvc not in sv, f"raw CVV leaked into {col.name}: {sv!r}"
            # The raw cardholder name must NEVER appear in any field.
            assert raw_name not in sv, f"raw cardholder_name leaked into {col.name}: {sv!r}"

    # Sanity: the row DOES exist with the expected last4 + brand.
    assert pm["last4"] == raw_pan[-4:]
    assert pm["brand"] == "visa"
