"""Tenant provisioning — stand up a brand-new ISP from config, repeatably.

The spine of onboarding: one privileged (OWNER) transaction that creates a fresh Tenant, its root
org tree, the first super-admin user, and the baseline config (CRM entities + roles/permissions +
notification defs) — REUSING the same builders the demo seed uses (`build_crm_entities`,
`build_access_config`, `build_notification_defs`). Proves the GAAex thesis: a 2nd ISP from config.

Runs as OWNER (RLS-bypass) because it writes rows across a not-yet-authenticated tenant — exactly
like the seed/lifespan path. The new rows carry the new tenant_id, so existing RLS policies isolate
them; no new policy and no migration needed. i18n strings are global (tenant_id NULL), so there is
no per-tenant i18n seed.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy_utils import Ltree

from .models import Tenant, OrgNode, User, Assignment
from .security import hash_password
from .seed import build_crm_entities, build_access_config
from .seed_notifications import build_notification_defs


class ProvisioningError(ValueError):
    """Raised when provisioning can't proceed (e.g. the admin email is already taken)."""


async def provision_tenant(
    s: AsyncSession,
    *,
    company_name: str,
    admin_email: str,
    admin_password: str,
    admin_name: str = "Admin",
    currency: str = "AMD",
    locale: str = "en",
) -> dict:
    """Provision a new ISP tenant in ONE owner transaction. Creates the Tenant, a 3-level starter org
    tree (Group → Region → Team), the first admin User (super_admin at the root), and the baseline
    config (CRM entities, permissions + roles, notification defs). Idempotent-safe: refuses if the
    admin email already exists. Returns {tenant_id, admin_user_id, org_root_id}.

    `currency`/`locale` are accepted for the onboarding contract; i18n is global and currency has no
    tenant column yet, so they're not persisted here (no destructive migration) — wired when those
    columns land.
    """
    company_name = (company_name or "").strip()
    admin_email = (admin_email or "").strip().lower()
    if not company_name:
        raise ProvisioningError("company_name is required")
    if not admin_email:
        raise ProvisioningError("admin_email is required")

    # email is globally unique (app_user.email) — refuse early with a clean message
    if (await s.execute(select(User).where(User.email == admin_email))).scalar_one_or_none():
        raise ProvisioningError(f"A user with email '{admin_email}' already exists")

    # ---- tenant ----
    tenant = Tenant(name=company_name)
    s.add(tenant)
    await s.flush()

    # ---- starter org tree: Group → Region → Team ----
    root = OrgNode(tenant_id=tenant.id, type="Group", name=f"{company_name} Group", code="grp", path=Ltree("grp"))
    s.add(root)
    await s.flush()
    region = OrgNode(tenant_id=tenant.id, parent_id=root.id, type="Region", name="Headquarters", code="hq", path=Ltree("grp.hq"))
    s.add(region)
    await s.flush()
    team = OrgNode(tenant_id=tenant.id, parent_id=region.id, type="Team", name="Team 1", code="team1", path=Ltree("grp.hq.team1"))
    s.add(team)
    await s.flush()

    # ---- first admin user (super_admin at the root node) ----
    admin = User(
        tenant_id=tenant.id, primary_node_id=root.id,
        email=admin_email, name=(admin_name or "Admin").strip(), password_hash=hash_password(admin_password),
    )
    s.add(admin)
    await s.flush()

    # ---- baseline config (reuses the demo builders, parametrized by tenant) ----
    await build_crm_entities(s, tenant.id)
    roles = await build_access_config(s, tenant.id)
    s.add(Assignment(tenant_id=tenant.id, user_id=admin.id, role_id=roles["super_admin"].id, node_id=root.id))
    await build_notification_defs(s, tenant.id)

    await s.commit()
    return {"tenant_id": str(tenant.id), "admin_user_id": str(admin.id), "org_root_id": str(root.id)}
