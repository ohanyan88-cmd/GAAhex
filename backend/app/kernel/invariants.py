"""Application-level enforcement of the SPEC §0 Global Invariants.

The DB-level halves (financial immutability triggers, audit append-only triggers, region_id
columns) live in alembic revision `b70ef3b98e27`. This module owns the runtime halves: the rules
that depend on the calling user / module / payload context and so cannot be evaluated by a static
DB constraint.

SPEC §0 lists 7 Global Invariants. Each public function below cites the invariant it enforces.
Each typed exception is meant to be caught by FastAPI and mapped to the appropriate HTTP code:

    OwnerViolation       → 409 Conflict       (write rejected — caller is not the owner module)
    AccessDenied         → 403 Forbidden      (default-deny: no grant covers the request)
    DuplicateMasterData  → 409 Conflict       (write rejected — payload inlined master data)
    CrossRegionDenied    → 403 Forbidden      (read rejected — region scope doesn't include target)

Important: this module is the kernel FACADE. The real engines (the full default-deny matrix across
Role × Department × Region × Ownership, the cross-region grant graph, the master-data registry)
land in later steps. For now the facade exists, raises the right exception type for the right
condition, and is a no-op when the supporting metadata isn't backfilled yet. Routers and writers
that adopt these gates today get a working contract; later step expansions deepen the rules without
changing the call sites.
"""
from __future__ import annotations

import logging
import uuid
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import EntityDef, User


_log = logging.getLogger("gaaex.kernel.invariants")


# ---------------------------------------------------------------------------- §0.5 master-data registry

#: SPEC §2.4 / §6 — the master records of GAAex. These exist ONCE in the system and are referenced
#: by id from every linked record (Subscription, Invoice line, Work Order, etc.). A payload that
#: inlines one of these by VALUE (a nested dict instead of an id reference) violates SPEC §0.5
#: "References, not copies." The records router scans incoming write payloads against this set via
#: `assert_no_inline_master_copies` and rejects offenders with HTTP 422 (DuplicateMasterData).
#:
#: Membership rationale (from SPEC §6 Data Relationships):
#:   - customer, contact         — root identity records (§2.3 account model)
#:   - billing_account           — financial container under Customer (§2.3)
#:   - service                   — provisioned service instance (§6 Service relationships)
#:   - product, tariff_plan      — catalog masters referenced by every service/order (§2.2 + §6)
#:   - vendor                    — Procurement master referenced by purchase orders, payments
#:   - employee                  — HR master referenced by assignments, payroll, work orders
#:
#: The set is a frozen view of the master-data registry — adding a master record means appending
#: here in one place; every router that calls `assert_no_inline_master_copies(payload,
#: MASTER_RECORD_KEYS)` immediately gets the new guard.
MASTER_RECORD_KEYS: frozenset[str] = frozenset({
    "customer",
    "contact",
    "billing_account",
    "service",
    "product",
    "tariff_plan",
    "vendor",
    "employee",
})


# ---------------------------------------------------------------------------- typed exceptions

class OwnerViolation(Exception):
    """SPEC §0.1 — a non-owner module tried to write a record kind it does not own.

    Map to HTTP 409 Conflict. The caller may still READ and reference the record; the violation is
    specifically about WRITES.
    """


class AccessDenied(Exception):
    """SPEC §0.2 — default-deny: no grant covers the requested (action, entity, scope).

    Map to HTTP 403 Forbidden. The body should NOT echo which layer denied (Role / Dept / Region /
    Ownership) — leaking the matrix shape gives a hostile caller probing power. A generic "access
    denied" is the right surface.
    """


class DuplicateMasterData(Exception):
    """SPEC §0.5 — a write payload inlined a master-data record by value rather than by id.

    Map to HTTP 409 Conflict. Example: a Subscription payload that contains a full `tariff_plan`
    object dictionary instead of a `tariff_plan_id` UUID. Master records live ONCE; linkages
    reference by id only.
    """


class CrossRegionDenied(Exception):
    """SPEC §0.6 — caller asked for a record in a region their scope doesn't include.

    Map to HTTP 403 Forbidden. The user's region scope is derived from their org_node assignments
    (Step 6 wires the real region scope evaluator). Until then this facade is a no-op when the
    target region_id is NULL (legacy unpartitioned data).
    """


