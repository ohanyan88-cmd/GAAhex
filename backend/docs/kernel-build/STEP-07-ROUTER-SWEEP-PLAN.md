# Step 7 — Router Sweep Plan

**SPEC reference:** `GAAhex_Cross_Module_Architecture_SPEC.md` §0.1 single-owner, §0.2 default-deny,
§2.2 ownership matrix, §4 Permissions model (Role × Department × Region × Ownership).

**Pattern (already established in `routers/orders.py::advance_order`):**

```python
from ..kernel import assert_can, AccessDenied

try:
    await assert_can(
        s, user,
        action=<spec-verb>,
        entity_key=<entity_key>,
        region_id=getattr(record, "region_id", None),
        owner_user_id=<owner-uuid-or-None>,
    )
except AccessDenied as e:
    raise HTTPException(403, detail=str(e))
```

The `getattr(..., "region_id", None)` shape mirrors orders.py because the SQLAlchemy models do not
yet declare `region_id` columns (they live as raw SQL columns from migration `b70ef3b98e27`); the
kernel's region-layer is still a forward-compat no-op (see `assert_can_read_region`). The call site
adopts the gate today and Step 6+ deepens the engine without router edits.

---

## Mapping table — (action, entity_key, region_source, owner_source)

### High priority (operational core)

| Router       | Endpoint                                | Method | action          | entity_key            | region_source        | owner_user_id source        |
|--------------|-----------------------------------------|--------|-----------------|-----------------------|----------------------|-----------------------------|
| records.py   | `/api/{slug}` create                    | POST   | create          | ent.key (from slug)   | n/a (record.region)  | None (new record)           |
| records.py   | `/api/{slug}/{id}` update               | PATCH  | edit            | ent.key               | rec.region_id        | None                        |
| records.py   | `/api/{slug}/{id}` delete               | DELETE | delete          | ent.key               | rec.region_id        | None                        |
| records.py   | `/api/{slug}/{id}/transition`           | POST   | edit            | ent.key               | rec.region_id        | None                        |
| orders.py    | `/api/orders` create                    | POST   | create          | order                 | n/a                  | None                        |
| orders.py    | `/api/orders/{id}` update               | PATCH  | edit            | order                 | order.region_id      | order.control_pass_by       |
| orders.py    | `/api/orders/{id}/submit`               | POST   | edit            | order                 | order.region_id      | order.control_pass_by       |
| orders.py    | `/api/orders/{id}/cancel`               | POST   | edit            | order                 | order.region_id      | order.control_pass_by       |
| orders.py    | `/api/orders/{id}/advance`              | POST   | edit            | order                 | (already wired)      | (already wired)             |
| billing.py   | `/api/subscriptions` create             | POST   | create          | subscription          | n/a                  | None                        |
| billing.py   | `/api/subscriptions/{id}` update        | PATCH  | edit            | subscription          | sub.region_id        | None                        |
| billing.py   | `/api/subscriptions/{id}/cancel`        | POST   | edit            | subscription          | sub.region_id        | None                        |
| billing.py   | `/api/subscriptions/{id}/suspend`       | POST   | edit            | subscription          | sub.region_id        | None                        |
| billing.py   | `/api/subscriptions/{id}/resume`        | POST   | edit            | subscription          | sub.region_id        | None                        |
| billing.py   | `/api/subscriptions/{id}/generate-invoice` | POST | create        | invoice               | sub.region_id        | None                        |
| billing.py   | `/api/invoices` create                  | POST   | create          | invoice               | n/a                  | None                        |
| billing.py   | `/api/invoices/{id}/issue`              | POST   | edit            | invoice               | inv.region_id        | None                        |
| billing.py   | `/api/invoices/{id}/void`               | POST   | edit            | invoice               | inv.region_id        | None                        |
| billing.py   | `/api/invoices/{id}/payments` create    | POST   | create          | payment               | inv.region_id        | None                        |
| billing.py   | `/api/invoices/run-dunning`             | POST   | edit            | invoice               | None                 | None                        |
| billing.py   | `/api/products` create                  | POST   | manage          | product (config)      | n/a                  | None                        |
| billing.py   | `/api/products/{id}` update             | PATCH  | manage          | product               | n/a                  | None                        |
| billing.py   | `/api/products/{id}/retire`             | POST   | manage          | product               | n/a                  | None                        |
| helpdesk.py  | `/api/helpdesk/queues` create           | POST   | manage          | helpdesk_queue        | n/a                  | None                        |
| helpdesk.py  | `/api/helpdesk/queues/{id}` update      | PATCH  | manage          | helpdesk_queue        | q.region_id          | None                        |
| helpdesk.py  | `/api/helpdesk/queues/{id}` delete      | DELETE | manage          | helpdesk_queue        | q.region_id          | None                        |
| helpdesk.py  | `/api/helpdesk/tickets` create          | POST   | create          | helpdesk_ticket       | n/a                  | None                        |
| helpdesk.py  | `/api/helpdesk/tickets/{id}` update     | PATCH  | edit            | helpdesk_ticket       | t.region_id          | t.assigned_agent_id         |
| helpdesk.py  | `/api/helpdesk/tickets/{id}` delete     | DELETE | delete          | helpdesk_ticket       | t.region_id          | t.assigned_agent_id         |
| helpdesk.py  | `/api/helpdesk/tickets/{id}/assign`     | POST   | assign          | helpdesk_ticket       | t.region_id          | t.assigned_agent_id         |
| helpdesk.py  | `/api/helpdesk/tickets/{id}/resolve`    | POST   | edit            | helpdesk_ticket       | t.region_id          | t.assigned_agent_id         |
| helpdesk.py  | `/api/helpdesk/tickets/{id}/reopen`     | POST   | edit            | helpdesk_ticket       | t.region_id          | t.assigned_agent_id         |
| helpdesk.py  | `/api/helpdesk/tickets/{id}/close`      | POST   | edit            | helpdesk_ticket       | t.region_id          | t.assigned_agent_id         |
| workitems.py | `/api/workitems` create                 | POST   | create          | workitem              | n/a                  | payload.assigned_user_id    |
| workitems.py | `/api/workitems/{id}` update            | PATCH  | edit            | workitem              | w.region_id          | w.assigned_user_id          |
| workitems.py | `/api/workitems/{id}` delete            | DELETE | delete          | workitem              | w.region_id          | w.assigned_user_id          |
| workitems.py | `/api/workitems/{id}/assign`            | POST   | assign          | workitem              | w.region_id          | w.assigned_user_id          |
| workitems.py | `/api/workitems/{id}/start,complete,..` | POST   | edit            | workitem              | w.region_id          | w.assigned_user_id          |
| services.py  | `/api/services` create                  | POST   | create          | service               | n/a                  | None                        |
| services.py  | `/api/services/{id}` update             | PATCH  | edit            | service               | svc.region_id        | None                        |
| services.py  | `/api/services/{id}/activate,suspend,..`| POST   | edit            | service               | svc.region_id        | None                        |
| services.py  | `/api/services/{id}/resources` create   | POST   | edit            | service               | svc.region_id        | None                        |
| services.py  | `/api/services/{id}/resources/{rid}` rel| DELETE | edit            | service               | svc.region_id        | None                        |
| customer360.py| `/api/customers/{id}/portal-users`     | POST   | edit            | customer              | rec.region_id        | None                        |

