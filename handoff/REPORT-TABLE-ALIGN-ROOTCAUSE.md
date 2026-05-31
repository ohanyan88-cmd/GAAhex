# Table Alignment — REAL Root-Cause Fix (supersedes 033f672)

**Branch:** main · **Commit:** `b53fbab` · **Date:** 2026-05-31

> The earlier fix (commit `033f672`) corrected an EntityView cell-count mismatch but missed the actual root cause. The alignment bug persisted on Invoices and most list pages. Gev observed: "STATUS and AMOUNT headers do not sit over their columns — the headers are compressed to the left while the body spans full width." This report documents the real fix.

---

## Root cause (what the previous agent missed)

**Tailwind's `.grid` utility was overriding the table's `display: table` UA default.**

The CSS chain:
- HTML: `<table className="grid">` — relies on `<table>` defaulting to `display: table`
- Tailwind utilities load with `.grid { display: grid; }` at specificity (0,1,0)
- The browser's UA stylesheet sets `table { display: table; }` at specificity (0,0,0)
- Tailwind wins → every `<table className="grid">` was actually rendering as a CSS grid container

Once the `<table>` was a grid container, `<thead>` and `<tbody>` resolved to `display: block`, and the header row computed its width INDEPENDENTLY from the body row. On Invoices: **header row was 452px wide, body row was 815px wide** — same DOM table, two completely different layout boxes.

That's why AMOUNT/STATUS headers were compressed to the left while ֏ values + Pay-online buttons sprawled right. The cell counts matched perfectly; the **layout mode** did not.

The previous fix (skipping `cols[1]` in EntityView, deleting the legacy `.grid` block) only addressed EntityView's KIND-column duplication. The display-mode collision was untouched.

---

## The fix

**File:** `frontend/src/styles/styles.css` at `table.grid` (line ~1806)

```css
table.grid {
  display: table;                     /* defeat Tailwind .grid utility — selector specificity (0,1,1) beats (0,1,0) */
  table-layout: fixed;                /* column widths from header row, not content */
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
table.grid thead { display: table-header-group; }
table.grid tbody { display: table-row-group; }
table.grid tr    { display: table-row; }
table.grid th, table.grid td { display: table-cell; }

table.grid th.sel-col,
table.grid td.sel-col      { width: 40px; }
table.grid th.actions-col,
table.grid td.actions-col  { width: 200px; overflow: visible; }
```

Defense-in-depth: explicit `display: table-*` on every descendant so no future utility can break the table model.

**Then** `actions-col` class was applied to every trailing action `<th>` and `<td>` across 15 view files, 3 components, and 9 Studio panes (27 files total). Same for `sel-col` on leading checkbox cells.

---

## Verification

### Pixel-level bounds check (10/10 PASS — every `<th>` ↔ first-row `<td>` within 2px)

| Page | Theme | Result |
|---|---|---|
| Invoices | light | ✅ ALL ALIGNED |
| Invoices | dark | ✅ ALL ALIGNED |
| Customers | light | ✅ ALL ALIGNED |
| Customers | dark | ✅ ALL ALIGNED |
| Orders | light | ✅ ALL ALIGNED |
| Orders | dark | ✅ ALL ALIGNED |
| Subscriptions | light | ✅ ALL ALIGNED |
| Subscriptions | dark | ✅ ALL ALIGNED |
| Helpdesk | light | ✅ ALL ALIGNED |
| Helpdesk | dark | ✅ ALL ALIGNED |

Sample (Invoices light): every `th_left == td_left` and `th_right == td_right` to the pixel; AMOUNT spans 1060–1214px, ACTIONS spans 1214–1414px.

### The single-bar test Gev demanded

`screenshots/align_proof_amount_over_money.png` — tight crop showing the "AMOUNT" header text sitting directly above the column of `15,000 ֏`, `15,000 ֏`, `600 ֏`, `9,900 ֏`, `9,900 ֏`, `0 ֏`. **Visually confirmed.**

Plus 8 before/after screenshots (Invoices + Customers × light/dark × before/after) in `screenshots/align_real_*.png`.

---

## Files modified (27)

**CSS (root-cause fix):**
- `frontend/src/styles/styles.css`

**Views (15):**
- InvoicesView · EntityView · CustomerView · HelpdeskView · OrdersView · PartiesView · PaymentGatewayView · ProductsView · ResourcePoolsView · ServicesView · SubscriptionsView · UsageView · WebhooksView · MyApprovalsView

**Components/Modals (3):**
- WorkItemsTable · CustomerBillingModal · ReportSchedulePanel

**Studio (9):**
- AutomationsPane · DashboardsPane · FieldsPane · ReportsPane · RolesPane · StudioRichPanes · UsersPane · ViewsPane · WorkflowsPane

## Files intentionally NOT modified (with reason)

- AccountsView, PaymentsView, InteractionsView, DashboardView (tickets widget), SavedViewsView, WebhooksView Deliveries table, Permissions matrix / Field-Schema preview / Feature flags tables, CustomerBillingModal sub-tables (Accounts / Recent invoices / Payments / Services) — **no actions-col or sel-col exists**; header and body cell counts already match; `table-layout: fixed` now distributes data columns evenly.
- `frontend-portal/` (legacy alt frontend) — not the live app per CLAUDE.md.

---

## Doctrine compliance

- ✅ Real root-cause fix, not a per-view band-aid
- ✅ DELETE old code, don't layer — the previous EntityView `cols[1]` skip from commit `033f672` remains valid (it was a separate, legitimate cell-count bug); the new CSS supersedes the legacy `.grid` cascade without leaving dead rules
- ✅ Single column system — one `<table>` with `table-layout: fixed` for header AND body
- ✅ Light + dark verified
- ✅ Pixel-level bounds proof (not just visual eyeballing)
- ✅ The single-bar test (AMOUNT-over-money) passes visibly

---

## Commit

| Hash | Message |
|---|---|
| `b53fbab` | fix(tables): table-layout:fixed + actions-col/sel-col widths — real alignment across all .grid tables |

Pushed to `origin/main`.

---

## Artifact list

- `verify_align_proof.js` — Playwright bounds-checker (Node script; pass `before` or `after` as argv to label outputs)
- `screenshots/align_real_before_invoices_light.png` + `_dark.png`
- `screenshots/align_real_before_customers_light.png` + `_dark.png`
- `screenshots/align_real_after_invoices_light.png` + `_dark.png`
- `screenshots/align_real_after_customers_light.png` + `_dark.png`
- `screenshots/align_proof_amount_over_money.png` — **the single-bar Gev-proof**
