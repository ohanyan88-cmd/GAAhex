"""i18n API (Armenian + English) — the string bundles the frontend loads per language.

A read returns global default strings merged with the caller's tenant overrides (tenant wins).
Writes (tenant overrides) require config.manage. Labels aren't secret, so reads are open to any
authenticated tenant user. Languages: hy, en (default en).

NOTE: fixed paths under /api ("/api/i18n"), so register BEFORE records.router ("/api/{slug}").
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session, OwnerSessionLocal
from ..kernel import assert_can, AccessDenied
from ..models import User
from ..models.translation import Translation
from ..access import load_grants, can
from .auth import current_user

router = APIRouter(prefix="/api/i18n", tags=["i18n"])

LANGS = {"hy", "en"}
DEFAULT_LANG = "en"


# ---- merge helper (reusable — e.g. by a meta hook to localize entity/status labels) ----

async def bundle_for(s: AsyncSession, tenant_id, lang: str) -> dict[str, str]:
    """Flat {key: value} for a language: global defaults first, then this tenant's overrides (which
    win). Importable so other routers (e.g. meta.py) can localize labels for the caller's lang."""
    rows = (await s.execute(
        select(Translation).where(
            Translation.lang == lang,
            or_(Translation.tenant_id.is_(None), Translation.tenant_id == tenant_id),
        )
    )).scalars().all()
    bundle: dict[str, str] = {}
    # globals (tenant_id None) first, tenant overrides applied after → tenant wins
    for t in sorted(rows, key=lambda r: r.tenant_id is not None):
        bundle[t.key] = t.value
    return bundle


# ---- endpoints (/keys BEFORE /{lang} so it isn't captured as a language) ----

@router.get("/keys")
async def list_keys(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """All known translation keys (global + this tenant), for an admin string editor."""
    rows = (await s.execute(
        select(Translation.key).where(
            or_(Translation.tenant_id.is_(None), Translation.tenant_id == user.tenant_id)
        ).distinct()
    )).all()
    return sorted({r[0] for r in rows})


@router.get("/{lang}")
async def get_bundle(lang: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The flat {key: value} bundle for `lang` (global defaults + tenant overrides)."""
    if lang not in LANGS:
        raise HTTPException(404, f"Unknown language '{lang}' (supported: {sorted(LANGS)})")
    return await bundle_for(s, user.tenant_id, lang)


@router.put("/{lang}")
async def upsert_overrides(lang: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Upsert this tenant's translation overrides for `lang`. Body: {key: value, ...}. config.manage."""
    if lang not in LANGS:
        raise HTTPException(404, f"Unknown language '{lang}' (supported: {sorted(LANGS)})")
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage configuration")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements legacy role check.
    try:
        await assert_can(s, user, action="config_manage", entity_key="translation",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    if not isinstance(payload, dict) or not payload:
        raise HTTPException(422, "body must be a non-empty {key: value} object")

    existing = {
        t.key: t for t in (await s.execute(
            select(Translation).where(
                Translation.tenant_id == user.tenant_id, Translation.lang == lang,
                Translation.key.in_(list(payload.keys())),
            )
        )).scalars().all()
    }
    updated = 0
    for key, value in payload.items():
        if not isinstance(value, str):
            raise HTTPException(422, f"value for '{key}' must be a string")
        if key in existing:
            existing[key].value = value
        else:
            s.add(Translation(tenant_id=user.tenant_id, lang=lang, key=key, value=value))
        updated += 1
    await s.commit()
    return {"lang": lang, "updated": updated}


# ---- starter seed (idempotent; coordinator wires into lifespan alongside the other seeds) ----

# key → {en, hy}. Core nav, CRM statuses, and common actions.
STARTER: dict[str, dict[str, str]] = {
    "nav.dashboard": {"en": "Dashboard", "hy": "Վահանակ"},
    "nav.leads": {"en": "Leads", "hy": "Լիդեր"},
    "nav.customers": {"en": "Customers", "hy": "Հաճախորդներ"},
    "nav.contacts": {"en": "Contacts", "hy": "Կոնտակտներ"},
    "nav.deals": {"en": "Deals", "hy": "Գործարքներ"},
    "nav.tickets": {"en": "Tickets", "hy": "Հայտեր"},
    "nav.reports": {"en": "Reports", "hy": "Հաշվետվություններ"},
    "nav.studio": {"en": "Studio", "hy": "Ստուդիա"},
    "nav.settings": {"en": "Settings", "hy": "Կարգավորումներ"},
    "status.NEW": {"en": "New", "hy": "Նոր"},
    "status.CONTACTED": {"en": "Contacted", "hy": "Կապ հաստատված"},
    "status.QUALIFIED": {"en": "Qualified", "hy": "Որակավորված"},
    "status.CONVERTED": {"en": "Converted", "hy": "Փոխարկված"},
    "status.LOST": {"en": "Lost", "hy": "Կորցրած"},
    "status.PROSPECT": {"en": "Prospect", "hy": "Հեռանկար"},
    "status.ACTIVE": {"en": "Active", "hy": "Ակտիվ"},
    "status.SUSPENDED": {"en": "Suspended", "hy": "Կասեցված"},
    "status.CHURNED": {"en": "Churned", "hy": "Հեռացած"},
    "status.OPEN": {"en": "Open", "hy": "Բաց"},
    "status.WON": {"en": "Won", "hy": "Շահած"},
    "status.IN_PROGRESS": {"en": "In Progress", "hy": "Ընթացքի մեջ"},
    "status.RESOLVED": {"en": "Resolved", "hy": "Լուծված"},
    "common.save": {"en": "Save", "hy": "Պահպանել"},
    "common.cancel": {"en": "Cancel", "hy": "Չեղարկել"},
    "common.delete": {"en": "Delete", "hy": "Ջնջել"},
    "common.edit": {"en": "Edit", "hy": "Խմբագրել"},
    "common.create": {"en": "Create", "hy": "Ստեղծել"},
    "common.search": {"en": "Search", "hy": "Որոնել"},
}


async def seed_i18n_if_empty() -> None:
    """Seed the global (tenant_id NULL) starter strings once. Idempotent: a no-op if any global
    translation already exists."""
    # OWNER session: global (tenant_id NULL) rows must bypass RLS WITH CHECK (which keys on tenant).
    async with OwnerSessionLocal() as s:
        if (await s.execute(
            select(func.count()).select_from(Translation).where(Translation.tenant_id.is_(None))
        )).scalar_one():
            return
        for key, vals in STARTER.items():
            for lang, value in vals.items():
                s.add(Translation(tenant_id=None, lang=lang, key=key, value=value))
        await s.commit()