### Medium priority (config-manage + comm)

| Router               | Action  | Entity                  | Notes                                                       |
|----------------------|---------|-------------------------|-------------------------------------------------------------|
| meta.py              | manage  | entity_def              | already gated by `_require_config_manage`; add assert_can   |
| roles.py             | manage  | role_def                | already config_manage-gated                                 |
| assignments.py (-)   | n/a     | n/a                     | NO SUCH FILE — assignment CRUD in users.py / roles.py       |
| users.py             | manage  | user                    | already config_manage-gated                                 |
| automations.py       | manage  | automation              | config-manage gated                                         |
| webhooks.py          | manage  | webhook                 | config-manage gated                                         |
| notifications.py     | manage  | notification_def        | config-manage gated                                         |
| comm.py              | create  | comm_message            | communication paths                                         |
| interactions.py      | create  | interaction             | interaction CRUD                                            |
| outbound.py          | create  | outbound                | outbound channel/send                                       |
| payment_gateway.py   | create  | payment                 | payment initiation                                          |
| accounts.py          | create/edit | billing_account     | record CRUD                                                 |
| respool.py           | manage  | respool                 | resource pool                                               |
| usage.py             | create  | usage                   | usage records                                               |
| calendar.py          | create/edit/delete | calendar_event| calendar CRUD                                               |
| saved_view.py        | (none — read+CRUD per user)        |  defer if budget short                  |

### Low priority

`analytics`, `reports`, `dashboards`, `report_builder`, `report_schedules`, `metrics`, `search`,
`me`, `capabilities`, `audit_log` (read-only), `auth`, `portal_auth`, `portal*`, `apikeys`.
Will sweep only the sensitive writes (e.g. apikey issuance).

---

## Operating doctrine

- **Commit per router** to survive context limits.
- Tests: per-router 403 test added under `backend/tests/test_<router>.py` for the high-priority set
  (no edits to `test_orders.py` — Batch 1 owns that file).
- assert_can goes BEFORE any DB mutation. The existing `can(grants, ...)` role checks are kept —
  the kernel call adds Role × Dept × Region × Ownership AND-evaluation on top.
- `getattr(record, "region_id", None)` — the region column is added by migration but not on the SA
  model; the kernel region layer is a no-op until Step 6+ ships the real evaluator.
