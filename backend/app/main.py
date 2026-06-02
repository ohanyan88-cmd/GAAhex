import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv

# Load .env into os.environ BEFORE any app modules import — field_crypto.py reads
# GAAHEX_FIELD_KEY directly from os.environ at module-import time, so the env must
# be populated before `from .config import settings` triggers app.* imports below.
load_dotenv()

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy import text, select

from .config import settings, _assert_production_deploy_contract
from .db import SessionLocal, OwnerSessionLocal, engine, owner_engine
from .models import (  # noqa: F401  (imported so the mappers register)
    Base, Tenant, OrgNode, User,
    EntityDef, FieldDef, StatusDef, RelationDef, WorkflowDef, Record,
    PermissionDef, RoleDef, Assignment, RoleDeny, Event, FeatureFlag,
)
# M1-A audit item #4 — tenant-filter safety net (defense layer 2 after RLS).
# Attached AFTER `.models` import so `Base.metadata` is fully populated when the
# listener discovers the tenant-scoped table set. Gated by env GAAHEX_TENANT_AUDIT
# (on by default in dev; off in tests + prod). No-op + zero overhead when disabled.
# Both engines are audited; legitimate exceptions (auth lookups, GUC binding, seed
# scripts) opt out per-statement via `execution_options(audit_tenant_filter=False)`.
from .tenant_query_audit import setup_tenant_query_audit  # noqa: E402
setup_tenant_query_audit(engine)
setup_tenant_query_audit(owner_engine)
from .seed import (
    seed_if_empty, seed_meta_if_empty, seed_access_if_empty,
    seed_portal_if_empty, seed_spec_roles_if_missing,
    backfill_demo_user_departments,
)
from .seed_notifications import seed_notifications_if_empty
from .seed_demo_loop import seed_demo_loop_if_empty
from .seed_catalog import seed_catalog_if_missing
from .seed_default_records import run as seed_default_records_run
from .seed_dev_bulk import seed_dev_bulk_if_empty, _dev_seed_enabled
from .seed_ownership import seed_ownership_matrix_if_empty
from .seed_pipeline import seed_canonical_pipeline_if_empty
from .seed_workflows import seed_workflows_if_missing
from .seed_kpi_formulas import seed_kpi_formulas_if_missing
from .seed_statuses import seed_status_standardization_if_empty
from .seed_role_boundaries import seed_role_boundaries_if_empty
from .seed_regions import seed_demo_regions_if_empty
from .seed_nav_registry import seed_nav_registry_if_empty
from .migrate_interactions import migrate_interactions
from .scheduler import start_scheduler, stop_scheduler
from .routers import auth, meta, records, reports, notifications, notification_defs, dashboards, views, approvals, search, comm, export, activity, ops, billing_subscription, billing_invoice, billing_payment, billing_credit_note, billing_product, bulk, report_builder, orders, customer360, webhooks, apikeys, services, respool, usage, documents, i18n, accounts, analytics, ai, tenant_settings, convert, billing_cycle, capabilities, health, jobs, report_schedules, digests, search_assist, helpdesk, users, workitems, payment_gateway, calendar as calendar_router, portal_auth, portal, portal_billing, portal_support, portal_service, roles, automations, events, page_config, me, org_nodes, metrics, audit_log, studio_pages, feature_flags, page_bindings, assignments, mandatory_approvals, regions, kpis, customer_timeline, workflows, nav_registry, assets, procurement, contract_expiring, workspace, tariff_plans, credit_notes, dunning, revenue_assurance, payment_methods, install_board, noc_dashboard, noc_inventory, comments, watchers, tasks, slas, attachments, communications, configurations, escalations, relationships, imports_exports, lifecycle


