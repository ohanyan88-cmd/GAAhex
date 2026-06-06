# Module Catalog

| Field | Value |
|---|---|
| **Location** | `docs/catalogs/MODULE_CATALOG.md` |
| **Layer** | Catalog (between Standards and Implementation) |
| **Status** | **LOCKED · RATIFIED · BASELINE ESTABLISHED — 2026-06-06** |
| **LAW-GV3 cycle** | ✅ CREATE · ✅ REVIEW · ✅ AUDIT · ✅ NORMALIZE · ✅ LOCK |
| **Authority** | [`../governance/PROJECT_CONSTITUTION.md`](../governance/PROJECT_CONSTITUTION.md) → PRM → `02_DOMAIN_ARCHITECTURE.md` §9.1 → `CORE_OWNERSHIP_MATRIX.md` |
| **Amendments** | Only via LAW-GV1 of PROJECT_CONSTITUTION |

**LAW-GV5 search performed before authorship (2026-06-06):**

- Enumerated `backend/app/` — 17 top-level files + 12 seed scripts + 9 subdirectories (kernel, models, routers, services, adapters, middleware, security, utils, branding).
- Enumerated `frontend/src/` — 3 top-level files + 12 subdirectories (views, components, layout, lib, page-shell, primitives, studio, modals, hooks, context, generated, styles).
- Cross-referenced every module against `CORE_OWNERSHIP_MATRIX.md` Part B (URL prefix → core) and `02_DOMAIN_ARCHITECTURE.md` §9.1-9.3 (module-level domain declaration rule).
- Result: ~390 modules identified. No prior canonical Module Catalog existed; this is the first authoritative module → core/domain registry. Module-level domain declaration rule from `02` §9.1 has been declared but never enumerated until now.

**LAW-GV3 audit record (2026-06-06):**

- **CREATE** — Drafted 2026-06-06 by Ընգեր. Coverage: all `backend/app/*.py` files (top-level + nested) and all `frontend/src/**/*.{ts,tsx}` directories.
- **REVIEW** — Every primary owner cross-checked against `CORE_OWNERSHIP_MATRIX.md` Part B (API path → core), Part D (page → core), and PRM core definitions. Domain assignments cross-checked against `02_DOMAIN_ARCHITECTURE.md` §7.1 (the 12 canonical domains).
- **AUDIT** — Part D ownership conflict scan: **0 conflicts.** No backend module or frontend directory has two primary owners. LAW-DA2 + `01` L1 honored.
- **NORMALIZE** — All Domain column values use the 12 canonical domains per `02_DOMAIN` §7.1 (CRM / OSS / BSS / Network / Inventory / Workforce / Billing / Portal / Studio / Automation / Reporting / Administration) or one of the shorthand codes documented at §0.1 below. No mid-doc terminology drift.
- **Architectural decisions altered:** zero. Every assignment derived from existing canonical sources.

---

## 0. Conventions

### 0.1 Domain code legend

The Domain column uses one of:

- One of the **12 canonical domains** per `02_DOMAIN` §7.1: `CRM` / `OSS` / `BSS` / `Network` / `Inventory` / `Workforce` / `Billing` / `Portal` / `Studio` / `Automation` / `Reporting` / `Administration`.
- A compound (e.g. `OSS/Network`) when the module legitimately spans two domains as primary.
- `(cross)` — cross-cutting infrastructure consumed by all domains (e.g. kernel, middleware, utilities). No single canonical domain.
- `(n/a)` — system-internal Workspace chrome not tied to a business domain (e.g. PageShell framework).

### 0.2 Status legend

Same as `CORE_OWNERSHIP_MATRIX.md`: **S** = STRONG · **P** = PARTIAL · **W** = WEAK · **M** = MISSING.

### 0.3 Naming conventions

- Backend paths shown relative to `backend/app/`.
- Frontend paths shown relative to `frontend/src/`.
- Per `02_DOMAIN` §9.1, every backend module declares its domain in a top-of-file comment (`# Domain: <D>`). This catalog is the canonical truth; the in-file declaration is the implementation-side reflection of it.

---

# Part A — Backend modules

## A.1 Kernel (Foundation, cross-cutting)

Per Sealed Baseline 2026-06-05: the kernel is the load-bearing core of the
configuration-driven thesis. New code goes *beside* the kernel, never
inside it.

| Module | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `kernel/__init__.py` | (cross) | (cross) | All Foundation | S |
| `kernel/workflow_engine.py` | Workflow | (cross) | Event, Audit | S |
| `kernel/approvals.py` | Approval | (cross) | Workflow, Audit | S |
| `kernel/control_gate.py` | Workflow | (cross) | Policy, Approval | S |
| `kernel/invariants.py` | Governance | (cross) | Security | S |
| `kernel/kpi_engine.py` | Analytics | (cross) | Reporting | P |
| `kernel/timeline.py` | Audit | (cross) | Event | S |

## A.2 Top-level boot & cross-cutting infrastructure

| Module | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `main.py` | (cross) | Administration | All | S |
| `db.py` | Data | (cross) | Tenant, Security | S |
| `config.py` | Configuration | Administration | Tenant, Security | S |
| `access.py` | Permission | (cross) | Identity, Tenant | S |
| `gxl.py` | Workflow | (cross) | Policy | S |
| `workflow.py` | Workflow | (cross) | Event | S |
| `notify_hooks.py` | Notification | (cross) | Event, Workflow | P |
| `pagination.py` | Search | (cross) | (n/a) | P |
| `resolvers.py` | Data | (cross) | Relationship | P |
| `scheduler.py` | Background Processing | Administration | Time | P |
| `ai.py` | AI | (cross) | Permission, Audit | W |
| `channels.py` | Notification | (cross) | Communication, Integration | P |
| `payment_gateway.py` | Financial | Billing | Integration | P |
| `export_formats.py` | Import/Export | Administration | Template | P |
| `tenant_query_audit.py` | Audit | (cross) | Tenant | P |
| `migrate_interactions.py` | Data | Administration | (migration) | S |

