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

## 11. Responsibilities

### 11.1 Tenant administrators and domain users

- **Approve high-impact AI actions** — review and approve/reject mutations, deletions, sensitive field changes before AI executes them.
- **Monitor AI usage and costs** — view tenant AI consumption reports; set quota limits via Entitlement Core.
- **Review AI assistant behavior** — audit AiAuditLog for unexpected tool calls, output quality, cost anomalies.

### 11.2 Prompt engineers and product teams

- **Author and maintain prompts** — write, test, review, version, and retire prompts; translate into multiple locales.
- **Validate prompt quality** — ensure prompts are injection-resistant, produce accurate outputs, conform to brand voice.
- **Monitor prompt performance** — track token usage, success rates, user feedback; deprecate underperforming versions.

### 11.3 AI Core platform owners

- **Manage assistants and tools** — register assistants, assign roles, declare tool APIs, configure knowledge sources.
- **Enforce approval gates** — define high-impact criteria, assign approver roles, configure timeouts.
- **Cost metering and quota enforcement** — monitor tenant budgets, configure ModelConfigs, coordinate with Entitlement Core.
- **Audit and compliance** — maintain AiAuditLog integrity, respond to security incidents, provide audit trails for disputes.

### 11.4 Security and compliance teams

- **Review AI governance** — ensure AI respects tenant boundaries, permission gates, audit requirements; validate injection defenses.
- **Incident response** — investigate AI-related security events (unauthorized tool calls, data leaks, approval bypasses).
- **Regulatory support** — provide audit evidence for compliance audits; redact PII in audit logs for disclosures.

## 12. Allowed Patterns

### AP1 — Multi-locale prompt versioning

A prompt can be authored in `en_US`, then translated to `hy_AM`, `es_ES`, etc., each as a separate version with the same `key` but different `locale`. Users are served the locale matching their profile or tenant region.

### AP2 — Fallback chain for model selection

A ModelConfig can name multiple fallback models. If the primary model times out or returns an error, the system tries the next in the chain within the timeout window, ensuring graceful degradation.

### AP3 — Knowledge source composition

An assistant can reference multiple KnowledgeSources (e.g., troubleshooting articles + customer data). AI retrieves from all sources according to their indexing strategies and refresh cadences.

### AP4 — Cost-aware approval gates

An approval gate can be triggered when estimated cost exceeds a threshold (e.g., >$5 per request) or when a specific high-impact action is detected. The same gate rules apply to all assistants in the tenant; configuration is centralized in Entitlement Core.

### AP5 — Field-level output redaction

An AiTool's output schema can declare a redaction list (e.g., "AI may not see password_hash, social_security_number"). API responses are filtered before being returned to the model, ensuring sensitive fields never leak.

### AP6 — Audit-driven cost reconciliation

AiAuditLog stores estimated tokens (pre-call) and actual tokens (post-call). Billing disputes are resolved by comparing audit records with provider invoices; discrepancies trigger alerts.

### AP7 — Human-in-loop approval workflows

For high-impact actions, the AI request blocks and waits for a human approver to review the AI's proposed action (tool call, parameters, context). Approver confirms, rejects, or requests clarification; AI continues only on approval.

### AP8 — Permission inheritance from assistant role

An AiAssistant inherits all permissions assigned to its `roleId`. A tool invocation checks if the assistant's role has the required permission for the API endpoint. No tool is "always allowed"; every invocation is gated.

## 13. Forbidden Patterns

### FP1 — Ungoverned LLM calls in code

Inline calls to LLM APIs without registering a Prompt entity first. Example: `ai_client.call("summarize this customer", context)` without a corresponding `Prompt` row.

### FP2 — AI bypasses permission gates

An AI assistant calling an API endpoint without checking `can(assistant_role, action, record_path)`. Example: AI calling `/api/v1/customers/{id}/delete` even though the assistant's role does not have `customer.delete`.

### FP3 — Ungoverned cross-tenant data access

AI reading from or writing to another tenant's data. Example: Knowledge source query "all articles" without a `tenantId` filter, or an assistant registered in Tenant A calling an API that returns Tenant B's data.

### FP4 — Prompt injection via interpolation

User input directly concatenated into system prompts. Example: `system_prompt = "You are a support agent. " + user_input` instead of using parameterized prompts with validation.

### FP5 — Skipped approval for high-impact actions

AI executing a mutation (create/update/delete) or cost-exceeding request without waiting for HumanApprovalGate to approve first. Example: AI deleting >100 records without approval.

### FP6 — Silent model failures without fallback

Model timeout or error with no fallback; request is retried automatically or silently fails. Instead, fallback chain must be configured, and user must be notified if all fallbacks fail.

### FP7 — Unaudited tool invocations