_log = logging.getLogger("gaahex")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # M1-A Wave 4 — production deploy contract: refuse to boot if RLS won't engage
    # (DATABASE_URL and OWNER_DATABASE_URL must use distinct Postgres roles in prod).
    # No-op when settings.environment != "production", so dev/test/CI are unaffected.
    # See docs/M1A-DEPLOY-CONTRACT.md.
    _assert_production_deploy_contract()

    # S1 — JWT secret fail-fast (default-OFF; prod sets REQUIRE_STRONG_SECRETS=true).
    # Guard fires ONLY when require_strong_secrets is explicitly enabled, so dev/test are unaffected.
    if settings.require_strong_secrets:
        if settings.jwt_secret == "dev-only-change-me" or len(settings.jwt_secret) < 32:
            raise RuntimeError("Weak JWT secret; set a 32+ byte JWT_SECRET")

    # Schema is managed by Alembic migrations — run `alembic upgrade head` before starting.
    # On boot we only seed demo data (idempotent).
    await seed_if_empty()
    await seed_demo_regions_if_empty()  # SPEC §0.6 — one canonical region per tenant (idempotent)
    await seed_meta_if_empty()
    await seed_access_if_empty()
    await seed_spec_roles_if_missing()      # SPEC §4.3 — ensure all SPEC roles exist (idempotent)
    await backfill_demo_user_departments()  # SPEC §4.1 — M0 demo dept backfill (idempotent; NULL-only)
    await seed_notifications_if_empty()
    await seed_portal_if_empty()
    await i18n.seed_i18n_if_empty()
    await seed_demo_loop_if_empty()   # one sample customer with the full daily loop (idempotent)
    await seed_catalog_if_missing()   # promote enterprise-nav stubs into real config-driven entities (idempotent)
    await seed_canonical_pipeline_if_empty()  # SPEC §3 — 14 stages + 14 KPIs (Step 4; idempotent)
    await seed_workflows_if_missing()         # SPEC §5 — 5 cross-entity workflows W1..W5 (Step 4; idempotent)
    await seed_kpi_formulas_if_missing()      # SPEC §3/§9 — formula_spec on 4-6 of 14 KPIs (idempotent)
    await seed_status_standardization_if_empty()  # SPEC §7 — status sets (Step 5; idempotent)
    await seed_default_records_run()  # grant request.* perms to existing roles (idempotent); starter-row insertion deleted — empty pages now show the proper EmptyState per real-data doctrine
    await seed_ownership_matrix_if_empty()  # SPEC §2.2 — backfill entity_def.owner_module (Step 3; idempotent)
    await seed_role_boundaries_if_empty()   # SPEC §4.3 — role hard-denials (Step 6; idempotent)
    await seed_nav_registry_if_empty()      # SPEC §1 — 9 groups + 71 modules (Step 7; idempotent)
    # Dev-only bulk seeder — populates previously-sparse pages with 10 realistic Armenian-ISP
    # customers + the full cross-referenced tree. Gated by env-var `GAAHEX_DEV_SEED`; production
    # leaves it unset → seeder never runs → DB stays empty-until-real. Idempotent.
    if _dev_seed_enabled():
        await seed_dev_bulk_if_empty()
    await migrate_interactions()      # copy interaction table rows → record table (idempotent)
    await start_scheduler(app)        # no-op unless settings.scheduler_enabled (auto batch jobs)

    # N1 — RLS-bypass / superuser safety check (best-effort, fail-soft; informational only).
    # Warns when the app DB role is a superuser that can bypass RLS, which would be a
    # misconfiguration in a real multi-tenant deployment.  Only loud when require_strong_secrets
    # is on (prod); silent in dev so it doesn't clutter test output.
    if settings.require_strong_secrets:
        try:
            async with SessionLocal() as _s:
                row = (await _s.execute(text("SELECT current_setting('is_superuser')"))).scalar()
                if str(row).lower() == "on":
                    _log.warning(
                        "SECURITY: the application database role is a superuser and can bypass RLS. "
                        "Use a restricted app role in production."
                    )
        except Exception:
            pass  # DB may not be available during migrations / CI — never hard-fail here

    try:
        yield
    finally:
        await stop_scheduler(app)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Audit-P1 — set standard browser security headers on every response.

    Adds clickjacking / MIME-sniff / referrer / XSS / HSTS / permissions headers.
    Never overrides a header the downstream app already set, so endpoint-specific
    overrides (e.g. a special CSP on one route) still win.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        headers = response.headers

        defaults = {
            "X-Frame-Options": "DENY",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            # Modern guidance: explicitly OFF; browsers use CSP instead.
            "X-XSS-Protection": "0",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        }
        for name, value in defaults.items():
            if name not in headers:
                headers[name] = value

        # HSTS only on HTTPS requests — sending it over plain HTTP is a no-op
        # at best and a foot-gun at worst (dev/test traffic stays unaffected).
        if request.url.scheme == "https" and "Strict-Transport-Security" not in headers:
            headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        return response