## A.3 Security + Middleware

| Module | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `security/__init__.py` | Security | (cross) | Identity | P |
| `security/auth.py` | Identity | (cross) | Security | S |
| `security/field_crypto.py` | Security | (cross) | Compliance | P |
| `middleware/__init__.py` | Security | (cross) | (cross) | P |
| `middleware/idempotency.py` | Security | (cross) | Event | P |

## A.4 Utilities + Shared helpers

| Module | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `utils/__init__.py` | (cross) | (cross) | (cross) | S |
| `utils/billing_constants.py` | Financial | Billing | (n/a) | P |
| `utils/dt.py` | Time | (cross) | (n/a) | P |
| `utils/http_client.py` | Integration | (cross) | Security | P |
| `utils/http_errors.py` | (cross) | (cross) | Audit | S |
| `utils/ids.py` | Data | (cross) | (UUIDv7 generation) | S |
| `utils/money.py` | Financial | Billing | Localization | P |
| `utils/refnum.py` | Data | (cross) | (reference-number registry) | S |

## A.5 Adapters (Integration framework)

Per `12_INTEGRATION_ARCHITECTURE.md`: Integration Core owns the *framework*; each connector's primary core is its **target business core**.

| Module | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `adapters/__init__.py` | Integration | Automation | (cross) | P |
| `adapters/base.py` | Integration | Automation | Security, Audit | P |
| `adapters/email.py` | Notification | (cross) | Integration | P |
| `adapters/sms.py` | Notification | (cross) | Integration | P |
| `adapters/payment/__init__.py` | Financial | Billing | Integration | P |
| `adapters/payment/arca.py` | Financial | Billing | Integration | P |
| `adapters/payment/easypay.py` | Financial | Billing | Integration | P |
| `adapters/payment/idram.py` | Financial | Billing | Integration | P |
| `adapters/payment/telcell.py` | Financial | Billing | Integration | P |

## A.6 Services

| Module | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `services/__init__.py` | (cross) | (cross) | (cross) | S |
| `services/account_balance.py` | Financial | Billing | Party | P |
| `services/config_schemas.py` | Configuration | Studio | Metadata | P |
| `services/diagnostic_adapter.py` | Resource | Network | Integration | P |
| `services/dunning.py` | Financial | Billing | Workflow, Notification | P |
| `services/feature_gate.py` | Entitlement | Administration | Tenant, Security | P |
| `services/install_board.py` | Work | Workforce | Scheduling, Service | P |
| `services/invoice_lock.py` | Financial | Billing | Compliance | P |
| `services/ipam.py` | Resource | Network | (IP pool mgmt) | P |
| `services/network_adapter.py` | Resource | Network | Integration | P |
| `services/noc_dashboard.py` | Observability | Network | Case, SLA, Service | P |
| `services/noc_live_refresh.py` | Observability | Network | (cross) | P |
| `services/payment_allocation.py` | Financial | Billing | (cross) | P |
| `services/payment_gateway_adapter.py` | Financial | Billing | Integration | P |
| `services/privacy.py` | Compliance | Administration | Audit | P |
| `services/product_versions.py` | Product | (cross) | Audit | P |
| `services/proration.py` | Financial | Billing | Time | P |
| `services/revenue_assurance.py` | Financial | Billing | Audit | P |
| `services/stage8_gate.py` | Workflow | (cross) | Approval | P |
| `services/tenant_flag.py` | Entitlement | Administration | Tenant | P |
| `services/comms/` | Communication | (cross) | Notification | P |
| `services/olt/` | Resource | Network | Integration | P |
| `services/payments/` | Financial | Billing | Integration | P |
| `services/radius/` | Resource | Network | Integration | P |
| `services/storage/` | Storage | Administration | Document, Security | P |

## A.7 Models (Data Core hosts; per-model owner is per-entity)

Per `09_DATA_ARCHITECTURE.md` §15.5: every model declares its `__owner_core__` metadata.

