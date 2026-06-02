# Data Validation Standard (file 20)

LOCKED. Resolves SOURCE NOT PROVIDED for **Data Validation** (display-order #23; file 20). Written
code-accurate against `models/meta.py` (`FieldDef`) and `routers/records.py` (`_validate`,
`_validate_value`).

## 1. Field definition (`field_def`)
A field is defined by `FieldDef`: `key (snake_case), label, type, required, default_value,
config (JSONB), order`. `type` is one of the canonical 16:
`text | number | boolean | date | datetime | money | email | phone | select | multiselect |
status | ref | ref_user | ref_orgnode | file | formula`.
`config` carries type-specifics (e.g. `options` for select/multiselect, `target` for ref,
`currency` for money, `view_roles`/`edit_roles` for field security).

## 2. Validation is server-side and kernel-enforced
The **records writer is the single source of truth** for validation. UI-side validation is
convenience only; it never substitutes for the server check. Every create/update passes through
`_validate`; failures raise **HTTP 422** (403 for edit-permission failures).

## 3. Rules (on write)
- **Unknown field** → 422 (`Unknown field '{k}'`).
- **Required** → on full create, a missing/empty required field → 422
  (`Missing required field '{f.key}'`). On a **partial** update (PATCH), required is **not**
  re-enforced; present values are still type-validated.
- **Type-aware value checks** (for a present, non-empty value):
  - `email` — invalid format → 422.
  - `phone` — invalid number → 422.
  - `number` / `money` — non-numeric → 422 (`must be a number`).
  - `boolean` — coerced; non-boolean rejected.
  - `select` / `multiselect` — value not in `config.options` → 422 (`must be one of {opts}`).
  - `status` — validated against the entity's `status_def` (Global Status Standard, file 16);
    transitions go through guarded transition (missing `to` → 422; failed guard → 422). A status
    field is not edited by free PATCH.
  - `ref` / `ref_user` / `ref_orgnode` — must be an **id reference**, never an inline object.

## 4. References, not copies (ordering)
The §0.5 master-data guard runs **before** field validation: a payload that inlines a master
record (`customer, contact, billing_account, service, product, tariff_plan, vendor, employee`) by
value rather than by id is rejected with 422. (Security/Permission Standard, file 17, §0.5.)

## 5. Field-edit permission
Setting a field the caller's roles may not edit is refused with **403** (field-level security,
file 17 §8). Validation and field-permission are checked together on write.

## 6. Cross-references
Status values + transitions: Global Status Standard (file 16). Field-level view/edit gating:
Security/Permission Standard (file 17). Enum value casing (UPPER_SNAKE) for `select`/`status`
options: Enum Standard (file 03).
