# Answers to your scoping questions — Leads page redesign

Paste these alongside the brief (`LEADS-PAGE-REDESIGN-BRIEF.md`) and the source files.

1. **Deliverable form.** An **interactive prototype** (clickable HTML/React I can open in a browser and
   click through), ending in liftable code. I want to *review the working prototype first*, then take
   the code.

2. **How many overall page concepts.** **Two** distinct top-to-bottom directions. Develop the stronger
   one a bit further; don't dilute into many half-concepts.

3. **How adventurous.** **Moderate / evolutionary-plus.** Push layout, hierarchy, density, and
   scannability hard — but stay **strictly inside the `--gx-*` tokens and the PageShell 6-zone frame**.
   No brand/logo/typography changes. Rethink the *page*, not the *system*.

4. **Lead-card variations.** **2–3.** The card is shared by **Kanban and Cards**, so each variation must
   read well **both** in a narrow kanban column **and** in a wider cards-grid cell. Vary
   density/hierarchy (e.g. contact-first vs. status-first), not gimmicks.

5. **Table-view variations.** **2.** e.g. (a) classic dense rows, vs. (b) a slightly richer row with
   inline primary contact + a clear stage pill + quick row actions. Borderless rows, rounded outer
   frame (current direction), header that does **not** overlap content on scroll.

6. **Aspects to push on** (all of these): **triage speed / scannability**, **information hierarchy &
   density**, **lifecycle-stage clarity** (the StatusPill stages), and **prominence of the primary
   actions** (Search · Download · **+ New Lead**, incl. the one-click contract). Responsive behavior
   matters too (kanban "fill" board; cards grid reflow).

7. **App chrome.** **Page alone**, but wrap it in a *lightly mocked* dark topbar + left sidebar rail so
   proportions and contrast read true. **Don't design the chrome** — it already exists.

8. **Sample data — HouseNet flavored (~20–30 leads):**
   - Armenian names (e.g. Արամ Հակոբյան, Նարե Գրիգորյան, Davit Sargsyan…), mixed **residential +
     business**.
   - Yerevan addresses (Բաղրամյան, Կոմիտաս, Մաշտոցի, Արաբկիր…), apt/building numbers.
   - Phones in **+374 XX XXXXXX** format; realistic emails; AM document numbers (e.g. `AN1234567`).
   - Service interest = **internet/IPTV** plans (e.g. 50 / 100 / 300 Mbps; IPTV bundles).
   - Spread leads across the **5 lead stages**: `lead → validated_lead → assigned → deal →
     contract_signed` (so Kanban columns and stage pills are populated realistically).

9. **Hero / default view.** **Table** — it's the triage/inbox default (scan, sort, act in bulk).

10. **Tweaks panel toggles:** view mode (Table/Kanban/Cards), **density** (comfortable/compact),
    **light/dark** theme (must flip cleanly via tokens), visible field set on row/card, number of leads,
    and locale (EN/HY) if cheap. Goal: let me stress-test the design live.

11. **New tokens.** **Yes, allowed — if flagged.** Default to existing `--gx-*` tokens first; if you
    truly need a new one, list it separately with the proposed value + one-line rationale so we can
    approve it. **Never** hardcode a raw hex/px.

12. **Pain points & must-keeps.**
    - **Must keep:** the **3 view modes**; Search + Download + **+ New Lead** in the **header next to the
      title**; the **one-click HouseNet contract `.docx`** generation inside the New-Lead flow; the
      **20-most-recent default**; **LEADS-ONLY** scope; responsive **kanban "fill"** board; **borderless
      table with rounded frame**; **StatusPill** stages; full keyboard accessibility (real `<button>`s,
      focus states, aria labels).
    - **Lessons already learned (don't repeat):** the table header must **not** be sticky in a way that
      overlaps text on scroll (this bit us before); text must never spill past UI clip edges; controls
      were unified to **"md"** size; the KPI band needs a clean divider + symmetric spacing; dark-first,
      but everything must flip to light through tokens.
    - **Do NOT reintroduce:** the lifecycle **control-gates** (they moved to the Pipeline page) or any
      **order/customer** rows — this page is leads only.