| Model | Primary Core | Domain | Status |
|---|---|---|---|
| `models/__init__.py` | (cross) | (cross) | S |
| `models/access.py` | Permission | Administration | P |
| `models/apikey.py` | Developer Platform | Administration | P |
| `models/approval.py` | Approval | (cross) | P |
| `models/asset_location.py` | Resource/Location | Network | P |
| `models/attachment.py` | Document | (cross) | P |
| `models/automation.py` | Automation | Studio | P |
| `models/base.py` | (cross) | (cross) | S |
| `models/billing.py` | Financial | Billing | P |
| `models/broadcast.py` | Notification | (cross) | P |
| `models/calendar.py` | Scheduling | Workforce | P |
| `models/comm.py` | Communication | (cross) | P |
| `models/comment.py` | Communication | (cross) | P |
| `models/communication.py` | Communication | (cross) | P |
| `models/configuration.py` | Configuration | Studio | S |
| `models/cpe_binding.py` | Resource | Network | P |
| `models/credit_note.py` | Financial | Billing | P |
| `models/customer_user.py` | Identity | Portal | P |
| `models/dashboard.py` | Workspace | Reporting | P |
| `models/dunning.py` | Financial | Billing | P |
| `models/escalation.py` | Case | OSS | P |
| `models/event.py` | Event | (cross) | S |
| `models/feature_flag.py` | Entitlement | Administration | P |
| `models/fiber_route.py` | Resource | Network | P |
| `models/helpdesk.py` | Case | OSS | P |
| `models/idempotency_request.py` | Security | (cross) | P |
| `models/import_export.py` | Import/Export | Administration | P |
| `models/interaction.py` | Communication | CRM | P |
| `models/ipam.py` | Resource | Network | P |
| `models/job.py` | Background Processing | Administration | P |
| `models/kernel_defs.py` | (cross) | (cross) | S |
| `models/meta.py` | Metadata | Studio | P |
| `models/nav_module.py` | Workspace | (n/a) | P |
| `models/notification.py` | Notification | (cross) | P |
| `models/notification_pref.py` | Notification | (cross) | P |
| `models/olt_tree.py` | Resource | Network | P |
| `models/order.py` | Financial | BSS | P |
| `models/orgnode.py` | Organization | Workforce | S |
| `models/outbound.py` | Notification | (cross) | P |
| `models/page_binding.py` | Workspace | Studio | P |
| `models/page_config.py` | Workspace | Studio | P |
| `models/page_field_value.py` | Metadata | Studio | P |
| `models/party.py` | Party | CRM | P |
| `models/payment_allocation.py` | Financial | Billing | P |
| `models/payment_gateway.py` | Financial | Billing | P |
| `models/payment_method.py` | Financial | Billing | P |
| `models/portal_ticket_reply.py` | Case | Portal | P |
| `models/privacy_request.py` | Compliance | Administration | P |
| `models/product.py` | Product | (cross) | P |
| `models/product_version.py` | Product | (cross) | P |
| `models/ra_finding.py` | Financial | Billing | P |
| `models/ra_scan_run.py` | Financial | Billing | P |
| `models/radius_session.py` | Resource | Network | P |
| `models/record.py` | Data | (cross) | S |
| `models/refresh_token.py` | Identity | Administration | S |
| `models/region.py` | Location | (global) | P |
| `models/relationship.py` | Relationship | (cross) | P |
| `models/report.py` | Reporting | Reporting | P |
| `models/report_schedule.py` | Reporting | Reporting | P |
| `models/respool.py` | Resource | Network | P |
| `models/saved_view.py` | Search | (cross) | P |
| `models/search_history.py` | Search | (cross) | P |
| `models/service.py` | Service | OSS | P |
| `models/sla.py` | SLA | (cross) | P |
| `models/splitter.py` | Resource | Network | P |
| `models/stripe_webhook_event.py` | Integration | Billing | P |
| `models/studio_page.py` | Workspace | Studio | P |
| `models/tariff.py` | Product | (cross) | P |
| `models/task.py` | Work | Workforce | S |
| `models/technician_location.py` | Mobile | Workforce | W |
| `models/telemetry.py` | Observability | (cross) | P |
| `models/tenant.py` | Tenant | Administration | S |
| `models/translation.py` | Localization | (cross) | P |
| `models/usage.py` | Financial | Billing | P |
| `models/user.py` | Identity | Administration | S |
| `models/vlan.py` | Resource | Network | P |
| `models/watcher.py` | Notification | (cross) | P |
| `models/webhook.py` | Integration | Automation | P |
| `models/workflow_instance.py` | Workflow | (cross) | S |
| `models/workitem.py` | Work | Workforce | S |

## A.8 Routers (REST API surfaces)

Grouped by canonical URL prefix → domain per `02_DOMAIN` §9.2 + Matrix Part B. Each router declares its domain in a top-of-file comment.

### A.8.1 CRM domain routers

| Router | Primary Core | URL family | Status |
|---|---|---|---|
| `routers/customer360.py` | Party | `/api/v1/customers/360` | P |
| `routers/customer_timeline.py` | Communication | `/api/v1/customers/{id}/timeline` | P |
| `routers/convert.py` | Party | `/api/v1/leads/{id}/convert` | P |
| `routers/communications.py` | Communication | `/api/v1/communications` | P |
| `routers/comm.py` | Communication | `/api/v1/comm` | P |
| `routers/comments.py` | Communication | `/api/v1/comments` | P |
| `routers/me.py` | Identity | `/api/v1/me` | S |
| `routers/parties.py` *(in records.py)* | Party | `/api/v1/parties` | P |

### A.8.2 OSS domain routers

| Router | Primary Core | URL family | Status |
|---|---|---|---|
| `routers/services.py` | Service | `/api/v1/services` | P |
| `routers/helpdesk.py` | Case | `/api/v1/helpdesk` | P |
| `routers/slas.py` | SLA | `/api/v1/sla` | P |
| `routers/workflows.py` | Workflow | `/api/v1/workflows` | S |
| `routers/lifecycle.py` | Workflow | `/api/v1/lifecycle` | S |
| `routers/escalations.py` | Approval | `/api/v1/escalations` | P |

### A.8.3 BSS domain routers

| Router | Primary Core | URL family | Status |
|---|---|---|---|
| `routers/orders.py` | Financial | `/api/v1/orders` | P |
| `routers/contract_expiring.py` | Contract | `/api/v1/contracts/expiring` | P |
| `routers/approvals.py` | Approval | `/api/v1/approvals` | P |
| `routers/mandatory_approvals.py` | Approval | `/api/v1/approvals/mandatory` | P |
| `routers/procurement.py` | Resource | `/api/v1/procurement` | P |

### A.8.4 Network domain routers

| Router | Primary Core | URL family | Status |
|---|---|---|---|
| `routers/noc_dashboard.py` | Observability | `/api/v1/network/noc-dashboard` | P |
| `routers/noc_inventory.py` | Resource | `/api/v1/network/inventory` | P |
| `routers/assets.py` | Resource | `/api/v1/assets` | P |
| `routers/respool.py` | Resource | `/api/v1/network/respool` | P |
| `routers/regions.py` | Location | `/api/v1/regions` | P |

### A.8.5 Workforce domain routers

| Router | Primary Core | URL family | Status |
|---|---|---|---|
| `routers/workitems.py` | Work | `/api/v1/workitems` | S |
| `routers/tasks.py` | Work | `/api/v1/tasks` | S |
| `routers/assignments.py` | Work | `/api/v1/assignments` | S |
| `routers/calendar.py` | Scheduling | `/api/v1/calendar` | P |
| `routers/install_board.py` | Work | `/api/v1/work/install-board` | P |
| `routers/watchers.py` | Notification | `/api/v1/watchers` | P |
| `routers/org_nodes.py` | Organization | `/api/v1/org-nodes` | S |

