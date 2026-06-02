# Field-Level Access & Scheduler

Two orthogonal kernel engines: field-level read/write gates (A25) and the scheduled cross-tenant batch loop (E25). This document captures **what exists in the code right now**.

---

## 1. Field-Level Access (A25 — Records)

### 1.1 How it works: the default-open rule

Every field on an entity may declare optional access control in `FieldDef.config`:

```json
{
  "view_roles": ["sales", "cfo"],
  "edit_roles": ["owner", "cfo"]
}
```

The rule:
- **No `view_roles` declared** → visible to anyone who can view the record (default-open)
- **No `edit_roles` declared** → editable by anyone who can edit the record (default-open)
- **If either is set** → only roles in that set may see/edit the field
- **Super-admin bypass** → any user holding `config.manage` (Studio or tenant super-admin) bypasses both gates and sees/edits all fields

### 1.2 Where it's enforced

Field-level gates are enforced in two places in the records router (`backend/app/routers/records.py`):

#### Read side (view gate)
When a record is serialized to JSON (`_serialize`), any field whose `key` is in the hidden set is dropped entirely from the output. The hidden set is computed once per request via `_hidden_keys(fields, caller_roles, is_admin)` using `can_view_field(field.config, caller_roles, is_admin)` — defined in `access.py`.

Flow:
1. Load the user's grants via `load_grants` (loads `Assignment` rows, resolves the user's `RoleDef.key` set)
2. Compute field visibility as `hidden = _hidden_keys(fields, role_keys(grants), can(grants, "config", "manage"))`
3. When serializing each record, skip any field in `hidden` — **zero leakage in the JSON**

Applies to all read paths:
- `GET /{slug}` (list) — applied per record post-filter
- `GET /{slug}/{rec_id}` (detail)
- `POST /{slug}` (create response)
- `PATCH /{slug}/{rec_id}` (update response)
- `POST /{slug}/{rec_id}/transition` (transition response)

#### Write side (edit gate)
When a create/patch payload is validated (`_validate`), setting a field that the caller's roles cannot edit raises 403 immediately — **before mutation**. Validation calls `can_edit_field(field.config, caller_roles, is_admin)` per field present in the incoming payload.

Flow:
1. For each field `key` in the incoming payload, check `can_edit_field(field.config, caller_roles, is_admin)`
2. If False (roles mismatch and not admin), raise `HTTPException(403, f"Not allowed to edit field '{key}'")`
3. If True, validate type + required constraints and add to `data` dict

Applies to:
- `POST /{slug}` (create)
- `PATCH /{slug}/{rec_id}` (update) — partial update allowed; status changes go through `/transition` (guarded separately)

### 1.3 The two access functions

Both live in `backend/app/access.py`:

```python
def can_view_field(config: dict | None, caller_roles: set[str], is_admin: bool = False) -> bool:
    if is_admin:
        return True
    roles = (config or {}).get("view_roles")
    if not roles:
        return True
    return bool(caller_roles & set(roles))

def can_edit_field(config: dict | None, caller_roles: set[str], is_admin: bool = False) -> bool:
    if is_admin:
        return True
    roles = (config or {}).get("edit_roles")
    if not roles:
        return True
    return bool(caller_roles & set(roles))
```

The calling code passes:
- `config`: the field's `FieldDef.config` dict (or None)
- `caller_roles`: the user's role key set, derived from their active `Assignment` rows via `role_keys(grants)`
- `is_admin`: True if the user holds `config.manage` permission (checked once at request time)

### 1.4 Examples

**Sales rep viewing a customer:**
- Customer entity has a `credit_limit` field with `"view_roles": ["cfo", "finance"]`
- Sales rep has role `"sales"` — not in the set
- When listing/fetching customers, `credit_limit` is dropped from the JSON response
- If the rep attempts `PATCH /api/customers/{id}` with `{"credit_limit": 50000}`, the request fails with 403

**CFO editing an opportunity:**
- Opportunity has a `deal_margin_pct` field with `"edit_roles": ["sales_mgr"]`
- CFO has role `"cfo"` and permission `config.manage` (admin)
- The admin bypass applies: `can_edit_field` returns True immediately
- The field can be read and written

---

## 2. The Scheduler (E25 — Background Batch Loop)

### 2.1 What it will do

The scheduler is a **disabled-by-default cross-tenant background loop** that fires three batch jobs repeatedly on a fixed schedule:

1. **`run-dunning`** — poll all ISSUED invoices, mark any past `due_at` as OVERDUE
2. **`run-cycle`** — generate ISSUED invoices for all ACTIVE, due subscriptions (idempotently per `as_of`)
3. **`run-due`** — mark subscriptions due for renewal (currently a placeholder; will trigger notifications)

The loop runs **outside any user context** using a privileged OWNER session (RLS-bypassing), spawning per-tenant system actors so each tenant's jobs are isolated and can fail independently.

Every run is logged to the `job_run` table for operational visibility (J96 job log).

