"""M1-A Wave 7 (IDOR) — Hole: page_bindings.create_binding.page_id.

Wave 6's OpenAPI fuzzer caught POST /api/page-bindings accepting a body-supplied
``page_id`` UUID and dropping it straight onto a new PageBinding without verifying
the referenced StudioPage lived in the caller's tenant.

Reproduction shape:
    tenant A admin tries to create a binding pointing at tenant B's StudioPage.

Expected after Wave 7: the new ``_studio_page_or_422`` helper in
routers/page_bindings.py rejects the cross-tenant UUID with a 422.
"""

import uuid

import pytest
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models.page_binding import PageBinding
from app.models.studio_page import StudioPage
from app.models.tenant import Tenant


async def _seed_other_tenant_studio_page() -> uuid.UUID:
    """Insert a Tenant B + a StudioPage owned by tenant B directly via the owner
    session (bypasses RLS). Returns the StudioPage id — that's the only thing the
    IDOR repro needs (the cross-tenant UUID to dangle in front of tenant A)."""
    async with OwnerSessionLocal() as o:
        other = Tenant(id=uuid.uuid4(), name="IDOR-PageBindings-OtherTenant", status="active")
        o.add(other)
        await o.flush()
        page = StudioPage(
            id=uuid.uuid4(),
            tenant_id=other.id,
            key=f"idor-pb-{uuid.uuid4().hex[:8]}",
            label="Stranger Page from Tenant B",
        )
        o.add(page)
        await o.commit()
        return page.id


@pytest.mark.asyncio
async def test_create_binding_rejects_cross_tenant_page_id(client, admin):
    foreign_page_id = await _seed_other_tenant_studio_page()

    res = await client.post(
        "/api/page-bindings",
        headers=admin,
        json={
            "page_id": str(foreign_page_id),
            "component_key": "idor.repro.component",
            "entity_slug": "customer",
        },
    )

    # The new _studio_page_or_422 helper returns 422 for any page_id that doesn't
    # live in the caller's tenant.
    assert res.status_code == 422, res.text
    assert "page_id" in res.text

    # Sanity: no PageBinding was created on tenant A's side that points at the
    # foreign StudioPage UUID.
    async with OwnerSessionLocal() as o:
        rows = (await o.execute(
            select(PageBinding).where(PageBinding.page_id == foreign_page_id)
        )).scalars().all()
        assert rows == []
