# Navigation Standard — base (file 22)

LOCKED. Resolves SOURCE NOT PROVIDED for the base **Navigation Standard** (display-order #31;
file 22). The locked navigation **tree** in file 10 remains the authoritative content; this
standard is the data model + placement rules behind it. Written code-accurate against
`models/nav_module.py`, `models/page_config.py`, and `seed_nav_registry.py`.

## 1. IA is data, not hardcode
The information architecture lives in two tenant-scoped tables (`nav_group`, `nav_module`) and is
served to the UI via `/api/nav`. The UI renders from the data — it is not hardcoded itself
(zero-bespoke directive).

## 2. NavGroup (`nav_group`)
Top-level group (Workspace, CRM & Commercial, Billing & Revenue, …):
`key (machine id), name (label), icon, order, status`. `(tenantId, key)` unique and
`(tenantId, order)` unique — two groups can never share a slot, so re-ordering is a swap.

## 3. NavModule (`nav_module`)
A module within a group: `key, name, icon, order, placement, owner_record_keys, owner_module,
route, status`. `(tenantId, groupId, key)` unique and `(tenantId, groupId, order)` unique.
- **`placement`** (SPEC §1 `[O]`/`[V]` legend):
  - `O` — the module **owns records** (edited here); `owner_record_keys` lists the `entity_def`
    keys it owns (e.g. `['lead','pipeline_item']`, `['order']`, `['customer','contact']`).
  - `V` — **view/aggregation only** (Home, Global Search, Dashboards, Studio builders, Workspace
    hub items); `owner_record_keys` is null/empty.
- **`owner_module`** mirrors `entity_def.owner_module` (§2.2 ownership matrix) so "which module
  owns entity X?" resolves symmetrically; always equal to `key`.
- **`route`** is the UI path the side-nav links to (e.g. `/pipeline`, `/orders`).

## 4. Locked placement rules (SPEC §1)
- **Orders & Validation** sits under **Billing & Revenue**, not CRM (the Control Gate is §3
  Stage 8).
- **Contracts** is its own CRM module.
- **KB / Announcements / Communications / Calendar** appear under Workspace but **own their
  records** (`placement='O'`).
- **Workspace** itself owns nothing (`placement='V'` for hub items).
- **Studio** is first-class top-level — **not** nested under System.

## 5. Bespoke pages (`page_config`)
A page that is not an entity (a hand-built view, e.g. Services) carries a tenant-scoped,
superadmin-editable presentation descriptor: one row per `(tenant, page_key)`, `config` an open
JSON blob (MVP: `{title?, columns:[{key,label,visible}]}`). This is the "configure in place"
mechanism — the bespoke view keeps its data/tools and layers presentation controls on top without
a schema change.

## 6. Cross-references
Page types and shell behavior: Page Type Standard + PageShell (file 10). Left Navigation behavior
+ the authoritative tree: Left Navigation Standard (file 10). Ownership matrix: §2.2 (Core
Ownership, file 02). Module/record `.view` gating: Security/Permission Standard (file 17).
