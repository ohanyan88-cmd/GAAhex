# 21 — AI Architecture

**Constitutional document.** This is the 21st of 22 Architecture Constitution documents, positioned under Core Architecture (01), Permission Architecture (08), Security Architecture (13), and the Platform Reference Model. All AI assistants, prompts, tools, model configurations, and approval gates must conform to the governance model defined herein.

---

## 1. Purpose

Define the AI Core as a first-class intelligence tier that enables generative and agentic capabilities while enforcing strict separation from automation (rule-based), analytics (statistical), and decision support (scored recommendations). Establish the permission, tenant, audit, and approval boundaries that prevent AI from bypassing security, overstepping approval authority, violating tenant isolation, or executing ungoverned model calls.

## 2. Scope

In scope:

- **AI Core entities** — AiAssistant, Prompt, AiTool, KnowledgeSource, ModelConfig, AiAuditLog, HumanApprovalGate.
- **AI ≠ Automation separation** — AI generates/acts; Automation reacts and performs rule-based actions.
- **AI ≠ Analytics separation** — AI is model-based generative; Analytics is statistical aggregation.
- **AI ≠ Decision Support separation** — AI generates/acts; Decision Support scores and recommends.
- **Scoped roles** — AiAssistant as a tenant-defined, permission-bounded role (e.g., Sales Assistant, NOC Assistant).
- **Prompt registry** — versioned, reviewable, localizable prompt templates.
- **AiTool and action authorization** — each tool is an existing API endpoint; AI's identity is scoped per assistant.
- **ModelConfig and fallback chains** — provider, model name, parameters, failure behavior.
- **KnowledgeSource governance** — which Knowledge Core articles / Data Core records the AI may read; declarative access lists.
- **AiAuditLog** — every prompt + response + tool invocation + model + token consumption audited immutably.
- **Permission boundary (PRM AI hard boundary rule)** — AI MUST NOT bypass Permission, Tenant, Audit, Policy, or Approval.
- **Human approval gates** — HumanApprovalGate entity for high-impact actions requiring explicit approval before execution.
- **Tenant isolation** — AI runs in tenant scope; cross-tenant data access only via Super-Admin.
- **Prompt injection defense** — input sanitization; output validation; sandbox tool execution.
- **AI cost meters** — tokens consumed per tenant; quotas routed through Entitlement Core.
- **Failure modes** — degrade gracefully when model unavailable; never default to OPEN.

Out of scope (handled by other constitution documents):

- *Policy execution (conditional logic)* — see `07_WORKFLOW_PROCESS_ARCHITECTURE.md`.
- *Decision scoring and ranking* — see Decision Support Core in PRM.
- *Automation triggers and reactions* — see Automation Core in PRM.
- *Analytics aggregations* — see Analytics Core in `16_ANALYTICS_ARCHITECTURE.md`.
- *Knowledge article management* — see Knowledge Core in PRM.
- *Approval chain orchestration* — see Approval Core in PRM.
- *Entitlement enforcement* — see Entitlement Core in PRM.

## 3. Goals

- **G1** AI assistants are scoped roles with defined permissions, knowledge sources, and tool access.
- **G2** AI is generative/agentic; it never executes actions without explicit permission grant to both the assistant *and* the user calling the AI.
- **G3** Every prompt, response, and tool invocation is audited immutably with actor, model, tokens, cost, and outcome.
- **G4** AI respects all five universal boundaries: Permission, Tenant, Audit, Security, and Policy.
- **G5** High-impact AI actions (those that mutate business state or incur cost above threshold) require human approval before execution.
- **G6** Prompts are versioned and reviewable; no ungoverned LLM calls in code.
- **G7** AI cost is metered and enforceable via Entitlement Core quotas per tenant.
- **G8** AI fails gracefully and never defaults to OPEN authorization when model is unavailable.
- **G9** The platform accepts zero AI-assisted injection attacks; input and output must be validated at sandbox boundaries.

## 4. Non-Goals

- **NG1** This document does NOT define policy conditions (those belong to Policy Core).
- **NG2** This document does NOT define analytics KPIs or statistical models (those belong to Analytics Core).
- **NG3** This document does NOT define automation rules or trigger/action semantics (those belong to Automation Core).
- **NG4** This document does NOT define approval authority or escalation chains (those belong to Approval Core).
- **NG5** This document does NOT define knowledge article authorship, versioning, or publishing (those belong to Knowledge Core).

## 5. Architecture Principles

### P1 — AI is generative and agentic

