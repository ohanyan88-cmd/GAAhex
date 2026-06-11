import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session, set_tenant_guc
from ..models import EntityDef, FieldDef, StatusDef, Record, OrgNode, User, Event
from ..access import load_grants, can, role_keys, can_view_field, can_edit_field
from ..pagination import Page, X_TOTAL_COUNT, MAX_LIMIT, count_select
from .. import workflow, gxl, notify_hooks
from ..services.records_service import (
    build_record_list_stmt,
    build_count_stmt,
    apply_org_scope,
    apply_gxl_filter,
)
from ..utils.http_errors import approval_required  # PC-2
from ..utils.refnum import next_reference_number
from ..kernel import (
    MASTER_RECORD_KEYS,
    DuplicateMasterData,
    assert_no_inline_master_copies,
    assert_can,
    AccessDenied,
    assert_approval_or_raise,
    ApprovalRequired,
    create_approval_request,
    find_approved_approval,
    mark_approval_executed,
)
from .auth import current_user

# Back-compat paging helpers reused by sibling routers (billing / usage / interactions) and the
# pagination unit tests. The generic list endpoint below uses `Page` directly (unbounded by default
# + X-Total-Count); these preserve the original semantics: no limit => first DEFAULT_PAGE rows,
# any explicit limit clamped to MAX_PAGE.
DEFAULT_PAGE = 200
MAX_PAGE = MAX_LIMIT  # 500


def _paginate(items, limit=None, offset=0):
    """Window an already-materialized list. limit=None => first DEFAULT_PAGE; limit capped at MAX_PAGE.

    Back-compat shim used by sibling routers (billing/usage/interactions). Unlike the strict
    ``Page.from_request`` (which 422s on overflow), this helper still CLAMPS an over-cap limit
    to ``MAX_PAGE`` — those sibling routers were built against the clamp-not-reject contract and
    we don't want to silently 422 their in-flight requests when ``MAX_LIMIT`` moved from 500 → 1000.
    """
    if limit is None:
        bounded = DEFAULT_PAGE
    else:
        try:
            bounded = max(1, min(int(limit), MAX_PAGE))
        except (TypeError, ValueError):
            bounded = DEFAULT_PAGE
    return Page(bounded, offset).slice_list(items)

router = APIRouter(prefix="/api", tags=["records"])

# Reference-number prefixes per generic-record entity (docs/standards/03 — file 03 §8.2). Extend as
# more entities go live; an entity not listed here simply gets no human ref. (order/invoice/etc. are
# first-class tables and stamp their own prefix in their dedicated routers.)
_ENTITY_PREFIX = {
    "lead": "LED",
    "customer": "CUS",
    "contact": "CON",
    "campaign": "CAM",
}


# ---- helpers (the generic engine — no per-entity code) ----

async def _entity(s: AsyncSession, tenant_id, slug: str) -> EntityDef:
    ent = (await s.execute(
        select(EntityDef).where(EntityDef.tenant_id == tenant_id, EntityDef.route_slug == slug)
    )).scalar_one_or_none()
    if not ent:
        raise HTTPException(404, f"Unknown entity '{slug}'")
    return ent


async def _fields(s: AsyncSession, entity_id) -> list[FieldDef]:
    return list((await s.execute(
        select(FieldDef).where(FieldDef.entity_def_id == entity_id).order_by(FieldDef.order)  # noqa: tenant-filter cross-tenant — RLS-scoped session; entity tenant validated by caller via _entity()
    )).scalars().all())


async def _initial_status(s: AsyncSession, entity_id) -> str | None:
    st = (await s.execute(
        select(StatusDef).where(StatusDef.entity_def_id == entity_id, StatusDef.is_initial == True)  # noqa: tenant-filter, E712 — RLS-scoped session; entity tenant validated by caller via _entity()
    )).scalar_one_or_none()
    return st.key if st else None


