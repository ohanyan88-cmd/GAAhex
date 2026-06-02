---
name: gaahex-design
description: Use this skill to generate well-branded interfaces and assets for GAAhex — the multi-tenant, config-driven operations platform for ISPs — either for production or throwaway prototypes/mocks. Contains essential design guidelines, colors, type, fonts, logo assets, and a full UI kit of console components (sidebar, top bar, KPI tiles, data tables, status pills, Studio).
user-invocable: true
---

Read the `README.md` file in this skill first — it covers GAAhex's product context, content voice,
visual foundations (Cobalt & Gold), iconography, and a manifest of every file here.

**Core tokens:** `colors_and_type.css` (primitives → semantic → component, light + dark). Always link
it and set `data-theme="dark"` (or `"light"`) on `<html>`. Use semantic tokens (`var(--gx-primary)`,
`var(--gx-surface)`, ISP status like `var(--gx-online)`) — never raw primitives.

**The brand in one line:** cobalt = structure, azure = action, gold = prestige (sparing), slate =
everything else. Display type is Space Grotesk; UI is IBM Plex Sans; data/IP/MAC/IDs are IBM Plex
Mono. Icons are Lucide (2px stroke). No emoji in product UI. Remember GAAhex is config-driven —
**Studio** is the heart; every screen is rendered from config, so surface a "Configure page" path.

**Components:** `ui_kits/portal/` is a working console. Copy `app.css` + the `.jsx` components, or
lift patterns from them.

If creating visual artifacts (slides, mocks, throwaway prototypes), copy assets out of `assets/` and
produce static HTML files for the user to view. If working on production code, copy assets and read
the rules here to design as an expert in this brand.

If the user invokes this skill without other guidance, ask what they want to build, ask a few
focused questions, then act as an expert designer who outputs HTML artifacts **or** production code.