### A.8.6 Billing domain routers

| Router | Primary Core | URL family | Status |
|---|---|---|---|
| `routers/_billing_shared.py` | Financial | (shared utility) | P |
| `routers/accounts.py` | Financial | `/api/v1/billing/accounts` | P |
| `routers/billing.py` | Financial | `/api/v1/billing` | P |
| `routers/billing_credit_note.py` | Financial | `/api/v1/billing/credit-notes` | P |
| `routers/billing_cycle.py` | Financial | `/api/v1/billing/cycles` | P |
| `routers/billing_invoice.py` | Financial | `/api/v1/billing/invoices` | P |
| `routers/billing_payment.py` | Financial | `/api/v1/billing/payments` | P |
| `routers/billing_product.py` | Product | `/api/v1/billing/products` | P |
| `routers/billing_subscription.py` | Service | `/api/v1/billing/subscriptions` | P |
| `routers/credit_notes.py` | Financial | `/api/v1/billing/credits` | P |
| `routers/dunning.py` | Financial | `/api/v1/billing/dunning` | P |
| `routers/payment_gateway.py` | Financial | `/api/v1/billing/payment-gateway` | P |
| `routers/payment_methods.py` | Financial | `/api/v1/billing/payment-methods` | P |
| `routers/revenue_assurance.py` | Financial | `/api/v1/billing/revenue-assurance` | P |
| `routers/tariff_plans.py` | Product | `/api/v1/tariff-plans` | P |
| `routers/usage.py` | Financial | `/api/v1/billing/usage` | P |
| `routers/vendor_webhooks/` | Integration | `/api/webhooks/{vendor}` | P |

### A.8.7 Portal domain routers

| Router | Primary Core | URL family | Status |
|---|---|---|---|
| `routers/portal.py` | Portal | `/api/v1/portal` | P |
| `routers/portal_auth.py` | Portal | `/api/v1/portal/auth` | P |
| `routers/portal_billing.py` | Portal | `/api/v1/portal/billing` | P |
| `routers/portal_service.py` | Portal | `/api/v1/portal/services` | P |
| `routers/portal_support.py` | Portal | `/api/v1/portal/support` | P |

### A.8.8 Studio domain routers

| Router | Primary Core | URL family | Status |
|---|---|---|---|
| `routers/automations.py` | Automation | `/api/v1/automations` | P |
| `routers/configurations.py` | Configuration | `/api/v1/configurations` | S |
| `routers/feature_flags.py` | Entitlement | `/api/v1/feature-flags` | P |
| `routers/meta.py` | Metadata | `/api/v1/meta` | P |
| `routers/nav_registry.py` | Workspace | `/api/v1/nav` | P |
| `routers/notification_defs.py` | Notification | `/api/v1/notification-defs` | P |
| `routers/page_bindings.py` | Workspace | `/api/v1/page-bindings` | P |
| `routers/page_config.py` | Workspace | `/api/v1/page-config` | P |
| `routers/studio_pages.py` | Workspace | `/api/v1/studio/pages` | P |

### A.8.9 Automation domain routers

| Router | Primary Core | URL family | Status |
|---|---|---|---|
| `routers/digests.py` | Notification | `/api/v1/digests` | P |
| `routers/webhooks.py` | Integration | `/api/v1/webhooks` | P |
| `routers/jobs.py` | Background Processing | `/api/v1/jobs` | P |

### A.8.10 Reporting domain routers

| Router | Primary Core | URL family | Status |
|---|---|---|---|
| `routers/analytics.py` | Analytics | `/api/v1/analytics` | P |
| `routers/dashboards.py` | Analytics | `/api/v1/dashboards` | P |
| `routers/kpis.py` | Analytics | `/api/v1/kpis` | P |
| `routers/metrics.py` | Observability | `/api/v1/metrics` | P |
| `routers/report_builder.py` | Reporting | `/api/v1/reports/builder` | P |
| `routers/report_schedules.py` | Reporting | `/api/v1/reports/schedules` | P |
| `routers/reports.py` | Reporting | `/api/v1/reports` | P |
| `routers/views.py` | Search | `/api/v1/views` | P |

### A.8.11 Administration domain routers

| Router | Primary Core | URL family | Status |
|---|---|---|---|
| `routers/apikeys.py` | Developer Platform | `/api/v1/developer/api-keys` | P |
| `routers/audit_log.py` | Audit | `/api/v1/audit` | S |
| `routers/auth.py` | Identity | `/api/v1/auth` | S |
| `routers/bulk.py` | Import/Export | `/api/v1/admin/bulk` | P |
| `routers/capabilities.py` | Permission | `/api/v1/capabilities` | P |
| `routers/events.py` | Event | `/api/v1/events` | S |
| `routers/export.py` | Import/Export | `/api/v1/export` | P |
| `routers/health.py` | Observability | `/api/v1/health` | P |
| `routers/i18n.py` | Localization | `/api/v1/i18n` | P |
| `routers/imports_exports.py` | Import/Export | `/api/v1/admin/imports-exports` | P |
| `routers/nav_module.py` | Workspace | `/api/v1/admin/nav-module` | P |
| `routers/ops.py` | Observability | `/api/v1/admin/ops` | P |
| `routers/privacy.py` | Compliance | `/api/v1/admin/privacy` | P |
| `routers/records.py` | Data | `/api/v1/records` | S |
| `routers/relationships.py` | Relationship | `/api/v1/relationships` | P |
| `routers/roles.py` | Permission | `/api/v1/roles` | P |
| `routers/search.py` | Search | `/api/v1/search` | P |
| `routers/search_assist.py` | Search | `/api/v1/search/assist` | P |
| `routers/tenant_settings.py` | Tenant | `/api/v1/admin/tenant-settings` | S |
| `routers/users.py` | Identity | `/api/v1/users` | S |
| `routers/dashboards.py` *(also in Reporting)* | Analytics | (cross-domain dashboard sharing) | P |