async def _node_paths(s: AsyncSession, tenant_id) -> dict[str, str]:
    rows = (await s.execute(select(OrgNode.id, OrgNode.path).where(OrgNode.tenant_id == tenant_id))).all()
    return {str(i): str(p) for i, p in rows}


async def _node_path(s: AsyncSession, node_id) -> str | None:
    if not node_id:
        return None
    p = (await s.execute(select(OrgNode.path).where(OrgNode.id == node_id))).scalar_one_or_none()  # noqa: tenant-filter cross-tenant — RLS-scoped session; node_id is tenant-anchored FK from caller
    return str(p) if p is not None else None


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE_RE = re.compile(r"^\+?[\d \-]{5,20}$")


def _check_type(field: FieldDef, value):
    """Type-aware validation for a present, non-empty field value (raises 422 if invalid)."""
    t = field.type
    if t == "email":
        if not isinstance(value, str) or not _EMAIL_RE.match(value):
            raise HTTPException(422, f"Invalid email for '{field.key}'")
    elif t == "phone":
        if not isinstance(value, str) or not _PHONE_RE.match(value.strip()):
            raise HTTPException(422, f"Invalid phone number for '{field.key}'")
    elif t in ("number", "money"):
        try:
            float(value)
        except (TypeError, ValueError):
            raise HTTPException(422, f"'{field.key}' must be a number")
    elif t == "select":
        opts = (field.config or {}).get("options")
        if opts and value not in opts:
            raise HTTPException(422, f"'{field.key}' must be one of {opts}")


def _validate(fields: list[FieldDef], payload: dict, partial: bool,
              caller_roles: set | None = None, is_admin: bool = False):
    """Validate a create/patch payload. When `caller_roles` is provided, also enforce field-level
    edit gates: setting a field the caller's roles can't edit is refused with 403."""
    by_key = {f.key: f for f in fields}
    for k in payload:
        if k not in by_key:
            raise HTTPException(422, f"Unknown field '{k}'")
    data: dict = {}
    status_value = None
    has_status = any(f.type == "status" for f in fields)
    for f in fields:
        present = f.key in payload
        if f.type == "status":
            if present:
                status_value = payload[f.key]
            continue
        if present:
            # field-level edit gate (view-only / role-gated fields cannot be written)
            if caller_roles is not None and not can_edit_field(f.config, caller_roles, is_admin):
                raise HTTPException(403, f"Not allowed to edit field '{f.key}'")
            v = payload[f.key]
            if v is not None and v != "":
                _check_type(f, v)
            if f.type == "boolean" and v is not None:
                v = bool(v)
            data[f.key] = v
        elif not partial and f.required:
            raise HTTPException(422, f"Missing required field '{f.key}'")
    return data, status_value, has_status


def _hidden_keys(fields: list[FieldDef], caller_roles: set, is_admin: bool) -> set:
    """Data field keys the caller's roles may NOT view (dropped from serialized output)."""
    return {f.key for f in fields if not can_view_field(f.config, caller_roles, is_admin)}


def _serialize(rec: Record, hidden_keys: set | frozenset = frozenset()) -> dict:
    out = {
        "id": str(rec.id),
        "owner_node_id": str(rec.owner_node_id) if rec.owner_node_id else None,
        "status": rec.status,
        "created_at": rec.created_at.isoformat() if rec.created_at else None,
    }
    for k, v in (rec.data or {}).items():
        if k in hidden_keys:                       # field-level view gate
            continue
        out[k] = v
    return out


async def _get(s, tenant_id, entity_key, rec_id) -> Record:
    # Re-arm the RLS tenant GUC: write handlers commit mid-request and a pooled connection swap
    # can drop the session GUC, so a post-commit re-fetch would otherwise see zero rows (404).
    await set_tenant_guc(s, tenant_id)
    rec = (await s.execute(
        select(Record).where(
            Record.id == rec_id, Record.tenant_id == tenant_id, Record.entity_key == entity_key
        )
    )).scalar_one_or_none()
    if not rec:
        raise HTTPException(404, "Record not found")
    return rec


