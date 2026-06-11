// Single source of truth for the ISP workflow lifecycle.
//
// THE IRON RULE (Gev 2026-06-11) — 3 separate entities each own a stage-slice, with 2 conversions:
//
//   LEAD  (sales pipeline)        stages 1→6   LEAD … CONTRACT_SIGNED → ORDER_CREATED
//                                              @ ORDER_CREATED = SALES DONE → converts to ORDER
//   ORDER (fulfillment pipeline)  stages 7→13  ORDER_VALIDATED … → ACTIVATION
//                                              @ ACTIVATION → converts to CUSTOMER
//   CUSTOMER (active base)        NOT a pipeline. A full member of the active base the instant
//                                 activation completes (1 second or 10 years — same). Operational.
//
// S14 MONITORING is NOT a pipeline stage. At ACTIVATION an auto-task (owner = Customer Care) is
// created that FORCES the care check-call ("all OK? services active? were our people polite?").
//
// So the linear pipeline is 13 stages (LEAD → ACTIVATION); customer states + the care check-call live
// OUTSIDE the pipeline. Page UI reads from these constants — never hardcoded strings. Stored data is
// not touched here; this only governs UI.

export type LifecycleStageKey =
  | 'LEAD'
  | 'VALIDATED_LEAD'
  | 'ASSIGNED'
  | 'DEAL'
  | 'CONTRACT_SIGNED'
  | 'ORDER_CREATED'
  | 'ORDER_VALIDATED'
  | 'SCHEDULING'
  | 'CONFIG'
  | 'INSTALLATION'
  | 'CONNECTION_TEST'
  | 'PAYMENT_CONFIRMED'
  | 'ACTIVATION'   // last pipeline stage; @ here ORDER converts to CUSTOMER (MONITORING is NOT a stage)

// Customer = active base, NOT a pipeline stage. These are the active-customer states that live AFTER
// the pipeline (post-activation). The care check-call is an auto-task at activation, not a state.
export type CustomerState = 'ACTIVE' | 'SUSPENDED' | 'TERMINATED'

// One accountable Owner Department per stage (standard 11 + B5 in file 13).
// Any second-listed department becomes a supporting department on the stage
// (zero or more). This replaces the legacy "X / Y" dual-owner strings.
export type DepartmentOwner =
  | 'Sales'
  | 'Back Office'
  | 'Billing'
  | 'Validation'
  | 'Dispatch Team'
  | 'Technical Department'
  | 'NOC'
  | 'Billing Department'
  | 'Support'
  | 'Cross Department'

export type ControlGate =
  | 'Commercial Gate'
  | 'Technical Gate'
  | 'Billing Gate'
  | 'Customer Care Gate'

export interface LifecycleStage {
  key:        LifecycleStageKey
  label:      string
  // Exactly ONE accountable Owner Department per stage (B5).
  owner:      DepartmentOwner
  // Zero or more supporting departments (may be empty).
  supporting: DepartmentOwner[]
  gate?:      ControlGate
}

