# PHASE 2 RESUME — read before continuing / կարդա շարունակելուց առաջ

## Rules (corrected)
EN:
- NO parallel agent bursts. Work SEQUENTIAL — one cluster: build → token-audit → gate → then next. (Parallel bursts trip the per-minute rate ceiling even with plan budget left.)
- Token audit: every new --gx-* token in _workspace.css MUST exist in gaahex-tokens.css, BOTH dark+light value-maps. Grep each. Missing → define in token source, never inline.
- Finish i18n leaf keys AM/EN/RU. Chrome trilingual; seeded data English + marked in sample[] for Phase 3.
- Gate before commit: tsc=0 + vitest + lint + format. Render-check dark AND light.
- Cleanup-on-sight · verify-before-delete (grep+tsc+test before AND after) · ZERO duplicates. Push held.

HY:
- ՈՉ parallel agent։ SEQUENTIAL — մի cluster՝ build → token-audit → gate → հետո մյուսը։
- Token audit՝ ամեն նոր --gx-* token gaahex-tokens.css-ում, ԵՐԿՈՒ mode-ով։ Grep։ Չկա → սահմանիր source-ում, ոչ inline։
- i18n leaf keys AM/EN/RU։ Chrome եռալեզու; seeded data՝ English + sample[]-ում marked, Phase 3-ի։
- Gate commit-ից առաջ՝ tsc=0 + vitest + lint + format։ Render dark ԵՎ light։
- Cleanup-on-sight · verify-before-delete · ZERO duplicate։ Push պահված։

## Locked Q-answers
Q1 HomeView: redesign body → gx-WorkspaceGrid; verify comms in header → delete duplicate tabs (verify-before-delete).
Q2 Data: contract-true seeded GET /api/workspace?role=, ONE fetch; sample marked + logged for Phase 3 live-swap.
Q3 Roles: ship Sales Agent full, grid role-config-driven for the other 5; defer Dispatcher+Ops-Mgr role-defs, log in DECISIONS.
