// Single source of truth for the ISP workflow lifecycle.
//
// This is the master customer/service lifecycle that page copy, pipeline tabs,
// status labels, and (future) workflow automation must align with.
//
// LEAD → VALIDATED LEAD → ASSIGNED → DEAL → CONTRACT SIGNED → ORDER CREATED →
// ORDER VALIDATED → SCHEDULING → INSTALLATION → PROVISIONING → CONNECTION TEST →
// PAYMENT CONFIRMED → ACTIVATION → MONITORING.
//
// Page UI reads from these constants — NOT scattered hardcoded strings — so a
// single rename here flows through every screen. Stored data (e.g. backend
// lead.source values) is NOT touched by this module — it only governs UI.

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
  | 'ACTIVATION'
  | 'MONITORING'

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

// Master 14-stage Customer Lifecycle — THE single source of truth (SST) for pipeline
// stages across the whole platform. Every other place that needs stages derives from
// here (Pipeline view, backend stage_def seed, KPI bindings). Reconciled 2026-06-11:
//   • Exactly ONE accountable owner per stage (B5) — supporting[] left empty for now.
//   • Order is Config (#9) → Installation (#10): NOC pre-configures/provisions the ONU at the
//     office FIRST, then the field team installs that ready ONU on-site (HouseNet's real flow).
//   • #7 ORDER_VALIDATED is THE hard control gate (Validation, independent of Sales) —
//     enforced in the kernel (app.kernel.control_gate); nothing advances to Scheduling
//     until control_pass = TRUE.
export const LIFECYCLE_STAGES: LifecycleStage[] = [
  { key: 'LEAD',              label: 'Lead',              owner: 'Sales',                supporting: [],          gate: 'Commercial Gate' },
  { key: 'VALIDATED_LEAD',    label: 'Validated Lead',    owner: 'Sales',                supporting: [],          gate: 'Commercial Gate' },  // exit: coverage=YES + reachable + intent (feasibility folded in)
  { key: 'ASSIGNED',          label: 'Assigned',          owner: 'Sales',                supporting: [],          gate: 'Commercial Gate' },
  { key: 'DEAL',              label: 'Deal',              owner: 'Sales',                supporting: [],          gate: 'Commercial Gate' },
  { key: 'CONTRACT_SIGNED',   label: 'Contract Signed',   owner: 'Sales',                supporting: [],          gate: 'Commercial Gate' },
  { key: 'ORDER_CREATED',     label: 'Order Created',     owner: 'Back Office',          supporting: [],          gate: 'Commercial Gate' },
  { key: 'ORDER_VALIDATED',   label: 'Order Validated',   owner: 'Validation',           supporting: [],          gate: 'Technical Gate'  },  // THE control gate
  { key: 'SCHEDULING',        label: 'Scheduling',        owner: 'Dispatch Team',        supporting: [],          gate: 'Technical Gate'  },
  { key: 'CONFIG',            label: 'Config',            owner: 'NOC',                  supporting: [],          gate: 'Technical Gate'  },
  { key: 'INSTALLATION',      label: 'Installation',      owner: 'Technical Department', supporting: [],          gate: 'Technical Gate'  },
  { key: 'CONNECTION_TEST',   label: 'Connection Test',   owner: 'NOC',                  supporting: [],          gate: 'Technical Gate'     },
  { key: 'PAYMENT_CONFIRMED', label: 'Payment Confirmed', owner: 'Billing',              supporting: [],          gate: 'Billing Gate'       },
  { key: 'ACTIVATION',        label: 'Activation',        owner: 'Billing',              supporting: [],          gate: 'Billing Gate'       },
  { key: 'MONITORING',        label: 'Monitoring',        owner: 'NOC',                  supporting: ['Support'], gate: 'Customer Care Gate' },
]

// ── Exit / off-ramp states ────────────────────────────────────────────────────
// NOT linear stages — branches a record can drop into. Some rejoin the happy path
// (install_failed → back to scheduling; suspended → back to monitoring on payment).
export type LifecycleExitKey =
  | 'LOST'            // lead never converted
  | 'CANCELLED'       // order cancelled pre-delivery
  | 'INSTALL_FAILED'  // tech visit failed — reschedule
  | 'SUSPENDED'       // active customer cut for non-payment — restorable
  | 'TERMINATED'      // final churn / account closed

export interface LifecycleExitState {
  key:     LifecycleExitKey
  label:   string
  owner:   DepartmentOwner
  from:    LifecycleStageKey[]   // stages this can branch from
  rejoin?: LifecycleStageKey     // where a recoverable state returns to
}

export const LIFECYCLE_EXIT_STATES: LifecycleExitState[] = [
  { key: 'LOST',           label: 'Lost',           owner: 'Sales',         from: ['LEAD', 'VALIDATED_LEAD', 'ASSIGNED', 'DEAL', 'CONTRACT_SIGNED'] },
  { key: 'CANCELLED',      label: 'Cancelled',      owner: 'Back Office',   from: ['ORDER_CREATED', 'ORDER_VALIDATED', 'SCHEDULING'] },
  { key: 'INSTALL_FAILED', label: 'Install Failed', owner: 'Dispatch Team', from: ['SCHEDULING', 'INSTALLATION', 'CONFIG', 'CONNECTION_TEST'], rejoin: 'SCHEDULING' },
  { key: 'SUSPENDED',      label: 'Suspended',      owner: 'Billing',       from: ['MONITORING'], rejoin: 'MONITORING' },
  { key: 'TERMINATED',     label: 'Terminated',     owner: 'Support',       from: ['MONITORING', 'ACTIVATION'] },
]

// Sales-Pipeline slice — Sales-owned acquisition, LEAD → CONTRACT_SIGNED.
export const SALES_PIPELINE_STAGES: LifecycleStage[] = LIFECYCLE_STAGES.slice(0, 5)

// Service-Delivery slice — post-contract through MONITORING, ORDER_CREATED → MONITORING.
export const SERVICE_DELIVERY_STAGES: LifecycleStage[] = LIFECYCLE_STAGES.slice(5)

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
