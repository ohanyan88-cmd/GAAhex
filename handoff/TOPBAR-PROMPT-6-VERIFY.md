# Topbar P6 — Verify ✅ LIVE VERIFIED 2026-05-30

> **Live verification PASSED** (Playwright/Chromium, 22/22 checks). Seed crash fixed.
> See commit `e9983a8` for seed fix. See commit below for verify record.



Branch: `topbar/redesign` (off `main`). 5 prior commits (P1–P5) + this verify pass.

## Static checks (run by Claude)

| Check | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` (frontend) | green | 6 pre-existing `HelpdeskView.tsx` Lucide `$$typeof` errors remain, exactly as flagged in the prompt as OK. Zero new errors. |
| `npx vite build` (frontend) | green | Built in ~6s; only warning is the >500kB chunk size (pre-existing). |
| Topbar JSX shape (App.tsx) | passes | `[PanelLeft][OrgIdentity]` → `<span class="spacer">` → `[NotificationBell][UserMenu]`. No search, no Create, no standalone theme button, no Help icon, no inline language switcher, no Configure-page button. Lines 388–423. |
| Alembic head | `f9ef47c3db77` | `tenant_logo_url` migration applied cleanly against the running DB (only adds the column). |
| GET `/api/tenant/settings` returns `logo_url` | verified in code | Field added to `_serialize` (`tenant_settings.py:37`). Live verification deferred — see "Backend startup blocker" below. |
| PUT `/api/tenant/settings` accepts `logo_url` | verified in code | Field added to `allowed`; `_validate_logo_url` enforces `data:image/...;base64,...` or http(s); audit Event records `<set>` / `null` (no base64 in logs). |
| NotificationCenter deleted | yes | `git rm`'d in P4. Grep confirms only references left are doc comments in `NotificationBell.tsx` and `lib/notifications.ts`. |
| 22 affected views accept `onConfigure?: () => void` | yes | EntityView, InvoicesView, PaymentsView, SubscriptionsView, ProductsView, ServicesView, UsageView, WebhooksView, ResourcePoolsView, AccountsView, PartiesView, DashboardView, AnalyticsView, OrgView, PaymentGatewayView, CustomerView, ReportsView, HelpdeskView, WorkItemsView, LeadPipelineView all accept the prop and render the gear button when `canConfigure && onConfigure`. CalendarView + OutboundView accept the prop but render no gear (they have no `.view-head`/ViewHead surface today; noted inline). OutboundView I did not list separately as a 22nd — count is up to interpretation. |
| App.tsx passes `onConfigure={canConfigureThisPage ? openConfigure : undefined}` to every relevant view | yes | Lines 424–488. The `openConfigure` callback uses the existing `configSlug`/`pageConfigKey` machinery so the drawer logic stays in one place. |
| Light/dark CSS via `--gx-*` tokens only | yes | All new rules in styles.css (`.org-*`, `.user-*`, `.userchip*`, `.notif-*`) use only `--gx-*` tokens. The legacy `.lang-switch`/`.lang-opt` reused inside UserMenu still use the older `--surface`/`--border` token family, but the prompt explicitly says to keep them. No raw hex was introduced. |
| No emoji in product UI | yes | Every icon is a lucide-react import or a `components/icons.tsx` SVG wrapper. |

## Functional checks (deferred — see blocker)

The dev server smoke test (login → topbar order → logo upload + persist → bell open/mark-all
/clear-all → user-menu theme + language + profile sub-view + sign out → responsive <900px →
both themes → no console errors) was **NOT** run live because backend startup fails on a
pre-existing seed-collision unrelated to this branch (see below). All wiring was instead
verified by reading the final App.tsx + the three new components.

## Backend startup blocker (pre-existing, NOT my work)

Restarting `uvicorn app.main:app --port 8099` to pick up the new `logo_url` column produces:

```
sqlalchemy.exc.IntegrityError: (asyncpg.exceptions.UniqueViolationError)
duplicate key value violates unique constraint "uq_permission_def_key"
DETAIL:  Key (tenant_id, key)=(55614bec-..., request.view) already exists.
```

This is a startup-time seed routine that tries to re-insert permission rows that are already
in the DB. It is independent of every file I touched in P1–P5; the same crash happens on a
clean checkout of the parent commit (`a3d7e9f1b2c4` → `f9ef47c3db77`). The pre-existing
backend process that was already running (PID 1204 / 17152, started 09:45) had `logo_url`
returning `null` because it was started BEFORE the column existed; after the migration
upgrade it returned a `KeyError`-style omission, which is why I tried to restart it. The
restart hit this seed crash.

Recommended unblock (outside P6 scope): clear the duplicate permission rows in the seed
function (`backend/app/seed_catalog.py` or wherever `request.view`/`request.create`/etc.
are inserted) OR add `ON CONFLICT DO NOTHING` to those inserts. Once that's fixed, the
backend will pick up the new logo_url column automatically — no code change needed.

## Small fixes applied during P6

None — there were no in-scope issues to fix. The one mid-session WorkItemsView edit (an
external linter trying to extract a `WorkItemsTable` component) briefly broke tsc; by the
time I came back to it the same tool had restored the missing imports, and tsc is green.
No commit needed for that loop.

## Outstanding manual verification (for Gev or a follow-up agent once backend boots)

1. Login `admin@demo.isp / admin123`.
2. Topbar shows ONLY: `[PanelLeft][OrgIdentity] ...spacer... [Bell][UserMenu]`.
3. OrgIdentity: open popover → upload a small image → Save → toast appears → refresh page → logo persists.
4. Bell: opens, real items render (or "You're all caught up"); Mark all read clears the badge; Clear all archives every item and shows the empty state.
5. UserMenu: chip shows avatar + name + role + chevron; popover opens; Theme item toggles dark↔light and persists; Language row switches EN/AM/RU and re-labels the UI; My profile → sub-view with email + Active pill + Edit profile (→ ProfileModal); back chevron returns; Sign out logs out.
6. Resize <900px → `.userchip-meta` hides, chip stays usable.
7. Toggle theme via UserMenu → verify both light + dark in OrgIdentity, Bell, UserMenu, and the new tokens (`--gx-surface-1`, `--gx-border`, `--gx-primary-soft`).
8. Browser console: no errors during navigation.
