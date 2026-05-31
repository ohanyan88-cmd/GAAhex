# Step 4.4 — SPEC §4.4 Field-Level Encryption-at-Rest (PREPARE, design only)

**Date:** 2026-05-31
**Author:** spec-build / security agent
**Scope:** DESIGN DOCUMENT ONLY for SPEC §4.4 — separate-grant + encryption-at-rest for the
sensitive field set. No model edits, no migrations, no router changes. Activation (helper
module + migrations + key-mgmt wiring) is a deliberately separate later round, gated by Gev
decisions called out in §7.

---

## 0. SPEC §4.4 source (verbatim, lines 214-215 of `GAAex_Cross_Module_Architecture_SPEC.md`)

> **### 4.4 Field-Level (separate grant + encryption at rest)**
> ID/passport, tax number, payment method, bank details, salary, legal docs, contract values,
> discount approval, network credentials, API keys, secrets, audit logs.
> **Secrets/keys/bank details are encrypted at rest, not merely permissioned.**

Two distinct controls are required:
1. **Separate grant** — these fields don't ride on row-level access; reading them needs its
   own permission key on top of normal read access.
2. **Encryption at rest** — the storage layer holds ciphertext for the most-sensitive subset
   so a DB dump / disk image / privileged read cannot recover plaintext.

---

## 1. Sensitive field inventory

GAAex stores entity rows two ways:
- **First-class BSS tables** (typed columns): `app_user`, `customer_user`, `api_key`,
  `refresh_token`, `webhook_def`, `payment_order`, `invoice`, `payment`, `order`,
  `subscription`, `interaction`, `event`, `service_resource`, `helpdesk_ticket`, …
- **Config-driven Records** (`record` table, single `data` JSONB bag) — most domain entities
  including `customer`, `contract`, `employee`, `document`, `quote`, `device`, `consent_record`,
  `legal_case`, `compliance_rule`, `vendor_payment`, `payroll_run`, `purchase_order`, …
  Their fields are declared in `_def` tables (`entity_def` / `field_def`) and live as keys
  inside `record.data`.

This split matters for the encryption design: a JSONB-bag field can't carry a `TypeDecorator`
the way a typed SQLAlchemy column can — it needs a different path (the encrypt/decrypt has to
happen at the field-write/field-read boundary in the records router, keyed off a
`field_def.sensitive=true` flag).

Risk levels:
- **HIGH** — encrypt at rest + separate grant
- **MED** — separate grant only (no at-rest crypto needed yet)
- **LOW** — audit/log scope only, no extra controls beyond existing RLS

