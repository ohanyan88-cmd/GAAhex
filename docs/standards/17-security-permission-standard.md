# Security & Permission Standard (file 17)

LOCKED. Resolves the SOURCE NOT PROVIDED placeholder for **Security & Permission** (display-order
#22; this is file 17 in `docs/standards/`). Written code-accurate against `app/access.py`,
`app/kernel/invariants.py`, `models/access.py`, and the Permission Registry (file 15). This
standard is the authoritative RBAC contract and **supersedes the thinner RBAC notes in file 12**.

## 1. Principle — default-deny
No grant means no access. An access decision that no positive grant covers is **denied** (HTTP
403, `AccessDenied`). The denial surface is generic — it never echoes which layer (role /
department / region / ownership / field) refused, so a hostile caller can't map the matrix.

## 2. Permission keys
Lowercase `object.action`, dot-separated, object first (file 15; multi-word action segments use
snake_case, e.g. `comment.view_internal`). Keys are canonical, immutable once released, never
localized. A role grants keys; wildcards are allowed **in grants only**:
`*` (all), `object.*` (all actions on an object), or the literal `object.action`.

## 3. Roles (`role_def`)
A `RoleDef` is a tenant-scoped bundle: `permissions` (JSONB list of keys/wildcards) + a default
`scope ∈ node | subtree | tenant`. `(tenantId, key)` unique. Roles are config (edited in
SuperAdmin); the engine that interprets them is fixed kernel.

## 4. Assignment — the grant (`assignment`)
A grant binds `user → role` at an **org node** (the scope anchor), plus two optional filters
(SPEC §4.1):
- `department` — if set, the assignment applies only in that department context.
- `region_scope ∈ home_only | subtree | any` — how far the assignment reaches across the region
  partition. **NULL is read as `home_only`.**

## 5. Org-scope evaluation
Org nodes form a hierarchy addressed by an **ltree `path`**. A grant's reach over a record at
`record_path`:
- `tenant` → always in scope (all nodes in the tenant).
- `node` → `record_path == grant_path` (that node only).
- `subtree` → `record_path == grant_path` **or** `record_path` starts with `grant_path + "."`
  (the node and all descendants).

## 6. The access decision (`can`)
`can(entity_key, verb, record_path)` is **true iff some grant** both (a) carries the permission
(`*`, `entity_key.*`, or `entity_key.verb`) **and** (b) its scope covers `record_path`. Otherwise
default-deny. List/search endpoints filter every row through this same gate
(`in_view_scope` = `can(..., "view", path)`), so a caller never sees a record outside scope.

## 7. Role deny — hard-denials (`role_def_deny`)
A `RoleDeny` row (the role's *cannot* list) is evaluated **after** the positive grant: a matching
deny raises `AccessDenied` even when the role's positive permissions would have allowed the
action. Wildcards: `denied_action='*'` denies every verb; `denied_entity_key=NULL` denies the
action for **any** entity. Deny always wins over grant.

## 8. Field-level security (`field_def.config`)
A field may declare `{"view_roles": [...], "edit_roles": [...]}`:
- no `view_roles` ⇒ visible to anyone who can view the record (default-open);
- no `edit_roles` ⇒ editable by anyone who can edit the record (default-open);
- an `is_admin` caller (holds `configuration.manage`) bypasses both gates.
A field a caller's roles may not view is **never** returned, labeled, used as a search snippet/
highlight, exported, reported, or exposed to AI-readable views — enforced identically across UI,
API, export, reports, and search.

## 9. Global Invariants (`kernel/invariants.py` — `assert_can` facade)
Enforced above the everyday gate; each maps to a fixed HTTP code:
- **§0.1 Single owner** — only a record kind's owner module may **write** it (`OwnerViolation` →
  409). Non-owner modules may read and reference by id. Owner is `entity_def.owner_module` /
  `nav_module.owner_module` (§2.2 ownership matrix).
- **§0.2 Default-deny** — see §1 (`AccessDenied` → 403).
- **§0.5 Master data — references, not copies** — the master records
  (`customer, contact, billing_account, service, product, tariff_plan, vendor, employee`) exist
  once and are referenced by id. A write payload that inlines one by value is rejected
  (`DuplicateMasterData` → 422).
- **Region** — a read whose region scope doesn't include the target is rejected
  (`CrossRegionDenied` → 403).
- **§0.3 Financial immutability / §0.4 audit append-only** — enforced at the **DB layer** (triggers,
  alembic `b70ef3b98e27`), below the application, so the invariant holds even against privileged
  raw SQL. (Cross-ref: Audit Standard file 04, §0.3 billing.)

## 10. The layered decision inputs
Every decision composes, in order, until one denies: authenticated identity → `tenantId` → role
permissions (incl. wildcards) → explicit permissions → ownership → assignment → department →
team/region scope → object visibility → feature flag → field restrictions → record status →
workflow state. Two hard rules: a **feature flag never replaces a permission**, and **watching a
record grants no permission**.

## 11. Tenant isolation
Tenant-scoped tables carry a `tenant_isolation` row-level-security policy (NULLIF-guarded). No
query crosses a tenant boundary; `tenantId` is mandatory on every tenant-owned row.

## 12. Secrets at rest
Signing keys and credentials (e.g. a `WebhookDef.secret` HMAC key) are stored via `EncryptedString`
(SPEC §4.4) — encrypted at rest, decrypted transparently on read; the database never holds the
plaintext. (Cross-ref: Integration Standard.)

## 13. Error mapping (canonical)
`OwnerViolation → 409`, `AccessDenied → 403`, `DuplicateMasterData → 422`, `CrossRegionDenied →
403`. Bodies stay generic; no layer-leaking detail.
