# SPEC §1 Nav Registry — PREPARE (awaiting ⛔ Gev approval)

Step 7 of the SPEC build. **PREPARE only** — model + migration FILE + seed + read-only router
are written, but nothing activates until Gev replies `approved §1 nav`.

## What's in this PR

| File | Purpose |
|---|---|
| `backend/app/models/nav_module.py` | `NavGroup` + `NavModule` ORM models |
| `backend/alembic/versions/19f9f4bd6599_nav_registry.py` | Migration FILE — creates both tables + RLS policies. **NOT applied to live DB.** |
| `backend/app/seed_nav_registry.py` | Idempotent seeder for the 9 groups × 75 modules per tenant |
| `backend/app/routers/nav_registry.py` | Read-only `GET /api/nav` returning the nav tree. **NOT mounted in `main.py`.** |
| `backend/app/main.py` | Adds commented-out import + seeder call + `include_router` (all gated on Gev approval) |

### Counts in the seed (`SPEC_NAV_STRUCTURE`)

| Group | Modules |
|---|---|
| Workspace | 11 |
| Work Management | 3 |
| CRM & Commercial | 6 |
| Billing & Revenue | 7 |
| Network & Operations | 14 |
| Analytics & AI | 4 |
| Enterprise | 6 |
| System | 5 |
| Studio | 15 |
| **Total** | **9 groups × 71 modules** |

## SPEC §1 compliance audit

| Required by SPEC | Where enforced | Status |
|---|---|---|
| Orders & Validation under **Billing & Revenue** (NOT CRM) | seed row `orders_validation` in group `billing_revenue` at order=3, placement='O', owns `['order']` | OK |
| Contracts is its own CRM module | seed row `contracts` in group `crm` at order=2, placement='O', owns `['contract']` | OK |
| KB / Announcements / Communications / Calendar under Workspace with `[O]` flag | rows `knowledge_base`, `announcements`, `communications`, `calendar` in `workspace`, all placement='O' with their respective `owner_record_keys` | OK |
| Workspace owns nothing | group `workspace` itself has no `owner_record_keys` field; hub modules (`home`, `my_work`, `global_search`, `activity_feed`, `saved_views`, `recent_items`, `team_workspace`) are placement='V'. The [O] modules inside Workspace own their OWN records — Workspace as a group does not | OK |
| Studio is first-class top-level (NOT under System) | group `studio` is its own top-level group at `group_order=9`, separate from `system` (order=8) | OK |

## RLS

Both tables get the standard NULLIF-guarded `tenant_isolation` policy (same shape as
`region`, `approval`, `portal_ticket_reply`, ...):

```sql
USING      (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
```

`nav_module.owner_module` is mirrored from `key` and carries an index
(`ix_nav_module_owner_module`) so future "which module owns entity X?" lookups can match
the SPEC §2.2 ownership-matrix vocabulary symmetrically with `entity_def.owner_module`.

## Manual follow-ups (this PR DOES NOT touch)

- `backend/app/models/__init__.py` — needs `NavGroup` + `NavModule` added to the import
  block + `__all__`. **Not edited here** to avoid colliding with the KPI agent who may be
  touching the same file in parallel. Add after merge:

  ```python
  from .nav_module import NavGroup, NavModule
  # __all__:
  "NavGroup", "NavModule",
  ```

  Until that's done, the models are still registered with the metadata when
  `app/seed_nav_registry.py` (or `app/routers/nav_registry.py`) is imported — the import
  in `__init__.py` is just the canonical re-export surface.

## ⛔ AWAITING APPROVAL TO:

1. **Apply the migration to live DB** (after backup, per Gev's HDD-backup rule).
   `alembic upgrade head` will pick up `19f9f4bd6599` automatically.
2. **Uncomment the lifespan seeder call** (`await seed_nav_registry_if_empty()` in
   `app/main.py`) plus its `from .seed_nav_registry import …` line.
3. **Uncomment the router mount** (`app.include_router(nav_registry.router)` in
   `app/main.py`) plus its import.
4. **Wire the frontend** to consume `GET /api/nav` (separate Portal work).

Reply `approved §1 nav` to proceed.
