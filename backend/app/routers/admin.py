"""Platform admin — tenant provisioning.

`POST /api/admin/tenants` stands up a brand-new ISP tenant from config (see provisioning.py). This
is a cross-tenant, privileged op, so it runs on the OWNER session (RLS bypass) — registered before
the generic `/api/{slug}` records router in main.py.

Gate (Stage-1 documented choice): the caller must be an existing **super_admin** — detected via the
`config.manage` capability (super_admin's `*` grant), the same signal Studio and i18n writes use.
A dedicated platform-level `tenant.provision` permission is the longer-term option; until a platform
realm exists, reusing the super_admin gate is the pragmatic, secure-by-default choice.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_owner_session
from ..models import User
from ..access import load_grants, can
from ..provisioning import provision_tenant, ProvisioningError
from .auth import current_user, validate_password_strength

router = APIRouter(prefix="/api/admin", tags=["admin"])


class ProvisionIn(BaseModel):
    company_name: str
    admin_email: str
    admin_password: str
    admin_name: str | None = None
    currency: str | None = None
    locale: str | None = None


@router.post("/tenants", status_code=201)
async def provision_tenant_endpoint(
    body: ProvisionIn,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_owner_session),
):
    """Provision a new tenant (ISP) + its first admin + baseline config, in one owner transaction.
    Returns the new tenant + admin identifiers — never the password."""
    # gate: existing super_admin (config.manage). load_grants on the owner session is fine — it
    # filters by the caller's own user_id/tenant_id.
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Provisioning requires a super_admin (config.manage)")

    validate_password_strength(body.admin_password)
    try:
        result = await provision_tenant(
            s,
            company_name=body.company_name,
            admin_email=body.admin_email,
            admin_password=body.admin_password,
            admin_name=body.admin_name or "Admin",
            currency=body.currency or "AMD",
            locale=body.locale or "en",
        )
    except ProvisioningError as e:
        raise HTTPException(409, str(e))

    return {
        "tenant": {"id": result["tenant_id"], "name": body.company_name.strip()},
        "admin": {"id": result["admin_user_id"], "email": body.admin_email.strip().lower()},
        "org_root_id": result["org_root_id"],
    }