def _deny(entity_key: str, verb: str):
    raise HTTPException(403, f"Not allowed: {entity_key}.{verb}")


# ---- generic CRUD (access-enforced) ----

def _matches_q(rec: Record, needle: str) -> bool:
    """Case-insensitive substring match over a record's text-ish data values (status excluded)."""
    for v in (rec.data or {}).values():
        if isinstance(v, str) and needle in v.lower():
            return True
    return False


def _sort_value(rec: Record, field: str):
    """The value a record sorts by: a core column (status/created_at) or a JSONB data field."""
    if field == "created_at":
        return rec.created_at
    if field == "status":
        return rec.status
    return (rec.data or {}).get(field)


@router.get("/{slug}")
async def list_records(
    slug: str,
    response: Response,
    q: str | None = None,
    filter: str | None = None,
    sort: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List records for an entity. All query params are optional.

      - q:      case-insensitive substring over text data fields (pushed into SQL as
                ``data::text ILIKE %q%`` — see TRADE-OFFS below)
      - filter: a GXL boolean evaluated per record (ctx = {**data, "status"}); broken ⇒ fail closed
      - sort:   a field key (or `-key` for descending) over status / created_at / a JSONB data key
      - limit:  page size — defaults to ``DEFAULT_LIMIT`` (100), hard-capped at ``MAX_LIMIT`` (1000);
                anything above the cap is rejected with HTTP 422 (see ``pagination.Page``)
      - offset: rows to skip (default 0)

    REMEDIATION (D25 — Critical performance, 2026-06-04):
    ------------------------------------------------------
    Previously this endpoint loaded the ENTIRE tenant+entity slice into Python before filtering /
    sorting / paging. That's now corrected: pagination, ordering, and the ``q`` ILIKE filter all
    run in SQL so the result set is bounded at the database layer.

    Order of operations:
      SQL: tenant + entity_key + q (ILIKE on data::text) + ORDER BY + LIMIT/OFFSET
        ↓
      Python (per page, NOT per tenant):
        1. org-scope ``can()`` view-gate — drops rows whose owner_node_id is outside the caller's
           scope. Runs AFTER pagination because the org tree match is path-prefix and not
           cheaply pushable into SQL.
        2. GXL ``filter`` per record (broken/false excludes — never 500).
        3. field-level view-gate redaction in ``_serialize``.

    TRADE-OFFS (intentional, documented):
      * The legacy ``_matches_q`` walked each record's data values and matched on
        ``str.lower().contains(needle)``. The SQL form is ``data::text ILIKE '%q%'``, which is a
        very-close approximation: it matches the same characters, but the comparison happens
        over the JSON text representation, so a numeric ``42`` in a data field WILL match
        ``q=42`` (where the Python form skipped non-strings). False-positive risk only — a
        record that wasn't surfaced before may now appear. Acceptable for the perf-vs-fidelity
        trade-off; the launch-critical bug here was unbounded reads, not q-fidelity.
      * Because the org-scope filter runs in Python AFTER the LIMIT/OFFSET, a single returned
        page MAY contain fewer items than ``limit`` (some rows on the page were dropped by the
        view-gate). This is acceptable: clients walking pages should treat ``X-Total-Count``
        as the upper bound and stop when they get an empty page rather than assume every page
        is exactly ``limit`` long. The total reported in ``X-Total-Count`` is the pre-page,
        pre-view-gate total (the SQL-matched row count), so it's an UPPER bound on visible.
      * The GXL ``filter`` still runs per-row in Python (it's a tiny expression DSL with no SQL
        compiler) — that's now safe because it only sees one page at a time.
    """
    ent = await _entity(s, user.tenant_id, slug)
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "view"):           # no view permission on this entity at all
        _deny(ent.key, "view")
    paths = await _node_paths(s, user.tenant_id)

    # Build the SQL query: filter + sort + paginate AT THE DATABASE, not in Python. The
    # original implementation materialised every row in the tenant and then filtered — that
    # was the D25 critical (unbounded memory).
    stmt = build_record_list_stmt(user.tenant_id, ent.key, q, sort)

    # ---- pagination — pushed into SQL --------------------------------------------------
    # Defaults to DEFAULT_LIMIT (100) when ``limit`` is omitted; Page() raises 422 on
    # explicit overflow (limit > MAX_LIMIT). offset clamped at 0.
    page = Page.from_request(limit, offset)
    stmt = page.apply(stmt)

    rows = list((await s.execute(stmt)).scalars().all())

    # field-level view gate: which data keys this caller's roles may not see
    fields = await _fields(s, ent.id)
    hidden = _hidden_keys(fields, role_keys(grants), can(grants, "config", "manage"))

    # ---- post-page filtering in Python -------------------------------------------------
    # 1. org-scope view-gate — runs AFTER pagination because the path-subtree match is
    #    expensive to push into SQL (would need an org-tree join). The page may shrink as
    #    a result; clients should rely on X-Total-Count and the page emptying out for the
    #    end-of-list signal.
    visible = apply_org_scope(rows, grants, ent.key, paths)

    # 2. GXL filter (per record; broken/false expression excludes — never 500). Runs on the
    #    page only, so even pathological filters can no longer trigger a full-tenant scan.
    visible = apply_gxl_filter(visible, filter)

    # X-Total-Count: total matching rows from the SQL query (pre-view-gate-in-Python). With
    # SQL-side pagination this is now an UPPER bound on what the caller can see (vs. exact
    # pre-page count under the old all-rows-in-memory model). Frontend pagers still work —
    # they may overshoot by the org-scope-denied delta, but never undershoot.
    total = (await s.execute(count_select(build_count_stmt(user.tenant_id, ent.key, q)))).scalar_one()
    response.headers[X_TOTAL_COUNT] = str(total)

    return [_serialize(r, hidden) for r in visible]


@router.post("/{slug}", status_code=201)
async def create_record(slug: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ent = await _entity(s, user.tenant_id, slug)
    if ent.status == "retired":
        raise HTTPException(409, f"Entity '{slug}' is retired; new records cannot be created")
    grants = await load_grants(s, user)
    owner_path = await _node_path(s, user.primary_node_id)
    if not can(grants, ent.key, "create", owner_path):
        _deny(ent.key, "create")
    # SPEC §0.2 default-deny (Step 7) — Role × Department × Region × Ownership AND-evaluation on
    # top of the legacy role check above. Region comes from the payload's `data.region_id` when
    # present (a new record has no row yet); ownership is None on create (records gain an owner
    # only via subsequent /assign verbs on entities that have one).
    try:
        await assert_can(
            s, user,
            action="create",
            entity_key=ent.key,
            region_id=(payload.get("data") or {}).get("region_id") if isinstance(payload, dict) else None,
            owner_user_id=None,
        )
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    # SPEC §0.5 — references, not copies. Reject payloads that inline a master record as a nested
    # dict / list-of-dicts (must be passed by id reference). The check runs BEFORE field validation
    # so the violation surfaces with the clearest error.
    try:
        assert_no_inline_master_copies(payload, MASTER_RECORD_KEYS)
    except DuplicateMasterData as e:
        raise HTTPException(422, str(e))
    rkeys = role_keys(grants)
    admin = can(grants, "config", "manage")
    fields = await _fields(s, ent.id)
    data, _ignored_status, has_status = _validate(fields, payload, partial=False, caller_roles=rkeys, is_admin=admin)
    # status is lifecycle-managed: new records always start at the initial status
    status = (await _initial_status(s, ent.id)) if has_status else None
    # Stamp the human reference number (docs/standards/03 prefix registry) for entities that carry a
    # prefix — lead (LED), customer (CUS), etc. Entities without a prefix simply have no ref.
    prefix = _ENTITY_PREFIX.get(ent.key)
    if prefix and not data.get("ref"):
        data = {**data, "ref": await next_reference_number(s, tenant_id=user.tenant_id, prefix=prefix)}
    rec = Record(
        tenant_id=user.tenant_id, entity_key=ent.key,
        owner_node_id=user.primary_node_id, status=status, data=data,
    )
    s.add(rec)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "CREATE", ent.key, rec.id, user.id, {"data": data, "status": status})
    await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="CREATE", entity_key=ent.key,
                            record=rec, actor_user_id=user.id, extra={"status": status})
    await s.commit()
    rec = await _get(s, user.tenant_id, ent.key, rec.id)  # re-fetch: post-commit s.refresh fails (see transition)
    return _serialize(rec, _hidden_keys(fields, rkeys, admin))


@router.get("/{slug}/{rec_id}")
async def get_record(slug: str, rec_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ent = await _entity(s, user.tenant_id, slug)
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "view", await _node_path(s, rec.owner_node_id)):
        _deny(ent.key, "view")
    fields = await _fields(s, ent.id)
    hidden = _hidden_keys(fields, role_keys(grants), can(grants, "config", "manage"))
    return _serialize(rec, hidden)


@router.patch("/{slug}/{rec_id}")
async def update_record(slug: str, rec_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ent = await _entity(s, user.tenant_id, slug)
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "edit", await _node_path(s, rec.owner_node_id)):
        _deny(ent.key, "edit")
    # SPEC §0.2 default-deny (Step 7) — kernel gate on the existing record's region/owner.
    try:
        await assert_can(
            s, user,
            action="edit",
            entity_key=ent.key,
            region_id=getattr(rec, "region_id", None),
            owner_user_id=None,
        )
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    # SPEC §0.5 — references, not copies. Same guard as POST: even a partial update may not inline
    # a master record as a nested object.
    try:
        assert_no_inline_master_copies(payload, MASTER_RECORD_KEYS)
    except DuplicateMasterData as e:
        raise HTTPException(422, str(e))
    rkeys = role_keys(grants)
    admin = can(grants, "config", "manage")
    fields = await _fields(s, ent.id)
    data, _status_ignored, _ = _validate(fields, payload, partial=True, caller_roles=rkeys, is_admin=admin)
    # status changes go through /transition (guarded), never via free PATCH
    before = dict(rec.data or {})
    merged = dict(before)
    merged.update(data)
    rec.data = merged
    await workflow.emit(s, user.tenant_id, "UPDATE", ent.key, rec.id, user.id,
                        {"changed": data, "before": {k: before.get(k) for k in data}})
    await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="UPDATE", entity_key=ent.key,
                            record=rec, actor_user_id=user.id, extra={"changed": data})
    await s.commit()
    rec = await _get(s, user.tenant_id, ent.key, rec.id)  # re-fetch: post-commit s.refresh fails (see transition)
    return _serialize(rec, _hidden_keys(fields, rkeys, admin))


@router.delete("/{slug}/{rec_id}", status_code=204)
async def delete_record(slug: str, rec_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Delete a record.

    SPEC §4.5 mandatory-approval gate: deleting a `customer` record is destructive — the
    customer record is the root of orders, services, invoices, etc. — and so requires an
    APPROVED `customer_delete` Approval row. First call parks a PENDING approval and
    returns 202; once decided APPROVED via PATCH /api/mandatory-approvals/{id}/decide,
    the second call performs the delete and consumes the approval (EXECUTED). Deletes of
    any other entity slug pass through unchanged.
    """
    ent = await _entity(s, user.tenant_id, slug)
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "delete", await _node_path(s, rec.owner_node_id)):
        _deny(ent.key, "delete")
    # SPEC §0.2 default-deny (Step 7) — kernel gate.
    try:
        await assert_can(
            s, user,
            action="delete",
            entity_key=ent.key,
            region_id=getattr(rec, "region_id", None),
            owner_user_id=None,
        )
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # SPEC §4.5 — `customer_delete`. Only fires when the deleted entity is a customer;
    # all other slugs pass through unchanged.
    approved_approval = None
    if ent.key == "customer":
        try:
            await assert_approval_or_raise(
                s, tenant_id=user.tenant_id,
                action_type="customer_delete",
                target_entity_key="customer",
                target_record_id=rec.id,
            )
        except ApprovalRequired:
            approval = await create_approval_request(
                s, tenant_id=user.tenant_id,
                action_type="customer_delete",
                requested_by_user_id=user.id,
                target_entity_key="customer",
                target_record_id=rec.id,
                payload={"name": (rec.data or {}).get("name"), "status": rec.status},
            )
            await s.commit()
            raise approval_required(approval.id, "customer_delete")
        approved_approval = await find_approved_approval(
            s, tenant_id=user.tenant_id,
            action_type="customer_delete",
            target_entity_key="customer",
            target_record_id=rec.id,
        )

    await workflow.emit(s, user.tenant_id, "DELETE", ent.key, rec.id, user.id,
                        {"data": dict(rec.data or {}), "status": rec.status})
    await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="DELETE", entity_key=ent.key,
                            record=rec, actor_user_id=user.id, extra={"status": rec.status})
    await s.delete(rec)
    if approved_approval is not None:
        await mark_approval_executed(s, approval_id=approved_approval.id, actor_user_id=user.id)
    await s.commit()