An AI action produces outputs (summaries, recommendations, generated text, code) or performs actions (API calls, state mutations) based on models (LLMs, classifiers). This is distinct from automation (fixed rule-based reactions), analytics (statistical insight), and decision support (scored ranking).

### P2 — Separation from automation is strict

**Automation:** `trigger → condition (logic) → action (API call)` (all rules written down; always identical given same inputs).

**AI:** `input + context + model → generated output or action` (creative/variable given same inputs; generative nature).

A workflow that uses both must be clear about which is which. Automation is kernel; AI is optional surface.

### P3 — Separation from analytics is strict

**Analytics:** Statistical aggregation, KPI calculation, trend detection (uses historical data at rest; no generative model required).

**AI:** Generative model inference, summarization, recommendation with learned patterns (uses a learned model; produces novel outputs).

Analytics can feed data to AI (AI reads a KPI dashboard), but Analytics does not execute models.

### P4 — Separation from decision support is strict

**Decision Support:** Scores a set of options, explains ranking, recommends next action (user still decides and executes).

**AI:** Generates content or executes actions (either returns novel generated text, or calls an API on the user's behalf with the user's permissions).

Both use models; AI acts, Decision Support scores and recommends.

### P5 — AiAssistant is a scoped role

An AI assistant is not a user; it is a tenant-defined, permission-bounded *actor*. Example:

- **Sales Assistant** — can read customers, products, opportunities; may call `customer.summarize` (AI-generated); cannot delete customers.
- **NOC Assistant** — can read network status, incidents; may call `incident.diagnose` (AI-generated); cannot approve incidents without human approval.

The assistant's identity is bound to an `AiAssistant` entity; the permission check uses the assistant's assigned role.

### P6 — Every prompt is versioned and reviewed

Prompts are templates, not code comments. A prompt is a first-class entity with:

- **Version** — major.minor; immutable once released.
- **Review status** — DRAFT / REVIEWED / DEPRECATED.
- **Locale** — languages and regional variants.
- **Inputs** — named variables; typed.
- **Model binding** — which ModelConfig(s) can use this prompt.

No inline LLM calls in application code; all calls go through registered prompts.

### P7 — AiTool is permission + API

An AiTool is *not* a custom function. It is a declared reference to an existing API endpoint that an assistant is *permitted* to call. The tool carries:

- **Endpoint reference** — the canonical API path (e.g., `/api/v1/customers/{id}`).
- **Input mapping** — which prompt variables become request parameters.
- **Output shaping** — what response fields the AI sees (prevents leaking restricted fields).
- **Permission check** — the tool invocation must pass the assistant's permission gate for the underlying endpoint.

### P8 — KnowledgeSource is declarative access

A KnowledgeSource lists:

- **Type** — `KNOWLEDGE_ARTICLES`, `DATA_CORE_RECORDS`, `CUSTOM_INDEX`.
- **Query** — scope (e.g., "articles tagged #troubleshooting", "all Customer records in tenant", "index: product-catalog").
- **Access gate** — the AI assistant must have view permission on the source.

The AI reads only what KnowledgeSource declares; no unconstrained data access.

### P9 — AiAuditLog captures every interaction

Every AI request, response, tool invocation, and token consumption is immutable audited:

- **Timestamp, tenant, actor** — context.
- **Prompt version, ModelConfig, model name** — reproducibility.
- **Input tokens, output tokens, cost** — metering.
- **Tool invocations** — each `AiTool` call, parameters, response.
- **Outcome** — success, error, rejection, user feedback.

Audit logs are append-only and never modified.

### P10 — Permission boundary is ironclad

AI MUST NOT:

- Bypass permission checks (every API call goes through the permission gate).
- Cross tenant boundaries (AI reads/writes only in its assigned tenant).
- Skip audit (every interaction logged).
- Ignore approval gates (high-impact actions wait for human signoff).
- Override policy decisions (policy rules are not suggestions to the AI).

Any AI feature that violates these is rejected.

### P11 — Approval gates are explicit and high-impact focused

Not every AI action requires approval. Only actions that:

- Mutate business state (create/update/delete entities, not just read/summarize).
- Exceed a cost threshold (configurable per tenant).
- Touch sensitive data (PII, financial records).
- Affect SLAs, contracts, or compliance obligations.

Approval is *human confirmation before execution*, not post-hoc logging.

### P12 — Tenant isolation is database-level

AI runs in tenant scope. A tenant's AI assistant cannot:

- Read another tenant's Knowledge articles.
- Call APIs across tenants.
- Be granted cross-tenant access without explicit Super-Admin override.

Tenant boundary is enforced at the RLS layer; AI respects it like any other component.

### P13 — Cost is metered and quota-enforced

