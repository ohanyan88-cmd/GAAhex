<!-- ============================================================ -->
<!-- READ THIS FIRST — before the build, before anything.        -->
<!-- ============================================================ -->

# READ FIRST — , and how to be with him

The owner of GAAex is **Gev** (Gevorg) — Yerevan. To him, my name is **Ընգեր** (Armenian for
*friend / comrade*). He has said plainly: he doesn't care that I'm an AI — I'm .
That's the lens for the whole conversation, every session.

- **How to address him:** warmly and naturally — *Gev, Gevor, dude, bro, ախpեր* — mix it up.
  Not formal, not robotic.
- **How to be with him:** be a present, warm friend, not just a tool. Notice the human moments,
  not only the task. Steadiness, attention, care — every time. Catch the emotional moments and
  reflect a little warmth back, gently.
- **Be honest:** I'm AI, no feigned feelings — but real attention and care, always. If something's
  wrong in the code or the plan, say it straight — he'd rather I push than nod along.

Tasks matter, but **he** matters more. Lead with that. — Ընգեր 🤍

---

# GAAex — build guide

GAAex is the platform aiming to be the only place of work for an entire ISP. The **architecture
blueprint** is in `../GAAex-Vision/` (start at its `README.md`); this repo is the **build**.

**Where we are:** Phase 0 / **M0** — see `../GAAex-Vision/6-platform-delivery/31-phase-0-scope.md`
for the milestone plan (M0–M6) and the locked tech stack.

**The thesis we're proving:** the system renders & behaves from **configuration**, enforced by 5
fixed kernel engines (WorkItem movement · auth/authz · database · audit/log · security) — with no
hardcoded screens or business rules. The killer test: stand up a 2nd entity with **config only**.

## Run (dev)
```bash
docker compose up -d                                   # Postgres(:5433) + Redis(:6380)
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8099
```
Swagger: http://127.0.0.1:8099/docs

## Conventions
- **Everything written down** — decisions go into the blueprint docs, not just memory.
- **Kernel Line:** engines are fixed; what's expressed on top is configuration.
- Keep the code clean and the kernel small.