// Master pipeline — THE single source of truth (SST). 13 linear stages, split by the iron rule into
// the LEAD slice (1→6, sales) and the ORDER slice (7→13, fulfillment). Reconciled 2026-06-11:
//   • LEAD owns 1→6; @ ORDER_CREATED (sales done) the lead CONVERTS to an ORDER.
//   • ORDER owns 7→13; @ ACTIVATION the order CONVERTS to a CUSTOMER (active base — NOT a stage).
//   • #7 ORDER_VALIDATED is THE hard control gate (Validation, independent of Sales) — kernel-enforced.
//   • MONITORING is NOT here anymore — it became a Customer-Care auto-task created at activation.
export const LIFECYCLE_STAGES: LifecycleStage[] = [
  // ── LEAD slice (stages 1→6) · Sales pipeline · converts to ORDER at ORDER_CREATED ──
  { key: 'LEAD',              label: 'Lead',              owner: 'Sales',                supporting: [],          gate: 'Commercial Gate' },
  { key: 'VALIDATED_LEAD',    label: 'Validated Lead',    owner: 'Sales',                supporting: [],          gate: 'Commercial Gate' },  // exit: coverage=YES + reachable + intent (feasibility folded in)
  { key: 'ASSIGNED',          label: 'Assigned',          owner: 'Sales',                supporting: [],          gate: 'Commercial Gate' },
  { key: 'DEAL',              label: 'Deal',              owner: 'Sales',                supporting: [],          gate: 'Commercial Gate' },
  { key: 'CONTRACT_SIGNED',   label: 'Contract Signed',   owner: 'Sales',                supporting: [],          gate: 'Commercial Gate' },
  { key: 'ORDER_CREATED',     label: 'Order Created',     owner: 'Back Office',          supporting: [],          gate: 'Commercial Gate' },  // SALES DONE → convert to ORDER
  // ── ORDER slice (stages 7→13) · Fulfillment pipeline · converts to CUSTOMER at ACTIVATION ──
  { key: 'ORDER_VALIDATED',   label: 'Order Validated',   owner: 'Validation',           supporting: [],          gate: 'Technical Gate'  },  // THE control gate
  { key: 'SCHEDULING',        label: 'Scheduling',        owner: 'Dispatch Team',        supporting: [],          gate: 'Technical Gate'  },
  { key: 'CONFIG',            label: 'Config',            owner: 'NOC',                  supporting: [],          gate: 'Technical Gate'  },
  { key: 'INSTALLATION',      label: 'Installation',      owner: 'Technical Department', supporting: [],          gate: 'Technical Gate'  },
  { key: 'CONNECTION_TEST',   label: 'Connection Test',   owner: 'NOC',                  supporting: [],          gate: 'Technical Gate'     },
  { key: 'PAYMENT_CONFIRMED', label: 'Payment Confirmed', owner: 'Billing',              supporting: [],          gate: 'Billing Gate'       },
  { key: 'ACTIVATION',        label: 'Activation',        owner: 'Billing',              supporting: [],          gate: 'Billing Gate'       },  // CONVERT to CUSTOMER + auto care check-call task
]

// ── Exit / off-ramp states ────────────────────────────────────────────────────
// NOT linear stages — branches a record can drop into. Some rejoin the happy path
// (install_failed → back to scheduling; suspended → back to monitoring on payment).
// PIPELINE exit states only (lead/order off-ramps). Customer-base states (suspended/terminated) are
// NOT here — they live on CustomerState (post-activation), see CUSTOMER_STATES below.
export type LifecycleExitKey =
  | 'LOST'            // lead never converted (sales off-ramp)
  | 'CANCELLED'       // order cancelled pre-delivery
  | 'INSTALL_FAILED'  // tech visit failed — reschedule

export interface LifecycleExitState {
  key:     LifecycleExitKey
  label:   string
  owner:   DepartmentOwner
  from:    LifecycleStageKey[]   // stages this can branch from
  rejoin?: LifecycleStageKey     // where a recoverable state returns to
}

export const LIFECYCLE_EXIT_STATES: LifecycleExitState[] = [
  { key: 'LOST',           label: 'Lost',           owner: 'Sales',         from: ['LEAD', 'VALIDATED_LEAD', 'ASSIGNED', 'DEAL', 'CONTRACT_SIGNED'] },
  { key: 'CANCELLED',      label: 'Cancelled',      owner: 'Back Office',   from: ['ORDER_VALIDATED', 'SCHEDULING', 'CONFIG'] },
  { key: 'INSTALL_FAILED', label: 'Install Failed', owner: 'Dispatch Team', from: ['SCHEDULING', 'INSTALLATION', 'CONFIG', 'CONNECTION_TEST'], rejoin: 'SCHEDULING' },
]

// CUSTOMER active-base states (post-activation, NOT pipeline stages). The care check-call is an
// auto-task (owner Customer Care) created at ACTIVATION — it forces the call, it is not a state.
export const CUSTOMER_STATES: { key: CustomerState; label: string; owner: DepartmentOwner }[] = [
  { key: 'ACTIVE',     label: 'Active',     owner: 'Support' },   // full member of the active base
  { key: 'SUSPENDED',  label: 'Suspended',  owner: 'Billing' },   // cut for non-payment — restorable to ACTIVE
  { key: 'TERMINATED', label: 'Terminated', owner: 'Support' },   // final churn / account closed
]

