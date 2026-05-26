from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text, select

from .db import engine, SessionLocal
from .models import (  # noqa: F401  (imported so the mappers register)
    Base, Tenant, OrgNode, User,
    EntityDef, FieldDef, StatusDef, RelationDef, WorkflowDef, Record,
    PermissionDef, RoleDef, Assignment, Event,
)
from .seed import seed_if_empty, seed_meta_if_empty, seed_access_if_empty
from .routers import auth, meta, records, reports, notifications, dashboards


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema is managed by Alembic migrations — run `alembic upgrade head` before starting.
    # On boot we only seed demo data (idempotent).
    await seed_if_empty()
    await seed_meta_if_empty()
    await seed_access_if_empty()
    yield


app = FastAPI(title="GAAex API", version="0.0.1-m0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(meta.router)
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
    async with SessionLocal() as s:
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
