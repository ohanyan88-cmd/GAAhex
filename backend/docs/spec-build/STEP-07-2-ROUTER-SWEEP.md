# Step 7.2 — Router Sweep (assert_can adoption)

Per the Step 7.2 plan (continuing the Step 7 router sweep that wired 18 routers + 6 §4.5
adoption paths), this pass adopts `assert_can` on the remaining router write paths.

## Routers wired in this sweep

Per-router commits (each only touches the listed file):

| Router | Action | Entity key | Commit |
|---|---|---|---|
| `calendar.py` | create / edit / delete | `calendar`, `calendar_event` | `2a8a6b2` |
| `notifications.py` | outbound compose+send only | `outbound_message` | `b9a4369` |
| `tenant_settings.py` | settings/theme writes | `tenant` | `82c5e92` |
| `views.py` | saved_view CRUD | (borrows entity's `view`) | `6343523` |
| `page_config.py` | page_config + page_field_value writes | `page_config`, `page_field_value` | `b556d8a` |
| `org_nodes.py` | node CRUD | `org_node` | `653ba1f` |
| `i18n.py` | translation upserts | `translation` | `d59c5e0` |
| `assignments.py` | role assignment CRUD | `assignment` | `7c444ce` |
| `feature_flags.py` | feature flag CRUD | `feature_flag` | `0a288ad` |
| `studio_pages.py` | page versions / publish / rollback | `studio_page` | `7ec963e` |
| `page_bindings.py` | binding CRUD | `page_binding` | `525c4c8` |
| `notification_defs.py` | notification def CRUD + test-send | `notification_def` | `0d1b936` |
| `dashboards.py` | dashboard + widget CRUD | `dashboard_def` | `a1eb49f` |
| `users.py` | user CRUD | `app_user` | `93e2db8` |
| `report_builder.py` | saved report CRUD | (borrows entity's `view`) | `182dc55` |
| `report_schedules.py` | schedule CRUD + run-due | `report_schedule` | `a310e2e` |
| `digests.py` | manual run-digests trigger | `notification` (`manage` action) | `97aee6e` |
| `ops.py` | maintenance toggle | `ops_maintenance` | `88323e5` |
| `bulk.py` | per-record delete / transition | (uses the bulk entity's key) | `8248c9c` |
| `convert.py` | lead → customer | `lead` (edit) + `customer` (create) | `3879cb6` |
| `billing_cycle.py` | billing run-cycle | `invoice` (`create` action) | `2a0cc07` |
| `ai.py` | score / summarize / ask / chat / act | `ai` (`use` action) | `83abf3c` |
| `approvals.py` | approve / reject | `approval` | `86e6c93` |

**23 routers wired** in Step 7.2.

### Pattern used

Each wire follows the established pattern from `orders.py`:

```python
from ..kernel import assert_can, AccessDenied

try:
    await assert_can(
        s, user,
        action=<verb>,                          # create | edit | delete | config_manage | use | …
        entity_key=<entity>,                    # the entity being mutated
        region_id=<rec.region_id if any>,
        owner_user_id=<rec.created_by / .owner_user_id if any>,
    )
except AccessDenied as e:
    raise HTTPException(403, detail=str(e))
```

Where a router had a central `_require_config_manage(…)` helper (meta.py / roles.py style),
the kernel gate was added INSIDE that helper so every write path inherits it without
duplicating the try/except.

For routers whose writes use an inline `can(grants, "config", "manage")` check (no helper),
either a per-handler kernel call was added after the legacy check, or a tiny local helper
(`_kernel_gate(...)`) was introduced.

### Owner-borrow choice (saved_view + report_def)

`saved_view` and `report_def` are configuration objects layered OVER an entity. Their kernel
gate borrows the underlying entity's view permission (`entity_key=<the_entity>, action="view"`)
because the role grants don't seed `saved_view.*` / `report_def.*` — using the borrowed perm
keeps the sales_agent path working (existing test `test_list_views_own_plus_shared_not_others`
exercises this).

## Skipped — by design

| Router | Reason |
|---|---|
| `auth.py` | Login itself is the precondition for kernel checks; gating it would invert. |
| `portal_auth.py` | Same — portal session establishment. |
| `portal_billing.py`, `portal_service.py`, `portal_support.py` | Principal is `CustomerUser`, not `User`; the kernel `assert_can` expects User. Wiring breaks the type contract — DEFERRED to a future portal-aware kernel surface. |
| `me.py` | Self-service only (`/api/me/avatar`, `/api/me/password`). Routes mutate ONLY the caller's own row via `_own_row(s, user)`. Own-only by construction. |
| `search_assist.py` | Saved searches / recent / pinned — every route scopes to `user.id` in the WHERE clause. Own-only by construction. |
| `notifications.py` (inbox) | `mark_read`, `snooze`, `archive`, `unarchive`, `read-all` — every route scopes to `user_id == user.id` in the WHERE clause. Own-only by construction. Adding kernel `notification.edit` would require seeding it on every role; the WHERE clause IS the own-only enforcement. |
| Read-only routers (`activity`, `analytics`, `audit_log`, `capabilities`, `dashboards` GET, `documents`, `events`, `export`, `health`, `jobs`, `kpis`, `me` GET, `metrics`, `nav_registry`, `reports`, `report_builder` GET / run, `search`) | Writes are what need gating; reads are scoped via grants + RLS already. |

## Already wired before this sweep

Per Step 7 + §4.5 adoption (see git log preceding `7524d5f`):

- `records`, `orders`, `billing`, `helpdesk`, `workitems`, `services`, `customer360`, `meta`,
  `roles`, `automations`, `webhooks`, `comm`, `interactions`, `payment_gateway`, `accounts`,
  `respool`, `usage`, `apikeys` (Step 7)
- §4.5 adoption: `billing` (contract_change, payment_adjust, high_discount),
  `records` (customer_delete), `roles` (role_perm_change), `workflows` (workflow_override)
- `mandatory_approvals`, `customer_timeline`, `kpis` (incidentally call assert_can)

## Test results

The Step 7.2 router commits do not break the per-router tests:

- `tests/test_calendar.py` — 14 passed
- `tests/test_notifications.py` + `tests/test_outbound_compose.py` + `tests/test_notif_a26.py` + `tests/test_notif_prefs.py` — 30 passed
- `tests/test_search.py` (covers views) — 11 passed
- `tests/test_page_config.py` — 5 passed
- `tests/test_i18n.py` — 4 passed
- `tests/test_feature_flags.py` — passes (5 + tests)
- `tests/test_studio_pages.py` — 9 passed
- `tests/test_page_bindings.py` — 4 passed
- `tests/test_dashboards.py` — 11 passed
- `tests/test_users.py` — 4 passed
- `tests/test_report_builder.py` — 7 passed
- `tests/test_reports.py` — 10 passed (covers report_schedules indirectly)
- `tests/test_tenant_theme.py` — passes
- `tests/test_ops.py` — 3 passed
- `tests/test_billing.py` + `tests/test_billing_depth.py` — 22 passed (covers billing_cycle)
- `tests/test_loop_e2e.py` — 1 passed (covers convert)
- `tests/test_bulk.py` — 5 passed (after moving kernel gate per-record to preserve partial-failure)
- `tests/test_ai.py` + `tests/test_ai_agent.py` — 18 passed
- `tests/test_approvals.py` — 5 passed

Medium-sized batches of the wired router tests run together pass cleanly (e.g. 73 passed in a
batch of 13 test files). The full pytest suite shows pre-existing test isolation flakiness
caused by parallel work-in-progress changes in `backend/app/routers/billing.py` and the
field-encryption migration that are NOT part of Step 7.2's scope — that flakiness predates
this sweep and is owned by the §4.4 ACTIVATE agent.

### Baseline reference

Baseline run before any 7.2 work: **609 passed, 8 skipped, 1 xfailed**.

When my Step 7.2 commits are layered onto a clean test DB, individual-router tests pass and
medium batches stay green. The full-suite re-runs are inconsistent due to the chronic
test-isolation issue (session-scoped DB + pytest-asyncio interactions) that is not introduced
by this sweep — same flake pattern (DB connection closed during setup, `app_user` table not
yet seeded between sessions) is observed even when only running test files that don't touch
any 7.2 router. Reproducing the exact baseline number requires a fresh `gaahex_test` drop and
a quiet machine; on this branch with parallel agents writing, the suite number floats.

## Notes / follow-ups

1. **Role grants for new kernel-gated entities.** Several new entity keys appeared in this
   sweep (`calendar`, `calendar_event`, `outbound_message`, `org_node`, `translation`,
   `assignment`, `feature_flag`, `studio_page`, `page_binding`, `notification_def`,
   `dashboard_def`, `app_user`, `report_schedule`, `ops_maintenance`, `page_config`,
   `page_field_value`, `approval`). Today they only resolve via `super_admin`'s `*` grant.
   When the role seed is widened to grant these explicitly, no router change is needed —
   the kernel will start enforcing per-role in addition to the legacy `config.manage` check.

2. **Bulk router design.** The bulk gate was deliberately moved into `_do_delete` / `_do_transition`
   (per-record) rather than batch-level, to preserve the documented partial-failure contract
   in `test_bulk_agent_forbidden_per_id` (a forbidden id fails its own row; the batch still
   returns 200).

3. **Portal routers deferred.** When the kernel surface grows a `CustomerUser`-aware sibling
   (e.g. `assert_customer_can`), the four portal routers can be wired without changing the
   kernel's User-typed core.

4. **Notification inbox / me / search-assist deferred-by-design.** These are own-only by
   construction (WHERE filters on `user.id`). Adding kernel gates would require seeding
   per-user permission grants that don't add safety beyond the existing scope filter.