| # | SPEC item | Where it lives today | Current storage | Risk | Action |
|---|---|---|---|---|---|
| 1 | **ID / passport** | Not yet modeled. No `passport`/`national_id`/`personal_id` columns in any model or `field_def` (grep clean across `app/models/*.py` and `seed_catalog.py`). The `customer` Record's `data` bag is the natural home when KYC fields land. | n/a | **HIGH** | Define on `field_def` as `sensitive=true` when added; encrypt at rest. |
| 2 | **Tax number** | Not yet modeled. No `tax_id`/`tin`/`tax_number` columns or field defs anywhere. The `customer` / `party` Record will carry this when B2B KYC lands. | n/a | **HIGH** | Same: tag `sensitive=true` at field-def time. |
| 3 | **Payment method** | `billing.Payment.method` (`models/billing.py:86`) — the **kind** of payment (`cash`/`card`/`transfer`), NOT a card number. `PaymentOrder.provider` (`models/payment_gateway.py:49`). **No PAN, no CVV, no card_token columns anywhere.** Card data is delegated to the gateway providers (idram/telcell/arca) — GAAex stores only the provider's reference. | plaintext (`String(20)`), low-sensitivity | **LOW** for `method` (categorical) · **MED** for `PaymentOrder.provider_ref` (provider's opaque ref, no PAN) | Keep `method` plain; treat `provider_ref` as MED (separate grant for view, no crypto). |
| 4 | **Bank details** | Not yet modeled. No `bank_account`/`iban`/`swift`/`bank_*` columns. When supplier/vendor banking lands (likely on `supplier` Record or a new `bank_account` Record), it will be `data`-bag JSONB. | n/a | **HIGH** | Encrypt at rest. **SPEC §4.4 explicitly names "bank details" in the must-encrypt clause.** |
| 5 | **Salary / compensation** | Not yet a column. The `employee` Record (`seed_catalog.py:199`) has `name`, `email`, `title`, `department` — no `salary` field yet. `payroll_run` (`seed_catalog.py:211`) has a `total` (period aggregate) but no per-employee amount. The `request` self-service catalog has a "Finance · Salary advance" request_type label but no salary column. | n/a (record `data` when added) | **HIGH** | Encrypt at rest; separate grant for HR/Finance only. |
| 6 | **Legal docs** | `document` Record (`seed_catalog.py:233`) has `name`/`kind`/`url`. **Document bytes are NOT stored in the DB** — only a URL reference. `document_template.body` (`seed_catalog.py:235`) is plain Textarea. `policy.body`, `compliance_rule.requirement`, `kb_article.body`, `legal_case.detail` — all plain text in `record.data`. | URL (plain) for `document`; plain text for the bodies | **MED** | Separate grant per entity; the *bytes* live outside the DB, so disk-encryption is the storage host's responsibility (S3 SSE / disk LUKS). |
| 7 | **Contract values** | `contract` Record (`seed_catalog.py:63-67`) with `data.value` as `money` type. Also `quote.amount`, `order.total`, `subscription.amount`, `invoice.total`, `payment.amount`, `purchase_order.total`, `budget.amount`, `expense.amount`, `vendor_payment.amount`, `payroll_run.total`. All money is integer luma. | plaintext `BigInteger` (typed BSS) or `data.value` integer (Records) | **MED** | Separate grant ("view contract value") — but **don't** encrypt: aggregation, SLA, reporting, and the Stage 8 control gate all need numeric access. App-level grant is sufficient. |
| 8 | **Discount approval** | `mandatory_approvals` workflow (`routers/mandatory_approvals.py:126`) has `action_type="high_discount"` as one of the gated actions. `kernel/approvals.py:70` lists `"high_discount"` in the gated set. `invoice_line.kind="discount"` is a billing line type. No `discount_pct`/`discount_amount` column on Records yet beyond the `promotion.discount_pct` (`seed_catalog.py:74`) and `discount` Record (`seed_catalog.py:111`). | plaintext numeric | **MED** | Separate grant (gated approval already exists in `mandatory_approvals` — extend with field-read permission on the discount value). No crypto. |
| 9 | **Network credentials** | None stored. Network gear Records (`olt`, `router`, `switch`, `tower`, `device`) carry IP/serial/model only — **no SSH/SNMP/RADIUS credential columns**. `service_resource.value` (`models/service.py:44`) holds IP/MAC/port identifiers, no auth. | n/a | **HIGH** | When provisioning credentials land (likely in an `integration.config_json` Record per `seed_catalog.py:278` or a new `network_credential` table), tag `sensitive=true` and encrypt at rest. |
| 10 | **API keys** | `models/apikey.py:24` — `ApiKey.key_hash` is SHA-256 of the full key, prefix kept for display, **raw key never stored**. This is correct already. `RefreshToken.token_hash` (`models/refresh_token.py:20`) is the same pattern. | **already hashed** (SHA-256, irreversible) | **DONE** | No change. Same pattern stays the gold standard for any future bearer token. |
| 11 | **Secrets** | `webhook_def.secret` (`models/webhook.py:22`) — HMAC signing key, stored **as plaintext `String(255)`**. Needed in plaintext for signing — can't be hashed. Env-driven secrets (JWT secret, SMTP password, Twilio auth token, AI API key, idram/telcell/arca keys) live in `app/config.py:14-64` and come from environment / `.env`, never persisted in the DB. | `webhook_def.secret` **plaintext in DB**; everything else env-only | **HIGH** for `webhook_def.secret` · **LOW** for env-driven (already off-DB) | Encrypt `webhook_def.secret` at rest. Env-driven secrets stay env-driven (key-mgmt = vault — see §4). |
| 12 | **Audit logs** | `event.data` JSONB (`models/event.py:32`) — fully readable today. `prevent_update_event` + `prevent_delete_event` DB triggers make it append-only but not confidential. Workflow audits, transition payloads (old/new values), action results — all in cleartext JSONB. | plaintext JSONB | **MED** (mostly metadata; PII only when a sensitive field's old/new value rides along) | Payload-level redaction at *write* time — see §6. Whole-payload encryption would break audit search; redact only the field names that are tagged sensitive elsewhere. |

Also worth noting (current good-hygiene baseline, no change needed):
- `app_user.password_hash` (`models/user.py:24`) and `customer_user.password_hash`
  (`models/customer_user.py:28`) — **bcrypt/argon2 one-way hash**, never plaintext.
- `refresh_token.token_hash` — SHA-256, raw token never persisted.
- `api_key.key_hash` — SHA-256, raw key returned exactly once at creation.

**Inventory totals:**
- **12 SPEC items** scanned.
- **3 already-handled** (passwords, refresh tokens, API keys — irreversible hash baseline).
- **5 HIGH to encrypt at rest** when modeled: ID/passport, tax number, bank details,
  salary, network credentials. Plus `webhook_def.secret` today.
- **4 MED separate-grant only**: legal-doc metadata, contract values, discount values,
  audit-log payload (with field-name redaction).
- **0 LOW** removed.

---

## 2. Encryption-at-rest strategy

Three honest options for the AT REST control:

### Option A — Per-column application-level AEAD (Fernet, key from env/vault)

- Python `cryptography.fernet.Fernet` (AES-128-CBC + HMAC-SHA256, authenticated).
- Encrypt at ORM-write boundary, decrypt at ORM-read boundary. Two surfaces:
  - **Typed BSS columns** (e.g. `webhook_def.secret`): SQLAlchemy `TypeDecorator`
    auto-transforms.
  - **JSONB `record.data` fields** (e.g. customer.passport): encrypted in the records
    router based on `field_def.sensitive=true`. The `data` value stored is the ciphertext
    string; the read path detects the tag and decrypts.
- Operator with DB read sees ciphertext only.
- Operator with **app+env access** sees plaintext (env key is the boundary).
- Search/index over plaintext is impossible (good — that's the point); equality search needs a
  deterministic hash side-column if ever needed (out of scope for this round).

### Option B — Postgres TDE (transparent disk encryption)

- AWS RDS / Azure DB / on-prem with LUKS — encrypted at the disk layer.
- **Zero code change.** Operationally cheap.
- Protects against: stolen disk image, careless backup. Does NOT protect against: a DB user
  with SELECT, a leaked `pg_dump`, an SQL injection.
- This is the floor, not the ceiling.

### Option C — pgcrypto column encryption (`pgp_sym_encrypt` / `pgp_sym_decrypt`)

- Encryption happens server-side in Postgres. Key passed in each query.
- Key must travel with every read query → if you've got SQL access you've got the key when it's
  being passed, complicating key-rotation and SQL-injection surface.
- Reasonable middle ground but the key handling is awkward versus Option A's clean Python
  boundary.

### Recommendation

> **B + A together.** B (disk-level / RDS storage encryption) is the cheap baseline that
> protects backups and stolen disks. A (application-level Fernet AEAD on the HIGH-risk
> columns + sensitive `field_def` fields) raises the bar so even a DB-read operator (or a
> rogue `pg_dump`) sees ciphertext for the most-sensitive subset. A's clean Python boundary
> matches the kernel's existing chokepoint pattern (write goes through one place, audit
> emits from one place — encryption should too). C is rejected because key handling at query
> time is the worst of both worlds.

### Implementation sketch (for the activation round — NOT to land now)

```python
# backend/app/security/field_crypto.py  (FUTURE — do not create this round)
import os
from cryptography.fernet import Fernet, MultiFernet
from sqlalchemy.types import TypeDecorator, String

def _load_fernet() -> MultiFernet:
    # GAAEX_FIELD_KEYS is a comma-separated list, NEWEST FIRST. MultiFernet encrypts with the
    # first key and decrypts with any of them — supports zero-downtime key rotation.
    raw = os.environ["GAAEX_FIELD_KEYS"]
    keys = [Fernet(k.strip().encode()) for k in raw.split(",") if k.strip()]
    if not keys:
        raise RuntimeError("GAAEX_FIELD_KEYS empty")
    return MultiFernet(keys)

_FERNET = _load_fernet()

def encrypt_str(plain: str | None) -> str | None:
    if plain is None:
        return None
    return _FERNET.encrypt(plain.encode("utf-8")).decode("ascii")

def decrypt_str(cipher: str | None) -> str | None:
    if cipher is None:
        return None
    return _FERNET.decrypt(cipher.encode("ascii")).decode("utf-8")

class EncryptedString(TypeDecorator):
    """Drop-in for `String`/`Text` columns that should be ciphertext on disk.
    Writes encrypt; reads decrypt. Stored type is Text (ciphertext is longer than plaintext)."""
    impl = String
    cache_ok = True
    def process_bind_param(self, value, dialect):
        return encrypt_str(value)
    def process_result_value(self, value, dialect):
        return decrypt_str(value)
```

For JSONB `record.data` fields, the records router (`routers/records.py`, write + read paths)
consults `field_def.sensitive` and calls `encrypt_str` / `decrypt_str` on those keys before
the JSONB is persisted / after it's read. The DB never sees the plaintext value of a sensitive
JSONB field.

---

## 3. Migration plan (per HIGH column — NOT to run now)

For each typed column being converted to encrypted-at-rest (e.g. `webhook_def.secret`):

1. **Add cipher column.** New migration: `ALTER TABLE webhook_def ADD COLUMN secret_cipher TEXT NULL`.
2. **Backfill in Python.** Separate migration runs a one-shot script that reads each row's
   plaintext `secret`, encrypts via `field_crypto.encrypt_str`, writes to `secret_cipher`.
   (Done in Python, not SQL — the encryption key never lives in Postgres.)
3. **Switch readers/writers.** Code change: SQLAlchemy column points at `secret_cipher` with
   `EncryptedString` type-decorator. Plain `secret` column is still there but unused.
4. **Drop plaintext.** Final migration: `ALTER TABLE webhook_def DROP COLUMN secret`.
5. **Rename.** `ALTER TABLE webhook_def RENAME COLUMN secret_cipher TO secret`.

Each step is its own alembic revision so the rollout can pause/halt between any two if
something burns.

For JSONB `record.data.<field>`: backfill walks `record` rows where the matching `field_def.
sensitive=true`, re-writes that key with its ciphertext counterpart. One migration per
`entity_key`+`field` pair so partial failure stays contained.

---

## 4. Key management

| Environment | Where the key lives | Rotation procedure |
|---|---|---|
| dev / test | `.env` → `GAAEX_FIELD_KEYS=<single Fernet key>`. Fresh key per dev box; lost data on rotation is acceptable. | Generate via `Fernet.generate_key()`, paste into `.env`, restart. |
| staging | Same shape, separate key from prod. Stored in the CI secret manager (GitHub Actions encrypted secret). | Same as dev. |
| **production** | **Vault provider — Gev decision** (see §7). Options ranked: HashiCorp Vault (best, k8s-native, audit-rich) · AWS Secrets Manager (cheap if already on AWS) · Azure Key Vault (cheap if already on Azure). Key fetched at app boot, held in memory only; never written to disk; never logged. | `MultiFernet` supports multi-key rotation: prepend the NEW key to `GAAEX_FIELD_KEYS`, deploy, run a background "re-encrypt all" sweep that reads each ciphertext (decrypts with any key) and writes back (encrypts with the newest), then remove the OLD key from the list and deploy again. Zero downtime, atomic per row. |

**Key escrow:** the prod key must be backed up to a separate secure location (vault snapshot
or an offline HSM-protected copy) — losing the key means losing every encrypted column
permanently. This is a Gev procedural decision (§7).

---

## 5. Access via API (separate grant)

Encryption at rest does not relieve the access-control layer; once the app decrypts, the
plaintext still needs gating.

Extend `app/kernel/access.py` / `assert_can` with field-level grants on top of the existing
4-way (Role × Department × Region × Ownership) AND:

- New permission key shape: `field:<entity_key>.<field_key>:read`
  e.g. `field:customer.passport:read`, `field:employee.salary:read`,
  `field:webhook_def.secret:read`, `field:contract.value:read`.
- Default deny — same as the rest of `assert_can`.
- The records router (read path), before serializing `record.data`, drops any key whose
  `field_def.sensitive=true` UNLESS the caller has `field:<ek>.<fk>:read`. Same for typed BSS
  columns: the response model masks the column when the grant fails.
- For typed columns, the API response shape stays stable: the field renders as `null` (or
  `"***"` if the caller knows the field exists but lacks the grant — depends on UX).

This keeps the **separate grant** half of SPEC §4.4 honest: a Sales user with normal
customer-read access doesn't see the customer's passport, even though they can read the row.

---

## 6. Audit log encryption (§4.4 also names "audit logs")

SPEC §4.4 lists "audit logs" in the sensitive set. The audit log can't be encrypted whole —
that would break SIEM queries, the kernel's transition reads, the Activity Feed, and
SPEC §0.4's append-only guarantee (you can't easily search "give me all transitions on
customer X" if every payload is opaque ciphertext).

**Recommendation: payload-level redaction at WRITE time.**

When `workflow.emit` (`app/workflow.py`) writes an event whose `data` carries old/new values
of a record's fields, the chokepoint consults `field_def.sensitive=true` for each key and
substitutes a redaction marker:

```python
# pseudo, lives in workflow.emit on the write path
def _redact_payload(entity_key: str, data: dict, sensitive_fields: set[str]) -> dict:
    out = {}
    for k, v in data.items():
        if k in sensitive_fields:
            out[k] = "[REDACTED]"   # or a one-way hash digest if equality search is needed
        elif isinstance(v, dict):
            out[k] = _redact_payload(entity_key, v, sensitive_fields)
        else:
            out[k] = v
    return out
```

The redaction marker keeps the audit trail's *shape* intact (the field name still appears in
the diff so "you changed something" is auditable) while keeping the *value* invisible. A
separate "decrypt my audit entry" flow is out of scope — the SPEC explicitly says audit logs
are append-only and Admin can't edit them; reversible decryption would invite abuse.

