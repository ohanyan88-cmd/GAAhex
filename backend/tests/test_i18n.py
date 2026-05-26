"""Coverage for the i18n bundle API (i18n.py) + the global↦tenant override merge.

A read returns global default strings (tenant_id NULL) merged with the caller tenant's overrides
(tenant wins). Writes require config.manage. Languages hy/en. The starter strings are seeded by the
lifespan in the running app; the test harness doesn't run lifespan, so each test calls the
idempotent `seed_i18n_if_empty()` first (same seed the app uses). Unique override keys per test.
"""

from app.routers import i18n


async def _seed():
    await i18n.seed_i18n_if_empty()           # idempotent: no-op once globals exist


# ===================== starter bundles (global, both languages) =====================

async def test_starter_bundles_en_hy(client, admin):
    await _seed()
    en = (await client.get("/api/i18n/en", headers=admin)).json()
    hy = (await client.get("/api/i18n/hy", headers=admin)).json()
    assert isinstance(en, dict) and isinstance(hy, dict)
    # a known starter key is present in both languages...
    assert en["nav.dashboard"] == "Dashboard"
    assert hy["nav.dashboard"] == "Վահանակ"               # the Armenian string
    # ...and a global (NULL-tenant) key with no tenant override is visible to the tenant
    assert en["nav.leads"] == "Leads"


async def test_unknown_language_404(client, admin):
    await _seed()
    assert (await client.get("/api/i18n/fr", headers=admin)).status_code == 404


# ===================== tenant override layered over global (override wins) =====================

async def test_override_layers_over_global_and_adds_new_key(client, admin):
    await _seed()
    # override an existing global key + add a brand-new tenant-only key
    put = await client.put("/api/i18n/en", headers=admin,
                           json={"nav.settings": "My Settings", "custom.greeting": "Hi there"})
    assert put.status_code == 200 and put.json()["updated"] == 2

    en = (await client.get("/api/i18n/en", headers=admin)).json()
    assert en["nav.settings"] == "My Settings"            # tenant override wins over global "Settings"
    assert en["custom.greeting"] == "Hi there"            # new tenant-only key appears
    assert en["nav.dashboard"] == "Dashboard"             # untouched global still served


# ===================== write permission + validation =====================

async def test_override_requires_config_manage_and_validates(client, admin, agent):
    await _seed()
    # the seeded agent lacks config.manage → 403
    assert (await client.put("/api/i18n/en", headers=agent, json={"x.y": "z"})).status_code == 403
    # empty body / non-string value → 422
    assert (await client.put("/api/i18n/en", headers=admin, json={})).status_code == 422
    assert (await client.put("/api/i18n/en", headers=admin, json={"x.y": 5})).status_code == 422
    # unknown language → 404 (checked before the body)
    assert (await client.put("/api/i18n/fr", headers=admin, json={"x.y": "z"})).status_code == 404