An AI tool call is made without logging the invocation in AiAuditLog. Every tool call must be immutably recorded with timestamp, actor, assistant, tool name, parameters, response status.

### FP8 — Dynamically generated knowledge source queries

A knowledge source query constructed at request time from user input. Example: `query = "articles tagged #" + user_input` instead of a static, pre-defined query.

### FP9 — Cost-unaware token consumption

Model calls without pre-request cost estimation or quota checking. Example: AI invoking a model without checking `remaining_quota < estimated_cost`.

### FP10 — Redacted PII in AI output without validation

AI output returned to user without validating that sensitive fields (SSN, password, credit card) are absent. Output must be typed and validated against the prompt's output schema.

## 14. Cross-Architecture Dependencies

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

## 15. Implementation Requirements

### 15.1 Entity schemas

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

### 15.2 API endpoints

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

### 15.3 Permission keys

Register in `docs/standards/15-permission-registry.md`:

```
ai.invoke_assistant           — call an AI assistant
ai.manage_assistants         — CRUD AI assistants
ai.manage_prompts            — CRUD prompts
ai.approve_high_impact_action — approve AI-initiated mutations
```

### 15.4 Events

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

### 15.5 Tests

- **Unit tests** — prompt parameterization, token counting, cost calculation, permission checks.
- **Integration tests** — full AI request flow (invoke → permission check → tool call → audit → response).
- **Security tests** — prompt injection attempts, cross-tenant data access, approval bypass.
- **Failure tests** — model timeout, fallback chain, quota exhaustion, approval timeout.

### 15.6 Documentation

- **Prompt authorship guide** — how to write and review prompts.
- **Assistant setup guide** — how to register an assistant, assign role, set knowledge sources.
- **Tool registration guide** — how to declare API endpoints as tools.
- **Cost estimation** — model pricing, token counting, quota planning.
- **Troubleshooting** — common failures and mitigation.

## 16. Future Expansion Rules

### 16.1 Evolving the prompt registry

When a prompt needs updating:

1. Create a new version (major.minor increment).
2. Set old version to DEPRECATED.
3. Update ModelConfigs that reference the old version to point to the new one.
4. Retire old version after one release cycle.

### 16.2 Adding new AI models

When a new LLM provider or model becomes available:

1. Add to `ai_model_registry` (provider, model_name, context_window, cost per mtok, deprecation_date).
2. Create ModelConfig(s) that reference it (with fallback chains).
3. Test with existing prompts before enabling in production.
4. Document cost implications; notify tenants of new options.

### 16.3 Expanding knowledge sources

When new knowledge or data becomes available for AI to read:

1. Create a new KnowledgeSource entity with explicit query, access gate, indexing strategy.
2. Add to assistants that should have access via their `knowledge_source_ids` list.
3. Test retrieval quality; audit access patterns.

### 16.4 Adding new high-impact approval criteria

When a new approval criterion is discovered (e.g., "all Compliance Core mutations"):

1. Document the business reason (audit trail).
2. Add or update HumanApprovalGate entries.
3. Notify affected assistant owners; update documentation.
4. Monitor approval SLA; ensure approvers are available.

### 16.5 Model deprecation

When a provider deprecates a model:

1. Update `ai_model_registry` with deprecation_date.
2. Update all ModelConfigs that reference it; add fallback chain if missing.
3. Provide migration path for affected tenants (e.g., cost incentive to move to new model).
4. Retire after deprecation_date; remove from active ModelConfigs.

## 17. Implementation Requirements (continued)

### 17.1 Validation and testing

- **Schema validation** — AiAuditLog entries are parsed and validated for completeness before writing.
- **Permission validation** — every tool invocation is pre-checked for permission; failures are logged but not exposed to model.
- **Cost pre-estimation** — token count is estimated via token counter or prior model call data; request is rejected if cost > quota.
- **Locale fallback** — if a prompt is not available in the requested locale, fallback to `en_US`.

### 17.2 Monitoring and observability

- **AI request metrics** — latency, success rate, error rate per assistant, per model, per knowledge source.
- **Cost tracking** — token consumption trend, daily spend, quota usage per tenant.
- **Approval SLA** — time-to-approval for high-impact actions; escalations if SLA breached.
- **Fallback frequency** — how often fallback chain is triggered; indicates primary model reliability.

### 17.3 Lifecycle management

- **Soft-delete** — assistants, prompts, tools, knowledge sources have an `enabled` / `status` field; no hard deletes.
- **Audit immutability** — AiAuditLog entries are append-only; never updated or deleted (even for compliance reasons; PII is redacted at disclosure time, not at storage).
- **Configuration deployment** — assistants, prompts, tools, knowledge sources are deployed via configuration management (not code); changes are audited.

---

*End of 21 — AI Architecture.*
