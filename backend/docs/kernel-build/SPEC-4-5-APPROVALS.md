# SPEC §4.5 — Mandatory Approvals (scaffolding)

**SPEC reference:** `GAAex_Cross_Module_Architecture_SPEC.md`
- §4.5 Mandatory Approvals — the 12 high-stakes business actions that MUST go through an approval
  workflow before execution.
- §0.4 Audit Append-Only — every approval state change emits an Event.

This step lays the SPEC §4.5 scaffolding: the `Approval` model + `approval` table, the kernel
state-machine helpers, the HTTP router at `/api/mandatory-approvals`, and the smoke test. It does
NOT wire the gate into the 12 action paths — that adoption sweep is deferred (see "What's
deferred" below).

This is distinct from the pre-existing **M12 workflow-transition approval** system (`PendingApproval`
model + `routers/approvals.py` at `/api/approvals`). That system parks workflow status transitions
flagged `approval: true` and is a config-driven workflow feature. SPEC §4.5 is a SEPARATE kernel
concern: a registry of high-stakes business actions that requires explicit approval rows BEFORE the
action can execute. The two coexist in the codebase, each with their own table, kernel, router, and
audit trail.

Prior steps:
- Step 6 (`a7b3c9d5e1f2`) — kernel permissions engine (Dept/Region columns + `role_def_deny`).

---

## A — Model

`backend/app/models/approval.py` — adds the new `Approval` class alongside the existing
`PendingApproval` class:

```python
class Approval(Base):
    __tablename__ = "approval"
    __table_args__ = (
        Index("ix_approval_tenant_status", "tenant_id", "status"),
        Index("ix_approval_target", "target_entity_key", "target_record_id"),
    )

    id:                 uuid PK
    tenant_id:          uuid FK tenant.id        NOT NULL
    action_type:        str(60)                  NOT NULL    # one of MANDATORY_APPROVAL_ACTIONS
    target_entity_key:  str(80)                  NULL        # e.g. 'invoice', 'service'
    target_record_id:   uuid                     NULL        # the record being acted on
    requested_by:       uuid FK app_user.id      NOT NULL
    requested_at:       timestamptz default now()NOT NULL
    payload:            JSONB                    NOT NULL    # proposed change parameters
    status:             str(20) default 'PENDING' NOT NULL   # PENDING|APPROVED|REJECTED|EXECUTED
    decided_by:         uuid FK app_user.id      NULL
    decided_at:         timestamptz              NULL
    decision_reason:    text                     NULL
    executed_at:        timestamptz              NULL
```

Exported from `backend/app/models/__init__.py` as `Approval` (alongside the existing
`PendingApproval` export).

### State machine

```
    PENDING (default)  ──► APPROVED  ──► EXECUTED
                       └─► REJECTED   (terminal)
```

Forward-only — `decide_approval` refuses a non-PENDING row, `mark_approval_executed` refuses a
non-APPROVED row. The kernel helpers raise `ValueError` on illegal transitions; the router maps
those (and the equivalent state checks it does up front) to HTTP 409.

---

## B — Migration

`backend/alembic/versions/b5e8f1c2d3a4_spec_4_5_mandatory_approvals.py`

- **Revision:** `b5e8f1c2d3a4`
- **down_revision:** `a7b3c9d5e1f2` (Step 6)
- **Additive + reversible** — no data migration, no touched columns on other tables.

Creates the `approval` table with:

- All 13 columns above, including FKs to `tenant.id` and `app_user.id`.
- Three indexes: the implicit `ix_approval_tenant_id` (single-column convenience), plus the
  composite `ix_approval_tenant_status` (the list endpoint's hot path) and `ix_approval_target`
  (lookup-by-target for `assert_approval_or_raise`).
- Table comment quoting SPEC §4.5 + §0.4.
- Standard NULLIF-guarded tenant-isolation RLS policy:
  ```sql
  ALTER TABLE approval ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON approval
    USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
  ```

`downgrade()` drops the policy, the indexes, and the table.

---

## C — Kernel functions (`backend/app/kernel/approvals.py`)

```python
class ApprovalRequired(Exception):
    """SPEC §4.5 — action requires approval but no APPROVED row covers it."""

MANDATORY_APPROVAL_ACTIONS: frozenset[str] = frozenset({
    "high_discount", "refund", "credit_note", "invoice_cancel",
    "service_suspend", "contract_change", "payment_adjust",
    "customer_delete", "asset_writeoff", "procurement",
    "role_perm_change", "workflow_override",
})

async def assert_approval_or_raise(s, *, tenant_id, action_type,
                                   target_entity_key=None, target_record_id=None) -> None
async def create_approval_request(s, *, tenant_id, action_type, requested_by_user_id,
                                  target_entity_key=None, target_record_id=None,
                                  payload: dict) -> Approval
async def decide_approval(s, *, approval_id, decided_by_user_id,
                          decision: str, reason: str | None = None) -> Approval
async def mark_approval_executed(s, *, approval_id, actor_user_id=None) -> Approval
```

All four functions emit audit Events via `workflow.emit` (SPEC §0.4 append-only). Event types:

| Function                    | `Event.type`        |
| --------------------------- | ------------------- |
| `create_approval_request`   | `create approval`   |
| `decide_approval`           | `update approval`   |
| `mark_approval_executed`    | `execute approval`  |

Re-exported from `backend/app/kernel/__init__.py` so callers `from ..kernel import
assert_approval_or_raise, ApprovalRequired, ...` exactly like they already do for `assert_can` and
`AccessDenied`.

### Idempotency

`create_approval_request` dedupes on the tuple
`(tenant_id, action_type, target_entity_key, target_record_id, requested_by)` when an existing
row is in `PENDING` or `APPROVED` state. The protect-against case is UI retry / browser-back; a
second submission with a different payload still returns the original row (the first payload
wins). REJECTED and EXECUTED rows are NOT considered — a fresh attempt after rejection or
re-running an already-executed action is a brand-new request.

---

## D — Router (`backend/app/routers/mandatory_approvals.py`)

Mounted at `/api/mandatory-approvals`, included in `main.py` immediately after the existing
`approvals.router` (M12 workflow approvals at `/api/approvals`) so neither collides.

| Method | Path                                          | Purpose                                |
| ------ | --------------------------------------------- | -------------------------------------- |
| GET    | `/api/mandatory-approvals`                    | List, optional `?status=` `?action_type=` filters |
| GET    | `/api/mandatory-approvals/{id}`               | Detail                                 |
| POST   | `/api/mandatory-approvals`                    | Create PENDING request (idempotent)    |
| PATCH  | `/api/mandatory-approvals/{id}/decide`        | Flip PENDING → APPROVED \| REJECTED    |
| POST   | `/api/mandatory-approvals/{id}/execute`       | Flip APPROVED → EXECUTED               |

The `/decide` route runs `assert_can(s, user, action='approve', entity_key='approval')` — SPEC §0.2
default-deny via the Step 6/7 kernel gate. Holders of `super_admin` (wildcard grants) pass through
today; tenants who want a dedicated approver role can add an `approval.approve` permission via
Studio at any time.

All four mutating endpoints are tenant-scoped via `current_user` — a caller never sees another
tenant's approvals (enforced both at the SQL layer via the standard tenant_id WHERE clause and at
the DB layer via RLS).

### Distinct from `/api/approvals`

`routers/approvals.py` (PendingApproval-based) remains UNTOUCHED. It serves the M12 workflow
transition parking lot — a different conceptual table for a different concern.

---

## E — Smoke test (`backend/tests/test_mandatory_approvals.py`)

Five tests, all green:

```
tests/test_mandatory_approvals.py::test_create_decide_execute_progression_and_audit PASSED
tests/test_mandatory_approvals.py::test_decide_rejected_blocks_execute PASSED
tests/test_mandatory_approvals.py::test_invalid_action_type_rejected PASSED
tests/test_mandatory_approvals.py::test_all_spec_action_types_accepted PASSED
tests/test_mandatory_approvals.py::test_create_approval_request_is_idempotent PASSED

============================== 5 passed in 4.78s ==============================
```

Coverage:
1. Full happy-path progression PENDING → APPROVED → EXECUTED through the HTTP surface,
   incl. audit-event assertion.
2. REJECTED rows refuse `/execute` with 409; audit still records the rejection.
3. An action_type outside `MANDATORY_APPROVAL_ACTIONS` is 422.
4. Every one of the 12 SPEC §4.5 action types is accepted by the create endpoint.
5. Kernel-level idempotency on `create_approval_request` (returns the existing PENDING row).

The pre-existing PendingApproval test suite (`tests/test_approvals.py`) was re-run after the
changes and still passes 5/5 — the two systems coexist cleanly.

---

## F — What's deferred

### F.1 Adoption — wiring `assert_approval_or_raise` into the 12 action paths

The kernel scaffold exists; nothing in the codebase yet calls `assert_approval_or_raise` at the
mutation sites. The 12 SPEC §4.5 actions map to the following adopter targets:

| SPEC §4.5 action          | `action_type`         | Adopter (router / function)                                                     |
| ------------------------- | --------------------- | ------------------------------------------------------------------------------- |
| High discount             | `high_discount`       | `routers/orders.py` (apply_discount) + `routers/billing.py` (invoice line edits) |
| Refund                    | `refund`              | `routers/payment_gateway.py` + `routers/billing.py` payment refund path         |
| Credit note               | `credit_note`         | `routers/billing.py` credit-note creation                                       |
| Invoice cancellation      | `invoice_cancel`      | `routers/billing.py` invoice void / cancel                                      |
| Service suspension        | `service_suspend`     | `routers/services.py` suspend transition                                        |
| Contract change           | `contract_change`     | `routers/services.py` tariff change + `routers/orders.py` change order          |
| Manual payment adjustment | `payment_adjust`      | `routers/billing.py` manual payment line                                        |
| Customer deletion         | `customer_delete`     | `routers/records.py` (delete on `customer` slug) + `routers/accounts.py`        |
| Asset write-off           | `asset_writeoff`      | (new — Module 7 Inventory, not yet built)                                       |
| Procurement               | `procurement`         | (new — Module 7 Procurement, not yet built)                                     |
| Role permission change    | `role_perm_change`    | `routers/roles.py` (PATCH /api/roles/{id})                                       |
| Workflow override         | `workflow_override`   | `routers/records.py` transition with `?force=true` query (admin override)       |

For each adopter the pattern is:

```python
from ..kernel import (
    assert_can, AccessDenied,
    assert_approval_or_raise, ApprovalRequired,
    create_approval_request, mark_approval_executed,
)

# 1. Standard SPEC §0.2 role gate.
await assert_can(s, user, action="refund", entity_key="invoice", ...)

# 2. SPEC §4.5 approval gate. The caller may pass an explicit approval_id from the
#    request body (the standard "I've already got approval, execute it" flow) — the
#    gate then verifies that row is APPROVED for this exact action+target.
try:
    await assert_approval_or_raise(
        s, tenant_id=user.tenant_id,
        action_type="refund",
        target_entity_key="invoice", target_record_id=invoice_id,
    )
except ApprovalRequired:
    # No APPROVED row — queue a PENDING and return 202.
    approval = await create_approval_request(
        s, tenant_id=user.tenant_id,
        action_type="refund", requested_by_user_id=user.id,
        target_entity_key="invoice", target_record_id=invoice_id,
        payload={"amount": amount, "reason": reason},
    )
    await s.commit()
    return JSONResponse(status_code=202, content={
        "status": "approval_pending", "approval_id": str(approval.id),
    })

# 3. Action proper runs.
... do the refund ...

# 4. Close the gate so the approval can't be re-used.
await mark_approval_executed(s, approval_id=approval_id, actor_user_id=user.id)
```

This adoption sweep is a separate, bounded effort — analogous to Step 7's `assert_can` sweep.

### F.2 Notifications on approval request

When a new PENDING approval is created, the eligible approvers should be notified. This belongs
in the Module 3 notification subsystem (NotificationDef + notification-pref), not in the kernel.
Fold it into the notifications spec as a new NotificationDef key per action type
(`approval.high_discount.requested`, `approval.refund.requested`, …) and a generic emit in
`create_approval_request` once the NotificationDef seed lands.

### F.3 Expiry / auto-reject

SPEC §4.5 does not currently mandate an expiry window on PENDING approvals. A future enhancement
could auto-REJECT requests older than N days via a scheduler sweep (same pattern as the helpdesk
SLA sweep). The state machine already supports it (REJECTED is terminal; a fresh request after
expiry can be created cleanly because dedupe skips REJECTED rows).

### F.4 Role permission `approval.approve`

The router uses `assert_can(action='approve', entity_key='approval')` for the `/decide` gate. Today
only `super_admin` matches (wildcard grants). A dedicated `Approver` role with this exact permission
key, gated to specific action types via a future `approval_role_def` mapping table, is the
canonical SPEC §4.5 next step but is out of scope for the scaffolding.

---

## G — Verification transcript

```pwsh
PS> docker exec -i gaaex-db psql -U gaaex -c "CREATE DATABASE gaaex_approval_test;"
CREATE DATABASE

PS> $env:DATABASE_URL="postgresql+asyncpg://gaaex:gaaex@localhost:5433/gaaex_approval_test"
PS> $env:OWNER_DATABASE_URL=$env:DATABASE_URL
PS> cd backend
PS> .venv\Scripts\python.exe -m alembic upgrade head
INFO  [alembic.runtime.migration] Running upgrade a7b3c9d5e1f2 -> b5e8f1c2d3a4, SPEC §4.5 mandatory approvals — approval table

PS> docker exec -i gaaex-db psql -U gaaex -d gaaex_approval_test -c "\d approval"
                                      Table "public.approval"
      Column       |           Type           | Collation | Nullable |           Default
-------------------+--------------------------+-----------+----------+------------------------------
 id                | uuid                     |           | not null |
 tenant_id         | uuid                     |           | not null |
 action_type       | character varying(60)    |           | not null |
 target_entity_key | character varying(80)    |           |          |
 target_record_id  | uuid                     |           |          |
 requested_by      | uuid                     |           | not null |
 requested_at      | timestamp with time zone |           | not null | now()
 payload           | jsonb                    |           | not null | '{}'::jsonb
 status            | character varying(20)    |           | not null | 'PENDING'::character varying
 decided_by        | uuid                     |           |          |
 decided_at        | timestamp with time zone |           |          |
 decision_reason   | text                     |           |          |
 executed_at       | timestamp with time zone |           |          |
Indexes:
    "approval_pkey" PRIMARY KEY, btree (id)
    "ix_approval_target" btree (target_entity_key, target_record_id)
    "ix_approval_tenant_id" btree (tenant_id)
    "ix_approval_tenant_status" btree (tenant_id, status)
Foreign-key constraints:
    "approval_decided_by_fkey" FOREIGN KEY (decided_by) REFERENCES app_user(id)
    "approval_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES app_user(id)
    "approval_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenant(id)
Policies:
    POLICY "tenant_isolation"
      USING ((tenant_id = (NULLIF(current_setting('gaaex.tenant_id'::text, true), ''::text))::uuid))
      WITH CHECK ((tenant_id = (NULLIF(current_setting('gaaex.tenant_id'::text, true), ''::text))::uuid))

PS> .venv\Scripts\python.exe -m pytest tests/test_mandatory_approvals.py -v
tests/test_mandatory_approvals.py::test_create_decide_execute_progression_and_audit PASSED
tests/test_mandatory_approvals.py::test_decide_rejected_blocks_execute PASSED
tests/test_mandatory_approvals.py::test_invalid_action_type_rejected PASSED
tests/test_mandatory_approvals.py::test_all_spec_action_types_accepted PASSED
tests/test_mandatory_approvals.py::test_create_approval_request_is_idempotent PASSED
============================== 5 passed in 4.78s ==============================

PS> .venv\Scripts\python.exe -m pytest tests/test_approvals.py -v  # regression: existing PendingApproval tests
tests/test_approvals.py::test_actions_set_field_and_emit_event PASSED
tests/test_approvals.py::test_broken_action_is_failsoft PASSED
tests/test_approvals.py::test_approval_parks_lists_to_approver_and_approves PASSED
tests/test_approvals.py::test_approval_reject_leaves_record PASSED
tests/test_approvals.py::test_approval_guardrails PASSED
============================== 5 passed in 6.80s ==============================

PS> docker exec -i gaaex-db psql -U gaaex -c "DROP DATABASE gaaex_approval_test;"
DROP DATABASE
```

---

## H — Adoption (router wirings)

The scaffold described above is now adopted by the router-layer adopters listed below. Each
wiring follows the same pattern (refuse the mutation when `assert_approval_or_raise` raises;
queue a PENDING via `create_approval_request`; on the retry after `/decide` flips the row to
APPROVED, perform the mutation and `mark_approval_executed`). Only the trigger condition and
target tuple differ per adopter.

| SPEC §4.5 action       | Adopter (file:function)                                | Trigger                                            | Commit    |
| ---------------------- | ------------------------------------------------------ | -------------------------------------------------- | --------- |
| `service_suspend`      | `routers/services.py:suspend_service`                  | ACTIVE → SUSPENDED transition                      | `df56b96` |
| `invoice_cancel`       | `routers/billing.py:void_invoice`                      | ISSUED/OVERDUE → VOID transition                   | `da75336` |
| `contract_change`      | `routers/billing.py:update_subscription`               | PATCH mutates plan_name / amount / cycle           | `8b18232` |
| `payment_adjust`       | `routers/billing.py:add_payment`                       | Payload includes `adjust: true`                    | `d3512a2` |
| `high_discount`        | `routers/billing.py:create_invoice`                    | Σ(discount lines) > 20 % × Σ(charge lines)         | `7ff54ce` |
| `customer_delete`      | `routers/records.py:delete_record`                     | `ent.key == 'customer'` (DELETE /api/customers/{id}) | `b3922b6` |
| `role_perm_change`     | `routers/roles.py:update_role`                         | PATCH includes a `permissions` array               | `854c259` |
| `workflow_override`    | `routers/records.py:transition`                        | Query string `?force=true`                         | `70b7de8` |

Test coverage for the gates lives in `tests/test_billing.py` (5 tests on
contract_change / payment_adjust / high_discount, plus exempt-path coverage) and
`tests/test_mandatory_approvals.py` (2 tests on customer_delete + non-customer
pass-through), all added in commit `f8aa5e8`. Total green tests after the adoption sweep:
**578** (baseline before sweep was 571 — +7 new tests, zero regressions).

### Not wired (no adopter route exists yet)

| SPEC §4.5 action  | Reason                                                                            |
| ----------------- | --------------------------------------------------------------------------------- |
| `refund`          | No refund endpoint exists in `routers/payment_gateway.py` or `routers/billing.py`. Payment refunds are not modeled as a distinct mutation path today — they would require either a `POST /api/payments/{id}/refund` route or a `POST /api/payment-orders/{id}/refund` route, neither of which is built. Wire when the refund flow is built. |
| `credit_note`     | No credit-note creation endpoint exists. Credit notes today are expressed as discount lines on a manual invoice (already gated by `high_discount` when they cross the 20 % threshold). When a dedicated `POST /api/credit-notes` endpoint lands, wire `credit_note` there. |
| `asset_writeoff`  | Inventory module (Module 7) not yet built; route does not exist (already noted as deferred in §F.1). |
| `procurement`     | Procurement module (Module 7) not yet built; route does not exist (already noted as deferred in §F.1). |

The remaining 8 of 12 actions are wired. When the four deferred routes land, each is a
~15-line addition matching the patterns above.