### 2.2 Current status: manual only

Today the three jobs are **endpoints, not scheduled**:

- `POST /api/invoices/run-dunning` — must be called manually (gated on `invoice.edit`)
- `POST /api/billing/run-cycle` — must be called manually (gated on `invoice.create`)
- `POST /api/subscriptions/run-due` — not yet implemented (spec-only)

To enable automatic scheduling, two things must be added:

1. **A scheduler configuration flag** (e.g., `SCHEDULER_ENABLED` in `.env` or a tenant setting)
2. **A background task** that runs on a timer, calls each endpoint in sequence, and catches/logs failures

### 2.3 How the jobs work: fail-soft pattern

Each job implements the **fail-soft pattern**:

- **Per-subscription savepoints** — each subscription billed inside its own `async with s.begin_nested()` so one failure rolls back only that sub, not the whole batch
- **Errors collected in a list** — not raised immediately; instead added to the summary JSON
- **Final commit is atomic** — all successful subs + the JobRun are committed together, or rolled back together if the final commit fails
- **Unexpected failures log as ERROR** — if the whole run crashes, a separate JobRun(status="ERROR") is logged before re-raising

Example from `billing_cycle.py::run_cycle`:

```python
for sub in subs:
    if not _is_due(sub, as_of):
        skipped += 1
        continue
    try:
        async with s.begin_nested():  # per-sub savepoint
            inv = await _bill_one(s, user, sub, as_of)
        generated += 1
        invoice_ids.append(str(inv.id))
    except Exception as e:            # fail-soft
        errors.append({"subscription_id": str(sub.id), "message": str(e)})

# Success summary includes the per-sub errors
_record_job_run(s, user, "billing.run_cycle", "SUCCESS",
                {"as_of": result["as_of"], "generated": generated, "skipped": skipped,
                 "errors": errors}, started)
await s.commit()
```

### 2.4 Job logging (J96)

Every run inserts a `JobRun` row:

```python
class JobRun(Base):
    id: UUID
    tenant_id: UUID                      # cross-tenant logs are scoped
    owner_node_id: UUID | None           # optional org node (e.g., per-region run)
    job_key: str                         # e.g. "billing.run_cycle"
    status: str                          # "SUCCESS" | "ERROR"
    summary: dict                        # the endpoint's result dict, or {"message": "..."}
    actor_user_id: UUID | None           # the system user who ran it (if applicable)
    started_at: datetime                 # wall-clock start
    finished_at: datetime                # wall-clock finish
```

Read via `GET /api/jobs` (paginated, optional `?job_key=` filter) — see `jobs.py` for details.

### 2.5 The three jobs (current + planned)

#### run-dunning (live)

**Endpoint:** `POST /api/invoices/run-dunning` (endpoint only; no schedule yet)

**Logic:** Marks any ISSUED invoice with `due_at < now` as OVERDUE (idempotent per invoice, per run).

**Gated on:** `invoice.edit` permission

**Returned summary:**
```json
{
  "overdue_count": 42,
  "already_overdue": 3,
  "marked_count": 39,
  "errors": []
}
```

**Fail-soft:** Each invoice marked inside a savepoint; errors per-invoice are collected and returned in the summary.

---

#### run-cycle (live)

**Endpoint:** `POST /api/billing/run-cycle` with optional `{"as_of": "YYYY-MM-DD"}` (defaults to today, UTC)

**Logic:** For every ACTIVE subscription that is DUE (never billed, or last cycle-bill > 1 cycle old), generate an ISSUED invoice idempotently. Due-logic is keyed on `subscription.last_invoiced_at` (what already happened), not `next_invoice_at` (a mutable schedule).

**Gated on:** `invoice.create` permission (mints invoices)

**Returned summary:**
```json
{
  "as_of": "2026-05-27",
  "generated": 18,
  "skipped": 2,
  "errors": []
}
```

**Fail-soft:** Each sub billed inside a savepoint; per-sub errors in the summary (e.g., customer lookup failed, amount validation failed).

**Idempotency:** A second run for the same `as_of` generates 0 (stamps `last_invoiced_at = as_of`), so the run is a pure function of `(subscriptions, as_of)`.

---

#### run-due (planned, spec-only)

**Endpoint:** `POST /api/subscriptions/run-due` (not yet implemented in code)

**Logic:** Poll subscriptions due for renewal (e.g., within 14 days of `next_invoice_at`) and emit notifications / mark them for follow-up. Foundation for auto-renewal / upsell workflows.

**Gated on:** `subscription.edit` or `notification.create` (TBD)

---

### 2.6 How to enable the scheduler in production

Once a background task runner is added (see section 2.7 "Horizon next"), enable it:

1. Set `SCHEDULER_ENABLED=true` in the deployment `.env` (or a tenant-settings override)
2. The task runner fires the three endpoints on a cadence:
   - `run-dunning`: daily (e.g., 01:00 UTC)
   - `run-cycle`: daily (e.g., 02:00 UTC) with `as_of=today`
   - `run-due`: daily (e.g., 03:00 UTC)
