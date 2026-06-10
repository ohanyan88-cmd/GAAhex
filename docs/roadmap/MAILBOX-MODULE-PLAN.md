# Mailbox Module Plan — GAAhex Mail

**Status:** IN PROGRESS · **Phase A (Foundation) LANDED 2026-06-10 (uncommitted)** — `mail_account` +
`mail_folder` models + migration `c4d5e6f7a8b9` (tenant_isolation RLS), `SmtpEmailGateway` (per-tenant,
aiosmtplib), `/api/mail/*` router (accounts CRUD · /test · send), `feature_mail_*` settings (OFF default),
`mail.*` keys in file 15. **KT-MAIL-1** (cross-tenant isolation) + **KT-MAIL-3** (send via tenant's own
SMTP) GREEN. Decisions OD-1..5 accepted as recommended (per-user · password-v1 · poll-v1 · bodies-inline ·
denormalized thread_id). **Notification auto-routing DONE:** `channels.dispatch` now routes tenant `email` traffic through the
tenant's `is_system_sender` mailbox via `SmtpEmailGateway` (additive + fail-soft; tenants without a
mailbox fall through unchanged) — proven by `test_mail_notification_dispatch_routes_via_tenant_system_sender`.
(Global comms-factory `smtp` registration intentionally skipped — the per-tenant `gateway_for_account`
path in router + dispatch is the multi-tenant-correct seam; a global-settings `smtp` entry would
contradict per-tenant config.) **Phase A COMPLETE.**

**Phase B (Inbound IMAP) LANDED 2026-06-10 (uncommitted):** `MailMessage` + `MailAttachment` models +
migration `d5e6f7a8b9c0` (tenant_isolation RLS); `services/mail_sync.py` — pure testable `ingest_message`
(MIME parse → MailMessage + attachments to StorageBackend, idempotent on (account,folder,uidvalidity,uid))
+ `set_message_flag` + thin aioimaplib `sync_account`/`sync_all_enabled`; router gains folders / messages
list+read / flag PATCH / attachment download / manual `/sync`; scheduler `mail.sync_all` job (self-gated
on `mail_sync_enabled`, tenant-scoped). **KT-MAIL-2** (inbound sync + attachment storage round-trip +
idempotent re-poll + flag persistence) GREEN.

**Phase C (UI) BUILT 2026-06-10 (uncommitted) — via 7-agent fan-out; tsc clean (0 errors), frontend
29/29 green.** Files: `lib/mail.ts` + `views/mail/` (MailView 3-pane shell · MailRouteAdapter ·
FolderSidebar · MessageList · ThreadReader + MessageBody[DOMPurify] + AttachmentChips · ComposeModal +
RecipientField · MailAccountSettings[write-only secrets]) + `_comms.css` + nav/App wiring. D18/D20 clean.
⚠️ **CONTRACT GAP (Phase C.2 — REQUIRED before E2E):** the agents built the UI against a *richer*
contract than the live Phase A/B backend. To function end-to-end the backend must be upgraded to match
(additive, KT-MAIL tests stay green): message list/read fields (`from_addr`/`from_name`/`to_addrs[]`
MailAddress arrays · `flag_seen/flagged/answered` · `sent_at/received_at`) + `{items,total}` shape;
folder `unseen_count`; `testAccount→{imap_ok,smtp_ok,detail}`; `triggerSync→{queued,detail}`;
`createAccount` accept `secret_password`; new endpoints **PATCH /accounts/{id}**, **DELETE
/messages/{id}**, **POST /attachments** (upload), attachment URL **/messages/{mid}/attachments/{aid}**;
`send` accept `to: MailAddress[]` + `attachment_ids`. This is the autonomous-agent "invented contract"
risk, flagged up-front.

**Phase C.2 (reconciliation) DONE 2026-06-10 (uncommitted).** Backend upgraded to the richer contract
(additive — KT-MAIL-1/2/3 stayed green): message list/read now emit `from_addr`/`from_name`/`to_addrs[]`
MailAddress arrays + `flag_seen/flagged/answered` + `sent_at/received_at`; folders emit `unseen_count` +
`account_id` + `last_sync_at`; `testAccount→{imap_ok,smtp_ok,detail}` (probes both); `triggerSync→{queued,
detail}`; `createAccount`/`updateAccount` accept `secret_password` (write-only); NEW endpoints **PATCH
/accounts/{id}**, **DELETE /messages/{id}**, **POST /attachments** (upload, tenant-fenced storage key),
attachment URL nested **/messages/{mid}/attachments/{aid}**; `send` accepts `to: MailAddress[]` (+ string
back-compat) + `attachment_ids`. New **`test_mail_phase_c2_contract`** exercises the full reconciled
surface E2E. Two drift ratchet regressions from the agent UI (raw `btn`, `<div onClick>`) fixed to
baseline. **tsc clean · frontend 29/29 · drift all-pass.**

**MAIL MODULE FUNCTIONALLY COMPLETE** (send + receive + inbox/compose/read/threads/attachments +
per-tenant + notifications-from-own-domain, UI↔backend wired). **Remaining: Phase D** (polish — FTS
search, bounce/DSN classifier, IMAP IDLE hardening) — non-blocking enhancements. _Original plan below._