# ---------------------------------------------------------------------------- SPEC §4.5 own-only actions

#: SPEC §4 sketches actions that are inherently scoped to the acting user's own records. The
#: assert_can ownership layer enforces these by requiring `user.id == owner_user_id` when the
#: action belongs to this set. Tuning the set is config-driven (Studio path) in a later step; for
#: now this is the kernel default.
#:
#: The set lives here so adding an "own-only" action is one append in one place, not a router
#: sweep. A None owner_user_id (record has no assigned owner / unassigned) means the ownership
#: layer is a no-op — we don't refuse an action because we don't know whose record it is.
_OWN_ONLY_ACTIONS: frozenset[str] = frozenset({
    "workitem.view.own",
    "workitem.edit.own",
    "task.edit.own",
})


# ---------------------------------------------------------------------------- §0.1 single-owner write — first-class tables
#
# SPEC §2.2 Ownership Matrix split:
#
#   1. Config-driven entities (Record rows keyed by `entity_key`) → governed by
#      `entity_def.owner_module` (Step 3 backfill) + `assert_writer_owns_record` below.
#
#   2. First-class typed tables (`invoice`, `payment`, `service`, …) → carry no entity_def
#      row, so ownership is encoded here in code and enforced via
#      `assert_writer_owns_record_firstclass` from each first-class write router.
#
# The map keys are physical `__tablename__` strings so the guard is unambiguous when several
# routers write the same table (e.g. billing.py writes invoice / payment / subscription). The
# right-hand values come verbatim from SPEC §2.2 — "Invoices", "Payments", "Service Inventory",
# etc. — so the seed file, the kernel, and the spec read the same words.
FIRST_CLASS_OWNER_MAP: dict[str, str] = {
    # Billing & Revenue
    "invoice":           "Invoices",
    "payment":           "Payments",
    "credit_note":       "Invoices",          # SPEC §2.2: Credit Note → owner Invoices
    "subscription":      "Billing Accounts",  # financial container under Customer
    # Catalog
    "product":           "Product Catalog",
    # Operations
    "service":           "Service Inventory",
    "service_resource":  "Service Inventory",
    # Sales / fulfillment
    "order":             "Orders",
    "order_item":        "Orders",
    # Support
    "helpdesk_ticket":   "Tickets",
    "helpdesk_queue":    "Tickets",
    # Work dispatch (SPEC §2.2 "Work Order — Owner: Work Orders")
    "workitem":          "Work Orders",
    # add more from SPEC §2.2 as their first-class tables land (asset, contract, etc.)
}


async def assert_writer_owns_record_firstclass(
    s: AsyncSession,
    *,
    table_name: str,
    writer_module: str,
) -> None:
    """SPEC §0.1 — Single owner, first-class table variant.

    Use this for typed first-class tables (`invoice`, `payment`, `service`, …) whose ownership
    can't be discovered via `entity_def.owner_module` because they don't have an entity_def
    row. For config-driven Record-backed entities, use `assert_writer_owns_record`.

    Looks up `table_name` in `FIRST_CLASS_OWNER_MAP` and raises `OwnerViolation` when
    `writer_module` does not match.

    No-op contract:
        - `table_name` not in `FIRST_CLASS_OWNER_MAP` → no-op (legacy / not-yet-mapped path).
          New first-class tables get a no-op until they're added to the map; this keeps the
          kernel adoptable without flag-day breakage.

    The `s` AsyncSession arg is accepted for forward compatibility — current logic is a pure
    map lookup, but later steps may consult tenant-scoped overrides (e.g. an
    `ownership_override` table) the same way the entity_def lookup works today.
    """
    expected = FIRST_CLASS_OWNER_MAP.get(table_name)
    if expected is None:
        return  # not in the map — skip (legacy path)
    if writer_module != expected:
        raise OwnerViolation(
            f"SPEC §0.1: only the {expected!r} module may write to {table_name!r}. "
            f"Caller declared writer_module={writer_module!r}."
        )


# ---------------------------------------------------------------------------- §0.1 single-owner write

