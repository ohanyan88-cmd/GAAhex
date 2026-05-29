# GAAex Batch Playbook — the canonical way we build

**This is THE working method for GAAex feature batches. Gev endorsed it explicitly (2026-05-27):
it saves usage very well and works very well — always use this method.** Proven across batches
20–32 (CRM depth → Helpdesk → WorkItems).

## The shape

ONE **coordinator** window (Opus) runs the whole batch by dispatching **in-window background
agents** — NOT separate terminals a human pastes into, NOT parallel human-driven windows. The
coordinator writes the specs, dispatches the lane agents, reads their results, does ALL the
shared-file wiring + migration + tests + git itself.

```
coordinator (Opus)
  ├─ writes A..E(+) task specs → Desktop\GAAex\TASKS\  (gitignored)
  ├─ dispatches lane agents (Agent tool, run_in_background:true), model-tiered
  ├─ integrates: shared-file wiring · contract checks · one migration · full pytest SOLO · tsc
  └─ commits + pushes
```

## Lanes (typically A–E; up to A–I for fat multi-surface batches)

A single medium module splits cleanly into ~5 disjoint lanes; don't force more than the files
allow (two agents must never share a file). Save A–I for genuinely fat batches (e.g. the customer
portal). Per-batch judgment, not a mandate.

Typical 5-lane split for a new module:
- **A — backend core** (model + migration + router). The meaty lane.
- **B — frontend** (the View + its api client + App.tsx wiring).
- **C — tests** (built against the spec contract; runs concurrent with A).
- **D — docs** (docs/specs/<MODULE>.md).
- **E — a small adjacent piece** (a helper endpoint, a second small view, seed data).

## Model tiering (this is the usage win)

- **Sonnet** → hard backend (models/migrations/routers) + complex frontend (full Views).
- **Haiku** → tests, docs, simple endpoints, small UI edits.
- **Opus** → only the coordinator (specs + integration + judgment).

Ratio that's worked: ~2 Sonnet / 3 Haiku per 5-lane batch. Opus never re-reads what an agent can
read in its own cheaper context — that duplication was the original usage burn.

## Lane discipline (why batches stay clean)

Every task spec MUST carry these as STRICT RULES:
- **NO git. NO server/docker start-stop. NO pytest run.** (Agents only read their own files + refs.)
- Each agent **creates only its own files**; lanes are **file-disjoint**.
- **Shared central files are the coordinator's job** — agents must NOT edit them, they REPORT the
  exact edits as paste-ready lines. Shared files: `main.py`, `models/__init__.py`, `seed.py`,
  `scheduler.py`, and on the frontend `App.tsx`/`api.ts` (give those to ONE frontend lane only).
- Backend model lanes do NOT hand-pick the migration head blindly — the spec tells them the current
  head to chain `down_revision` from.
- Only **ONE batch runs at a time** (a 2nd concurrent batch = 10 agents that collide).

## Dispatch order

- Launch **A, B, C, E together** (background). C builds to the spec contract, so it can run before A
  lands.
- Hold **D (docs) until A/B/E land**, then dispatch it — Haiku finishes fast and would otherwise
  document code that doesn't exist yet. Tell D explicitly: "the code HAS landed, read the real files,
  you HAVE the Write tool — actually write the file."

## The integration pass (coordinator — this is where quality is made)

1. **Verify cross-lane contracts BEFORE wiring.** grep the real signatures the agents called blind:
   `notify_hooks.fire`, `workflow.emit`, `can(...)`, model field names, helper imports. Cheap; catches
   mismatches before they become confusing test failures.
2. **Apply the reported paste-lines** to the shared files yourself.
3. **Run the new module's tests first** (fast feedback), then the **full suite SOLO**
   (`AI_PROVIDER=none AI_API_KEY= .venv/Scripts/python.exe -m pytest -q`). Solo because concurrent
   agents hammering the shared DB cause false connection/401 failures — a clean solo run is truth.
4. **Validate the migration by APPLYING it** (`alembic upgrade head`). Tests use `create_all`, so they
   do NOT exercise the hand-written migration/RLS SQL — only an actual upgrade does.
5. **`npx tsc --noEmit`** on the frontend.
6. **Reconcile cross-lane drift** the tests/tsc surface (add a missing endpoint, fix a shape, or put a
   thin adapter at the frontend boundary).
7. Commit (no `Co-Authored-By` trailer — pure-GAAex history) + push.

**Expect ~2 cross-lane bugs per batch.** That's normal and the pass exists to catch them.

## Recurring bug-classes to pre-empt (seen B31–B32)

- **Trailing-slash route shadowing.** A collection route written `@router.get("/")` under
  `prefix="/api/workitems"` becomes `/api/workitems/` — a request to `/api/workitems` (no slash)
  falls through to the generic `/api/{slug}` records router → 404. **Fix:** use `@router.get("")` /
  `@router.post("")` for the bare-prefix collection routes (or the billing style: `prefix="/api"` +
  explicit `/workitems` path). Always register module routers BEFORE `records.router`.
- **`+` in datetime query params.** `datetime.isoformat()` → `...+00:00`; a raw `+` in a URL query
  string decodes to a space and fails ISO parsing (422). In tests/clients pass dates via httpx
  `params={...}` (auto-encoded), not f-string URLs. (Real frontends using URLSearchParams are fine.)
- **DELETE returns 204, not 200** — write the tests to expect 204.
- **You can't backdate via the API** (e.g. negative SLA minutes is rejected). To test time-based
  sweeps, open `app.db.SessionLocal`, mutate the row's timestamp, then call the sweep function directly.
- **Workers forget to register their router** in `main.py` — the contract is they REPORT it and the
  coordinator wires it; always double-check the include_router line is present + before records.

## Authorizations

`git push` and `alembic upgrade head` trip the safety classifier. Once Gev has clearly authorized
pushes/migrations for the session, just do them (don't re-ask each batch). The GAAex DB is the LOCAL
Docker Postgres on :5433 — not the cloud — so migrations are low-risk dev infra.

---
Memory pointer: [[gaaex-headless-orchestration]] (+ [[gaaex-parallel-windows]] marks the old
"separate windows" model as superseded).