**Status (original):** PLAN · pre-implementation
**Anchored on:** `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md`
**Author check:** I have read the sealed baseline and the M1 plan. Mail is a
**first-class module** (`/api/mail/*` router + service layer + background workers),
**NOT a 6th kernel engine** (forbidden, [I1](#i1)) and **NOT a slug-branch** in
`app/routers/records.py` (forbidden, [I5](#i5)). It rides the existing five engines
(WorkItem movement · auth/authz · database/RLS · audit/log · security) unchanged,
using extension points E6, E7, E9, and the established first-class-module-worker shape
that billing / webhooks / network already use. Every credential is Fernet-encrypted at
rest via the existing `EncryptedString` column type; every table carries `tenant_id` +
the canonical `tenant_isolation` RLS policy in the same migration.

> **Rule of the road.** Mail ships a real per-tenant email client — SEND (SMTP) +
> RECEIVE (IMAP), inbox / compose / read / threads / attachments, plus invoice & dunning
> notifications routed through each tenant's **own** mail server — *without the platform
> shape changing*. Five ISPs each plug in their own server; tenant A can never read
> tenant B's mail, and tenant A's notifications leave from A's domain. If a Mail task
> feels like it needs a 6th engine, an entity-specific record route, or `if slug=='mail'`
> in `records.py`, the task is wrong, not the baseline. GAAhex is an SMTP **client** of
> each tenant's server — never an MTA / outbound relay; deliverability is the tenant
> server's job.

---

## Table of contents

1. [Objective](#1-objective)
2. [Scope](#2-scope)
3. [Non-scope](#3-non-scope)
4. [Extension points used + invariants honored](#4-extension-points-used--invariants-honored)
5. [Data model](#5-data-model)
6. [Architecture](#6-architecture)
7. [API surface](#7-api-surface)
8. [Frontend](#8-frontend)
9. [Security & multi-tenancy — the "5 companies" proof](#9-security--multi-tenancy--the-5-companies-proof)
10. [Implementation phases](#10-implementation-phases)
11. [Killer tests](#11-killer-tests)
12. [Risk register](#12-risk-register)
13. [Open decisions](#13-open-decisions)

---

## 1. Objective

A full per-tenant email client embedded in GAAhex: outbound SMTP send, inbound IMAP
sync, threaded inbox / compose / reader / folders / attachments, per-user mailbox
management, and **system-notification routing** so that invoice and dunning emails leave
through each tenant's own mail server and domain (correct SPF/DKIM by construction).

Concretely, Mail is **proven** when:

1. Two tenants each configure a distinct `mail_account` (their own SMTP + IMAP host and
   credentials), send mail, and receive mail — entirely through `/api/mail/*` config, no
   new model classes outside the Mail module and no entity-specific record routes.
2. Under the production `gaahex_app` NOSUPERUSER role, **KT-MAIL-1** shows zero
   cross-tenant read: tenant B cannot list or open tenant A's accounts or messages.
3. A dunning notification leaves via the tenant's **own** SMTP (the account's
   `smtp_host`, never a global `settings.smtp_host`), lands in that account's Sent
   folder, and is recorded as an `OutboundMessage(channel="email")` plus an
   append-only `workflow.emit` audit event (**KT-MAIL-3**).
4. The M0 killer test stays green byte-for-byte and the `backend-rls` CI job stays hard
   (green without `continue-on-error`).

What Mail is **not**: a webmail replacement for power users (no IMAP IDLE-push refinements,
no contacts/calendar in v1), an MTA / shared outbound relay, or a kernel rewrite.

---

## 2. Scope

- `mail_account` model + CRUD: per-tenant SMTP/IMAP connection config, Fernet-encrypted
  credentials, optional OAuth2/XOAUTH2 token material, the designated `is_system_sender`
  flag, per-user `owner_user_id`.
- Per-tenant SMTP **send** via the account's own server (`SmtpEmailGateway` implementing
  the existing `EmailGateway` Protocol), interactive compose, threaded reply/forward,
  append-to-Sent over IMAP.
- IMAP **inbound sync** worker → `mail_folder` + `mail_message` + `mail_attachment`,
  attachments streamed to the existing `StorageBackend`, bodies inline in Postgres,
  bidirectional flag reconcile, UIDVALIDITY recovery.
- `/api/mail/*` router: accounts, `/test`, `/sync`, folders, message list/read, send,
  draft CRUD, flag/move/delete, attachment download.
- Notification routing: the tenant's `is_system_sender` account carries invoice / dunning
  mail; the send is mirrored to Sent and to the existing `OutboundMessage` delivery log.
- DSN/bounce classification fed by the same IMAP worker (no SendGrid-style webhook needed).
- RLS `tenant_isolation` on every Mail table **plus** an app-layer per-user mailbox
  ownership filter on every message/folder/attachment query.
- Frontend: a standalone **Mail** nav entry → `MailView` reusing the existing
  `COMMUNICATION` page type and the already-authored `.gx-comms .mail*` 3-pane CSS.

---

## 3. Non-scope

Anything here **is not Mail v1**. Adding it is scope creep for a successor conversation.

| Out of scope | Why |
|---|---|
| A 6th kernel engine | Forbidden ([I1](#i1)). Mail is a module beside billing/webhooks. |
| Slug-branch in `records.py` (`if slug=='mail'`) | Forbidden ([I5](#i5)). Mail has its own router namespace. |
| Per-tenant permission keys (`tenantX.mail.view`) | Forbidden ([I6](#i6)). Keys come from the registry. |
| Building our own MTA / shared outbound relay | We are an SMTP **client** of each tenant's server; deliverability is the tenant server's job (R-MAIL-1). |
| IMAP IDLE push as the default | v1 uses poll-based sync; IDLE lands in Phase D (polish) per [Open decision OD-3](#od3). |
| Full-text search engine (Elastic/OpenSearch) | Postgres FTS (deferred `tsvector` GIN migration) covers v1 volumes; revisit on SLA break. |
| `mail_thread` table (per-thread persisted labels) | v1 derives a thread from the denormalized `thread_id`; add a table only when per-thread state is needed ([OD-5](#od5)). |
| Contacts / calendar / shared-team-inbox assignment | post-Mail-v1. |
| Raw full-MIME archival in Postgres | Bodies inline as `Text` (TOAST); raw MIME, if ever needed, goes to `StorageBackend`. |

---

## 4. Extension points used + invariants honored

### Extension points (sealed baseline §8)

| EP | Used by | Notes |
|---|---|---|
| **E6** — new tenant-scoped tables | `mail_account`, `mail_folder`, `mail_message`, `mail_attachment` | Each ships `tenant_id` + `tenant_isolation` RLS **in the same migration** (the `b1c768523e3e_outbound_webhooks.py` pattern). A `mail_sync_state` cursor is folded into `mail_folder` (per-folder UIDVALIDITY/last-UID), not a separate table. |
| **E7** — new permissions | `mail.*` keys added to `docs/standards/15-permission-registry.md` **before** code | `object.action`, lowercase, immutable once released ([§5 keys](#5-data-model)). |
| **E9** — new feature gate | `feature_mail_enabled` (default OFF) + `mail_sync_enabled` (default OFF) | Deploy-contract-aware; a fresh clone / CI boot is fully inert (no socket, no task). |

A new router namespace + service layer + background worker is the established
**first-class module** shape (billing / webhooks / network), not a new extension point.

> **Resolved contradiction (permission keys).** The five dimension designs proposed two
> key shapes — `mail.account.view` / `mail.message.send` (three-segment) and
> `mail_account.manage` / `mail_message.send` (object = `mail_account`). This plan
> **standardizes on the object-dotted-action form** to match the existing registry
> (`webhook.manage`, `attachment.download`), with the canonical key list in [§5](#5-data-model).
> The frontend uses a dedicated `OBJ.MAIL_*` constant set, **not** `OBJ.COMMUNICATION`
> (the COMMUNICATION object is reused only as the *PageShell page type*, never as the
> permission object — see [§8](#8-frontend)).

### Invariants honored (I1–I10)

<a id="i1"></a>**I1. The 5 kernel engines stay fixed.** Mail adds zero engine code. Sends/syncs ride
the **audit** engine via `workflow.emit`; transitions of message state are plain column
writes, not a 6th engine. The IMAP/SMTP workers are module workers, not engines.

<a id="i2"></a>**I2. Audit append-only.** Every send (`MAIL_SENT`), sync completion
(`MAIL.ACCOUNT.SYNCED`), UIDVALIDITY reset, and auth failure emits through
`workflow.emit` (which already supports `actor_type="SYSTEM"`). No direct `INSERT INTO
event`, ever; no audit backfill.

<a id="i3"></a>**I3. Tenant isolation engages.** Every Mail migration carries the byte-identical
`tenant_isolation` policy (`USING`/`WITH CHECK` on
`current_setting('gaahex.tenant_id', true)`). The IMAP/SMTP workers run on
`OwnerSessionLocal` but **bind the `gaahex.tenant_id` GUC to `account.tenant_id` before
every write**, so RLS scopes inserts even on the owner role — the same per-tenant GUC
discipline the scheduler already uses.

<a id="i4"></a>**I4. Killer test stays green.** Mail adds KT-MAIL-1/2/3 alongside the M0 killer;
the M0 test is never modified.

<a id="i5"></a>**I5. Config-only entities use the generic API surface.** Mail does **not** ride
`/api/{slug}`; it is an allowed module namespace (`/api/mail/*`) exactly like
`/api/webhooks`. No `if slug=='mail'` lands in `records.py`. (The Q4 ratchet — no new
entity-specific routes outside the generic record router — does **not** block a module
router; PR review confirms the distinction.)

<a id="i6"></a>**I6. Permission keys follow `object.action` and are immutable.** All `mail.*` keys
land in file 15 before code.

<a id="i7"></a>**I7. Enum values are UPPER_SNAKE_CASE.** `MailAccountStatus`, `MailAuthType`,
`MailTransportSecurity`, `MailFolderRole`, `MailMessageDirection`, `MailSendStatus`,
`MailAttachmentDownloadState` register in file 14 in UPPER_SNAKE_CASE.

<a id="i8"></a>**I8. Deploy contract gates production boot.** `_assert_production_deploy_contract()`
extends so that if `feature_mail_enabled=true` in production, at least one tenant
`mail_account` must exist with a real (non-mock) host + credentials present — fail-closed,
matching the existing mock-provider refusal. No weakening of the existing checks.

<a id="i9"></a>**I9. The 70 LOCKED standards.** New enums land in file 14 and new permission keys in
file 15 **before** the code that adopts them. Frontend obeys D20 (tokens only, no inline
hex/px) and file 10 (PageShell + standard zones / tabs).

<a id="i10"></a>**I10. Append-only signoff trail.** Mail introduces no §3-invariant relaxation. If a
future need (e.g. a shared-team-inbox assignment model, or a per-user GUC) ever requires
relaxing an invariant, it goes through a successor sealed-baseline file, never a silent edit.

---

## 5. Data model

Four tables in `backend/app/models/mail.py`, created in **one additive Alembic migration**
(`xxxx_mail_tables.py`) that also applies the four `tenant_isolation` policies in a single
`upgrade()` and seeds the `mail.*` permission keys. Every PK is `uuid7`; every row carries
`tenant_id` (FK `tenant.id`, indexed); encrypted columns store as `Text` (Fernet output never
truncates). Patterns reuse `webhook.py` (encrypted `secret`), `attachment.py`
(`storage_key`/`checksum`/`mime`), `calendar.py` (`created_by`/`owner_node_id`), and
`record.py` (`deletion_state`).

> **Resolved contradiction (sync cursor).** One design proposed a separate
> `mail_sync_state` table; another folded the cursor into `mail_folder`. This plan
> **folds the cursor into `mail_folder`** (`uidvalidity`, `last_uid`, `highest_modseq`,
> `last_sync_at`) because the IMAP cursor is intrinsically per-folder. Account-level
> liveness (`status`, `last_error`, `last_sync_at`) lives on `mail_account`.

### 5.1 `mail_account` — per-(tenant, user) mailbox connection

| column | type | notes |
|---|---|---|
| `id` | `UUID` PK | `uuid7` |
| `tenant_id` | `UUID` NOT NULL, FK `tenant.id`, indexed | D1 |
| `owner_user_id` | `UUID` NULL, FK `app_user.id` | mailbox owner; NULL = tenant-shared / system sender |
| `owner_node_id` | `UUID` NULL, FK `org_node.id` | org placement for visibility scoping |
| `reference_number` | `String(20)` NULL | `MBX-000001` per-tenant business id (S5/D8) |
| `display_name` | `String(160)` NOT NULL | "Support — support@isp1.am" |
| `email_address` | `String(320)` NOT NULL | RFC max |
| `imap_host` | `String(255)` NOT NULL | |
| `imap_port` | `Integer` NOT NULL, default 993 | |
| `imap_security` | `String(10)` NOT NULL, default `SSL` | `SSL`\|`STARTTLS`\|`NONE` |
| `smtp_host` | `String(255)` NOT NULL | |
| `smtp_port` | `Integer` NOT NULL, default 465 | |
| `smtp_security` | `String(10)` NOT NULL, default `SSL` | same enum |
| `auth_type` | `String(20)` NOT NULL, default `PASSWORD` | `PASSWORD`\|`OAUTH2` |
| `auth_username` | `String(320)` NULL | login user if ≠ `email_address` |
| `secret_password` | `EncryptedString()` NULL | Fernet — IMAP/SMTP password |
| `oauth_provider` | `String(40)` NULL | `GOOGLE`\|`MICROSOFT`\|`GENERIC` |
| `oauth_client_id` | `String(255)` NULL | not secret |
| `secret_oauth_client_secret` | `EncryptedString()` NULL | Fernet |
| `secret_oauth_refresh_token` | `EncryptedString()` NULL | Fernet |
| `oauth_access_token_expires_at` | `DateTime(tz)` NULL | access token cached in worker, not DB |
| `is_system_sender` | `Boolean` NOT NULL, default false | sends invoices/dunning |
| `is_default` | `Boolean` NOT NULL, default false | default compose-from for the owner |
| `sync_enabled` | `Boolean` NOT NULL, default true | pause polling without delete |
| `supports_idle` | `Boolean` NOT NULL, default false | learned per account |
| `status` | `String(20)` NOT NULL, default `PENDING` | `MailAccountStatus` |
| `last_error` | `Text` NULL | last connect/auth detail (redacted) |
| `last_sync_at` | `DateTime(tz)` NULL | last successful poll |
| `created_at` / `updated_at` | `DateTime(tz)` | server_default now() (+ onupdate) |
| `created_by` | `UUID` NOT NULL, FK `app_user.id` | |
| `deletion_state` | `String(20)` NOT NULL, default `ACTIVE` | D14 5-value enum (`record.py`) |
| `deleted_at` | `DateTime(tz)` NULL | |

**`MailAccountStatus`:** `PENDING`, `CONNECTED`, `AUTH_ERROR`, `CONN_ERROR`, `DISABLED`.

**Indexes/constraints:** `ix_mail_account_tenant_id`; `ix_mail_account_owner
(tenant_id, owner_user_id)`; `ix_mail_account_sync (tenant_id, status, sync_enabled)`;
partial-unique `uq_mail_account_default (tenant_id, owner_user_id) WHERE is_default AND
deletion_state='ACTIVE'`; partial-unique `uq_mail_system_sender (tenant_id) WHERE
is_system_sender AND deletion_state='ACTIVE'` (at most one system sender per tenant);
`UniqueConstraint(tenant_id, owner_user_id, email_address)`. **RLS:** `tenant_isolation`.

### 5.2 `mail_folder` — IMAP folders + per-folder sync cursor

| column | type | notes |
|---|---|---|
| `id` | `UUID` PK | `uuid7` |
| `tenant_id` | `UUID` NOT NULL, FK `tenant.id`, indexed | |
| `account_id` | `UUID` NOT NULL, FK `mail_account.id` **ON DELETE CASCADE**, indexed | |
| `imap_path` | `String(512)` NOT NULL | raw mUTF-7-decoded folder name |
| `display_name` | `String(255)` NOT NULL | |
| `role` | `String(20)` NULL | `MailFolderRole`: `INBOX`\|`SENT`\|`DRAFTS`\|`TRASH`\|`SPAM`\|`ARCHIVE`\|`CUSTOM` |
| `uidvalidity` | `BigInteger` NULL | RFC 3501 — change ⇒ full resync |
| `last_uid` | `BigInteger` NULL | incremental cursor (advanced only after commit) |
| `highest_modseq` | `BigInteger` NULL | CONDSTORE, when advertised |
| `last_sync_at` | `DateTime(tz)` NULL | |
| `unseen_count` / `total_count` | `Integer` NOT NULL default 0 | cached badges |
| `created_at` | `DateTime(tz)` | server_default now() |

**Constraints:** `ix_mail_folder_tenant_id`, `ix_mail_folder_account_id`,
`UniqueConstraint(tenant_id, account_id, imap_path)`. **RLS:** `tenant_isolation`.

### 5.3 `mail_message` — one stored email (header + body + flags + threading)

| column | type | notes |
|---|---|---|
| `id` | `UUID` PK | `uuid7` |
| `tenant_id` | `UUID` NOT NULL, FK `tenant.id`, indexed | |
| `account_id` | `UUID` NOT NULL, FK `mail_account.id` **ON DELETE CASCADE**, indexed | |
| `folder_id` | `UUID` NULL, FK `mail_folder.id` **ON DELETE SET NULL**, indexed | NULL for a queued outbound before placement |
| `uid` | `BigInteger` NULL | IMAP UID (NULL for local drafts) |
| `uidvalidity` | `BigInteger` NULL | folder UIDVALIDITY at fetch (dedupe fence) |
| `message_id` | `String(998)` NULL, indexed | RFC `Message-ID` |
| `in_reply_to` | `String(998)` NULL | parent `Message-ID` |
| `references_raw` | `Text` NULL | full `References` header |
| `thread_id` | `UUID` NOT NULL, indexed | denormalized thread key (see [§6.3](#63-threading)) |
| `from_addr` / `from_name` | `String(320)`/`String(255)` NULL | envelope sender |
| `to_addrs` / `cc_addrs` / `bcc_addrs` / `reply_to_addrs` | `JSONB` NOT NULL default list | `[{name,email}]` |
| `subject` | `String(998)` NULL | |
| `snippet` | `String(280)` NULL | precomputed list preview |
| `body_text` | `Text` NULL | plaintext part |
| `body_html` | `Text` NULL | raw HTML part (sanitized at render) |
| `direction` | `String(10)` NOT NULL, default `INBOUND` | `MailMessageDirection`: `INBOUND`\|`OUTBOUND` |
| `flag_seen` / `flag_flagged` / `flag_answered` / `flag_draft` | `Boolean` NOT NULL default false | IMAP flag mirror |
| `is_deleted` | `Boolean` NOT NULL default false | `\Deleted` mirror |
| `has_attachments` | `Boolean` NOT NULL default false | |
| `size_bytes` | `BigInteger` NULL | RFC822 size |
| `sent_at` | `DateTime(tz)` NULL | header `Date` |
| `received_at` | `DateTime(tz)` NULL | INTERNALDATE / receive time |
| `send_status` | `String(20)` NULL | OUTBOUND `MailSendStatus`: `QUEUED`\|`SENT`\|`FAILED`\|`BOUNCED` |
| `send_error` | `Text` NULL | SMTP/DSN detail |
| `related_entity_type` / `related_entity_id` | `String(40)`/`UUID` NULL | polymorphic business link (Communications tab), no FK |
| `outbound_message_id` | `UUID` NULL | link to `outbound_message` for system sends + bounce correlation |
| `created_at` | `DateTime(tz)` | server_default now() |

**Body storage:** inline `Text` (Postgres TOAST handles large bodies); list queries select
only header/snippet columns. Raw full MIME is **not** stored in the DB.

**Indexes:** tenant/account/folder; `ix_mail_message_folder_uid (tenant_id, folder_id, uid)`;
`ix_mail_message_thread (tenant_id, thread_id, sent_at)`;
`ix_mail_message_msgid (tenant_id, message_id)`;
`ix_mail_message_list (tenant_id, folder_id, received_at)`;
partial `ix_mail_message_sendq (tenant_id, send_status) WHERE send_status='QUEUED'`;
`ix_mail_message_related (tenant_id, related_entity_type, related_entity_id)`.
**Idempotency fence:** partial-unique
`uq_mail_message_uid (tenant_id, account_id, folder_id, uidvalidity, uid) WHERE uid IS NOT
NULL` — re-polling the same UID never duplicates; `message_id` is the secondary dedupe
guard. **FTS:** a `tsvector` GIN index is a deferred follow-up migration (Phase D), not in
the first migration. **RLS:** `tenant_isolation`.

### 5.4 `mail_attachment` — file parts (metadata only; bytes in StorageBackend)

| column | type | notes |
|---|---|---|
| `id` | `UUID` PK | `uuid7` |
| `tenant_id` | `UUID` NOT NULL, FK `tenant.id`, indexed | |
| `message_id` | `UUID` NOT NULL, FK `mail_message.id` **ON DELETE CASCADE**, indexed | |
| `filename` | `String(255)` NOT NULL | |
| `content_type` | `String(160)` NOT NULL | MIME |
| `size_bytes` | `BigInteger` NOT NULL | |
| `checksum` | `String(64)` NULL | SHA-256 hex (`attachment.py` precedent) |
| `storage_key` | `String(500)` NULL | StorageBackend key; NULL until fetched (lazy) or if oversize |
| `is_inline` | `Boolean` NOT NULL default false | |
| `content_id` | `String(255)` NULL | `cid:` for inline images |
| `imap_part_id` | `String(40)` NULL | MIME part path for lazy fetch |
| `download_state` | `String(20)` NOT NULL, default `PENDING` | `MailAttachmentDownloadState`: `PENDING`\|`STORED`\|`FAILED`\|`SKIPPED_OVERSIZE` |
| `created_at` | `DateTime(tz)` | server_default now() |

**Constraints:** tenant/message indexes; `ix_mail_attachment_cid (tenant_id, message_id,
content_id)`. **RLS:** `tenant_isolation`.

### 5.5 Permission keys (file 15 — `object.action`, lowercase, immutable)

```
mail.account.view          mail.account.manage         mail.system_sender.manage
mail.view                  mail.read                   mail.send
mail.reply                 mail.delete                 mail.move
mail.flag                  mail.draft.manage           mail.attachment.download
mail.sync.trigger
```

- `mail.account.manage` gates credential write (parallel to the webhooks `config.manage`
  gate). Secrets are **write-only over the API** — responses expose `has_password:bool`,
  never the value (the `webhook_def.secret` posture).
- `mail.system_sender.manage` is Super-Admin-scope: designate the tenant's
  `is_system_sender` account, so a normal user cannot hijack the billing sender.
- `mail.read` / `mail.attachment.download` are audited via `workflow.emit` for messages on
  a sensitive `related_entity` (file 15 attachment-download posture).

### 5.6 Enums registered (file 14, UPPER_SNAKE_CASE)

`MailAccountStatus`, `MailAuthType`, `MailTransportSecurity`, `MailFolderRole`,
`MailMessageDirection`, `MailSendStatus`, `MailAttachmentDownloadState`.

---

## 6. Architecture

`backend/app/services/mail/` (service + workers) + `backend/app/routers/mail.py`
(`APIRouter(prefix="/api/mail")`, registered in `main.py` **before** `records.router` so
`/api/mail` is never captured as an entity slug — the `outbound_router` precedent).

### 6.1 Inbound IMAP worker

Library: **`aioimaplib`** as the async transport (native `IDLE` via `wait_server_push`,
async fetch on the existing event loop — no thread-per-account), stdlib
`email.parser.BytesParser(policy=email.policy.default)` for MIME, and `imapclient.imap_utf7`
borrowed only for modified-UTF-7 folder-name encode/decode. Both deps are pure-python
(no native build), safe for the on-prem docker image.

**Where it runs:** the **same process** as the existing scheduler but a **separate asyncio
loop** with its own `start_mail_sync(app)` / `stop_mail_sync(app)` lifespan contract, wired
in `main.py` right after `start_scheduler`. It is **not** folded into the hourly `_JOBS`
sweep (IMAP needs long-lived IDLE connections and a tighter cadence). With
`mail_sync_enabled` unset, `start_mail_sync` spawns no task and opens no socket — inert,
exactly like the scheduler's gate.

**Shape:** one manager loop reconciles a set of per-account `asyncio.Task`s against the DB
(enumerating ACTIVE `mail_account` rows **across all tenants** on `OwnerSessionLocal`,
binding the `gaahex.tenant_id` GUC to `account.tenant_id` for every write); concurrency is
bounded by a `mail_sync_max_concurrent_accounts` semaphore (not by tenant count, so 5 ISPs
share one capped pool). Each account loop: one full `sync_account()` catch-up, then IDLE
(`supports_idle`) with re-issue before the RFC 2177 29-min ceiling, else poll every
`mail_sync_poll_seconds`. Per-account fail isolation — one ISP's dead server never stalls
the other four. The model is shardable by `hash(account_id)` for future horizontal scale
with zero code change.

**Sync correctness:**
- **UIDVALIDITY:** compare on every `SELECT`; on change, reset `last_uid=0` and re-key
  existing rows by `Message-ID` for dedupe, then persist the new value (RFC 3501 §2.3.1.1).
- **Incremental fetch:** `UID SEARCH UID <last_uid+1>:*` in `mail_sync_fetch_batch` chunks;
  fetch with **`BODY.PEEK[]`** (never `RFC822`/`BODY[]`, which would set `\Seen`); advance
  `last_uid` monotonically only **after** each message commits (crash-safe).
- **Idempotent ingest:** `ON CONFLICT DO NOTHING` on the partial-unique UID fence.
- **Flag reconcile:** PULL `UID FETCH FLAGS` (CONDSTORE `CHANGEDSINCE highest_modseq` when
  advertised) → update local flags; PUSH local flag-change intents via `UID STORE
  +/-FLAGS`. Server is source of truth on conflict.
- **Backoff:** `MailAuthError` → `status=AUTH_ERROR`, stop the task, emit audit, **no
  auto-retry** (avoids lockout storms); transient `MailConnError` → exponential backoff
  (`mail_sync_backoff_base_seconds` → `_max_seconds`). Per-message parse error → mark that
  message FAILED, continue (cursor only advances past committed messages).

### 6.2 Outbound SMTP gateway

`SmtpEmailGateway` (`backend/app/services/comms/smtp_email.py`) implements the **existing
`EmailGateway` Protocol** exactly (sibling of `sendgrid_email.py`), so every existing caller
(notifications, billing, broadcasts) and the `Attachment` dataclass and the
`EmailGatewayError` exception tree all work unchanged. SMTP/threading params
(`cc`/`bcc`/`reply_to`/`in_reply_to`/`references`/`headers`) are defaulted kwargs. Transport
is **`aiosmtplib`** (native async; no `asyncio.to_thread` shim). `send()`:

1. Mint an RFC-5322 `Message-ID` (`<{uuid7()}@{from_domain}>`) — stored as the bounce/Sent
   correlation key.
2. Build MIME (`app/services/mail/mime.py`: text + `multipart/alternative` html + decoded
   attachments + inline `Content-ID` + threading headers).
3. Submit via `aiosmtplib.send(...)`; map failures onto the existing exception tree
   (`SMTPConnectError`/`Disconnected` → connection; `RecipientsRefused`/`ResponseException`
   → command; `TimeoutError` → timeout).
4. Best-effort IMAP `APPEND` to the Sent folder (shared `aioimaplib` helper) — failure is
   logged and **swallowed** (the mail already left).
5. Return `EmailSendResult(message_id, status="accepted", ...)`.

Every log line reuses `channels._redact_addr` — `to=<redacted> subject body_len` only,
never password/body.

> **Resolved contradiction (number of SMTP paths).** Three send paths exist today
> (`channels._smtp_adapter` legacy, `adapters/email.py::SmtpEmailAdapter` OOP, and the comms
> gateways). This plan makes **`SmtpEmailGateway` the single real implementation**; the
> legacy adapters are left only as the env-global single-tenant fallback and are superseded
> when the Mail module's adapter is registered.

### 6.3 Threading

Hybrid header-based threading computed at ingest in the service layer (not the DB), writing a
denormalized `thread_id` (no `mail_thread` table in v1, [OD-5](#od5)):
1. Look up `In-Reply-To` and the last `References` id against `mail_message.message_id`
   within `(tenant_id, account_id)` → inherit that parent's `thread_id`.
2. Else normalized-subject + participant match within a 30-day window (JWZ-lite).
3. Else mint a new `thread_id = uuid7()`.
Thread view is a single indexed range scan on `ix_mail_message_thread`.

### 6.4 Notification routing (invoices / dunning)

Today the chain `notify_hooks.fire → emit_notification → _dispatch_external →
channels.dispatch → adapters.registry["email"]` ends at a **process-global**
`SmtpEmailAdapter` built once from env — the exact thing that breaks multi-tenancy. The fix
is **additive and non-breaking**: a `TenantEmailAdapter` (`channel="email"`) that reads
`meta["tenant_id"]`, opens a tenant-bound session, resolves
`get_tenant_email_gateway(s, tenant_id, purpose="system")` (the `is_system_sender` account),
and sends. Two touch-points: (a) add `tenant_id` to the `meta` dict `channels.dispatch`
already builds (one line, backward-compatible — existing adapters ignore unknown keys);
(b) register `TenantEmailAdapter` in `adapters.registry["email"]` in place of the env-global
adapter when Mail is active, falling back to `LogEmailAdapter` in dev/test. The retry sweep,
`OutboundMessage` logging, and A26 prefs are all unchanged. A tenant with no system sender
falls back to `get_email_gateway()` (mock/log in dev) and records FAILED — never 500s.

`get_tenant_email_gateway(s, tenant_id, account_id=None, purpose)` (in
`app/services/mail/gateway.py`) builds an `SmtpEmailGateway` from the calling tenant's
decrypted `mail_account` (not global env); `purpose="user"` resolves `account_id`,
`purpose="system"` resolves the `is_system_sender` row. The legacy global path stays intact
(`register_email_gateway("smtp", ...)` lets simple single-tenant deploys pick SMTP from env).

### 6.5 Storage

Attachment bytes go to the existing `StorageBackend` via `storage.store(...)` →
`StoredObject(storage_key, size_bytes, checksum_sha256)`; the DB row is metadata only. The
same tenant-partitioned `LocalDiskBackend` that serves portal attachments serves Mail; the
`storage_key` is a system UUIDv7 path (never the original filename — so a hostile filename
can't escape the tenant directory). Parts over `storage_max_file_bytes` (100 MB, reused) are
recorded with `download_state=SKIPPED_OVERSIZE`, `storage_key=NULL` — one huge attachment
never fails the whole message.

### 6.6 Encryption

`secret_password` / `secret_oauth_*` are `EncryptedString` (Fernet AEAD, key
`GAAHEX_FIELD_KEY`, storage `Text`) — auto-encrypt on bind, decrypt on read, decrypt only at
connect time, never logged, never serialized. `decrypt_str` returns `None` on a retired/garbled
key, so the service degrades to `status=AUTH_ERROR` with
`last_error="[credential unreadable — re-enter]"` — **never a 500**. Key rotation reuses the
documented Fernet sweep (MultiFernet for zero-downtime). XOAUTH2 refresh runs server-side via
the canonical `app/utils/http_client.get_async_client`, re-encrypting the new access token.

### 6.7 New settings (`config.py`, scheduler-style block, all default-inert)

```
feature_mail_enabled: bool = False           # master module gate (deploy-contract-aware)
mail_sync_enabled: bool = False              # inbound worker switch (independent of scheduler_enabled)
mail_sync_poll_seconds: int = 120
mail_idle_refresh_seconds: int = 1500        # < RFC 2177 29-min ceiling
mail_sync_max_concurrent_accounts: int = 20  # semaphore: open IMAP sockets per process
mail_sync_fetch_batch: int = 50              # UIDs per round-trip
mail_sync_max_message_bytes: int = 26214400  # 25 MB → headers-only above this
mail_sync_backoff_base_seconds: int = 30
mail_sync_backoff_max_seconds: int = 1800
```

Attachment size reuses `storage_max_file_bytes`; no new knob.

---

## 7. API surface

`APIRouter(prefix="/api/mail")`. Every endpoint: `Depends(current_user)` +
`Depends(get_session)`, a `_require_*` permission gate (webhooks pattern), and a
tenant-scoped `_load` (404 if not this tenant's row, like `webhooks._load`). Secrets are
never returned. Send emits `workflow.emit(type_="MAIL_SENT", entity_key="mail_message", ...)`
and records an `OutboundMessage(channel="email")`.

```
# Accounts (mail.account.manage to write; mail.account.view to read; secrets never returned)
GET    /api/mail/accounts
POST   /api/mail/accounts
GET    /api/mail/accounts/{id}
PATCH  /api/mail/accounts/{id}                          # password only if provided
DELETE /api/mail/accounts/{id}
POST   /api/mail/accounts/{id}/test                     # connect SMTP+IMAP → {imap_ok, smtp_ok, detail?}
POST   /api/mail/accounts/{id}/sync                     # mail.sync.trigger → enqueue an IMAP poll
GET    /api/mail/accounts/{id}/sync-state

# Folders / messages (mail.view + per-user owner check; mail.read opens a body)
GET    /api/mail/accounts/{id}/folders
GET    /api/mail/messages?account_id&folder&q&unseen&limit&offset   # X-Total-Count header
GET    /api/mail/messages/{id}                          # mail.read; marks seen
GET    /api/mail/threads/{id}                           # ordered thread
PATCH  /api/mail/messages/{id}                          # flags/move: {read?, starred?, folder?} (mail.flag/mail.move)
DELETE /api/mail/messages/{id}                          # mail.delete (→ Trash)
GET    /api/mail/messages/{id}/attachments/{aid}        # mail.attachment.download (audited; blob)

# Compose / drafts (mail.send / mail.reply / mail.draft.manage)
POST   /api/mail/attachments                            # bupload multipart → {attachment_id}
POST   /api/mail/messages/send                          # {account_id,to[],cc[],bcc[],subject,html,text,attachment_ids[],in_reply_to?,references[]?}
GET/POST/PATCH/DELETE /api/mail/drafts[/{id}]           # draft CRUD + autosave
GET    /api/mail/contacts?q=                            # recipient autocomplete (or reuse /api/customers)
```

Large attachments are **pre-uploaded** to `/api/mail/attachments` (returning ids the send
payload references) so a multi-MB file never bloats the JSON send.

---

## 8. Frontend

The codebase is ~80% ready for an email client; reuse-first:

- **Page type:** reuse the existing `COMMUNICATION` PageShell type (documented as "3-pane
  list/thread/context (Inbox, Helpdesk)"). No new PageType (the union is locked).
- **CSS:** reuse the already-authored, never-wired `.gx-comms .mail*` 3-pane skeleton in
  `frontend/src/styles/_comms.css` (folders 200px | list 340px | reader 1fr; `.mail-row.unread`
  gold left border; responsive collapse). `MailView` opts in via `workspaceClassName="gx-comms"`,
  exactly like `MessagesView`. Any additions go under `.gx-comms` using `--gx-*` tokens only —
  zero inline hex/px (D20).
- **API client:** new `frontend/src/lib/mail.ts` of typed `bget`/`bpost`/`bupload`/`openDocument`
  wrappers mirroring `billing.ts`/`helpdesk.ts`. No raw `fetch` in views (A8/AC-2). `bget`'s
  `{status,ok,data}` gives the 404-degrade-vs-5xx-error split; `intercept401` is free.
- **Nav/routing:** one standalone **Mail** nav entry (`viewType:'mail'`, existing `MailIcon`);
  a `MailRouteAdapter` on `/mail` reads `?folder`, `?msg`, `?account`, `?settings` via
  `useSearchParams` (the `HelpdeskRouteAdapter` pattern), so a dunning notification can
  deep-link to a specific sent message and selection survives reload. Account settings open
  **inside** MailView (gear → modal / `?settings=1`), not a second nav item.
- **View decomposition** (`views/mail/`): `MailView` (PageShell + 3-pane orchestration + the
  three fetches) → `FolderSidebar`, `MessageList`/`MessageRow`, `ThreadReader`, `MessageBody`,
  `AttachmentChips`, `ComposeModal`, `RecipientField`, `RichTextEditor`, `MailAccountSettings`;
  `types.ts` for the shared shapes.
- **Security at render:** `MessageBody` renders inbound HTML **only through DOMPurify** (add
  `dompurify`); never raw `dangerouslySetInnerHTML`. Remote images gated behind a "Show
  images" toggle (tracking-pixel/privacy default-off); links `rel="noopener"`. The compose
  body lives behind a `RichTextEditor` emitting a stable `{html,text}` contract (a plain
  `<textarea>` is an acceptable v1 fill behind that component).
- **Settings form:** Identity / IMAP / SMTP / Auth groups; **Test connection**, **Save**,
  **Sync now**, **Set default**, **Delete**. Password fields are **write-only** — the GET
  never returns the secret; the field shows "•••• set — replace?" and transmits only a newly
  typed value.
- **States** (reuse `components/States.tsx`): the **"No mail account yet"** `EmptyState` →
  "Add a mail account" is the most important first-run state; empty folder, no-selection
  placeholder, `ErrorBanner`+retry on 5xx, `toast` on send/test errors (keeping the draft
  open). `PermissionDenied` when the user lacks `mail.view`.

> **Resolved contradiction (permission object).** The frontend uses dedicated `OBJ.MAIL_*`
> constants matching the `mail.*` registry keys ([§5.5](#5-data-model)) — **not**
> `OBJ.COMMUNICATION`. COMMUNICATION is reused only as the PageShell page *type*. The UI
> never sends `tenant_id`; tenant scoping is JWT + RLS server-side, so 5 ISPs "just work"
> with zero client branching.

---

## 9. Security & multi-tenancy — the "5 companies" proof

**Three layers, evaluated in order** (RLS → ownership → permission), matching file 15's
"a permission grant alone is never sufficient":

1. **Tenant (RLS, hard fence).** Every Mail table carries `tenant_id` + the byte-identical
   `tenant_isolation` policy, keyed on the `gaahex.tenant_id` GUC the auth layer sets after
   re-validating the JWT `tenant` claim. Under prod's `gaahex_app` NOSUPERUSER role a query
   under tenant A's GUC can never see tenant B. The IMAP/SMTP workers run on the owner role
   but **bind the GUC to `account.tenant_id` before every write**, so even worker inserts are
   RLS-scoped. NULL GUC ⇒ default-deny.
2. **Per-user mailbox ownership (service-layer predicate).** RLS isolates tenants but cannot
   express per-user-within-tenant. Every message/folder/attachment query joins to
   `mail_account` and filters: `owner_user_id = current_user` **OR** a shared/`is_system`
   account the caller's grants cover (via `can(grants, "mail.view")` at the right org scope).
   Reading another user's personal mailbox without coverage → 404 (the `webhooks._load`
   posture). The worker writes the correct `account_id`; ownership is derived from the
   account, never trusted from the message.
3. **Permission (RBAC).** The `mail.*` keys gate the action even on a visible mailbox (a user
   may `mail.view` a shared support inbox but lack `mail.send` from it). `mail.system_sender.manage`
   is separated so a normal user cannot hijack the billing sender.

**The "5 companies plug in" proof.** Onboarding per ISP is config-only, no code: a super_admin
`POST /api/mail/accounts` with that ISP's own SMTP/IMAP host + creds (or OAuth). Because every
row carries `tenant_id`, RLS scopes reads; because send dials the **account's** `smtp_host`
(never a global `settings.smtp_host`), each ISP's mail leaves from its own server/domain with
SPF/DKIM aligned by construction. Five accounts across five tenants are five independent,
DB-isolated, app-ownership-fenced connections. Dunning for tenant A literally connects to A's
server. This is proven mechanically by **KT-MAIL-1/2/3** under the hard `backend-rls` job.

**PII / log redaction.** Every operator log line in the Mail service + workers uses
`channels._redact_addr` — redacted addresses + `body_len` only, never subject/body/recipients/
secrets in cleartext. Attachment downloads are audited via `workflow.emit`.

---

## 10. Implementation phases

Phased, not parallel. Each phase has a hard exit gate. **Phase A (Foundation) folds into M1
Phase 2.A** — the M1 plan's P2.A is "Email — `EMAIL_GATEWAY_PROVIDER=sendgrid` reaches a real
address." The Mail Foundation phase generalizes that same notification surface to per-tenant
SMTP: `SmtpEmailGateway` + `TenantEmailAdapter` slot into the **same `EmailGateway` Protocol
seam** M1 P2.A exercises, so the two are landed in one review window (M1 P2.A's exit — "outbound
test email reaches a real address; deploy contract passes; audit row recorded" — is satisfied by
either SendGrid **or** a tenant SMTP account, and KT-MAIL-3 becomes a sibling of M1's email-smoke).

### Phase A — Foundation: per-tenant SMTP send + account model *(folds into M1 Phase 2.A)*

| Task | Exit |
|---|---|
| `mail.*` keys land in file 15; enums in file 14 (before code). | Standards updated. |
| `feature_mail_enabled` + `mail_sync_*` settings (default OFF). | Fresh clone / CI fully inert. |
| Migration: `mail_account` (+ `mail_folder` stub) with `tenant_isolation` RLS in-file; seed `mail.*` keys. | `backend-rls` verifies the policy. |
| `SmtpEmailGateway` (Protocol-conformant) + `get_tenant_email_gateway` + `TenantEmailAdapter`; `tenant_id` added to `channels.dispatch` meta. | Existing SendGrid/mock path + full suite untouched. |
| Accounts CRUD + `/test` + `POST /api/mail/messages/send` (send via account SMTP, append to Sent, log `OutboundMessage`, emit `MAIL_SENT`). | — |
| **Exit gate** | **KT-MAIL-1** (send isolation) + **KT-MAIL-3** (notification via tenant SMTP) green under `backend` **and** `backend-rls`; M0 killer still green. |

### Phase B — Inbound IMAP

| Task | Exit |
|---|---|
| `mail_message` + `mail_attachment` migrations (RLS in-file); fold sync cursor into `mail_folder`. | `backend-rls` verifies. |
| `start_mail_sync`/`stop_mail_sync` lifespan + manager loop + per-account loop (IDLE + poll fallback, semaphore, backoff). | Worker inert unless `mail_sync_enabled`. |
| Folder discovery (mUTF-7), incremental UID fetch (`BODY.PEEK[]`), MIME parse → bodies inline + attachments to `StorageBackend`, UIDVALIDITY recovery, bidirectional flag reconcile. | — |
| **Exit gate** | **KT-MAIL-2** (inbound sync + attachment to storage + flag round-trip, idempotent re-poll) green. |

### Phase C — UI

| Task | Exit |
|---|---|
| `lib/mail.ts`; `MailView` + `views/mail/*` against `COMMUNICATION` + `.gx-comms .mail*`; nav entry + `MailRouteAdapter`. | `tsc --noEmit` green; D20 clean. |
| Inbox / compose / reader / folders / `MailAccountSettings` (write-only secrets); DOMPurify body render + image gate. | — |
| **Exit gate** | Manual smoke: read / compose / attach in two tenants; no cross-leak; first-run "No mail account yet" state works. |

### Phase D — Polish: threads / search / bounce / IDLE refinement

| Task | Exit |
|---|---|
| Deferred `tsvector` GIN migration + FTS over `subject`/`body_text`. | Search within SLA. |
| DSN/bounce classifier in the IMAP worker → correlate by minted `Message-ID` → `send_status=BOUNCED` + per-tenant suppression for hard bounces. | Bounce flips delivery status; dunning stops hammering a dead address. |
| IDLE hardening / liveness probing; optional manager-loop sharding note. | Near-real-time on IDLE-capable servers; poll fallback verified. |
| **Exit gate** | Thread assembly + FTS within SLA; bounce updates delivery status; full suite + `backend-rls` green. |

---

## 11. Killer tests

Named by intent, docstring tied to the invariant, **never** skipped / flaky / xfail. Live at
`backend/tests/test_mail.py` and run under the `gaahex_app` role in `backend-rls`.

### KT-MAIL-1 — `test_mail_cross_tenant_send_isolation`
Tenant A configures account A (SMTP A); tenant B configures account B. A sends; B sends.
Under each tenant's GUC, `GET /api/mail/accounts` and `/messages` return only that tenant's
rows; `GET /api/mail/messages/{A's id}` as B → 404. **Proves** zero cross-tenant read at the
RLS layer ([I3](#i3)) — the Mail analogue of `test_rls.py`.

### KT-MAIL-2 — `test_mail_inbound_sync_attachment_and_flag_roundtrip`
A fake/mocked IMAP server yields one message with one attachment. The worker syncs →
`mail_message` row + `mail_attachment` persisted to `StorageBackend` (resolvable
`storage_key`, bytes round-trip). `PATCH .../messages/{id}` sets `read=true` → the flag pushes
to IMAP and **survives a re-sync** (idempotent on `(uidvalidity, uid)` — no duplicate rows).
**Proves** inbound correctness, attachment storage, and flag bidirectionality.

### KT-MAIL-3 — `test_mail_notification_via_tenant_own_smtp`
With tenant A's `is_system_sender` account configured, trigger a dunning notification. Assert:
the send dialed **account A's** `smtp_host` (not `settings.smtp_host`); an
`OutboundMessage(channel="email", status="SENT")` row exists for A; a
`mail_message(direction="OUTBOUND", folder=SENT, outbound_message_id=...)` row exists; a
`MAIL_SENT` event was emitted via `workflow.emit`. Tenant B (no system account) is unaffected.
**Proves** the multi-tenant notification thesis + audit lineage ([I2](#i2)).

---

## 12. Risk register

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R-MAIL-1 | Tenant mail flagged spam (SPF/DKIM/DMARC). | M | H | We are an SMTP **client** of the tenant's own server; their MTA's reputation/DKIM apply by construction. Onboarding runbook verifies SPF/DKIM at the tenant server; `/test` surfaces auth/TLS failures pre-launch. We add no relay hop and sign no DKIM. |
| R-MAIL-2 | Missing `tenant_isolation` on any one Mail table ⇒ silent cross-tenant leak across the 5 ISPs. | L | C | Apply the exact `b1c768523e3e` policy loop over all four tables in the SAME migration; KT-MAIL-1 + the `backend-rls` hard job are the gate. |
| R-MAIL-3 | `GAAHEX_FIELD_KEY` loss/rotation makes every stored credential undecryptable. | L | H | `decrypt_str` → `None` ⇒ `status=AUTH_ERROR` + redacted `last_error`, never 500; documented MultiFernet re-key sweep. |
| R-MAIL-4 | Re-polling duplicates messages (stale UIDs after a UIDVALIDITY change). | M | M | Partial-unique `(tenant_id, account_id, folder_id, uidvalidity, uid) WHERE uid IS NOT NULL`; store `uidvalidity` per folder + full resync on change; `message_id` secondary dedupe. |
| R-MAIL-5 | Stored-XSS / tracking pixels when rendering inbound HTML. | M | H | DOMPurify-only render, never raw `dangerouslySetInnerHTML`; remote images behind "Show images"; `cid:` resolved only against same-message, same-tenant `mail_attachment` rows; `rel="noopener"`. |
| R-MAIL-6 | Auth-failure retry storms lock out a tenant mailbox / trip provider limits. | M | H | `MailAuthError` is terminal (stop task, audit, no auto-retry); resumes only on credential re-save; transient errors use bounded backoff. |
| R-MAIL-7 | IDLE not advertised / silently dropped (NAT/firewall) ⇒ mail appears to stop. | M | M | Learn `supports_idle`; non-IDLE accounts poll; re-issue IDLE before the 29-min ceiling and treat refresh as a liveness probe; broken IDLE falls to a poll cycle. |
| R-MAIL-8 | Unbounded memory on first backfill / post-UIDVALIDITY resync (tens of thousands of UIDs). | M | M | `mail_sync_fetch_batch` chunks (commit per chunk); `> mail_sync_max_message_bytes` → headers-only; semaphore caps concurrent heavy backfills. |
| R-MAIL-9 | A normal user creates/edits the `is_system_sender` account and sends dunning from the tenant domain. | L | H | Separate `mail.system_sender.manage` (Super-Admin scope); partial-unique one-system-sender-per-tenant; audit every change via `workflow.emit`. |
| R-MAIL-10 | A third uncoordinated SMTP path emerges (legacy `channels` + OOP adapter + new gateway). | M | M | `SmtpEmailGateway` is the single real implementation routed through the `EmailGateway` Protocol; legacy adapters are single-tenant fallback only, superseded when the Mail adapter registers. |
| R-MAIL-11 | A "small" PR adds `if slug=='mail'` to `records.py` or a 6th engine module. | L | C | Mail stays behind `/api/mail` (allowed module namespace, like webhooks); PR review confirms no records.py slug branch and no new engine ([I1](#i1)/[I5](#i5)). |
| R-MAIL-12 | Hostile MIME (encoding bombs, deep multiparts, spoofed filenames) crashes the parser / path-traversal. | M | M | `email.policy.default` (tolerant) + per-message try/except → mark FAILED, continue; `storage_key` is a system UUIDv7 path, never the original filename. |
| R-MAIL-13 | Large bodies bloat `mail_message` / slow list scans. | M | M | Postgres TOAST off-lines large bodies; list queries select only header/snippet via `ix_mail_message_list`; no raw MIME in the DB; defer `tsvector` GIN to Phase D. |

L=Low · M=Medium · H=High · C=Critical (thesis/leak-breaking).

---

## 13. Open decisions

Each carries a **RECOMMENDED** default the owner can override. Defaults are chosen to match
the sealed baseline and to keep v1 small.

<a id="od1"></a>**OD-1. Per-user vs per-tenant mailbox.**
**RECOMMENDED:** per-user by default (`mail_account.owner_user_id = current_user`), with shared
mailboxes modeled as `owner_user_id IS NULL` visible to holders of `mail.account.manage` / same
`owner_node_id`, and the tenant's `is_system_sender` account as a special shared mailbox.
*Rationale:* RLS gives the tenant fence for free; per-user ownership is a service-layer predicate
(file 15's sanctioned mechanism) and covers both personal inboxes and shared support inboxes
without a new model. *Override:* a pure per-tenant shared-inbox-only model is simpler but loses
personal mailboxes — defer team-inbox assignment to post-v1 regardless.

<a id="od2"></a>**OD-2. Password vs OAuth2.**
**RECOMMENDED:** ship **password auth in v1** (`auth_type=PASSWORD`, `secret_password`
encrypted) with the OAuth2 columns (`secret_oauth_*`) and `auth_type=OAUTH2` enum value present
in the schema but the provider flow **stubbed**. *Rationale:* the 5 pilot ISPs run their own mail
servers (password/app-password auth), so password unblocks day one; the encrypted columns mean
adding the Google/Microsoft flow later is additive, no migration. *Override:* if a pilot tenant
mandates Google Workspace OAuth, promote XOAUTH2 into Phase A scope.

<a id="od3"></a>**OD-3. Sync IDLE vs poll.**
**RECOMMENDED:** **poll-based sync in v1** (`mail_sync_poll_seconds=120`) with `supports_idle`
learned per account and IDLE used opportunistically when advertised; IDLE hardening is Phase D.
*Rationale:* poll is correct, simple, and firewall-proof; IDLE is a latency optimization, not a
correctness requirement. *Override:* if near-real-time inbox is a launch requirement, pull IDLE
hardening forward into Phase B.

<a id="od4"></a>**OD-4. Body / attachment storage.**
**RECOMMENDED:** **bodies inline** (`body_text`/`body_html` as `Text`, TOAST-handled) for
queryable list/thread/search; **attachments to `StorageBackend`** (metadata-only rows, lazy
fetch); **no raw full MIME in the DB**. *Rationale:* keeps the hot row queryable without a blob
fetch, reuses the proven `StorageBackend`, and bounds row size. *Override:* if a compliance need
for verbatim raw-MIME archival emerges, store raw MIME to `StorageBackend` keyed like an
attachment — not in Postgres.

<a id="od5"></a>**OD-5. Dedicated `mail_thread` table vs denormalized `thread_id`.**
**RECOMMENDED:** **denormalized `thread_id` column**, no `mail_thread` table in v1; thread
metadata derived from the message set. *Rationale:* one indexed range scan per thread; matches the
"defer until needed" discipline. *Override:* add `mail_thread` only when per-thread persisted
state (labels, mute, assignment) is required — additive, no message-row migration.