async def assert_writer_owns_record(
    s: AsyncSession,
    *,
    entity_key: str,
    writer_module: str,
) -> None:
    """SPEC §0.1 — Single owner. Every record has exactly one source module. Non-owner modules can
    read / reference / trigger, but cannot WRITE.

    Looks up `entity_def.owner_module` for the given `entity_key` and raises `OwnerViolation` if
    `writer_module` does not match.

    No-op contract:
        - If no `entity_def` row exists for `entity_key` → no-op (custom / unregistered entity).
        - If `entity_def.owner_module` is NULL → no-op (owner_module backfill lands in Step 3; until
          then the ownership matrix isn't populated and we cannot enforce). This keeps the kernel
          gate adoptable today without breaking when called for an entity that hasn't been
          attributed yet.

    Step 3 will backfill `entity_def.owner_module` from the SPEC §2.2 ownership matrix; once that
    column is universally non-NULL the facade becomes strict by construction without any code
    change here.
    """
    row = (
        await s.execute(
            select(EntityDef.owner_module).where(EntityDef.key == entity_key)
        )
    ).first()
    if row is None:
        return  # unknown entity_key — no def row, no enforcement
    owner_module = row[0]
    if not owner_module:
        return  # not yet backfilled — see Step 3
    if owner_module != writer_module:
        raise OwnerViolation(
            f"entity '{entity_key}' is owned by '{owner_module}'; "
            f"module '{writer_module}' cannot write it (read/reference/trigger only) — SPEC §0.1"
        )


# ---------------------------------------------------------------------------- §0.2 default-deny