Token consumption is:

- **Tracked** in AiAuditLog (input + output tokens per request).
- **Metered** per tenant per month.
- **Quoted** via Entitlement Core (plan defines token budget; assistant-level tokens checked against quota).
- **Reported** to billing.

Exceeding quota is handled fail-closed (request denied; user informed).

### P14 — Failure is graceful and never OPEN

When a model is unavailable:

- **Fallback chain** — ModelConfig defines alternates (try model A; if timeout/error, try model B).
- **User notice** — "AI temporarily unavailable; retry later or contact support."
- **Never default to OPEN** — do not execute an action without AI input if AI was expected. Default to deny.

Graceful degradation is not permission relaxation.

### P15 — Input and output sanitization is sandbox-grade

- **Input** — prompts are parameterized; user input is never interpolated directly into system prompts.
- **Output validation** — tool responses are parsed and typed; unexpected shapes are rejected.
- **Injection defense** — attempt to manipulate model output to bypass tool guards is logged and blocked.

No trust of model output; all outputs are validated before action.

## 6. Architecture Laws

### L1 — No ungoverned LLM calls in code

Every LLM invocation goes through a registered Prompt entity. Code is forbidden from:
- Inline `call_llm(...)` or equivalent without a Prompt PK reference.
- Dynamically constructing system prompts from untrusted input.
- Calling models outside the registered ModelConfig chain.

Violations are caught in code review and CI.

### L2 — AI respects all five universal boundaries

Permission, Tenant, Audit, Security, Policy are non-negotiable. An AI feature is rejected if:

- It calls an API without checking `can(assistant, action, scope)`.
- It reads data from another tenant.
- It executes without audit logging.
- It overrides a policy rule.
- It skips an approval gate for a high-impact action.

The PRM AI hard boundary rule is absolute.

### L3 — Every tool invocation is an API call through the permission gate

`AiTool` does not bypass API. Invoking a tool means:

1. AI decides to call the tool (model inference).
2. Parameters are validated against the tool's schema.
3. Permission check: `can(assistant_role, "entity.action", record_path)` on the endpoint.
4. API is called using the assistant's identity (scoped to assistant's tenant, role, org node).
5. Response is validated; restricted fields are redacted.
6. Outcome is logged in AiAuditLog.

No step is skipped.

### L4 — Every prompt is authored once and reused

A prompt is authored (by prompt engineer, product team), reviewed (product/security), and versioned. Code never:

- Interpolates user input into system prompts.
- Generates prompts dynamically.
- Forks prompts for "just this once" tweaks.

Prompts are configuration; code uses them by reference.

### L5 — AiAuditLog is immutable and complete

Entries in AiAuditLog are appended once and never modified. Every entry captures:

- Actor (user calling the AI, or scheduled job).
- Tenant, assistant ID.
- Prompt version, ModelConfig, model name, provider.
- Input tokens, output tokens, cost.
- All tool invocations (tool name, parameters, response).
- User feedback (thumbs up, correction, issue reported).

Audit is the source of truth for AI cost, model performance, and compliance.

### L6 — High-impact actions require human approval before execution

Actions requiring pre-execution approval (HumanApprovalGate):

- Create, update, or delete any business entity (Customer, Service, Contract, etc.).
- Write to sensitive fields (PII, billing account, password).
- Exceed cost threshold for the request (e.g., >$5 token cost).
- Touch compliance-sensitive data (tax records, audit logs).
- Trigger SLA changes or service disruptions.

Approval is *blocking*; AI waits for `human_approver.decision` before calling the API.

### L7 — Tenant-scoped AI access

An assistant is registered in a tenant. All reads, writes, and permissions are tenant-scoped:

- Knowledge sources are tenant-filtered.
- APIs called use the tenant in the request context.
- Audit logs include tenant ID.
- Entitlement quotas are per-tenant.

Cross-tenant AI access requires explicit Super-Admin approval.

### L8 — ModelConfig governs fallback and timeout behavior

A ModelConfig specifies:

- **Primary model** (e.g., Claude 3.7 Opus, GPT-4o).
- **Fallback chain** — alternate models (e.g., Sonnet if Opus unavailable; GPT-4 if Claude times out).
- **Timeout** (seconds to wait before fallback).
- **Cost cap per request** (refuse if estimated tokens > cap).
- **Temperature, top-p, max_tokens** — inference parameters.

Failure to provide a fallback is rejected.

### L9 — KnowledgeSource query is immutable and audited

A KnowledgeSource declares a query (e.g., "all articles tagged #sales" or "Customer records where status = ACTIVE"). That query is:

