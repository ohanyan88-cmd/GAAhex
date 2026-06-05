# RLS Exemption Registry

**Status:** **APPEND-ONLY** · operational standard registry
**Initialized:** 2026-06-05 — empty
**Governed by:** [`RLS_EXEMPTION_POLICY.md`](./RLS_EXEMPTION_POLICY.md)

> **What this file is.** The canonical, append-only list of every RLS exemption granted on the platform. One row per exemption. Entries are added by following the approval process in the [policy § 5](./RLS_EXEMPTION_POLICY.md#5-approval-requirements). Entries are **never edited or removed** once added — status changes are appended as new entries that reference the original by ID.

---

## Usage

### To grant a new exemption

1. **Read the policy in full.** Especially [§ 4 (criteria)](./RLS_EXEMPTION_POLICY.md#4-exemption-requirements-criteria), [§ 5 (approval)](./RLS_EXEMPTION_POLICY.md#5-approval-requirements), [§ 6 (expiration)](./RLS_EXEMPTION_POLICY.md#6-expiration-requirements), and [§ 7 (remediation)](./RLS_EXEMPTION_POLICY.md#7-remediation-requirements). Every criterion is enforced at signoff.

2. **Open a PR with all four deliverables:**
   - This file — append one new entry per the schema below.
   - A successor sealed baseline file (`docs/architecture/SEALED-ARCHITECTURE-BASELINE-<date>-RLS-EXEMPTIONS.md`, OR an existing open successor baseline) — add the exemption as an enumerated line item.
   - `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` — add a one-line link in the `Successor baselines` footer.
   - `backend/tests/test_rls_exemptions.py` — add the regression test + leak-vector check.

3. **Request the three signoffs** (technical correctness · policy compliance · platform-owner) per policy § 5. The PR is **not mergeable until all three are recorded.**

4. **Merge the PR.** The exemption's `Status` is `ACTIVE` from merge time.

### To retire an exemption (remediation complete)

Append a new row with the same `ID` and `Status: RETIRED`, plus a `Notes` field pointing to the PR that retired it. The original `ACTIVE` row stays in place — readers reconstruct the timeline by walking the rows for that ID in order.

### To flip an exemption to expired-awaiting-remediation

Append a new row with the same `ID` and `Status: EXPIRED-AWAITING-REMEDIATION`, with a `Notes` field documenting the trigger event and the remediation deadline. Same append-only rule.

### Forbidden operations

- ❌ **Editing a prior row in place.** Every state change is a new appended row.
- ❌ **Removing a row.** Even RETIRED entries stay — they document that an exemption *was* needed and what closed it.
- ❌ **Renumbering IDs.** IDs are assigned at first grant and never change. Gaps in the ID sequence (from PRs that were closed without merging) are normal and intentional.
- ❌ **Bulk grants.** One ID per exemption; one PR per exemption.

---

## Entry schema

Each row has these fields:

| Field | Description | Example |
|---|---|---|
| **ID** | `EXM-NNN` — three-digit zero-padded ascending integer, assigned at first grant. Never reused or renumbered. | `EXM-001` |
| **Date** | Date of the row's status (`YYYY-MM-DD`). Multiple rows per ID carry the date of each status flip. | `2026-08-15` |
| **Status** | One of: `ACTIVE` · `RETIRED` · `EXPIRED-AWAITING-REMEDIATION` | `ACTIVE` |
| **Expiration shape** | One of: `Structural` · `Temporary — date-bound (YYYY-MM-DD)` · `Temporary — trigger-bound (<trigger description>)` per [policy § 6](./RLS_EXEMPTION_POLICY.md#6-expiration-requirements) | `Temporary — trigger-bound (platform-metrics service ships)` |
| **Query** | The exact SQL / SQLAlchemy expression OR a pointer to the line range in source where the query lives. If pointer: `backend/app/services/foo.py:120-145`. | `select(...).execution_options(audit_tenant_filter=False)` |
| **Justification** | Which of the five criteria in [policy § 4](./RLS_EXEMPTION_POLICY.md#4-exemption-requirements-criteria) apply, with a one-paragraph plain-English explanation. | "Criterion 1+2+3+5: platform-metrics rollup; needs cross-tenant read; no per-tenant equivalent expresses the question; gated by `platform.metrics.read`." |
| **Owner** | Named engineer responsible for executing the migration path when expiration fires. | `Ընգեր` |
| **Migration path** | Concrete written-down steps to remove the exemption. Empty/TBD = grant **DENIED**. | "Build per-tenant materialized-view rollup; switch read to that; retire this row." |
| **Regression test** | pytest path that proves the exemption is still required (owner-role rows ≠ app-role-plus-tenant-filter rows). | `backend/tests/test_rls_exemptions.py::test_exm_001_required` |
| **Leak-vector check** | pytest path (or extension of the regression test) that confirms the exempted endpoint is gated against unauthorized actors. | `backend/tests/test_rls_exemptions.py::test_exm_001_no_leak_vector` |
| **Sealed-baseline link** | Path to the successor sealed baseline file where this exemption is also recorded as a line item. | `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-08-15-RLS-EXEMPTIONS.md` |
| **PR** | The PR number / merge-commit hash that introduced (or flipped) this row. | `gh-pr#142 · 7f3a9b1` |
| **Notes** | Free-form context — particularly useful on RETIRED / EXPIRED rows to capture what changed. | "Retired by PR #199 after the per-tenant metrics MV shipped." |

---

## Active exemptions

```
(none — registry initialized empty 2026-06-05)
```

When the first exemption is granted, it appears here as a row in the format below. Until then, the platform has **zero exemptions outstanding**, which is the intended default state.

### Row format (template)

```
| ID | Date | Status | Expiration shape | Query | Justification | Owner | Migration path | Regression test | Leak-vector check | Sealed-baseline link | PR | Notes |
```

---

## Retired exemptions

```
(none)
```

Retired exemptions stay listed here permanently. They document that the platform *once needed* the exemption and what closed it — useful context for future posture reviews.

---

## Expired (awaiting remediation)

```
(none)
```

An entry here is a **high-priority bug**. Per [policy § 6](./RLS_EXEMPTION_POLICY.md#6-expiration-requirements), the owner has 5 working days from the expiration trigger to either retire the exemption or land the remediation PR. Beyond that window, the exemption escalates to a release-blocking issue.

---

## Posture review trigger

Per [policy § 8](./RLS_EXEMPTION_POLICY.md#8-default-expectation), if the **Active exemptions** section grows to **3 or more rows simultaneously**, the platform owner is notified and the next successor sealed baseline must contain an RLS-posture review. The expected steady-state count is `0`; the expected lifecycle count is `0–2`.

---

— Ընգեր, 2026-06-05 (initialized empty)
