"""Party / Account API (doc 17a, Stage 1 — additive, DORMANT).

Small tenant + owner-scoped CRUD for the new Party and Account tables. They land BESIDE the flat
CRM customer (nothing migrates yet); the four BSS tables resolve via app.resolvers.account_or_customer.
Scope + audit exactly like services/respool. Permission gate: `party.*` / `account.*`.

NOTE on namespacing: fixed paths under /api ("/api/parties", "/api/accounts") → register BEFORE
records.router.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Record
from ..models.party import Party, Account
from ..access import load_grants, can
from .. import workflow
from ..kernel import assert_can, AccessDenied
from .auth import current_user
from .records import _node_path, _node_paths     # reuse the exact records scope primitives

router = APIRouter(prefix="/api", tags=["accounts"])

_PARTY_TYPES = {"individual", "organization", "carrier"}
_ACCOUNT_TYPES = {"residential", "business", "wholesale"}


def _deny(perm: str):
    raise HTTPException(403, f"Not allowed: {perm}")


def _iso(dt):
    return dt.isoformat() if dt else None


# ---- serializers ----

def _party(p: Party) -> dict:
    return {
        "id": str(p.id),
        "owner_node_id": str(p.owner_node_id) if p.owner_node_id else None,
        "type": p.type,
        "name": p.name,
        "parent_party_id": str(p.parent_party_id) if p.parent_party_id else None,
        "customer_record_id": str(p.customer_record_id) if p.customer_record_id else None,
        "status": p.status,
        "created_at": _iso(p.created_at),
    }


def _account(a: Account) -> dict:
    return {
        "id": str(a.id),
        "owner_node_id": str(a.owner_node_id) if a.owner_node_id else None,
        "holder_party_id": str(a.holder_party_id),
        "type": a.type,
        "currency": a.currency,
        "billing_cycle": a.billing_cycle,
        "credit_terms": a.credit_terms,
        "parent_account_id": str(a.parent_account_id) if a.parent_account_id else None,
        "status": a.status,
        "created_at": _iso(a.created_at),
    }


# ---- loaders / validation ----

async def _get_party(s, user: User, party_id) -> Party:
    p = (await s.execute(
        select(Party).where(Party.id == party_id, Party.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Party not found")
    return p


async def _get_account(s, user: User, account_id) -> Account:
    a = (await s.execute(
        select(Account).where(Account.id == account_id, Account.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Account not found")
    return a


async def _party_exists_or_422(s, tenant_id, party_id, field: str):
    if party_id is None:
        return
    p = (await s.execute(select(Party.id).where(Party.id == party_id, Party.tenant_id == tenant_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(422, f"{field} does not reference a known party")


async def _customer_record_or_422(s, tenant_id, record_id):
    if record_id is None:
        return
    rec = (await s.execute(
        select(Record.id).where(Record.id == record_id, Record.tenant_id == tenant_id, Record.entity_key == "customer")
    )).scalar_one_or_none()
    if not rec:
        raise HTTPException(422, "customer_record_id does not reference a known customer")


# ==========================================================================================
# Parties
# ==========================================================================================

@router.get("/parties")
async def list_parties(type: str | None = None, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    if not can(grants, "party", "view"):
        _deny("party.view")
    paths = await _node_paths(s, user.tenant_id)
    q = select(Party).where(Party.tenant_id == user.tenant_id)
    if type:
        q = q.where(Party.type == type)
    rows = (await s.execute(q.order_by(Party.created_at))).scalars().all()
    visible = [r for r in rows
               if can(grants, "party", "view", paths.get(str(r.owner_node_id)) if r.owner_node_id else None)]
    return [_party(p) for p in visible]


@router.post("/parties", status_code=201)
async def create_party(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    owner_path = await _node_path(s, user.primary_node_id)
    if not can(grants, "party", "create", owner_path):
        _deny("party.create")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="create", entity_key="party",
                         region_id=payload.get("region_id"), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "name is required")
    ptype = payload.get("type", "individual")
    if ptype not in _PARTY_TYPES:
        raise HTTPException(422, f"type must be one of {sorted(_PARTY_TYPES)}")
    parent_party_id = payload.get("parent_party_id")
    await _party_exists_or_422(s, user.tenant_id, parent_party_id, "parent_party_id")
    await _customer_record_or_422(s, user.tenant_id, payload.get("customer_record_id"))

    party = Party(
        tenant_id=user.tenant_id, owner_node_id=user.primary_node_id, type=ptype, name=name,
        parent_party_id=parent_party_id, customer_record_id=payload.get("customer_record_id"),
        status=payload.get("status", "active"),
    )
    s.add(party)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "create", "party", party.id, user.id, {"name": name, "type": ptype})
    await s.commit()
    await s.refresh(party)
    return _party(party)


@router.get("/parties/{party_id}")
async def get_party(party_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    party = await _get_party(s, user, party_id)
    grants = await load_grants(s, user)
    if not can(grants, "party", "view", await _node_path(s, party.owner_node_id)):
        _deny("party.view")
    return _party(party)


# ==========================================================================================
# Accounts
# ==========================================================================================

@router.get("/accounts")
async def list_accounts(party: uuid.UUID | None = None, type: str | None = None,
                        user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    if not can(grants, "account", "view"):
        _deny("account.view")
    paths = await _node_paths(s, user.tenant_id)
    q = select(Account).where(Account.tenant_id == user.tenant_id)
    if party:
        q = q.where(Account.holder_party_id == party)
    if type:
        q = q.where(Account.type == type)
    rows = (await s.execute(q.order_by(Account.created_at))).scalars().all()
    visible = [r for r in rows
               if can(grants, "account", "view", paths.get(str(r.owner_node_id)) if r.owner_node_id else None)]
    return [_account(a) for a in visible]


@router.post("/accounts", status_code=201)
async def create_account(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    owner_path = await _node_path(s, user.primary_node_id)
    if not can(grants, "account", "create", owner_path):
        _deny("account.create")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="create", entity_key="account",
                         region_id=payload.get("region_id"), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    holder_party_id = payload.get("holder_party_id")
    if not holder_party_id:
        raise HTTPException(422, "holder_party_id is required")
    await _party_exists_or_422(s, user.tenant_id, holder_party_id, "holder_party_id")
    atype = payload.get("type", "residential")
    if atype not in _ACCOUNT_TYPES:
        raise HTTPException(422, f"type must be one of {sorted(_ACCOUNT_TYPES)}")
    parent_account_id = payload.get("parent_account_id")
    if parent_account_id is not None:
        await _get_account(s, user, parent_account_id)   # 404 if the parent isn't a known account

    account = Account(
        tenant_id=user.tenant_id, owner_node_id=user.primary_node_id, holder_party_id=holder_party_id,
        type=atype, currency=payload.get("currency", "AMD"), billing_cycle=payload.get("billing_cycle", "monthly"),
        credit_terms=payload.get("credit_terms"), parent_account_id=parent_account_id,
        status=payload.get("status", "active"),
    )
    s.add(account)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "create", "account", account.id, user.id,
                        {"holder_party_id": str(holder_party_id), "type": atype})
    await s.commit()
    await s.refresh(account)
    return _account(account)


@router.get("/accounts/{account_id}")
async def get_account(account_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    account = await _get_account(s, user, account_id)
    grants = await load_grants(s, user)
    if not can(grants, "account", "view", await _node_path(s, account.owner_node_id)):
        _deny("account.view")
    return _account(account)
