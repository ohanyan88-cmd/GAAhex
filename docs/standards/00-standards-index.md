# 00 — Canonical Standards Index

> **Position in the architecture hierarchy (locked 2026-06-06):** these standards live *under*
> the **Architecture Constitution** at `docs/architecture/`:
>
> 1. `PLATFORM_REFERENCE_MODEL.md` — the constitutional definition of the 51 cores and 7 platform tiers.
> 2. The **22 Architecture Constitution documents** at `docs/architecture/01_*.md` through `22_*.md`,
>    indexed by `docs/architecture/00_ARCHITECTURE_INDEX.md`.
>
> The PRM defines *what cores exist and their ownership boundaries*. The 22 architecture documents
> define *the laws that govern each architectural viewpoint*. These 70 standards below define
> *how each core's entities, APIs, UI, lifecycle, and security behave at implementation level*.
> Architecture overrides Standards; Standards override Modules; Modules override Pages; Pages override
> Components; Components override Implementation. No implementation, no standard, and no module
> design may contradict the Architecture Constitution. See
> `docs/architecture/00_ARCHITECTURE_INDEX.md` for the constitution entry point and
> `docs/architecture/PRM-MIGRATION-AUDIT-2026-06-06.md` for the full classification audit.

LOCKED. Standard **name** is immutable identity. **Number** is display order only and
is never used as a business value, key, or reference. No duplicate numbers exist.

Legend — Status: `LOCKED` = full text present and patched. `LOCKED / SOURCE NOT PROVIDED`
= referenced as locked by other standards but source text not supplied to this patch.

