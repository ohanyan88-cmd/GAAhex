"""A19 smoke: provision a fresh tenant, log in as its admin, see the seeded CRM, and prove the
demo tenant can't see the new tenant's data."""
import pytest


@pytest.mark.asyncio
async def test_provision_tenant_smoke(client, admin):
    # --- provision a brand-new ISP as the demo super_admin ---
    r = await client.post("/api/admin/tenants", headers=admin, json={
        "company_name": "Smoke ISP",
        "admin_email": "founder@smoke.isp",
        "admin_password": "smoke1234",
    })
    assert r.status_code == 201, r.text
    data = r.json()
    print("\nPROVISION:", data)
    assert data["tenant"]["name"] == "Smoke ISP"
    assert "password" not in r.text.lower()

    # --- the new admin can log in ---
    lr = await client.post("/auth/login", json={"email": "founder@smoke.isp", "password": "smoke1234"})
    assert lr.status_code == 200, lr.text
    new_admin = {"Authorization": f"Bearer {lr.json()['access_token']}"}
    print("NEW ADMIN LOGIN: ok")

    # --- sees the seeded CRM entities ---
    me = await client.get("/meta/entities", headers=new_admin)
    assert me.status_code == 200, me.text
    keys = sorted(e["key"] for e in me.json())
    print("NEW TENANT ENTITIES:", keys)
    assert {"lead", "customer", "contact", "deal", "ticket"}.issubset(set(keys))

    # --- /api/leads is an empty list, NOT 403 (access + scope allow own tenant) ---
    leads = await client.get("/api/leads", headers=new_admin)
    assert leads.status_code == 200, leads.text
    assert leads.json() == []
    print("NEW TENANT /api/leads:", leads.json())

    # --- create a lead in the new tenant ---
    cr = await client.post("/api/leads", headers=new_admin, json={"name": "Smoke Lead"})
    assert cr.status_code == 201, cr.text
    new_lead_id = cr.json()["id"]
    print("CREATED LEAD in new tenant:", new_lead_id)

    # --- isolation: the DEMO admin must NOT see the new tenant's lead ---
    demo_leads = await client.get("/api/leads", headers=admin)
    assert demo_leads.status_code == 200, demo_leads.text
    demo_ids = [x["id"] for x in demo_leads.json()]
    print("DEMO admin /api/leads ids:", demo_ids)
    assert new_lead_id not in demo_ids
    print("ISOLATION: demo admin does NOT see the new tenant lead — OK")

    # --- safety: a duplicate admin email is refused (409) ---
    dup = await client.post("/api/admin/tenants", headers=admin, json={
        "company_name": "Dup ISP", "admin_email": "founder@smoke.isp", "admin_password": "smoke1234"})
    assert dup.status_code == 409, dup.text
    print("DUPLICATE EMAIL refused:", dup.status_code)