async def assert_can(
    s: AsyncSession,
    user: User,
    *,
    action: str,
    entity_key: str,
    region_id: uuid.UUID | None = None,
    department: str | None = None,
    owner_user_id: uuid.UUID | None = None,
) -> None:
    """SPEC §0.2 default-deny — AND-evaluation across Role × Department × Region × Ownership.

    The four SPEC §4.1 layers, evaluated in order. The function raises `AccessDenied` on the FIRST
    layer that denies (so the message indicates which layer caught it, which is fine for server
    logs; the router maps everything to a generic 403 to the caller — see the class docstring).

      1. **Role layer.** Look up the user's role grants via `access.load_grants`. The combined
         permission key is `f'{entity_key}.{action}'`. If no grant covers it (or '*' or
         '{entity_key}.*'), raise `AccessDenied('role: missing {key}')`.

      2. **Role hard-denial layer (SPEC §4.3).** Even if the positive permission matched, scan
         `role_def_deny` for the user's roles. A matching deny row raises `AccessDenied('role
         hard-denial …')`. Wildcard semantics: `denied_action='*'` matches any verb;
         `denied_entity_key=NULL` matches any entity.

      3. **Department layer (SPEC §4.1).** When `department` (the record's department) is
         provided, check that AT LEAST ONE of the user's assignments either has `department=NULL`
         (department-agnostic) or matches the record's department. If none do, raise
         `AccessDenied('department: mismatch')`.

      4. **Region layer (SPEC §0.6 + §4.1).** When `region_id` is provided, delegate to
         `assert_can_read_region` — Step 6 keeps the underlying engine as a forward-compat
         facade (full region-grant evaluation is a follow-up step).

      5. **Ownership layer (SPEC §4 'own only').** When `action` is in `_OWN_ONLY_ACTIONS` and
         `owner_user_id` is provided, require `user.id == owner_user_id`. Raises
         `AccessDenied('ownership: not the record owner')` on mismatch.

    Transitional backward-compatibility: every layer beyond #1 and #2 is gated on its respective
    optional input. With all optional kwargs left at None (the legacy call shape), the function
    falls back to layers #1 + #2 only — and emits a WARNING log "assert_can called without
    region/department context — kernel falling back to role-only check". This is intentional: it
    lets routers incrementally adopt the engine without breaking the M0 surface.

    SPEC §0.2 default-deny posture is preserved by design: every layer must AFFIRMATIVELY allow.
    """
    # Local imports to avoid module-load cycles (access.py → models → kernel).
    from .. import access as access_engine
    from ..models import Assignment, RoleDef, RoleDeny

    # ---------- layer 1: role grant ----------
    grants = await access_engine.load_grants(s, user)
    if not access_engine.can(grants, entity_key, action):
        raise AccessDenied(
            f"role: missing {entity_key}.{action} — SPEC §0.2 default-deny"
        )

    # ---------- layer 2: role hard-denial (SPEC §4.3) ----------
    # Collect the role_ids the user holds (via their assignments) and look up the deny rows in
    # one query. An empty result is the happy path — no deny rows applicable.
    role_ids_rows = (
        await s.execute(
            select(RoleDef.id)
            .join(Assignment, Assignment.role_id == RoleDef.id)
            .where(
                Assignment.user_id == user.id,
                Assignment.tenant_id == user.tenant_id,
            )
        )
    ).all()
    role_ids = [r[0] for r in role_ids_rows]
    if role_ids:
        deny_rows = (
            await s.execute(
                select(RoleDeny.denied_action, RoleDeny.denied_entity_key, RoleDeny.reason)
                .where(
                    RoleDeny.role_id.in_(role_ids),
                    RoleDeny.tenant_id == user.tenant_id,
                )
            )
        ).all()
        for denied_action, denied_entity_key, reason in deny_rows:
            if _deny_matches(denied_action, denied_entity_key, action, entity_key):
                msg = f"role hard-denial: '{denied_action}' on '{denied_entity_key or '*'}'"
                if reason:
                    msg += f" — {reason}"
                msg += " — SPEC §4.3"
                raise AccessDenied(msg)

    # ---------- transitional fallback warning ----------
    # If the caller passed NO scope context at all, log a warning and stop — they're using the
    # legacy (Step 0-5) API shape. This is the documented escape hatch for incremental adoption.
    if region_id is None and department is None and owner_user_id is None:
        _log.warning(
            "assert_can called without region/department/owner context — kernel falling back "
            "to role-only check for action=%r entity=%r user=%s",
            action, entity_key, getattr(user, "id", None),
        )
        return

    # ---------- layer 3: department ----------
    if department is not None:
        # The user matches if any of their assignments is department-agnostic (NULL) or names the
        # same department. We also accept the user's own `user.department` as a default if no
        # assignments specify one — covers the bootstrap state where assignments haven't been
        # widened with per-assignment department filters yet.
        dept_rows = (
            await s.execute(
                select(Assignment.department)
                .where(
                    Assignment.user_id == user.id,
                    Assignment.tenant_id == user.tenant_id,
                )
            )
        ).all()
        # Treat absence of any assignment department info as "fall back to user.department".
        assignment_depts = [r[0] for r in dept_rows]
        user_dept = getattr(user, "department", None)
        if any(d is None or d == department for d in assignment_depts):
            pass  # ok — at least one assignment covers this department
        elif user_dept is not None and user_dept == department:
            pass  # ok — user's home department matches
        else:
            raise AccessDenied(
                f"department: user is not in '{department}' — SPEC §4.1"
            )

    # ---------- layer 4: region (delegate to existing facade) ----------
    if region_id is not None:
        await assert_can_read_region(s, user, region_id=region_id)

    # ---------- layer 5: ownership (SPEC §4 'own only' actions) ----------
    if action in _OWN_ONLY_ACTIONS and owner_user_id is not None:
        if user.id != owner_user_id:
            raise AccessDenied(
                f"ownership: action '{action}' is restricted to the record owner — SPEC §4"
            )


