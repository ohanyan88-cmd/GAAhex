# GAAhex Portal — UI kit

A high-fidelity, interactive recreation of the **GAAhex operations console** in the new
*Cobalt & Gold* design language. This is the platform's single product surface — a multi-tenant,
config-driven workspace for an entire ISP.

> **Faithful, not invented.** Navigation mirrors the real `nav-config.ts` (18 modules), and Studio
> mirrors `StudioView.tsx`. Where the real app shows a config-driven stub for an unbuilt entity, this
> kit does too — nothing fictional is added.

## Run
Open `index.html`. It's a click-through prototype:
1. **Login** → brand split-screen, SSO option.
2. **Operations Dashboard** → KPI tiles (Space Grotesk numerals), revenue/churn chart, activity feed,
   attention tickets.
3. **Work Items** → dense data table ↔ kanban board toggle, SLA timers, priority pills.
4. **Studio** (the heart) → Schema · UI · Logic · Tenant. Build an entity as config and watch the
   **live preview** render the form + list view. The **Appearance** pane lets you set the tenant's
   **button/accent color, radius, density and theme** with an instant component preview.
5. ⌘K / Ctrl-K → command palette. Top-bar sun/moon → light ↔ dark. Sidebar toggle → collapse.
6. Every view header has **Configure page** → jumps to Studio (because every screen is config).

## Files
| File | What |
|---|---|
| `index.html` | App shell, routing, theme + command-palette state |
| `app.css` | All kit styles (pairs with `../../colors_and_type.css`) |
| `data.jsx` | `Icon` (Lucide wrapper) · `NAV` (18 modules) · mock KPIs / tickets / activity |
| `Shell.jsx` | `Sidebar` (collapsible module nav, gold active rail) · `TopBar` |
| `Login.jsx` | `Login` · `CommandPalette` |
| `Views.jsx` | `ViewHead` · `Dashboard` · `WorkItems` (table + board) · `Stub` |
| `Studio.jsx` | `Studio` · `EntityBuilder` (live preview) · `AppearancePane` (design surface) |

## Composing screens
Components export to `window` (Babel scope rule). Lift the shell (`Sidebar` + `TopBar`), drop any
view into `.view`, and reuse `.btn` / `.inp` / `.pill` / `.kpi` / `table.grid` classes from
`app.css`. Use **semantic tokens** so both themes work. Reserve **gold** for prestige/active; use
**azure** for anything interactive.

## Caveats
- Data is illustrative. In the real product every screen renders from `studio_config`.
- Icons are Lucide (CDN), stroke-identical to the in-repo `icons.tsx` set.