**Caveats called out:** if a sensitive field appears in `interaction.body` (a call note that
quotes the customer's passport) or `helpdesk_ticket.body` (a support email forwarding bank
details), regex-based scrubbing is the only practical defense. Document as a known gap; full
DLP is out of scope for this round.

---

## 7. ⛔ Compliance items awaiting Gev decision

These are **NOT** technical choices I should make alone — they affect ops, cost, and legal:

- [ ] **Vault provider** — HashiCorp Vault, AWS Secrets Manager, or Azure Key Vault for the
      prod encryption key. Depends on the prod hosting target (k8s vs. AWS vs. Azure) which
      Gev hasn't picked yet.
- [ ] **Key escrow procedure** — where the offline backup of the prod field-key lives, and
      who has access. Recovery model decision.
- [ ] **Audit / compliance review** — does GAAex need GDPR DPO sign-off, PCI DSS scope
      reduction (since card data is delegated to gateways, scope should be SAQ-A but legal
      review needed), Armenian data-protection-law compliance? Gev's call.
- [ ] **Backup procedure** — Postgres backup MUST include key escrow alignment: a backup
      restored to a new region needs the key OR a re-encryption pass. Procedural decision.
- [ ] **Where does ID/passport, tax number, bank details, salary actually land?** — They're
      not modeled today. The activation round needs the SCHEMA decision (which Record + which
      `field_def` entries) before the encryption hook can attach. Likely §4.4 + a separate
      PREPARE for the KYC field set.
