# GAAex

The platform that aims to be **the only place of work for an entire ISP** — every department,
every role, one system. Multi-tenant, configuration-driven, built on a small fixed kernel.

> **Blueprint:** the full architecture lives in `../GAAex-Vision/` (read its `README.md`).
> This repo is the build. Current milestone: **M0** (see `../GAAex-Vision/6-platform-delivery/31-phase-0-scope.md`).

## Stack
- **Backend:** Python · FastAPI · SQLAlchemy 2.0 (async) · Pydantic v2 · PostgreSQL (ltree, JSONB, RLS)
- **Frontend:** React + TypeScript (config-driven interpreter)
- **Cache/Events:** Redis · transactional outbox → NATS JetStream/Kafka (later)
- **Expressions:** GXL on CEL

## Run it (dev)
```bash
# 1. start Postgres + Redis
docker compose up -d

# 2. backend
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
.venv/Scripts/python.exe -m uvicorn app.main:app --port 8099
```
Then open:
- API docs (Swagger): http://127.0.0.1:8099/docs
- Health: http://127.0.0.1:8099/health
- Org tree: http://127.0.0.1:8099/api/org-tree

Postgres → `localhost:5433` (user/pass/db = `gaaex`). Redis → `localhost:6380`.

## M0 status (the walking-skeleton foundation)
- [x] Postgres + Redis (docker)
- [x] Tenant + OrgNode (recursive, ltree) models
- [x] Schema bootstrap + demo seed on startup
- [x] FastAPI baseline: `/health`, `/health/db`, `/api/org-tree`
- [ ] Auth: login / session
- [ ] Frontend baseline page
- [ ] (M1+) Alembic migrations · Config Registry · Runtime Interpreter

## Layout
```
backend/app/
  config.py        settings
  db.py            async engine/session
  models/          Tenant, OrgNode (+ kernel entities to come)
  main.py          FastAPI app + lifespan (bootstrap/seed)
  seed.py          demo tenant + org tree
docker-compose.yml Postgres 16 + Redis 7
```
