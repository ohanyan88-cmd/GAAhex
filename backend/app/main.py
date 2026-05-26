from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text, select

from .db import engine, SessionLocal, OwnerSessionLocal
from .models import (  # noqa: F401  (imported so the mappers register)
    Base, Tenant, OrgNode, User,
    EntityDef, FieldDef, StatusDef, RelationDef, WorkflowDef, Record,
    PermissionDef, RoleDef, Assignment, Event,
)
from .seed import seed_if_empty, seed_meta_if_empty, seed_access_if_empty
from .seed_notifications import seed_notifications_if_empty
from .seed_demo_loop import seed_demo_loop_if_empty
from .scheduler import start_scheduler, stop_scheduler
from .routers import auth, meta, records, reports, notifications, dashboards, views, approvals, search, comm, export, activity, ops, billing, bulk, report_builder, orders, customer360, webhooks, apikeys, services, interactions, respool, usage, documents, i18n, accounts, analytics, ai, admin, tenant_settings, convert, billing_cycle, capabilities, health, jobs, report_schedules


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema is managed by Alembic migrations — run `alembic upgrade head` before starting.
    # On boot we only seed demo data (idempotent).
    await seed_if_empty()
    await seed_meta_if_empty()
    await seed_access_if_empty()
    await seed_notifications_if_empty()
    await i18n.seed_i18n_if_empty()
    await seed_demo_loop_if_empty()   # one sample customer with the full daily loop (idempotent)
    await start_scheduler(app)        # no-op unless settings.scheduler_enabled (auto batch jobs)
    try:
        yield
    finally:
        await stop_scheduler(app)


app = FastAPI(title="GAAex API", version="0.0.1-m0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)
# Abuse guard — OFF unless settings.rate_limit_enabled (so tests/dev are unaffected). In-process.
app.add_middleware(apikeys.RateLimitMiddleware)

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
app.include_router(ops.router)
app.include_router(billing.router)
app.include_router(bulk.router)
app.include_router(report_builder.router)
app.include_router(orders.router)
app.include_router(customer360.router)
app.include_router(webhooks.router)
app.include_router(apikeys.router)
app.include_router(services.router)
app.include_router(interactions.router)
app.include_router(respool.router)
app.include_router(usage.router)
app.include_router(documents.router)
app.include_router(i18n.router)
app.include_router(accounts.router)                 # /api/parties + /api/accounts (17a, before records)
app.include_router(analytics.router)                # /api/analytics/* (fixed KPIs, before records)
app.include_router(ai.router)                       # /api/ai/* (lead score + summarize, before records)
app.include_router(admin.router)                    # /api/admin/* (tenant provisioning; owner-run, before records)
app.include_router(tenant_settings.router)          # /api/tenant/* (tenant profile/settings, before records)
app.include_router(convert.router)                  # /api/leads/{id}/convert (lead->customer; before records)
app.include_router(billing_cycle.router)            # /api/billing/run-cycle (batch billing; before records)
app.include_router(capabilities.router)             # /api/me/capabilities (effective rights; before records)
app.include_router(health.router)                   # /api/health[/ready|/status] (probes; before records)
app.include_router(jobs.router)                     # /api/jobs (batch-job run log; before records)
app.include_router(report_schedules.router)         # /api/report-schedules (scheduled reports; before records)
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