| # | Standard | Status | Source file | Key dependencies |
|---|----------|--------|-------------|------------------|
| 1 | Strategic Product Direction | LOCKED | 01 | (parent of all) |
| 2 | Global Status | LOCKED | 16 | Enum |
| 3 | Department Ownership | LOCKED | 02 | Assignment |
| 4 | Assignment | LOCKED | 02 | Department Ownership, Queue |
| 5 | Queue Ownership | LOCKED | 02 | Assignment, Escalation |
| 6 | Escalation | LOCKED | 02 | Queue, Notification |
| 7 | Approval Ownership | LOCKED | 02 | Audit, Event System |
| 8 | ID | LOCKED | 03 | (foundational) |
| 9 | Reference Number | LOCKED | 03 | ID |
| 10 | Naming | LOCKED | 03 | Enum |
| 11 | Enum | LOCKED | 03 | Naming, Localization |
| 12 | Audit | LOCKED | 04 | Event System, ActorType |
| 13 | Activity Timeline | LOCKED | 04 | Event System, Audit |
| 14 | Comment | LOCKED | 04 | Audit, Timeline, Attachment |
| 15 | Attachment | LOCKED | 04 | Audit, Timeline, Security |
| 16 | Task | LOCKED | 05 | Assignment, Audit, Timeline, Watcher, Notification |
| 17 | Watcher / Subscriber | LOCKED | 05 | Notification, Audit |
| 18 | Notification | LOCKED | 05 | Watcher, Event System |
| 19 | Event System | LOCKED | 06 | ID, Audit, Timeline, ActorType |
| 20 | Automation | LOCKED | 18 | Event System, Workflow |
| 21 | Integration | LOCKED | 19 | Event System, Security, Multi-Tenant |
| 22 | Security & Permission | LOCKED | 17 | Multi-Tenant, RBAC (supersedes file 12 notes) |
| 23 | Data Validation | LOCKED | 20 | Enum, Security, Global Status |
| 24 | Search & Filter | LOCKED | 21 | Security, Multi-Tenant |
| 25 | Reporting & Analytics | LOCKED | 08 | Security, Event System, Multi-Tenant |
| 26 | Import / Export | LOCKED | 08 | Data Validation, Security, Attachment |
| 27 | Multi-Tenant | LOCKED | 08 | Security (applies everywhere) |
| 28 | Localization | LOCKED | 08 | Enum, Naming |
| 29 | Configuration | LOCKED | 08 | Security, Audit, Feature Flag |
| 30 | Feature Flag | LOCKED | 08 | Configuration, Security, Multi-Tenant |
| 31 | Navigation (base + locked tree) | LOCKED | 22 | Security, Feature Flag, Ownership |
| 32 | PageShell | LOCKED | 10 | Universal Page |
| 33 | Universal Page | LOCKED | 10 | PageShell, Page Type |
| 34 | Page Type | LOCKED | 10 | Universal Page, Tabs |
| 35 | Object Detail | LOCKED | 10 | Tabs, Timeline |
| 36 | Button | LOCKED | 09 | Security, Color |
| 37 | Badge | LOCKED | 09 | Enum, Color |
| 38 | Chip | LOCKED | 09 | Enum, Security |
| 39 | Form | LOCKED | 09 | Data Validation, Security |
| 40 | Table | LOCKED | 09 | Search/Filter, Security, Import/Export, Badge |
| 41 | Modal | LOCKED | 09 | Button, Object Editing |
| 42 | Toast / Alert | LOCKED | 09 | Audit, Event System |
| 43 | Empty State | LOCKED | 09 | Feature Flag, Security |
| 44 | Card | LOCKED | 09 | Reporting, Color |
| 45 | Tabs | LOCKED | 09 | Object Detail, Security |
| 46 | Icon | LOCKED | 09 | Color |
| 47 | Color | LOCKED | 09 | (tokens) |
| 48 | Spacing | LOCKED | 09 | PageShell |
| 49 | Typography | LOCKED | 09 | Localization |
| 50 | Device Strategy | LOCKED | 10 | PageShell, Drawer, Table |
| 51 | Interface Density | LOCKED | 10 | Layout Grid, Table, Spacing |
| 52 | Object Editing | LOCKED | 10 | Drawer, Modal, Form |
| 53 | Layout Grid | LOCKED | 10 | Device, Density, Spacing |
| 54 | Left Navigation | LOCKED | 10 | Navigation (tree), Security, Feature Flag |
| 55 | Header / Top Bar | LOCKED | 10 | Button, Action Menu, Badge |
| 56 | Drawer | LOCKED | 10 | Object Editing, Form, Audit |
| 57 | Action Menu | LOCKED | 10 | Button, Security, Audit |
| 58 | Pagination | LOCKED | 10 | Table, Search/Filter, Security |
| 59 | Loading / Skeleton | LOCKED | 10 | Button, Table, Drawer |
| 60 | Customer Lifecycle & Pipeline Page Behavior | LOCKED | 11 | Page Type, Tabs, Workflow Engine |
| 61 | Workflow Engine | LOCKED | 12 | Event System, Approval, SLA |
| 62 | Relationship / Entity Link | LOCKED | 12 | ID, Reference Number, Enum |
| 63 | Deletion / Archive / Restore | LOCKED | 12 | Audit, Retention, Relationship |
| 64 | SLA | LOCKED | 12 | Workflow, Escalation, Watcher |
| 65 | Customer Communication | LOCKED | 12 | Notification, Relationship |
| 66 | API | LOCKED | 12 | Security, RBAC, Webhook |
| 67 | RBAC / Permission Model | LOCKED | 12 | Security, Multi-Tenant, Watcher |
| 68 | Background Job | LOCKED | 12 | Event System, Integration |
| 69 | Data Retention | LOCKED | 12 | Audit, Deletion, Attachment |
| 70 | Webhook | LOCKED | 12 | Event System, API, Background Job |

## Collision resolutions (S1)

- Former `17 / 17` collision (Event System vs Notification) resolved: Notification = 18,
  Event System = 19. Both name-keyed; numbers are ordering only.
- Former `22 vs 28` count mismatch resolved: a single contiguous sequence (1–70) with no
  gaps and no duplicates. The seven former `SOURCE NOT PROVIDED` entries (Global Status,
  Security & Permission, Automation, Integration, Data Validation, Search & Filter, Navigation
  base) are now written code-accurate as files 16–22. Zero placeholders remain.

## Canonical cross-cutting enums (defined once in file 03)

**ObjectType / EntityType (D3)** — 40-value superset used by Audit, Timeline, Watcher,
Relationship, Attachment owner, Communication, Export. Audit's former 13-value subset is replaced.

**ActorType (B3 / D5 — performer axis):** `USER, SYSTEM, AUTOMATION, INTEGRATION, API, CUSTOMER`.