// At ACTIVATION an auto-task is created (owner Customer Care) that forces the welcome/quality
// check-call. This is the SST replacement for the former "Monitoring" stage.
export const ACTIVATION_CARE_TASK = {
  owner: 'Customer Care',
  subject: 'Welcome / activation check-call',
  prompt: 'Confirm services are activated and the customer is satisfied (were our people polite?).',
} as const

// LEAD slice (sales pipeline) — stages 1→6, LEAD → ORDER_CREATED. Converts to ORDER at ORDER_CREATED.
export const SALES_PIPELINE_STAGES: LifecycleStage[] = LIFECYCLE_STAGES.slice(0, 6)

// ORDER slice (fulfillment pipeline) — stages 7→13, ORDER_VALIDATED → ACTIVATION. Converts to CUSTOMER.
export const SERVICE_DELIVERY_STAGES: LifecycleStage[] = LIFECYCLE_STAGES.slice(6)

// Approved Lead sources — business acquisition channels (NOT communication channels).
export const LEAD_SOURCES = ['Shop', 'Website', 'Referral', 'D2D', 'Telesales', 'B2B'] as const
export type LeadSource = typeof LEAD_SOURCES[number]

// Approved Communication channels — conversation surfaces (NOT lead sources).
// Canonical UPPER_SNAKE values per standard 14 (CommunicationChannel, Customer Service).
// 8 values; PORTAL_MESSAGE + SYSTEM_MESSAGE added per E (file 13 patch).
// Display labels are a separate concern — see COMMUNICATION_CHANNEL_LABELS below.
export const COMMUNICATION_CHANNELS = [
  'WHATSAPP',
  'MESSENGER',
  'SMS',
  'EMAIL',
  'CALLS',
  'INTERNAL_CHAT',
  'PORTAL_MESSAGE',
  'SYSTEM_MESSAGE',
] as const
export type CommunicationChannel = typeof COMMUNICATION_CHANNELS[number]

// Human-readable labels for the canonical enum values. Use this when rendering
// channel chips/filters/labels in UI — never embed display text in the enum.
export const COMMUNICATION_CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  WHATSAPP:       'WhatsApp',
  MESSENGER:      'Messenger',
  SMS:            'SMS',
  EMAIL:          'Email',
  CALLS:          'Calls',
  INTERNAL_CHAT:  'Internal Chat',
  PORTAL_MESSAGE: 'Portal Message',
  SYSTEM_MESSAGE: 'System Message',
}

// Canonical CommunicationDirection (standard 14 — 4 values, UPPER_SNAKE).
export const COMMUNICATION_DIRECTIONS = ['INBOUND', 'OUTBOUND', 'INTERNAL', 'SYSTEM'] as const
export type CommunicationDirection = typeof COMMUNICATION_DIRECTIONS[number]

// Approved Product Catalog categories.
export const COMMERCIAL_PRODUCT_CATEGORIES = ['Internet', 'IPTV', 'Combo'] as const
export const SUPPORTING_PRODUCT_CATEGORIES = ['Hardware', 'Add-ons', 'Bundles'] as const
export const PRODUCT_CATEGORIES = [...COMMERCIAL_PRODUCT_CATEGORIES, ...SUPPORTING_PRODUCT_CATEGORIES] as const
export type ProductCategory = typeof PRODUCT_CATEGORIES[number]

// Control gate definitions — used for UI copy/help text in the pipeline view.
export const CONTROL_GATE_DEFINITIONS: Record<ControlGate, string> = {
  'Commercial Gate':     'Contract, pricing, compliance, approvals.',
  'Technical Gate':      'Feasibility, capacity, infrastructure, config, install, connection.',
  'Billing Gate':        'First payment cleared, billing readiness, activation approval.',
  'Customer Care Gate':  'SLA, quality, incidents, monitoring, customer satisfaction.',
}