3. All three use the OWNER session + a per-tenant system actor, so they run as if called by a trusted operator
4. Failures are caught, logged to `job_run`, and do not cascade (fail-soft)

---

## 3. Export Surfaces (B25)

Entity record lists now export to CSV, JSON, XLSX, or PDF via `GET /{slug}/export`.

### 3.1 The endpoint

**Path:** `GET /api/{slug}/export?format={format}&q={q}&filter={filter}&sort={sort}`

**Formats:** `csv` (default), `json`, `xlsx`, `pdf`

**Filtering:** Uses the **exact same pipeline** as `GET /{slug}` (the list view):
1. Org-scope filter (access control) — never leak past ACL
2. Free-text search (`?q=`)
3. GXL filter expression (`?filter=`)
4. Sort (`?sort=` or `?sort=-key` for descending)
5. Pagination — capped by query params (but export always returns the full filtered set, no paging)

**Field visibility:** Respects field-level view gates (A25) — hidden fields are dropped from the export, same as from the list response.

**Response headers:** `Content-Disposition: attachment; filename="{slug}-{YYYYMMDD}.{format}"` for download.

### 3.2 CSV (default, streamed)

Plain text, RFC 4180 compliant. Headers in first row. Streamed one record at a time (memory efficient).

**Media type:** `text/csv`

### 3.3 JSON

JSON array of objects, one per record. Same field shape as the list endpoint (minus the hidden fields).

**Media type:** `application/json`

### 3.4 XLSX (stdlib-only)

OOXML workbook with one sheet. Headers in bold first row. Built via `build_xlsx(header, data_rows)` in `export_formats.py` (no external library; stdlib only).

**Branding from tenant settings:**
- `logo_text` or `name` (falls back to "GAAhex") in the header
- `currency` (defaults to "AMD") for money formatting

**Money format:** Integer luma values (e.g., `1500000` for ֏15,000) are displayed using `format_money(luma, currency)` which divides by 100 and groups thousands.

**Media type:** `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

### 3.5 PDF (stdlib-only)

Branded tabular PDF with:
- Header band: `logo_text`, entity title, date generated
- Column headers in bold
- Data rows below

Built via `build_pdf(...)` in `export_formats.py` (no external library; stdlib only).

Same tenant branding and money formatting as XLSX.

**Media type:** `application/pdf`

### 3.6 Access control

The export endpoint (`export.py::export_records`) reuses the exact same scope + view-gate pipeline as the records list:

```python
async def _viewable_filtered(...) -> list[Record]:
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "view"):
        raise HTTPException(403, f"Not allowed: {ent.key}.view")
    paths = await _node_paths(s, user.tenant_id)
    visible = [
        r for r in rows
        if can(grants, ent.key, "view", paths.get(str(r.owner_node_id)))
    ]
    # ... q / filter / sort ...
    return visible
```

So an export can **never leak** beyond what's visible in the list view.

---

## 4. Horizon next (spec-only)

The three items below are known, designed, but not yet implemented. They belong in the backlog for the scheduler hardening pass.

### 4.1 Durable scheduler (vs in-process)

Today: manual endpoints only. For production, add an out-of-process task runner (e.g., APScheduler + Redis, or a dedicated agent) so:
- Retries survive API restarts
- Job history is persistent (not lost on crash)
- Multiple instances don't race (only one leader runs the job)

### 4.2 Per-tenant schedule overrides

Allow tenants (via tenant settings, or an override table) to customize:
- Whether the scheduler is enabled (`scheduler_enabled: bool`)
- Which jobs run for that tenant (e.g., a tenant with manual billing skips `run-cycle`)
- The cadence per job (e.g., twice daily for `run-dunning` vs once daily for `run-cycle`)

### 4.3 Field-level masking in exports

Currently, exports drop hidden fields entirely (same as the list view). Future: offer a toggle to **mask** rather than drop — show the field name + a placeholder (e.g., `"[redacted]"`) so the schema is clear but the value is concealed. Useful for audit reports where the shape matters.

---

## Code References

- **Access control:** `backend/app/access.py` (`can_view_field`, `can_edit_field`, `load_grants`, `role_keys`)
- **Records CRUD + field gates:** `backend/app/routers/records.py` (`_hidden_keys`, `_validate`, `_serialize`)
- **Export endpoint:** `backend/app/routers/export.py` (`export_records`, `_viewable_filtered`)
- **Export formats:** `backend/app/export_formats.py` (`build_xlsx`, `build_pdf`)
- **Billing jobs:** `backend/app/routers/billing.py` (`run_dunning`), `billing_cycle.py` (`run_cycle`)
- **Job logging:** `backend/app/models/job.py` (`JobRun`), `routers/jobs.py` (read-only dashboard)
- **Field definition:** `backend/app/models/meta.py` (`FieldDef` — `config` JSONB holds `view_roles` / `edit_roles`)