app = FastAPI(title="GAAhex API", version="0.0.1-m0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    # S3: origins driven by settings.cors_origins (default "*" keeps dev/tests working).
    # Prod: set CORS_ORIGINS=https://app.example.com (comma-separate multiple origins).
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)
# Audit-P1 — security headers on every response. Registered between CORS and the
# rate limiter so it sits in the response path for all normal traffic.
app.add_middleware(SecurityHeadersMiddleware)
# Abuse guard — OFF unless settings.rate_limit_enabled (so tests/dev are unaffected). In-process.
app.add_middleware(apikeys.RateLimitMiddleware)
# Idempotency-Key cache — outermost so cache hits short-circuit before rate-limit billing (B4 agent recommendation).
# Only acts on POST/PATCH/DELETE with Idempotency-Key header; no-op otherwise.
from .middleware import IdempotencyMiddleware
app.add_middleware(IdempotencyMiddleware)


# N4 — global unhandled-exception handler: log server-side, return clean 500, never leak traceback.
# HTTPException is intentionally NOT caught here — FastAPI handles those normally.
@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, HTTPException):
        # Should not reach here, but be safe — let FastAPI's own handler deal with it.
        raise exc
    _log.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.include_router(auth.router)
app.include_router(meta.router)
app.include_router(notification_defs.router)        # /meta/notification-defs (Studio templates+rules; fixed-path under /meta)
# views + approvals own fixed paths under /api/* — register BEFORE the generic /api/{slug} records
# router so they aren't swallowed as entity slugs.
app.include_router(views.router)
app.include_router(approvals.router)
app.include_router(search.router)
app.include_router(comm.router)
app.include_router(comments.router)              # /api/comments + /api/{entityKey}/{id}/comments — file 04 Comment Standard
app.include_router(watchers.router)              # /api/{entityKey}/{id}/watchers — file 05 Watcher Standard
app.include_router(tasks.router)                 # /api/tasks — file 05 Task Standard
app.include_router(slas.router)                  # /api/slas  — file 12 SLA Standard
app.include_router(attachments.router)           # /api/attachments + /api/{entityKey}/{id}/attachments — file 04
app.include_router(communications.router)         # /api/communications — file 12 Customer Communication Standard
app.include_router(configurations.router)         # /api/configurations — file 08 Configuration Standard
app.include_router(escalations.router)            # /api/escalations — file 02 Escalation Standard
app.include_router(relationships.router)          # /api/relationships — file 12 Relationship Standard
app.include_router(imports_exports.router)        # /api/imports + /api/exports — file 08 Import/Export Standard
app.include_router(lifecycle.router)              # /api/lifecycle — file 12 D14 deletion-state lifecycle (polymorphic)
app.include_router(export.router)
app.include_router(activity.router)
app.include_router(audit_log.router)                # /api/audit-log (governance log; admin-scoped; before records)
app.include_router(ops.router)
app.include_router(billing_subscription.router)     # /api/subscriptions/* (split from billing god-router)
app.include_router(billing_invoice.router)          # /api/invoices/* + /api/invoices/run-dunning (split from billing god-router)
app.include_router(billing_payment.router)          # /api/payments/* + /api/invoices/{id}/payments (split from billing god-router)
app.include_router(billing_credit_note.router)      # /api/credit-notes (POST; reads served by generic record router)
app.include_router(billing_product.router)          # /api/products/* + /api/products/{id}/versions (split from billing god-router)
app.include_router(bulk.router)
app.include_router(report_builder.router)
app.include_router(orders.router)
app.include_router(customer360.router)
app.include_router(webhooks.router)
app.include_router(apikeys.router)
app.include_router(services.router)
app.include_router(assets.router)                   # /api/assets/{id}/writeoff (SPEC §4.5, before records)
app.include_router(procurement.router)              # /api/purchase-orders/{id}/submit (SPEC §4.5, before records)
app.include_router(respool.router)
app.include_router(usage.router)
app.include_router(documents.router)
app.include_router(i18n.router)
app.include_router(accounts.router)                 # /api/parties + /api/accounts (17a, before records)
app.include_router(analytics.router)                # /api/analytics/* (fixed KPIs, before records)
app.include_router(metrics.router)                  # /api/metrics/* (home dashboard time series, before records)
app.include_router(ai.router)                       # /api/ai/* (lead score + summarize, before records)
app.include_router(tenant_settings.router)          # /api/tenant/* (tenant profile/settings, before records)
app.include_router(convert.router)                  # /api/leads/{id}/convert (lead->customer; before records)
app.include_router(billing_cycle.router)            # /api/billing/run-cycle (batch billing; before records)
app.include_router(capabilities.router)             # /api/me/capabilities (effective rights; before records)
app.include_router(me.router)                       # /api/me/avatar + /api/me/password (self-service; before records)
app.include_router(health.router)                   # /api/health[/ready|/status] (probes; before records)
app.include_router(jobs.router)                     # /api/jobs (batch-job run log; before records)
app.include_router(report_schedules.router)         # /api/report-schedules (scheduled reports; before records)
app.include_router(digests.router)                  # /api/notifications/run-digests (digest job; before records)
app.include_router(search_assist.router)            # /api/saved-searches + /api/search/suggest (before records)
app.include_router(calendar_router.router)          # /api/calendar/* (fixed paths; before records)
app.include_router(helpdesk.router)                 # /api/helpdesk/* (fixed paths; before records)
app.include_router(users.router)                    # /api/users (assignee/agent picker; before records)
app.include_router(workitems.router)                # /api/workitems/* (fixed paths; before records)
app.include_router(payment_gateway.router)          # /api/invoices/{id}/pay + /api/payment-orders/* (before records)
app.include_router(portal_auth.router)              # /portal/auth/* (customer portal login; before records)
app.include_router(portal.router)                   # /portal/me/summary (customer portal; before records)
app.include_router(portal_billing.router)           # /portal/me/invoices|payments (B35; before records)
app.include_router(portal_support.router)           # /portal/me/tickets (B36; before records)
app.include_router(portal_service.router)           # /portal/me/services|subscriptions|usage (B37; before records)
app.include_router(roles.router)                    # /api/roles + /api/permissions (Studio; before records)
app.include_router(assignments.router)              # /api/assignments (Security Users pane; before records)
app.include_router(automations.router)              # /api/automations (Studio; before records)
app.include_router(events.router)                   # /api/events/types|registry (Studio event picker; before records)
app.include_router(page_config.router)              # /api/page-config/* (configure-in-place for bespoke pages; before records)
app.include_router(org_nodes.router)                # /api/org/nodes (org-structure CRUD; fixed path, before records)
app.include_router(studio_pages.router)             # /api/studio/pages (page versioning; fixed path, before records)
app.include_router(feature_flags.router)             # /api/feature-flags (DB-backed flags; before records)
app.include_router(page_bindings.router)             # /api/page-bindings (Studio data binding; before records)
app.include_router(notifications.outbound_router)   # GET /api/outbound (fixed path under /api)
app.include_router(mandatory_approvals.router)       # /api/mandatory-approvals (SPEC §4.5; before records)
app.include_router(regions.router)                   # /api/regions (SPEC §0.6; before records)
app.include_router(kpis.router)                      # /api/kpis (computation engine; before records)
app.include_router(customer_timeline.router)         # /api/customers/{id}/timeline (SPEC §8; before records)
app.include_router(workflows.router)                 # /api/workflows + /api/workflow-instances (SPEC §5; before records)
app.include_router(nav_registry.router)              # /api/nav (SPEC §1 config-driven nav; before records)
app.include_router(contract_expiring.router)         # /api/contracts/expiring (renewal watch; before records)
app.include_router(workspace.router)                 # /api/me/workspace-role (My Work layout resolver; before records)
app.include_router(tariff_plans.router)              # /api/tariff-plans (Phase A.1 BSS rate cards; before records)
app.include_router(credit_notes.router)              # /api/billing/credit-notes (Phase A.3 physical CN; before records)
app.include_router(dunning.router)                    # /api/dunning/* + /api/services/{id}/action-log (Phase B.2; before records)
app.include_router(revenue_assurance.router)          # /api/revenue-assurance/* (Phase B.3 leakage scans + finding queue; before records)
app.include_router(payment_methods.router)            # /api/payment-methods/* (Phase B.1 vaulted cards; before records)
app.include_router(install_board.router)              # /api/install-board/* + /api/splitters/{id}/strands + /api/cpe-bindings/* (NOC Phase A; before records)
app.include_router(noc_dashboard.router)              # /api/noc/* — OLT tree + ONU + optical telemetry + OTDR + tech GPS (NOC Phase B; before records)
app.include_router(noc_inventory.router)              # /api/fiber-routes + /api/outage-paths + /api/ipam/* + /api/assets/{id}/move + /api/radius/* + /api/broadcasts (NOC Phase C; before records)
# M1-C Phase 0 — vendor webhook receivers (named vendor_webhooks/ to avoid a
# collision with the existing outbound webhooks.py module that powers
# /api/webhooks tenant subscriptions). Each is a thin signature-verify + log + ack;
# event-handler dispatch lands in M1-C.1 (Stripe), .2 (Twilio), .3 (SendGrid).
from .routers.vendor_webhooks import stripe as stripe_webhooks  # noqa: E402
from .routers.vendor_webhooks import sendgrid as sendgrid_webhooks  # noqa: E402
from .routers.vendor_webhooks import twilio as twilio_webhooks  # noqa: E402
app.include_router(stripe_webhooks.router)            # POST /api/webhooks/stripe
app.include_router(sendgrid_webhooks.router)          # POST /api/webhooks/sendgrid
app.include_router(twilio_webhooks.router)            # POST /api/webhooks/twilio
app.include_router(records.router)
app.include_router(reports.router)
app.include_router(notifications.router)
app.include_router(dashboards.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "gaahex", "milestone": "M0"}


@app.get("/health/db")
async def health_db():
    async with SessionLocal() as s:
        await s.execute(text("select 1"))
    return {"db": "ok"}


@app.get("/org-tree")
async def org_tree():
    """Baseline read: the seeded tenant + org tree. Public; lives outside the /api/{slug}
    entity namespace so the generic record router doesn't shadow it."""
    # public + no tenant context → owner session (bypasses RLS) so it isn't default-denied.
    async with OwnerSessionLocal() as s:
        tenants = (await s.execute(select(Tenant))).scalars().all()
        nodes = (await s.execute(select(OrgNode).order_by(OrgNode.path))).scalars().all()
        return {
            "tenants": [{"id": str(t.id), "name": t.name, "status": t.status} for t in tenants],
            "nodes": [
                {
                    "id": str(n.id),
                    "type": n.type,
                    "name": n.name,
                    "code": n.code,
                    "path": str(n.path),
                    "parent_id": str(n.parent_id) if n.parent_id else None,
                }
                for n in nodes
            ],
        }