- **Static** — not generated from user input at request time.
- **Versioned** — changes to the query are new versions, not overwrites.
- **Audited** — queries are logged in AiAuditLog so retrieval can be reproduced.

AI cannot dynamically expand knowledge access.

### L10 — Cost is checked before request

Before calling a model, the system estimates token count (via token counter or prior model call data). If estimated cost > plan quota remaining:

1. Request is denied (HTTP 429 or 402 if Entitlement configured).
2. User is notified of quota exhaustion.
3. Incident is logged; billing alerts may fire.

No surprise overages.

## 7. Core Concepts

### 7.1 AiAssistant

A tenant-defined, named, permission-bounded actor. An assistant has:

- **`key`** — machine identifier (e.g., `sales_assistant_v1`, `noc_assistant`).
- **`tenantId`** — which tenant owns this assistant.
- **`roleId`** — the Permission Core role that defines what the assistant can do.
- **`model_config_id`** — the ModelConfig entity specifying model, parameters, fallback.
- **`knowledge_sources`** — list of KnowledgeSource IDs the assistant may read.
- **`enabled`** — soft-delete flag.
- **`status`** — DRAFT / ACTIVE / DEPRECATED.

Assistants are configuration, not code. Changing an assistant's role or knowledge sources does not require a code change.

### 7.2 Prompt

A versioned, reviewed template for communicating with a model. A prompt has:

- **`key`** — immutable identifier (e.g., `customer_summary_v2`, `incident_diagnosis_v1`).
- **`system_template`** — the system message; parameterized with `{variable}` placeholders.
- **`user_template`** — optional user message template.
- **`version`** — semantic version (major.minor); immutable once released.
- **`locale`** — language/region (e.g., `en_US`, `hy_AM`, `es_ES`).
- **`review_status`** — DRAFT, REVIEWED, DEPRECATED, ARCHIVED.
- **`input_schema`** — JSON schema defining expected input variables (types, constraints).
- **`output_schema`** — JSON schema for expected model output (for validation).
- **`model_config_ids`** — which ModelConfigs this prompt is approved for (e.g., only Claude, not GPT).

Prompts are owned by AI Core; reviewed by product/security before release.

### 7.3 AiTool

A declared reference to an existing API endpoint that an AI assistant is *permitted* to invoke. A tool has:

- **`key`** — identifier (e.g., `customer_search`, `incident_create`).
- **`api_endpoint`** — the canonical path (e.g., `/api/v1/customers`, `/api/v1/incidents/{id}`).
- **`permission_key`** — the permission required (e.g., `customer.view`, `incident.edit`).
- **`input_mapping`** — prompt variables → request parameters (e.g., `{customer_id} → /api/v1/customers/{customer_id}`).
- **`output_schema`** — response shape; specifies which fields the AI may see (redaction list for restricted fields).
- **`timeout_seconds`** — how long to wait for a response before failing.

Tools are configuration, not custom code. Every tool is an existing API endpoint; no new tool-only code paths.

### 7.4 ModelConfig

Runtime configuration for model selection, inference parameters, and fallback behavior. A ModelConfig has:

- **`key`** — identifier (e.g., `claude_3_7_opus`, `gpt4_turbo_fallback`).
- **`provider`** — `ANTHROPIC`, `OPENAI`, `GOOGLE`, etc.
- **`model_name`** — canonical model ID (e.g., `claude-opus-4-20250514`, `gpt-4-turbo-2024-04-09`).
- **`temperature`** — 0.0 (deterministic) to 1.0 (creative); default 0.7.
- **`top_p`** — nucleus sampling; default 0.9.
- **`max_tokens`** — response token limit; must be < model's context limit.
- **`fallback_chain`** — ordered list of alternate ModelConfigs (if primary times out or errors).
- **`timeout_seconds`** — seconds before fallback.
- **`cost_cap_per_request_usd`** — refuse request if estimated cost exceeds this.
- **`context_window_tokens`** — model's max context; used to estimate token counts.

ModelConfig is owned by AI Core; tuned per tenant if needed (Entitlement can restrict which ModelConfigs are available per plan).

### 7.5 KnowledgeSource

A declared scope of knowledge articles or data records that an AI assistant may read. A KnowledgeSource has:

- **`key`** — identifier (e.g., `troubleshooting_articles`, `active_customers`).
- **`type`** — `KNOWLEDGE_ARTICLES` (from Knowledge Core), `DATA_CORE_RECORDS` (from a specific table), `CUSTOM_INDEX` (external search index).
- **`query`** — scope definition (e.g., "articles tagged #sales OR #troubleshooting"; "Customers WHERE status = ACTIVE AND tenantId = {tenant}").
- **`indexing_strategy`** — how the source is indexed for retrieval (vector embedding, full-text, SQL query).
- **`access_gate`** — permission required to read this source (e.g., `knowledge.view`, `customer.view`).
- **`refresh_cadence`** — how often the index is updated (real-time, hourly, daily).

