# 11 — Customer Lifecycle & Pipeline Page Behavior Standard

LOCKED. B5 applied (one accountable owner per stage). S4 applied (pipeline page = multiple tabbed
views). Lead is the starting point; Customer is the result after Activation.

> **Reconciled 2026-06-11 (owner decision):** the frontend `lifecycle.ts` LIFECYCLE_STAGES is the
> single source of truth (SST); the backend `stage_def` is its projection, hard-locked by drift
> rule `SST-1`. Changes from the prior version: `PROVISIONING` → **`CONFIG`** (NOC, BEFORE installation — NOC pre-configures the ONU at the office, then the field team installs the ready ONU);
> `ORDER_VALIDATED` is the one hard control gate, owned by **Validation** (independent of Sales);
> the legacy `SERVICE_QUALIFICATION` stage is dropped (feasibility folded into `VALIDATED_LEAD`).
> Five exit/off-ramp states (`LOST, CANCELLED, INSTALL_FAILED, SUSPENDED, TERMINATED`) branch off
> the happy path.

## Core Lifecycle (canonical stages — UPPER_SNAKE)
```
LEAD → VALIDATED_LEAD → ASSIGNED → DEAL → CONTRACT_SIGNED → ORDER_CREATED → ORDER_VALIDATED →
SCHEDULING → CONFIG → INSTALLATION → CONNECTION_TEST → PAYMENT_CONFIRMED → ACTIVATION →
MONITORING
```
Off-ramp states (not linear): `LOST` (from LEAD…CONTRACT_SIGNED), `CANCELLED` (ORDER_CREATED…
SCHEDULING), `INSTALL_FAILED` (SCHEDULING…CONNECTION_TEST → rejoins SCHEDULING), `SUSPENDED`
(from MONITORING, non-payment → rejoins MONITORING on payment), `TERMINATED` (final churn).
Display labels may be localized; logic uses the canonical values. This lifecycle informs page
copy, empty states, pipeline tabs, status labels, and workflow design. (Stage status values are
enums per the Enum Standard; the diagram above uses display arrows for readability.)

## Customers Page Rule
The Customers page is the **Active Customer / Subscriber Registry**, not the start of customer
creation. Demote any primary "Create Customer" action; the primary acquisition action is
"Create Lead". Customers are activated/converted subscribers created through the Lead lifecycle.
Opening a customer still opens existing customer detail / Customer 360. Do not break customer
records or routes.
Purpose text: "Active customer and subscriber registry. New customers are created through the
Lead lifecycle and appear here after activation."

## Lead Sources (business acquisition channels)
`SHOP, WEBSITE, REFERRAL, D2D, TELESALES, B2B`. Never WhatsApp/SMS/Email/Calls/Messenger — those
are communication channels. Update labels without breaking stored values unless a migration
exists; otherwise add a mapping layer/TODO rather than destructive change.

## Communications Page (conversation channels)
Channels shown: `WHATSAPP, MESSENGER, SMS, EMAIL, CALLS, INTERNAL_CHAT` — a display subset of the
canonical `CommunicationChannel` enum defined in the Customer Communication Standard (file 12:
`WHATSAPP, MESSENGER, SMS, EMAIL, CALLS, INTERNAL_CHAT, PORTAL_MESSAGE, SYSTEM_MESSAGE`). The page
must not define a different channel enum (D10).

## Pipeline Page — three tabbed views (S4)
The Pipeline page is not a single board. It is structured into three views via the Tabs Standard.

### 1. Sales Pipeline
Purpose: sales-owned acquisition. Owner: Sales Department.
Stages: `LEAD → VALIDATED_LEAD → ASSIGNED → DEAL → CONTRACT_SIGNED`. Shows movement only until
Contract Signed.

### 2. Customer Lifecycle
Purpose: full end-to-end journey for management. Owner: Cross-Department (view), with one
accountable owner per stage (below).
Stages: the full Core Lifecycle (`LEAD … MONITORING`).

### 3. Service Delivery Pipeline
Purpose: post-contract delivery and activation. **B5 — each stage has exactly one accountable
Owner Department; supporting departments are contributors, not co-owners.**

| Stage | Accountable Owner | Supporting |
|-------|-------------------|------------|
| `ORDER_CREATED` | Back Office | — |
| `ORDER_VALIDATED` | Validation | — |  ← the hard control gate (independent of Sales) |
| `SCHEDULING` | Dispatch Team | — |
| `CONFIG` | NOC | — |  ← NOC pre-configures the ONU at the office first |
| `INSTALLATION` | Technical Department | — |  ← field team installs the ready ONU |
| `CONNECTION_TEST` | NOC | — |
| `PAYMENT_CONFIRMED` | Billing | — |
| `ACTIVATION` | Billing | — |
| `MONITORING` | NOC | Support |

Each card eventually supports: current stage, owner department (one), assigned user, SLA, blocked
reason. Use placeholder metadata/empty states when data is unavailable; no fake telecom data; no
business logic unless required for display.

## Control Gates (concept; UI copy/help text)
`COMMERCIAL_GATE` (lead, contract, pricing, compliance, approvals), `TECHNICAL_GATE` (feasibility,
capacity, infrastructure, config, install, connection), `BILLING_GATE` (first payment, billing
readiness, activation approval), `CUSTOMER_CARE_GATE` (SLA, quality, incidents, monitoring,
satisfaction). The four gates back the Leads-page gate strip (Commercial=leads, Technical/Billing=
orders, Customer Care=customers). Page
structure/copy must not conflict with this model. (Gates are enforced by the Workflow Engine
Standard, file 12.)

## Product Catalog Page
Approved categories:
```
Commercial Products: INTERNET, IPTV, COMBO
Supporting Products:  HARDWARE, ADD_ONS, BUNDLES
```
`COMBO` is first-class. Remove `VOICE` from primary categories unless it already exists as an
active product type in data. Use these for tabs/filters/chips/copy where product categories show.

## Implementation Safety
Preserve routes, records, permissions, backend APIs (only small safe UI-facing enum/config
changes where necessary). No destructive stored-value migration without approval. Prefer
config-driven labels. No fake data. No lifecycle automation business logic yet — wire UI/page
structure safely and preserve current functionality.

## Locked Decision
Lead-first acquisition; Customer = activated subscriber. Pipeline page = three tabbed views.
One accountable owner per service-delivery stage. Lead source and communication channel are
permanently separate concepts.