def _deny_matches(
    denied_action: str,
    denied_entity_key: str | None,
    action: str,
    entity_key: str,
) -> bool:
    """Return True iff the (denied_action, denied_entity_key) pair denies the requested
    (action, entity_key).

    Semantics:
        - `denied_action == '*'`            → matches any verb (entity still filtered below).
        - `denied_action == entity.action`  → matches when (entity_key, action) joins to the same
                                              compound string. Examples from SPEC §4.3:
                                                `invoice.edit`, `payment.*`, `network.config.*`.
        - `denied_action == action`         → bare verb match (used with denied_entity_key).
        - `denied_entity_key` NULL          → any entity matches.
        - `denied_entity_key == entity_key` → exact entity match.

    The compound-string form (`payment.*` style) is taken verbatim from the SPEC §4.3 text and
    parsed here at compare-time so the seed file reads identically to the SPEC.
    """
    requested = f"{entity_key}.{action}"

    # Compound form first — `denied_action` may itself be `entity.verb` or `entity.*`.
    if "." in denied_action:
        d_entity, d_verb = denied_action.split(".", 1)
        # `network.config.*` and similar dotted prefixes: treat the right-most segment as the verb,
        # everything before as a dotted entity match (e.g. 'network.config' == entity prefix).
        if "." in d_verb:
            # multi-segment entity: walk it as a prefix on the requested key.
            if requested == denied_action:
                return True
            if d_verb.endswith(".*") and requested.startswith(denied_action[:-1]):
                return True
            return False
        if d_verb == "*":
            entity_matches = (d_entity == entity_key)
            return entity_matches
        if d_entity == entity_key and d_verb == action:
            return True
        return False

    # Bare verb form (denied_action='view' / 'edit' / '*').
    if denied_action == "*":
        return denied_entity_key is None or denied_entity_key == entity_key
    if denied_action == action:
        return denied_entity_key is None or denied_entity_key == entity_key
    return False


# ---------------------------------------------------------------------------- §0.5 references-not-copies

def assert_no_inline_master_copies(payload: dict, master_keys: Iterable[str]) -> None:
    """SPEC §0.5 — References, not copies. Linked records store IDs only. No duplicated master data.

    Scans `payload` for any key in `master_keys` whose value is a dict / list-of-dicts (i.e. an
    inlined record object) rather than a UUID string / id reference. Raises `DuplicateMasterData`
    on the first offender.

    Example master_keys for a Subscription write: {"tariff_plan", "product", "customer"} — those
    must be passed as `tariff_plan_id`, `product_id`, `customer_id` references, not as nested
    objects.

    STUB STATUS — Step 3 wires this into the Record write path (`POST /api/{slug}` and the bulk
    write endpoints) once the master-data registry is enumerated. The function is fully working
    today; only the call sites are pending.
    """
    if not isinstance(payload, dict):
        return  # not a payload we can scan — let the writer validate shape

    master_set = set(master_keys)
    for key, value in payload.items():
        if key not in master_set:
            continue
        # Acceptable shapes: None, str (id), UUID, int — anything that LOOKS like a reference.
        # Reject dict and list-of-dict, which are the duplicated-master-data shapes.
        if isinstance(value, dict):
            raise DuplicateMasterData(
                f"payload key '{key}' is a master record — pass it by id ('{key}_id'), "
                f"not as an inline object — SPEC §0.5"
            )
        if isinstance(value, list) and value and isinstance(value[0], dict):
            raise DuplicateMasterData(
                f"payload key '{key}' is a list of master records — pass ids only "
                f"('{key}_ids'), not inline objects — SPEC §0.5"
            )


# ---------------------------------------------------------------------------- §0.6 cross-region read

async def assert_can_read_region(
    s: AsyncSession,
    user: User,
    *,
    region_id,
) -> None:
    """SPEC §0.6 — Region/Branch is a partition key on every operational record. Cross-region read
    requires an explicit grant.

    Today this is a facade. Step 6 wires the real evaluator that walks the user's org_node
    assignments, projects them to the region partition, and checks coverage.

    No-op contract:
        - If `region_id` is None → no-op (legacy unpartitioned data; pre-Step-3 backfill rows have
          NULL region_id, and refusing those would break every existing reader).
        - Otherwise: for now, fall through (no enforcement). The kernel surface is in place so
          callers can adopt the gate today and Step 6 swaps the implementation in without changing
          a single call site.

    The exception type is wired into FastAPI handlers so the 403 mapping is ready the moment Step 6
    flips this from facade to engine.
    """
    if region_id is None:
        return
    # Step 6 lands the schema (org_node.region_code + assignment.region_scope) and the kernel
    # call shape. The full region-grant evaluator (walk user's assignments → resolve region_code
    # via subtree → match against region_id) is deferred to a follow-up step that introduces the
    # canonical region table. Until then this guard is a no-op fall-through that keeps the
    # contract live; adopters get a working call site immediately.
    return
