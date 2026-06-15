# GAAhex — Decision Log / Որոշումների մատյան

> **EN:** The running, append-only record of material project decisions — one line per
> decision, newest at the bottom. Format: `YYYY-MM-DD · <area> · <decision> → <rationale>`.
> This is the audit trail of *what was decided and why*; the binding law lives in
> `PROJECT_CONSTITUTION.md` and the standards. A decision here may not contradict a
> higher governance layer (LAW-ST1) — if it would, the higher layer wins and this log
> records the conflict, not an override.
>
> **HY:** Նախագծի էական որոշումների ընթացիկ, միայն-ավելացվող մատյանը — մեկ տող մեկ
> որոշում, ամենանորը՝ ներքևում։ Ձևաչափ՝ `ՏԱՐԵԹԻՎ · <ոլորտ> · <որոշում> → <պատճառ>`։
> Սա *ինչ որոշվեց և ինչու*-ի audit trail-ն է. կապող օրենքը՝ `PROJECT_CONSTITUTION.md`-ում
> ու standard-ներում։ Այստեղի որոշումը չի կարող հակասել ավելի բարձր governance շերտին
> (LAW-ST1) — հակասելու դեպքում բարձր շերտը հաղթում է, ու մատյանը գրանցում է կոնֆլիկտը,
> ոչ թե override։

**Position:** Below the Constitution, PRM, Architecture and Standards. Append-only.

---

## Decisions

2026-06-15 · ML · start → AUDIT FIRST (characterize existing AI/ML surfaces real/heuristic/stub before any make-real or new-build; separate track from Ph4–6).
2026-06-15 · ML · audit RESULT → 0 trained models, 0 fantasy. "AI" = 1 transparent heuristic (lead score) + a real-but-dormant LLM gateway (stub→real on key). Churn/RA-"anomaly" are deterministic SQL, correctly named. Lead-scorer STAYS heuristic (weights data-tunable later); the 6 ML methods are a future toolbox, not a now-build. Full record: Bro sealed memory ml-audit.
2026-06-15 · ML/AI · provider enablement = data-governance GATE → free-tier LLM allowed ONLY on TEST/demo orgs (synthetic data, zero PII); NEVER pointed at live customer PII until provider data-use terms are confirmed (no-training + residency) or a no-train/paid key is used. Enable via gitignored backend/.env (AI_PROVIDER + AI_API_KEY); ships OFF by default (ai_provider="none"). Real provider path validated deterministically in tests/test_ai.py before any live key lands.
2026-06-15 · UI/Ph4 · §1 shell EXEMPTION → the Studio module (`studio/StudioShell.tsx` + its panes) is exempt from the PageShell §1 requirement. Justification: Studio is a superadmin-only, IDE-like meta-configuration workspace (entity/field designer, workflows, webhooks, notifications config) with its own left config-tree + pane navigation model — not a business data page with KPIs/registry/actions. Forcing PageShell would break the IDE layout for zero user benefit. Exemption is CONFINED to `studio/`; every consumer-facing page still uses PageShell. (Note: `primitives/StudioDrawer` is NOT exempt — it already sits on the shared Overlay primitive.)