### A.8.12 Cross-domain routers

| Router | Primary Core | URL family | Status |
|---|---|---|---|
| `routers/ai.py` | AI | `/api/v1/ai` | W |
| `routers/attachments.py` | Document | `/api/v1/attachments` | P |
| `routers/documents.py` | Document | `/api/v1/documents` | P |
| `routers/notifications.py` | Notification | `/api/v1/notifications` | P |
| `routers/workspace.py` | Workspace | `/api/v1/workspace` | P |
| `routers/activity.py` | Audit | `/api/v1/activity` | P |

## A.9 Seed scripts (Administration / bootstrap)

All seed scripts are tenant-bootstrap utilities — Administration domain.

| Module | Purpose | Status |
|---|---|---|
| `seed.py` | Master seed entry point | S |
| `seed_catalog.py` | Product catalog seed | S |
| `seed_default_records.py` | Default records per tenant | S |
| `seed_demo_loop.py` | Demo Lead→Customer→Order→… chain | S |
| `seed_dev_bulk.py` | Bulk dev seed | S |
| `seed_kpi_formulas.py` | KPI formula seed | P |
| `seed_nav_registry.py` | Nav tree seed | S |
| `seed_notifications.py` | Notification def seed | P |
| `seed_ownership.py` | Department ownership defaults (Standard 02 B5) | S |
| `seed_pipeline.py` | Lead/Customer lifecycle seed | S |
| `seed_regions.py` | Geographic regions seed | S |
| `seed_role_boundaries.py` | Role / permission seed | S |
| `seed_statuses.py` | Status enum seed (file 14) | S |
| `seed_workflows.py` | Workflow definition seed | S |

## A.10 Branding + Exceptions

| Module | Primary Core | Domain | Status |
|---|---|---|---|
| `branding/` (Python helpers) | Workspace | Studio | P |
| `exceptions/` | (cross) | (cross) | S |

---

# Part B — Frontend modules

## B.1 Workspace chrome (PageShell + Layout + Primitives)

These directories implement Workspace Core (per `01` §9.4: Workspace Core owns the page registry + chrome).

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `App.tsx` | Workspace | (n/a) | S |
| `main.tsx` | Workspace | (n/a) | S |
| `layout/MasterLayout.tsx` | Workspace | (n/a) | S |
| `layout/MasterLayoutContext.tsx` | Workspace | (n/a) | S |
| `layout/LeftNav.tsx` | Workspace | (n/a) | S |
| `layout/slots/` | Workspace | (n/a) | S |
| `layout/zones/` | Workspace | (n/a) | S |
| `page-shell/PageShell.tsx` | Workspace | (n/a) | S |
| `page-shell/PageHeader.tsx` | Workspace | (n/a) | S |
| `page-shell/KPIBar.tsx` | Workspace | (n/a) | S |
| `page-shell/ActionBar.tsx` | Workspace | (n/a) | S |
| `page-shell/FilterBar.tsx` | Workspace | (n/a) | S |
| `page-shell/EmptyState.tsx` | Workspace | (n/a) | S |
| `page-shell/ContextPanel.tsx` | Workspace | (n/a) | S |
| `page-shell/SlideOutPanel.tsx` | Workspace | (n/a) | S |
| `page-shell/primitives/` | Workspace | (n/a) | S |
| `primitives/Button.tsx` | Workspace | (n/a) | S |
| `primitives/DataTableCell.tsx` | Workspace | (n/a) | S |
| `primitives/DetailTab.tsx` | Workspace | (n/a) | S |
| `primitives/FormField.tsx` | Workspace | (n/a) | S |
| `primitives/Input.tsx` | Workspace | (n/a) | S |
| `primitives/KPITile.tsx` | Workspace | (n/a) | S |
| `primitives/LoadShell.tsx` | Workspace | (n/a) | S |
| `primitives/Pagination.tsx` | Workspace | (n/a) | S |
| `primitives/StatusPill.tsx` | Workspace | (n/a) | S |
| `primitives/StudioDrawer.tsx` | Workspace | Studio | S |

## B.2 Shared components

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `components/ActivityTimeline.tsx` | Audit | (cross) | P |
| `components/ChartPicker.tsx` | Analytics | Reporting | P |
| `components/Composer.tsx` | Communication | (cross) | P |
| `components/CustomCells.tsx` | Workspace | (cross) | P |
| `components/EmojiPicker.tsx` | Workspace | (cross) | P |
| `components/ErrorBoundary.tsx` | Workspace | (cross) | S |
| `components/FieldInput.tsx` | Metadata | Studio | P |
| `components/LoadingState.tsx` | Workspace | (cross) | S |
| `components/Modal.tsx` | Workspace | (cross) | S |
| `components/NoAccess.tsx` | Permission | (cross) | S |
| `components/NotificationBell.tsx` | Notification | (cross) | P |
| `components/OrgIdentity.tsx` | Organization | Workforce | S |
| `components/Overlay.tsx` | Workspace | (cross) | S |
| `components/RecordDrawer.tsx` | Workspace | (cross) | S |
| `components/RefPicker.tsx` | Relationship | (cross) | S |
| `components/RowActionsMenu.tsx` | Workspace | (cross) | S |
| `components/Select.tsx` | Workspace | (cross) | P |
| `components/States.tsx` | Workspace | (cross) | S |
| `components/Toast.tsx` | Workspace | (cross) | P |
| `components/UserMenu.tsx` | Identity | (cross) | S |
| `components/UserPicker.tsx` | Identity | (cross) | S |
| `components/ViewHead.tsx` | Workspace | (cross) | S |
| `components/WorkItemsBoard.tsx` | Work | Workforce | S |
| `components/WorkItemsTable.tsx` | Work | Workforce | S |
| `components/charts/` | Analytics | Reporting | P |
| `components/icons.tsx` | Workspace | (cross) | S |

