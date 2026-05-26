# GAAex System Inventory — Beyond Components (~110 non-UI concerns)

The system layers around the components (see `COMPONENT-INVENTORY.md`). Per the source: **components
are ~25% of an enterprise design system** — this is the other ~75%. Status: ✅ have · 🟡 partial ·
⬜ not started. **This is a NORTH-STAR CHECKLIST, not a sprint backlog** (see "Honest read").

## A. Design-system governance
1.⬜ naming (`gx-*`) · 2.⬜ versioning/semver · 3.🟡 token JSON source-of-truth (we have CSS vars in
BRAND.md, not a JSON SoT/Figma export) · 4.⬜ Figma↔code parity · 5.⬜ status registry ·
6.⬜ visual-regression (Chromatic/Percy) · 7.⬜ Storybook · 8.⬜ do/don't guides · 9.⬜ WCAG 2.2 audit ·
10.⬜ contribution rules. **(Mostly team/process tooling — premature for now.)**

## B. Interaction & motion
11.⬜ easing curves · 12.⬜ duration tokens · 13.🟡 hover/focus timings (ad-hoc .12s) · 14.⬜ page
transitions · 15.⬜ modal/drawer enter/exit · 16.⬜ skeleton shimmer · 17.⬜ reduce-motion ·
18.⬜ drag-drop feedback · 19.⬜ optimistic UI · 20.⬜ error-shake/success-pulse.

## C. Content & voice
21.⬜ UI copy/tone · 22.⬜ microcopy lib · 23.🟡 empty-state copy (ad-hoc) · 24.⬜ error taxonomy ·
25.⬜ success taxonomy · 26.🟡 date/time rules (iso now, no rules) · 27.✅ number/currency (defaults
to AMD ֏) · 28.⬜ pluralization (hy+en) · 29.⬜ i18n key structure · 30.⬜ help-text style.

## D. Data & state patterns
31.🟡 loading hierarchy (ad-hoc) · 32.🟡 empty/null/error states · 33.⬜ pagination vs infinite ·
34.🟡 optimistic vs pessimistic (currently pessimistic) · 35.⬜ cache invalidation · 36.🟡 realtime
viz (notif poll) · 37.⬜ stale-data indicators · 38.⬜ conflict resolution · 39.⬜ undo/redo ·
40.⬜ bulk-op progress.

## E. Permission & role  — *strong at the kernel already*
41.✅ role matrix (super_admin/manager/sales_agent, configurable) · 42.✅ permission scopes
(`entity.verb` + node/subtree/tenant) · 43.⬜ field-level access · 44.🟡 action gating (backend 403;
Studio hidden for non-admins) · 45.⬜ read-only mode visuals · 46.🟡 approval UI (M12 in build) ·
47.✅ audit trail per record (`/history`, immutable Events) · 48.⬜ impersonation banner ·
49.⬜ 403/no-access screens (UI) · 50.⬜ tenant/scope switcher.

## F. Notifications & communication
51.✅ in-app center (inbox, unread, mark-all) · 52.⬜ email templates · 53.⬜ SMS · 54.⬜ push ·
55.⬜ preferences UI · 56.⬜ digest vs realtime · 57.⬜ @-mentions · 58.⬜ categories · 59.⬜ priority
levels · 60.⬜ snooze/mute/archive. **(52–54 = channel adapters, doc 24, later phase.)**

## G. Search & discovery
61.⬜ global search · 62.⬜ command palette (⌘K) · 63.🟡 saved searches (A4 building per-entity) ·
64.⬜ recent/pinned · 65.⬜ query builder · 66.⬜ result highlighting · 67.⬜ faceted filtering ·
68.⬜ suggestions · 69.⬜ cross-entity results · 70.⬜ search analytics.

## H. Reporting & export
71.⬜ report builder · 72.⬜ scheduled reports · 73.⬜ export CSV/XLSX/PDF/JSON · 74.⬜ print layouts ·
75.⬜ PDF branding · 76.⬜ dashboard sharing · 77.⬜ drill-down · 78.🟡 custom dashboards (config
boards exist backend; drag-builder ⬜) · 79.⬜ period comparison · 80.⬜ chart annotations.

## I. Onboarding & guidance
81.⬜ welcome flow · 82.⬜ empty-state CTAs · 83.⬜ coach marks · 84.⬜ inline help · 85.⬜ help center ·
86.⬜ video slots · 87.⬜ changelog · 88.⬜ feature flags UI · 89.🟡 sample-data mode (demo seed exists) ·
90.⬜ migration assistant.

## J. Operations & reliability
91.⬜ status/health page · 92.⬜ maintenance scheduler · 93.⬜ rate-limit visuals · 94.⬜ API key mgmt ·
95.⬜ webhook config · 96.⬜ job dashboard · 97.⬜ error monitoring · 98.⬜ perf budgets ·
99.⬜ responsive breakpoints · 100.⬜ offline sync. **(Backend/infra-heavy; mostly post-launch.)**

## K. Brand & marketing surface
101.🟡 logo variants (have full/icon, dark/light) · 102.⬜ marketing-site tokens · 103.🟡 auth screens
(login built) · 104.⬜ email signature · 105.⬜ OG/social images · 106.🟡 favicon set · 107.⬜ app icons ·
108.⬜ slide deck · 109.⬜ doc templates · 110.⬜ print collateral. **(102/104/105/108–110 = marketing
collateral, not the product — out of scope for the platform build.)**

---

## Honest read
- **Scale:** ~110 here + ~80 components ≈ **190 surface concerns**. That's a multi-year, multi-team
  enterprise platform — not a backlog to burn down. The real danger is treating it as a to-do list and
  **drowning before shipping anything an ISP can actually run on**.
- **Reframe:** treat this as a **north-star checklist**. Build the thin slice that lets a real ISP run
  Lead→Customer→Ticket day-to-day, ship it, then pull items off this list driven by real usage.
- **We're already strong where it counts (the kernel):** roles/scopes (E41–E42), audit (E47),
  notifications inbox (F51), saved search (G63, building), config dashboards (H78), AMD currency
  (C27). The thinness is **UI breadth + ops/governance**, not the engine.
- **Defer hard:** governance/process tooling (A2,A4–A10 — Storybook, Figma parity, visual regression,
  versioning — these matter when a *team* builds, not now); channel adapters (F52–54); marketing
  collateral (K102,104,105,108–110 — not product).
- **Gev's PRIORITY VERDICT is sound** — adopt its must-do-before-launch subset as the near-term law;
  everything else stays on this checklist. Map below.

## Must-do-before-launch (Gev's verdict) → where we are
- A1–A3 naming/version/token-SoT → ⬜ (do a light token-JSON SoT; skip heavy governance)
- B11–B13 motion tokens → ⬜ (small: add to BRAND.md/tokens)
- C21–C25 copy + error/success taxonomy → ⬜ (a short content doc)
- D31–D33 loading/empty/pagination → 🟡 (formalize the states + add pagination)
- E41–E45 roles/scopes/field-access/action-gating/read-only → ✅✅⬜🟡⬜ (UI for 43/45 mainly)
- F51 inbox → ✅
- G61–G62 global search + ⌘K → ⬜
- H73–H74 export + print → ⬜
- J91–J92 status + maintenance → ⬜

The launch-critical gap is modest and concrete; the rest is horizon.