**PrincipalType (D5 / D12 — referenced-principal axis):** `EMPLOYEE, ROLE, DEPARTMENT, TEAM,
QUEUE`. Per-context subsets in file 03. `USER` (ActorType) ≠ `EMPLOYEE` (PrincipalType).

## Registries
- File 14 — `14-enum-registry.md`: every enum with owner department + values (Enum Standard r6/r8).
- File 15 — `15-permission-registry.md`: all `object.action` permission keys (lowercase, dot-separated; RBAC Standard, D2).
- `RLS_EXEMPTION_REGISTRY.md` — append-only RLS exemption registry. Governed by `RLS_EXEMPTION_POLICY.md`. Initialized empty 2026-06-05.
- `docs/branding/v3.0/` — **Brand v3.0 (LOCKED 2026-06-06)** — certified canonical brand package (logo · color · typography · voice · governance · trademark). D18 Color Architecture authoritative. Entry: `docs/branding/v3.0/README.md`. Pointer: `docs/branding/README.md`. Original zip: `D:\GAAhex-Brand-v3.0-Final (1).zip` (sha256 `fc06401997…d46f80dfa`).

## Operational standards (named, alongside the numbered 1–70)

These standards are LOCKED but live as named files rather than in the numbered 1–70 sequence (which is fixed by the original architecture). New operational standards land here when they need standards-level discoverability without disturbing the numbered sequence.

| Standard | Status | Source file | Governs |
|---|---|---|---|
| API Client | LOCKED | `API_CLIENT_STANDARD.md` | `bget` / `bpost` wrappers, 401 handling, `authH` single export |
| Auth Context | LOCKED | `AUTH_CONTEXT_STANDARD.md` | `AuthContext` usage, token persistence |
| Server State | LOCKED | `SERVER_STATE_STANDARD.md` | `useFetch` / react-query pattern, deprecated `alive` guard |
| UI Primitives | LOCKED | `UI_PRIMITIVES_STANDARD.md` | Which primitives exist, when to use each |
| Token Migration | LOCKED | `TOKEN_MIGRATION_STANDARD.md` | Token adoption checklist for new views and components |
| OpenAPI Codegen | LOCKED | `OPENAPI_CODEGEN_STANDARD.md` | Generated client conventions |
| Governance | LOCKED | `GOVERNANCE_STANDARD.md` | Drift rules, ratchet philosophy, standards-doc lifecycle |
| **RLS Exemption Policy** | **LOCKED** (2026-06-05) | `RLS_EXEMPTION_POLICY.md` | What an engineer does when an RLS gap surfaces (Fix Forward default; exemption rare, gated by sealed-baseline signoff). Companion: `RLS_EXEMPTION_REGISTRY.md`. |
| **Feature Gating Policy** | **LOCKED** (2026-06-05) | `FEATURE_GATING_POLICY.md` | Locks the two-system distinction: deploy-shape gates (`feature_gate.py`) are platform-wide for technical availability; tenant feature flags (`FeatureFlag` table) are per-tenant for business preferences. Each tenant decides its business features independently. |

## Reference prefix registry (S5 + D8 — complete)
```
CUS=Customer  LED=Lead  EMP=Employee  ROL=Role  DEP=Department  TEM=Team  QUE=Queue
TKT=Ticket  TSK=Task  INV=Invoice  PAY=Payment  CNT=Contract  ORD=Order  APP=Approval
PRJ=Project  AST=Asset  SVC=Service  SUB=Subscription  NDV=Network Device  SIT=Site
LOC=Location  VEN=Vendor  PUR=Purchase Order  KBA=Knowledge Article  CHG=Change Request
INC=Incident  PRB=Problem  RLE=Release  CMP=Campaign  COM=Communication  REL=Relationship
EVT=Event  IMP=Import  EXP=Export  WFL=Workflow  SLA=SLA  WHK=Webhook  CFG=Configuration
FFL=Feature Flag  JOB=Background Job
```
No duplicate prefixes (`REL`=Relationship, `RLE`=Release are distinct). Internal-only technical
records (e.g. webhook delivery attempts, trace keys) may be UUID-only when not business-visible.