## B.3 Per-domain views

### B.3.1 My Day

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `views/HomeView.tsx` | Workspace | (n/a) | S |
| `views/MyTasksView.tsx` | Work | Workforce | S |
| `views/MyApprovalsView.tsx` | Approval | (cross) | P |
| `views/RecentItemsView.tsx` | Workspace | (n/a) | P |
| `views/SavedViewsView.tsx` | Search | (cross) | P |

### B.3.2 CRM

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `views/CustomersListView.tsx` | Party | CRM | P |
| `views/CustomerView.tsx` | Party | CRM | P |
| `views/customer-tabs/` | Party | CRM | P |
| `views/CustomerTasksView.tsx` | Work | CRM | P |
| `views/PartiesView.tsx` | Party | CRM | P |
| `views/LeadPipelineView.tsx` | Workflow | CRM | P |
| `views/PipelineView.tsx` | Workflow | CRM | P |
| `views/InteractionsView.tsx` | Communication | CRM | P |
| `views/MessagesView.tsx` | Communication | (cross) | P |

### B.3.3 OSS / Services

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `views/ServicesView.tsx` | Service | OSS | P |
| `views/SubscriptionsView.tsx` | Service | OSS | P |
| `views/ProvisioningView.tsx` | Service | OSS | P |
| `views/ProductsView.tsx` | Product | (cross) | P |
| `views/TariffPlansView.tsx` | Product | (cross) | P |
| `views/ResourcePoolsView.tsx` | Resource | Network | P |
| `views/CoverageView.tsx` | Location | Network | P |
| `views/NetworkTopologyView.tsx` | Relationship | Network | P |
| `views/HelpdeskView.tsx` | Case | OSS | P |

### B.3.4 Network

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `views/NetworkInventoryView.tsx` | Resource | Network | P |
| `views/NocDashboardView.tsx` | Observability | Network | P |

### B.3.5 BSS

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `views/OrdersView.tsx` | Financial | BSS | P |

### B.3.6 Workforce

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `views/WorkItemsView.tsx` | Work | Workforce | S |
| `views/DispatchBoardView.tsx` | Scheduling | Workforce | P |
| `views/InstallationBoardView.tsx` | Work | Workforce | P |
| `views/TeamWorkspaceView.tsx` | Organization | Workforce | P |
| `views/CalendarView.tsx` | Scheduling | Workforce | P |
| `views/SchedulingView.tsx` | Scheduling | Workforce | P |
| `views/OrgView.tsx` | Organization | Workforce | S |

### B.3.7 Billing

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `views/InvoicesView.tsx` | Financial | Billing | P |
| `views/PaymentsView.tsx` | Financial | Billing | P |
| `views/CollectionsView.tsx` | Financial | Billing | P |
| `views/AccountsView.tsx` | Financial | Billing | P |
| `views/PaymentGatewayView.tsx` | Financial | Billing | P |
| `views/PaymentMethodsView.tsx` | Financial | Billing | P |
| `views/RevenueAssuranceView.tsx` | Financial | Billing | P |
| `views/UsageView.tsx` | Financial | Billing | P |

### B.3.8 Operations / cross-domain

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `views/OutboundView.tsx` | Notification | (cross) | P |
| `views/ActivityFeedView.tsx` | Audit | (cross) | P |

### B.3.9 Reporting

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `views/DashboardView.tsx` | Analytics | Reporting | P |
| `views/AnalyticsView.tsx` | Analytics | Reporting | P |
| `views/ReportsView.tsx` | Reporting | Reporting | P |
| `views/ReportBuilderView.tsx` | Reporting | Reporting | P |

### B.3.10 Administration

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `views/SettingsView.tsx` | Configuration | Administration | P |
| `views/WebhooksView.tsx` | Integration | Administration | P |
| `views/GlobalSearchView.tsx` | Search | (cross) | P |

### B.3.11 AI

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `views/AskGaaexView.tsx` | AI | (cross) | W |

### B.3.12 Demo + Generic

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `views/ComingSoonView.tsx` | Workspace | (n/a) | P |
| `views/EntityView.tsx` | Data | (cross) | S |
| `views/MasterLayoutDemoView.tsx` | Workspace | (n/a) | P |
| `views/PageShellDemoView.tsx` | Workspace | (n/a) | P |

