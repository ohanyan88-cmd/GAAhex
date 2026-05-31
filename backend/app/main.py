import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text, select

from .config import settings
from .db import engine, SessionLocal, OwnerSessionLocal
from .models import (  # noqa: F401  (imported so the mappers register)
    Base, Tenant, OrgNode, User,
    EntityDef, FieldDef, StatusDef, RelationDef, WorkflowDef, Record,
    PermissionDef, RoleDef, Assignment, Event, FeatureFlag,
)
from .seed import seed_if_empty, seed_meta_if_empty, seed_access_if_empty, seed_portal_if_empty
from .seed_notifications import seed_notifications_if_empty
from .seed_demo_loop import seed_demo_loop_if_empty
from .seed_catalog import seed_catalog_if_missing
from .seed_default_records import run as seed_default_records_run
from .seed_dev_bulk import seed_dev_bulk_if_empty, _dev_seed_enabled
from .migrate_interactions import migrate_interactions
from .scheduler import start_scheduler, stop_scheduler
from .routers import auth, meta, records, reports, notifications, dashboards, views, approvals, search, comm, export, activity, ops, billing, bulk, report_builder, orders, customer360, webhooks, apikeys, services, respool, usage, documents, i18n, accounts, analytics, ai, tenant_settings, convert, billing_cycle, capabilities, health, jobs, report_schedules, digests, search_assist, helpdesk, users, workitems, payment_gateway, calendar as calendar_router, portal_auth, portal, portal_billing, portal_support, portal_service, roles, automations, events, page_config, me, org_nodes, metrics, audit_log, studio_pages, feature_flags, page_bindings, assignments


_log = logging.getLogger("gaaex")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # S1 — JWT secret fail-fast (default-OFF; prod sets REQUIRE_STRONG_SECRETS=true).
    # Guard fires ONLY when require_strong_secrets is explicitly enabled, so dev/test are unaffected.
    if settings.require_strong_secrets:
        if settings.jwt_secret == "dev-only-change-me" or len(settings.jwt_secret) < 32:
            raise RuntimeError("Weak JWT secret; set a 32+ byte JWT_SECRET")

    # Schema is managed by Alembic migrations — run `alembic upgrade head` before starting.
    # On boot we only seed demo data (idempotent).
    await seed_if_empty()
    await seed_meta_if_empty()
    await seed_access_if_empty()
    await seed_notifications_if_empty()
    await seed_portal_if_empty()
    await i18n.seed_i18n_if_empty()
    await seed_demo_loop_if_empty()   # one sample customer with the full daily loop (idempotent)
    await seed_catalog_if_missing()   # promote enterprise-nav stubs into real config-driven entities (idempotent)
    await seed_default_records_run()  # insert 2-3 starter rows per empty entity + grant request.* perms (idempotent)
    # Dev-only bulk seeder — populates previously-sparse pages with 10 realistic Armenian-ISP
    # customers + the full cross-referenced tree. Gated by env-var `GAAEX_DEV_SEED`; production
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


app = FastAPI(title="GAAex API", version="0.0.1-m0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    # S3: origins driven by settings.cors_origins (default "*" keeps dev/tests working).
    # Prod: set CORS_ORIGINS=https://app.example.com (comma-separate multiple origins).
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)
# Abuse guard — OFF unless settings.rate_limit_enabled (so tests/dev are unaffected). In-process.
app.add_middleware(apikeys.RateLimitMiddleware)


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
# views + approvals own fixed paths under /api/* — register BEFORE the generic /api/{slug} records
# router so they aren't swallowed as entity slugs.
app.include_router(views.router)
app.include_router(approvals.router)
app.include_router(search.router)
app.include_router(comm.router)
app.include_router(export.router)
app.include_router(activity.router)
app.include_router(audit_log.router)                # /api/audit-log (governance log; admin-scoped; before records)
app.include_router(ops.router)
app.include_router(billing.router)
app.include_router(bulk.router)
app.include_router(report_builder.router)
app.include_router(orders.router)
app.include_router(customer360.router)
app.include_router(webhooks.router)
app.include_router(apikeys.router)
app.include_router(services.router)
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
app.include_router(records.router)
app.include_router(reports.router)
app.include_router(notifications.router)
app.include_router(dashboards.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "gaaex", "milestone": "M0"}


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