- [ ] **Search-on-encrypted-fields requirement?** — If "find customer by passport" is a
      product need, we'd need a deterministic hash side-column. Default assumption: not
      needed. Gev to confirm.

---

## 8. Out of scope for this PREPARE round

- No new files in `app/security/`.
- No `field_def.sensitive` column added.
- No alembic revision.
- No router changes.
- No env vars added to `app/config.py`.
- No vendor choice between Vault / AWS SM / Azure KV.

Each becomes a task in the ACTIVATE round, once the gates above are decided.

---

## 9. Activation-round task list (preview, NOT to execute now)

1. Add `field_def.sensitive: bool default false` (alembic).
2. Add `app/security/field_crypto.py` with `EncryptedString` TypeDecorator + helpers.
3. Add `GAAEX_FIELD_KEYS` to `app/config.py` settings.
4. Convert `webhook_def.secret` to `EncryptedString` (5-step migration per §3).
5. Wire sensitive-field gating in `routers/records.py` read/write paths (JSONB `data`).
6. Add `field:<entity>.<col>:read` permission keys to the role engine + seed defaults.
7. Add redaction pass to `workflow.emit` for `event.data` (§6).
8. Document the rotation runbook in `docs/ops/key-rotation.md`.
9. Set up the vault binding in prod (post-Gev decision).
10. PRE-modeling of ID/passport, tax number, bank details, salary as new `field_def` entries
    with `sensitive=true`, ready for first encrypted writes.