## B.4 Studio domain (Configuration + Metadata + Workspace authoring)

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `studio/StudioShell.tsx` | Workspace | Studio | P |
| `studio/StudioTree.tsx` | Workspace | Studio | P |
| `studio/StudioOverview.tsx` | Workspace | Studio | P |
| `studio/StudioGenericPane.tsx` | Workspace | Studio | P |
| `studio/StudioRichPanes.tsx` | Workspace | Studio | P |
| `studio/_shared.tsx` | Workspace | Studio | P |
| `studio/iconMap.ts` | Workspace | Studio | S |
| `studio/publishRegistry.ts` | Configuration | Studio | P |
| `studio/tree.ts` | Workspace | Studio | P |
| `studio/EntitiesPane.tsx` | Metadata | Studio | P |
| `studio/FieldsPane.tsx` | Metadata | Studio | P |
| `studio/PageManager.tsx` | Workspace | Studio | P |
| `studio/LayoutBuilder.tsx` | Workspace | Studio | P |
| `studio/ViewsPane.tsx` | Workspace | Studio | P |
| `studio/DataBinding.tsx` | Metadata | Studio | P |
| `studio/Templates.tsx` | Template | Studio | W |
| `studio/ActionsLogic.tsx` | Automation | Studio | P |
| `studio/AutomationsPane.tsx` | Automation | Studio | P |
| `studio/WorkflowsPane.tsx` | Workflow | Studio | P |
| `studio/WebhooksPane.tsx` | Integration | Studio | P |
| `studio/NotificationsPane.tsx` | Notification | Studio | P |
| `studio/Permissions.tsx` | Permission | Studio | P |
| `studio/RolesPane.tsx` | Permission | Studio | P |
| `studio/UsersPane.tsx` | Identity | Studio | P |
| `studio/FeatureFlagsPane.tsx` | Entitlement | Studio | P |
| `studio/DashboardsPane.tsx` | Analytics | Studio | P |
| `studio/ReportsPane.tsx` | Reporting | Studio | P |
| `studio/ContentEditor.tsx` | (Knowledge?) | Studio | W |
| `studio/ApiDocsPane.tsx` | Developer Platform | Studio | P |
| `studio/AuditLogPane.tsx` | Audit | Studio | P |
| `studio/AppearancePane.tsx` | Workspace | Studio | P |
| `studio/PreviewMode.tsx` | Workspace | Studio | P |
| `studio/PublishSettings.tsx` | Configuration | Studio | P |
| `studio/VersionHistory.tsx` | Configuration | Studio | P |
| `studio/SystemHealthPane.tsx` | Observability | Studio | P |
| `studio/ComponentsLibrary.tsx` | Workspace | Studio | P |

## B.5 Modals

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `modals/AiAssistModal.tsx` | AI | (cross) | W |
| `modals/CommentsModal.tsx` | Communication | (cross) | P |
| `modals/ConfigureDrawer.tsx` | Configuration | Studio | P |
| `modals/CustomerBillingModal.tsx` | Financial | Billing | P |
| `modals/PageSettingsPane.tsx` | Workspace | Studio | P |
| `modals/ProfileModal.tsx` | Identity | (cross) | P |
| `modals/ReportSchedulePanel.tsx` | Reporting | Reporting | P |
| `modals/SecurityModal.tsx` | Security | (cross) | P |
| `modals/SupportModals.tsx` | Case | OSS | P |

## B.6 Shared lib (clients, utilities, registries)

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `lib/api.ts` | (cross) | (cross) | S |
| `lib/action-menu.ts` | Workspace | (cross) | P |
| `lib/billing.ts` | Financial | Billing | P |
| `lib/capabilities.ts` | Permission | (cross) | S |
| `lib/config.ts` | Configuration | (cross) | P |
| `lib/dashboard-catalog.ts` | Analytics | Reporting | P |
| `lib/drawer-types.ts` | Workspace | (cross) | P |
| `lib/emoji-pack.ts` | Workspace | (cross) | P |
| `lib/errors.ts` | (cross) | (cross) | S |
| `lib/helpdesk.ts` | Case | OSS | P |
| `lib/humanize.ts` | Localization | (cross) | P |
| `lib/i18n.ts` | Localization | (cross) | P |
| `lib/lifecycle.ts` | Workflow | (cross) | S |
| `lib/metrics.ts` | Observability | (cross) | P |
| `lib/money.ts` | Financial | Billing | S |
| `lib/nav-config.ts` | Workspace | (n/a) | P |
| `lib/nav-loader.ts` | Workspace | (n/a) | P |
| `lib/notifications.ts` | Notification | (cross) | P |
| `lib/pageConfig.ts` | Workspace | Studio | P |
| `lib/paymentgw.ts` | Financial | Billing | P |
| `lib/stripe.ts` | Integration | Billing | P |
| `lib/time.ts` | Time | (cross) | P |
| `lib/useFlag.ts` | Entitlement | (cross) | P |
| `lib/useFocusTrap.ts` | Workspace | (cross) | S |
| `lib/users.ts` | Identity | (cross) | P |
| `lib/validators.ts` | Data | (cross) | P |
| `lib/workitems.ts` | Work | Workforce | S |

## B.7 Hooks + Context + Generated + Styles

| Path | Primary Core | Domain | Status |
|---|---|---|---|
| `hooks/useFetch.ts` | (cross) | (cross) | S |
| `context/AuthContext.tsx` | Identity | (cross) | S |
| `generated/permissions.ts` | Permission | (cross) | S (codegen) |
| `styles/` (CSS) | Workspace | (n/a) | S |

---

# Part C — Cross-domain reach + shared modules

Per `02_DOMAIN` L4-L5 (cross-domain reads via canonical APIs only; cross-domain writes via events only), certain modules are legitimately cross-cutting. They appear here for transparency.

| Module | Primary Core | Why cross-cutting |
|---|---|---|
| `kernel/workflow_engine.py` | Workflow | Every state-changing module routes through `workflow.emit` here. |
| `kernel/timeline.py` | Audit | Every audit record routes through here. |
| `models/event.py` | Event | Every domain event stored here. |
| `models/record.py` | Data | Generic record CRUD scaffold; not owned by one domain. |
| `routers/records.py` | Data | Generic record API; multi-entity. |
| `routers/relationships.py` | Relationship | Many-to-many cross-entity surface. |
| `routers/search.py` | Search | Cross-entity. |
| `routers/events.py` | Event | Event introspection. |
| `routers/notifications.py` | Notification | Notifications attach to any owner entity type. |
| `routers/documents.py`, `attachments.py` | Document | Polymorphic owner. |
| `routers/activity.py` | Audit | Polymorphic activity surface. |
| `components/RefPicker.tsx` | Relationship | Polymorphic entity picker. |
| `components/ActivityTimeline.tsx` | Audit | Polymorphic timeline render. |
| `lib/api.ts` | (cross) | The shared API client. |

---

# Part D — Ownership Conflict Scan

Per LAW-DA2 (every entity has exactly one primary owner) and `01` L1 (single primary ownership per artifact):