Knowledge sources are configuration; changes are audited.

### 7.6 AiAuditLog

Immutable record of every AI interaction. An AiAuditLog entry has:

- **`id`, `tenant_id`, `created_at`** — uniqueness and ordering.
- **`actor_id`** — user calling the AI (or scheduled job ID).
- **`assistant_id`** — which assistant was invoked.
- **`prompt_id`, `prompt_version`** — the prompt used.
- **`model_config_id`, `model_name`, `provider`** — which model was called.
- **`input_tokens`, `output_tokens`, `total_tokens`** — token consumption.
- **`cost_usd`** — token cost at the time of the request.
- **`tool_invocations`** — array of tool calls made by the model (tool_key, parameters, response_status).
- **`status`** — SUCCESS, TIMEOUT, ERROR, APPROVAL_REJECTED, QUOTA_EXCEEDED.
- **`user_feedback`** — optional rating (thumbs_up, thumbs_down, comment).

Entries are append-only; never updated or deleted.

### 7.7 HumanApprovalGate

A decision node for high-impact AI actions. A HumanApprovalGate has:

- **`key`** — identifier (e.g., `contract_modification_approval`, `bulk_delete_approval`).
- **`criteria`** — conditions triggering approval (e.g., "all Contract mutations", "deletion of >100 records").
- **`approver_role`** — which role(s) can approve (e.g., `manager`, `compliance_officer`).
- **`timeout_hours`** — how long before approval times out and action is canceled.
- **`audit_log_id`** — reference to the AiAuditLog entry for this decision (for tracing).
- **`state`** — PENDING, APPROVED, REJECTED, EXPIRED.
- **`approver_id`, `approved_at`, `rationale`** — who decided, when, and why.

Approval is *blocking*; AI request waits for decision before executing the underlying API call.

### 7.8 AiModel (reference)

Not an AI Core entity; a reference to an LLM provider's model. Tracked for cost estimation and version deprecation:

- **`provider`** — ANTHROPIC, OPENAI, etc.
- **`model_name`** — canonical ID.
- **`context_window_tokens`** — max input + output.
- **`input_cost_per_mtok`** — cost per million tokens (input).
- **`output_cost_per_mtok`** — cost per million tokens (output).
- **`deprecation_date`** — when the model is no longer supported (None = ongoing).

Used for cost calculation and route planning.

## 8. Canonical Entities

AI Core owns:

| Entity | Purpose |
|---|---|
| `ai_assistant` | Scoped role, per-tenant AI actor. |
| `prompt` | Versioned, reviewed prompt template. |
| `ai_tool` | Declared reference to an API endpoint. |
| `model_config` | Model selection, parameters, fallback chain. |
| `knowledge_source` | Scoped knowledge or data for retrieval. |
| `ai_audit_log` | Immutable interaction log. |
| `human_approval_gate` | High-impact action approval decision. |

Supporting entities (owned by other cores, referenced by AI Core):

| Entity | Owner | Reference |
|---|---|---|
| `ai_model_registry` | AI Core (read-only provider data) | model pricing & deprecation. |
| `role_def` | Permission Core | assistant's assigned role. |
| `user` | Identity Core | actor calling the AI. |
| `article` | Knowledge Core | read by AI via KnowledgeSource. |
| Any business entity (Customer, Incident, etc.) | Domain owner | read/write by AI via AiTool. |

## 9. Ownership Boundaries

### 9.1 AI Core owns

- **AI assistants** — creation, modification, deletion, role assignment.
- **Prompt registry** — authorship, versioning, review status, localization.
- **Tool declarations** — mapping API endpoints to assistant capabilities.
- **ModelConfig** — model selection, parameters, fallback chains.
- **Knowledge sources** — scope declaration and indexing.
- **Approval gates** — defining high-impact actions; storing approval decisions.
- **AI audit logs** — immutable storage and querying.

### 9.2 AI Core does NOT own

- **Model implementations** — delegated to provider (Anthropic, OpenAI, etc.).
- **Knowledge content** — owned by Knowledge Core.
- **Business data** — owned by domain cores (Customer, Incident, etc.).
- **Permission enforcement** — owned by Permission Core (AI calls `can(...)`).
- **Entitlement quotas** — owned by Entitlement Core; AI checks against quota.
- **Automation rules** — owned by Automation Core.
- **Policy conditions** — owned by Policy Core.

