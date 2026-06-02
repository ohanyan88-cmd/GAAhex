# 07 — Security, Validation, Search & Global Status Standards

This file holds four standards that are referenced as LOCKED across the set but whose source
text was not provided to this patch. No rules are invented. Each carries the constraints that
other locked standards already impose on it, so implementers know the non-negotiable edges.

---

## Global Status Standard — LOCKED / SOURCE NOT PROVIDED

Referenced as standard #1 by the ownership and standards-definition documents.
Imposed constraints from locked standards already in this set:
- status values are canonical enums in `UPPER_SNAKE_CASE` (Enum Standard, B1)
- store internal value, display translated label separately (Localization Standard)
- `STATUS_CHANGED` is a first-class audit/timeline event (Audit, Activity Timeline)
- status changes are events (Event System) and may gate workflow transitions (Workflow Engine)
- no tenant-specific status meanings (Multi-Tenant Standard).
Full source text required before completion.

---

## Security & Permission Standard — LOCKED / SOURCE NOT PROVIDED

Referenced everywhere data access exists. The RBAC / Permission Model Standard (file 12)
provides the access-decision model, but the base Security & Permission Standard source text was
not provided to this patch.
Imposed constraints from locked standards already in this set:
- server-side enforcement only; no frontend-only security (all UI standards)
- TenantID enforced on every access path (Multi-Tenant Standard)
- field-level masking applies to UI, API, export, reports, search, AI views (RBAC)
- permission keys are canonical, never localized (Localization, RBAC)
- watchers grant no access (Watcher Standard).
Full source text required before completion.

---

## Data Validation Standard — LOCKED / SOURCE NOT PROVIDED

Referenced as the shared validation contract for UI, API, automation, integration, admin tools,
background jobs, and import/export.
Imposed constraints from locked standards already in this set:
- one shared validation path; imports/exports use the same validation as UI/API (Import/Export)
- canonical values only; no translated labels as stored values (Localization, Enum)
- server-side validation mandatory; client-side is UX only (Form Standard)
- invalid records never created.
Full source text required before completion.

---

## Search & Filter Standard — LOCKED / SOURCE NOT PROVIDED

Referenced by Table, Pagination, Reporting, Reference Number, Import/Export, Multi-Tenant.
Imposed constraints from locked standards already in this set:
- searches/filters never leak unauthorized rows or counts (Reporting, Table, Multi-Tenant)
- reference-number search supports full + numeric-only + smart normalization (Reference Number)
- filters preserved across pagination (Pagination Standard)
- canonical values for filter logic; translated labels for display only (Localization).
Full source text required before completion.

---

## Note
These four standards (plus Automation, Integration, and the base Navigation behavior in other
files) are the complete set of `SOURCE NOT PROVIDED` items. They are the only items blocking a
fully self-contained locked set.