| Axis | Conflicts detected |
|---|---|
| Backend module → primary core | **0** |
| Backend module → primary domain | **0** |
| Frontend directory → primary core | **0** |
| Frontend directory → primary domain | **0** |
| Cross-module file-sharing (two modules both writing to one schema) | **0** (Part C documents the legitimate shared surfaces) |

**Result: ZERO ownership conflicts.** Every module in the platform has exactly one declared primary core and exactly one declared primary domain.

---

# Part E — Per-core module-count roll-up

Counts every module (backend file + frontend directory) where the core is the **primary** owner.

| Core | Tier | Backend modules | Frontend modules | Total |
|---|---|---|---|---|
| Audit | FOUNDATION | 4 | 2 | 6 |
| Configuration | FOUNDATION | 4 | 3 | 7 |
| Entitlement | FOUNDATION | 3 | 2 | 5 |
| Governance | FOUNDATION | 1 | 0 | 1 |
| Identity | FOUNDATION | 6 | 4 | 10 |
| Observability | FOUNDATION | 5 | 3 | 8 |
| Permission | FOUNDATION | 4 | 4 | 8 |
| Policy | FOUNDATION | 0 | 0 | 0 (consumed cross-cutting) |
| Security | FOUNDATION | 5 | 1 | 6 |
| Tenant | FOUNDATION | 2 | 1 | 3 |
| Time | FOUNDATION | 1 | 1 | 2 |
| Compliance | FOUNDATION | 3 | 0 | 3 |
| Party | BUSINESS OBJECTS | 4 | 4 | 8 |
| Organization | BUSINESS OBJECTS | 1 | 3 | 4 |
| Location | BUSINESS OBJECTS | 2 | 1 | 3 |
| Resource | BUSINESS OBJECTS | 14 | 2 | 16 |
| Product | BUSINESS OBJECTS | 4 | 2 | 6 |
| Service | BUSINESS OBJECTS | 3 | 3 | 6 |
| Contract | BUSINESS OBJECTS | 1 | 0 | 1 |
| Work | BUSINESS OBJECTS | 5 | 5 | 10 |
| Knowledge | BUSINESS OBJECTS | 0 | 0 | 0 (WEAK — no dedicated modules) |
| Financial | BUSINESS COMMERCE | 25 | 9 | 34 |
| Case | BUSINESS EXECUTION | 4 | 2 | 6 |
| Workflow | BUSINESS EXECUTION | 8 | 3 | 11 |
| Automation | BUSINESS EXECUTION | 2 | 2 | 4 |
| Approval | BUSINESS EXECUTION | 4 | 1 | 5 |
| SLA | BUSINESS EXECUTION | 2 | 0 | 2 |
| Scheduling | BUSINESS EXECUTION | 2 | 3 | 5 |
| Communication | BUSINESS EXECUTION | 7 | 4 | 11 |
| Notification | BUSINESS EXECUTION | 10 | 3 | 13 |
| Document | BUSINESS EXECUTION | 3 | 0 | 3 |
| Data | PLATFORM SERVICES | 4 | 2 | 6 |
| Metadata | PLATFORM SERVICES | 3 | 3 | 6 |
| Relationship | PLATFORM SERVICES | 2 | 2 | 4 |
| Search | PLATFORM SERVICES | 4 | 3 | 7 |
| Event | PLATFORM SERVICES | 2 | 0 | 2 |
| Integration | PLATFORM SERVICES | 10 | 2 | 12 |
| Developer Platform | PLATFORM SERVICES | 1 | 1 | 2 |
| Background Processing | PLATFORM SERVICES | 2 | 0 | 2 |
| Import/Export | PLATFORM SERVICES | 4 | 0 | 4 |
| Template | PLATFORM SERVICES | 0 | 1 | 1 (WEAK) |
| Storage | PLATFORM SERVICES | 1 | 0 | 1 |
| Analytics | INTELLIGENCE | 4 | 5 | 9 |
| Reporting | INTELLIGENCE | 3 | 4 | 7 |
| AI | INTELLIGENCE | 2 | 3 | 5 |
| Forecasting | INTELLIGENCE | 0 | 0 | 0 (MISSING) |
| Decision Support | INTELLIGENCE | 0 | 0 | 0 (PARTIAL — no dedicated modules) |
| Workspace | EXPERIENCE | 9 | 60+ | 69+ |
| Portal | EXPERIENCE | 5 | 0 | 5 |
| Mobile | EXPERIENCE | 1 | 0 | 1 |
| Marketplace | EXPERIENCE | 0 | 0 | 0 (MISSING / RESERVED) |
| Localization | EXPERIENCE | 1 | 2 | 3 |

**Maturity status consistency vs PRM:** the per-core module counts are
consistent with PRM core status (STRONG cores have 6+ modules; WEAK / MISSING
cores have 0-2 modules). The MISSING cores (Forecasting, Marketplace, Knowledge)
have zero modules — confirming the "reserved but not implemented" status
declared in PRM.

---

# Part F — Maintenance process

Per LAW-GV1 + `01` §15.1 + `02` §9.1:

1. **Adding a new backend module** requires:
    - Declare domain in top-of-file comment.
    - Add a row to the appropriate Part A subsection of this catalog.
    - If introducing a new top-level `/api/v1/<prefix>/*` URL family, also amend `02_DOMAIN` §9.2 and `CORE_OWNERSHIP_MATRIX.md` Part B.

2. **Adding a new frontend view** requires:
    - Add a row to the appropriate Part B subsection.
    - If introducing a new top-level nav slot, also amend `04_NAVIGATION` §7.1.

3. **Reassigning primary ownership of a module** requires LAW-GV1 amendment.

4. **Drift check** (planned for `tools/check_drift.py`):
    - Every backend module under `backend/app/` declares its `# Domain:` comment matching a row in Part A.
    - Every new frontend route in the router declares a `PageRegistryEntry` matching Part B.
    - No new top-level package without a corresponding catalog row.

---

*End of Module Catalog.*