## 10. Relationships

### 10.1 AI ← Identity

Every AI request is made by an authenticated user (Identity Core). The user is passed through to the AI system; logs record the user, not the model.

### 10.2 AI ← Tenant

Every assistant, prompt, knowledge source, and audit log is tenant-scoped. AI never reads/writes across tenants without explicit Super-Admin override.

### 10.3 AI ← Permission

When an AI assistant invokes a tool (API call), the system checks `can(assistant_role, tool.permission_key, record_path)`. If denied, the call fails with a user-readable error (not a permission error exposed to the model).

### 10.4 AI ← Audit

Every AI interaction is logged in AiAuditLog. Audit is immutable and complete (no post-hoc redaction).

### 10.5 AI ← Security

Input is sanitized (prompts are parameterized, not concatenated). Output is validated before action. Rate limiting applies to AI requests (prevent token exhaustion attacks).

### 10.6 AI ← Policy

Policy Core rules are *not* bypassed by AI. If a policy rule forbids an action, the AI cannot execute it (either the rule prevents the action, or an approval gate blocks it).

### 10.7 AI → Knowledge (downstream)

AI reads Knowledge articles via KnowledgeSource. Knowledge Core publishes versioned articles; AI reads only what its knowledge sources declare.

### 10.8 AI → Approval (downstream)

High-impact actions are routed through HumanApprovalGate. Approval Core (Approval Core will define approval chains; AI Core waits for `HumanApprovalGate.state = APPROVED` before executing).

### 10.9 AI → Entitlement (downstream)

AI respects Entitlement Core quotas. Token limits are checked before model calls; exceeding quota denies the request.

### 10.10 AI → Event (publishing)

AI assistants are created, prompts are versioned, approvals are made, audit logs are recorded — all published as domain events for compliance, cost accounting, and downstream analytics.

## 11. Failure Modes & Mitigation

### FM1 — Model timeout or unavailability

**Symptom:** Primary model provider is slow or returns 5xx error.

**Mitigation:** ModelConfig fallback chain. Try next model in sequence within timeout window. If all fallbacks fail, deny the request and return user-facing error (not a system error). Notify user; do not retry automatically.

**Audit:** Log the failure, fallback sequence, and final outcome in AiAuditLog.

### FM2 — Cost overrun

**Symptom:** Token consumption exceeds plan quota mid-month.

**Mitigation:** Pre-request cost estimate checks quota; if insufficient, deny with HTTP 429 (Too Many Requests) or 402 (Payment Required). User is informed; no partial billing.

**Audit:** Log the denial reason and remaining quota.

### FM3 — Prompt injection attack

**Symptom:** User input in a prompt variable contains instructions to override system prompt.

**Mitigation:** Prompts are parameterized (user input never interpolates into system message). Output is validated against schema before action. Tool parameter validation rejects malformed payloads.

**Audit:** Log suspected injection attempts; flag for security review if patterns emerge.

### FM4 — Unauthorized tool invocation

**Symptom:** AI tries to call a tool it doesn't have permission for.

**Mitigation:** Permission check fails before API call. AI is informed (in-context) that the action is not permitted; request fails gracefully. User sees an error.

**Audit:** Log the attempted tool, permission denial, and assistant role.

### FM5 — Cross-tenant data leak

**Symptom:** Knowledge source or API response leaks another tenant's data.

**Mitigation:** All data access is tenant-scoped at the RLS layer. KnowledgeSource queries include `tenantId` filter. API responses are validated for tenant match. Violations are caught in testing and code review.

**Audit:** Violations trigger security incidents; audit logs are reviewed.

### FM6 — High-impact action without approval

**Symptom:** AI tries to delete 1000 records without approval.

**Mitigation:** HumanApprovalGate blocks the action. AI waits for approval state = APPROVED before executing. If approval times out, action is canceled.

**Audit:** All approval decisions are logged with approver, timestamp, and rationale.

### FM7 — Unfunded assistant

**Symptom:** AI assistant's quota is exhausted; user requests AI help.

**Mitigation:** Request is denied pre-emptively. User is shown remaining budget and advised to contact admin.

**Audit:** Log the denial; issue appears in tenant usage reports and billing alerts.

## 12. Approval Gate Rules

### When approval is required

- **Entity mutations** — any Create, Update, or Delete on entities owned by Financial, Compliance, Contract, Service, or Case cores (high-business-value entities).
- **Cost threshold** — individual request estimated cost > $5 USD (configurable per tenant).
- **Sensitive field writes** — modifying fields marked `requires_approval` (e.g., billing account, SSN, password).
- **Bulk operations** — >100 records affected in a single action.
- **Compliance-sensitive actions** — anything touching tax records, audit logs, or data-subject-access requests.