@router.post("/{slug}/{rec_id}/transition")
async def transition(slug: str, rec_id: uuid.UUID, payload: dict, force: bool = False,
                     user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Move a record's status along a workflow transition, gated by a GXL guard.

    SPEC §4.5 mandatory-approval gate: `?force=true` is an admin override that lets the
    caller (1) skip the workflow guard if it fails and (2) attempt a transition that is not
    in the defined workflow (no matching from->to row). Such an override is a
    `workflow_override` per SPEC §4.5 and requires an APPROVED Approval row covering this
    record. First call parks a PENDING approval and returns 202; once decided APPROVED,
    the second call performs the override and consumes the approval (EXECUTED). The
    normal (force=false) path is exempt — those calls keep enforcing the workflow guard.
    """
    ent = await _entity(s, user.tenant_id, slug)
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "edit", await _node_path(s, rec.owner_node_id)):
        _deny(ent.key, "edit")
    # SPEC §0.2 default-deny (Step 7) — kernel gate on the transition (treated as an edit verb;
    # the per-transition guards still apply below).
    try:
        await assert_can(
            s, user,
            action="edit",
            entity_key=ent.key,
            region_id=getattr(rec, "region_id", None),
            owner_user_id=None,
        )
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    fields = await _fields(s, ent.id)
    hidden = _hidden_keys(fields, role_keys(grants), can(grants, "config", "manage"))

    to = payload.get("to")
    if not to:
        raise HTTPException(422, "Missing 'to' status")

    # SPEC §4.5 — `workflow_override`. Only fires when the caller passes ?force=true. The
    # gate runs BEFORE the guard/transition lookup so the approval check is independent of
    # whether the transition is otherwise legal.
    approved_override = None
    if force:
        try:
            await assert_approval_or_raise(
                s, tenant_id=user.tenant_id,
                action_type="workflow_override",
                target_entity_key=ent.key,
                target_record_id=rec.id,
            )
        except ApprovalRequired:
            approval = await create_approval_request(
                s, tenant_id=user.tenant_id,
                action_type="workflow_override",
                requested_by_user_id=user.id,
                target_entity_key=ent.key,
                target_record_id=rec.id,
                payload={"from": rec.status, "to": to, "slug": slug},
            )
            await s.commit()
            raise approval_required(approval.id, "workflow_override")
        approved_override = await find_approved_approval(
            s, tenant_id=user.tenant_id,
            action_type="workflow_override",
            target_entity_key=ent.key,
            target_record_id=rec.id,
        )

    transitions = await workflow.get_transitions(s, ent.id)
    tr = workflow.find_transition(transitions, rec.status, to)
    if not tr:
        if force:
            # With an APPROVED workflow_override, synthesize a minimal transition descriptor so
            # the rest of the path (emit + on-enter actions) runs as for a normal move.
            tr = {"from": rec.status, "to": to, "guard": None}
        else:
            raise HTTPException(409, f"No transition from '{rec.status}' to '{to}'")

    # Guard gate. `force` (an APPROVED workflow_override) bypasses the guard entirely, so skip the
    # evaluation — and its cross-record pre-fetch — in that case. A None/empty guard is always-pass.
    guard = tr.get("guard")
    if guard and not force:
        ctx = await workflow.guard_context(s, ent.id, rec)
        try:
            # Cross-record reach (sealed GXL addendum §2.1): pre-fetch any linked records the guard
            # dereferences and inject them into ctx before evaluating.
            ctx = await workflow.resolve_cross_record(s, ent.id, rec, guard, ctx)
        except gxl.GXLError as e:
            raise HTTPException(422, f"Invalid guard for {rec.status} -> {to}: {e}")
        if not gxl.evaluate(guard, ctx):
            raise HTTPException(422, f"Guard failed for {rec.status} -> {to}: {guard}")

    frm = rec.status

    # Approval step: park the move instead of applying it; the record stays at `frm` until decided.
    if workflow.requires_approval(tr):
        pa = await workflow.request_approval(s, tenant_id=user.tenant_id, entity_key=ent.key,
                                             record=rec, transition=tr, actor_user_id=user.id)
        await s.commit()
        rec = await _get(s, user.tenant_id, ent.key, rec.id)  # re-fetch: post-commit s.refresh fails
        return {**_serialize(rec, hidden),
                "pending_approval": {"id": str(pa.id), "to": to, "status": "PENDING"}}

    # Normal move: set status + emit the transition Event + run on-enter actions (fail-soft),
    # then fire event notifications.
    await workflow.complete_transition(s, tenant_id=user.tenant_id, entity_key=ent.key,
                                       record=rec, transition=tr, actor_user_id=user.id)
    await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="TRANSITION", entity_key=ent.key,
                            record=rec, actor_user_id=user.id, extra={"from": frm, "to": to})
    # SPEC §4.5 — consume the workflow_override approval (forward-only state machine).
    if approved_override is not None:
        await mark_approval_executed(s, approval_id=approved_override.id, actor_user_id=user.id)
    await s.commit()
    # Re-fetch rather than s.refresh(rec): after the transition's on-enter actions run, refreshing
    # the existing instance by identity raises InvalidRequestError ("Could not refresh instance"),
    # but the row is committed and readable — a fresh select returns the updated record.
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    return _serialize(rec, hidden)


@router.get("/{slug}/{rec_id}/history")
async def record_history(slug: str, rec_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The audit trail for one record — every create/update/transition/delete event."""
    ent = await _entity(s, user.tenant_id, slug)
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "view", await _node_path(s, rec.owner_node_id)):
        _deny(ent.key, "view")
    rows = (await s.execute(
        select(Event).where(Event.tenant_id == user.tenant_id, Event.record_id == rec_id).order_by(Event.created_at)
    )).scalars().all()
    return [
        {"type": e.type, "data": e.data, "actor_user_id": str(e.actor_user_id) if e.actor_user_id else None,
         "at": e.created_at.isoformat() if e.created_at else None}
        for e in rows
    ]