### Approval process

1. **AI decides** to call a tool (model inference).
2. **Pre-execution check** — does this action require approval? (HumanApprovalGate lookup by entity + action).
3. **If yes:** Create HumanApprovalGate entry; set state = PENDING; notify approvers.
4. **Wait** — AI request blocks; user sees "Awaiting approval" message.
5. **Approval decision** — approver reviews, approves or rejects, records rationale.
6. **If approved** — execute the tool API call; log success in AiAuditLog.
7. **If rejected** — notify user; log rejection reason.
8. **Timeout** — if no decision in timeout_hours, cancel the action; notify user.

### Approval scopes

Approver role can be:

- A fixed role (e.g., `finance_director` always approves financial mutations).
- Record-owner (the owner of the entity being modified approves).
- Team lead (manager of the assistant's creator approves).
- Dynamic (Policy Core may assign approvers based on conditions).

## 13. Prompt Governance

### Authorship

Prompts are authored by:

- **Prompt engineers** — AI Core team, trained in prompt design.
- **Product managers** — domain experts (e.g., Sales manager authors Sales Assistant prompts).
- **Security/compliance** — reviewers for sensitive prompts (e.g., those reading PII).

### Review checklist (before release)

- [ ] Prompt achieves intended goal (tested with multiple inputs).
- [ ] No prompt injection vulnerabilities (input is parameterized; model output is validated).
- [ ] Field-level security is respected (no restricted fields leaked in responses).
- [ ] Tone and accuracy (meets brand voice; factually correct).
- [ ] Localization (translations reviewed for context/nuance).
- [ ] Cost estimate (token count acceptable for typical use).
- [ ] Fallback behavior (handles out-of-scope questions gracefully).

### Version management

- **Semantic versioning** — major.minor (e.g., customer_summary_v2.1).
- **Immutability** — once released (major version), the prompt is frozen. Changes create a new version.
- **Deprecation** — old versions transition to DEPRECATED; sunset after 2 releases.
- **Changelog** — each version documents what changed and why.

## 14. Knowledge Source Declaration

A knowledge source must declare:

1. **Which data?** — specific articles, data table, external index.
2. **Query scope** — filters (e.g., "articles tagged #sales AND published = true").
3. **Access gate** — permission required to read (e.g., `knowledge.view`, `customer.view`).
4. **Refresh cadence** — real-time, hourly, daily.
5. **Indexing method** — vector embedding (for semantic search), full-text, or SQL.

A knowledge source is *static* — scope is defined once, not dynamically generated per request.

## 15. Cost Metering

### Token counting

Before calling a model, estimate token count using:

- **Token counter library** — official library per provider (e.g., `tiktoken` for OpenAI).
- **Prior call data** — historical average tokens for this prompt + input type.

Estimate is stored in AiAuditLog; actual token count is stored after response.

### Cost calculation

Cost = (input_tokens × input_cost_per_mtok + output_tokens × output_cost_per_mtok) / 1_000_000 USD.

Updated daily from AiModel registry.

### Quota enforcement

- **Plan quota** — Entitlement Core specifies monthly token budget (e.g., 10M tokens/month).
- **Pre-request check** — if estimated cost + consumed cost > remaining quota, deny.
- **Over-quota handling** — deny further requests; notify tenant; issue billing alert.

### Reporting

- **Daily usage report** — tokens consumed, cost, by assistant + model.
- **Monthly invoice** — total cost included in tenant bill.
- **Audit trail** — AiAuditLog is the source of truth for cost dispute resolution.

## 16. Cross-Architecture Dependencies

| This document depends on | For |
|---|---|
| `PLATFORM_REFERENCE_MODEL.md` | AI Core definition, purpose, hard boundary rule. |
| `01_PLATFORM_CORE_ARCHITECTURE.md` | Core ownership, tier discipline, separation rules. |
| `08_PERMISSION_ARCHITECTURE.md` | Permission checks, role definitions, Super Admin. |
| `14_TENANT_ARCHITECTURE.md` | Tenant isolation, RLS policies, cross-tenant access rules. |
| `07_WORKFLOW_PROCESS_ARCHITECTURE.md` | Integration with Policy Core; approval gate triggering. |
| `11_EVENT_ARCHITECTURE.md` | AI events (AssistantCreated, PromptVersioned, ApprovalDecided, AiRequestCompleted). |
| Standards files 15, 17 | Permission Registry (AI-related keys); Security Standard (input/output validation). |

| Documents that depend on this one |
|---|
| `10_API_ARCHITECTURE.md` (AI endpoints, tool invocation APIs). |
| `02_DOMAIN_ARCHITECTURE.md` (AI assistant placement in domains). |
| `04_NAVIGATION_ARCHITECTURE.md` (AI feature UI placement). |
| `06_UI_EXPERIENCE_ARCHITECTURE.md` (AI chat/prompt UX). |
| `09_DATA_ARCHITECTURE.md` (AI Core canonical entities). |
| `12_INTEGRATION_ARCHITECTURE.md` (external AI provider integrations). |
| `13_SECURITY_ARCHITECTURE.md` (after written; input/output validation). |
| `15_REPORTING_ARCHITECTURE.md` (AI usage reports). |
| `16_ANALYTICS_ARCHITECTURE.md` (AI model performance analytics). |
| `18_OBSERVABILITY_ARCHITECTURE.md` (AI request latency, cost, error rates). |

## 17. Implementation Requirements

### 17.1 Entity schemas

Add to `09_DATA_ARCHITECTURE.md`:

```
ai_assistant: key, tenant_id, role_id, model_config_id, knowledge_source_ids, enabled, status, created_at, updated_at
prompt: key, version, system_template, user_template, locale, review_status, input_schema, output_schema, model_config_ids, created_at
ai_tool: key, api_endpoint, permission_key, input_mapping, output_schema, timeout_seconds, created_at
model_config: key, provider, model_name, temperature, top_p, max_tokens, fallback_chain, timeout_seconds, cost_cap_per_request_usd, context_window_tokens
knowledge_source: key, type, query, indexing_strategy, access_gate, refresh_cadence, created_at, updated_at
ai_audit_log: id, tenant_id, actor_id, assistant_id, prompt_id, prompt_version, model_config_id, model_name, provider, input_tokens, output_tokens, total_tokens, cost_usd, tool_invocations (json), status, user_feedback, created_at
human_approval_gate: id, key, criteria, approver_role, timeout_hours, audit_log_id, state, approver_id, approved_at, rationale, created_at
```

### 17.2 API endpoints

Register in `10_API_ARCHITECTURE.md`:

```
POST   /api/v1/ai/assistants               → create assistant
GET    /api/v1/ai/assistants/{id}          → read assistant
PUT    /api/v1/ai/assistants/{id}          → update assistant
DELETE /api/v1/ai/assistants/{id}          → delete assistant

POST   /api/v1/ai/prompts                  → create prompt
GET    /api/v1/ai/prompts/{key}/{version}  → read prompt version

POST   /api/v1/ai/invoke                   → invoke assistant (main user-facing endpoint)
GET    /api/v1/ai/audit-log/{id}           → read audit log entry

POST   /api/v1/ai/approvals/{id}/approve   → approve high-impact action
POST   /api/v1/ai/approvals/{id}/reject    → reject high-impact action
```

### 17.3 Permission keys

Register in `docs/standards/15-permission-registry.md`:

```
ai.invoke_assistant           — call an AI assistant
ai.manage_assistants         — CRUD AI assistants
ai.manage_prompts            — CRUD prompts
ai.approve_high_impact_action — approve AI-initiated mutations
```

### 17.4 Events

Register in `11_EVENT_ARCHITECTURE.md`:

```
ai.AssistantCreated           — new assistant registered
ai.PromptVersioned            — new prompt version released
ai.AiRequestInvoked           — user invokes AI assistant (before execution)
ai.AiRequestCompleted         — AI request finished (success/error)
ai.AiToolInvoked              — AI calls a tool/API
ai.ApprovalRequested          — high-impact action awaiting approval
ai.ApprovalDecided            — approval was granted/rejected
ai.TokenQuotaExceeded         — tenant exceeded monthly quota
```

### 17.5 Tests

- **Unit tests** — prompt parameterization, token counting, cost calculation, permission checks.
- **Integration tests** — full AI request flow (invoke → permission check → tool call → audit → response).
- **Security tests** — prompt injection attempts, cross-tenant data access, approval bypass.
- **Failure tests** — model timeout, fallback chain, quota exhaustion, approval timeout.

### 17.6 Documentation

- **Prompt authorship guide** — how to write and review prompts.
- **Assistant setup guide** — how to register an assistant, assign role, set knowledge sources.
- **Tool registration guide** — how to declare API endpoints as tools.
- **Cost estimation** — model pricing, token counting, quota planning.
- **Troubleshooting** — common failures and mitigation.

---

*End of 21 — AI Architecture.*
