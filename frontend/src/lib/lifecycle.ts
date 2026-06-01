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
  | 'INSTALLATION'
  | 'PROVISIONING'
  | 'CONNECTION_TEST'
  | 'PAYMENT_CONFIRMED'
  | 'ACTIVATION'
  | 'MONITORING'

export type DepartmentOwner =
  | 'Sales'
  | 'Sales / Back Office'
  | 'Billing / Validation'
  | 'Dispatch Team'
  | 'Technical Department'
  | 'Technical Department / NOC'
  | 'Billing Department'
  | 'Billing Department / NOC'
  | 'NOC / Support'
  | 'Cross Department'

export type ControlGate =
  | 'Commercial Gate'
  | 'Technical Gate'
  | 'Service Gate'
  | 'Operational Gate'

export interface LifecycleStage {
  key:    LifecycleStageKey
  label:  string
  owner:  DepartmentOwner
  gate?:  ControlGate
}

// Master 14-stage lifecycle — used by the Customer Lifecycle pipeline view
// (read-only end-to-end journey) and as the union all other pipelines slice from.
export const LIFECYCLE_STAGES: LifecycleStage[] = [
  { key: 'LEAD',              label: 'Lead',              owner: 'Sales',                          gate: 'Commercial Gate' },
  { key: 'VALIDATED_LEAD',    label: 'Validated Lead',    owner: 'Sales',                          gate: 'Commercial Gate' },
  { key: 'ASSIGNED',          label: 'Assigned',          owner: 'Sales',                          gate: 'Commercial Gate' },
  { key: 'DEAL',              label: 'Deal',              owner: 'Sales',                          gate: 'Commercial Gate' },
  { key: 'CONTRACT_SIGNED',   label: 'Contract Signed',   owner: 'Sales',                          gate: 'Commercial Gate' },
  { key: 'ORDER_CREATED',     label: 'Order Created',     owner: 'Sales / Back Office',            gate: 'Commercial Gate' },
  { key: 'ORDER_VALIDATED',   label: 'Order Validated',   owner: 'Billing / Validation',           gate: 'Technical Gate'  },
  { key: 'SCHEDULING',        label: 'Scheduling',        owner: 'Dispatch Team',                  gate: 'Technical Gate'  },
  { key: 'INSTALLATION',      label: 'Installation',      owner: 'Technical Department',           gate: 'Technical Gate'  },
  { key: 'PROVISIONING',      label: 'Provisioning',      owner: 'Technical Department / NOC',     gate: 'Technical Gate'  },
  { key: 'CONNECTION_TEST',   label: 'Connection Test',   owner: 'Technical Department / NOC',     gate: 'Service Gate'    },
  { key: 'PAYMENT_CONFIRMED', label: 'Payment Confirmed', owner: 'Billing Department',             gate: 'Service Gate'    },
  { key: 'ACTIVATION',        label: 'Activation',        owner: 'Billing Department / NOC',       gate: 'Service Gate'    },
  { key: 'MONITORING',        label: 'Monitoring',        owner: 'NOC / Support',                  gate: 'Operational Gate'},
]

// Sales-Pipeline slice — Sales-owned acquisition, LEAD → CONTRACT_SIGNED.
export const SALES_PIPELINE_STAGES: LifecycleStage[] = LIFECYCLE_STAGES.slice(0, 5)

// Service-Delivery slice — post-contract through MONITORING, ORDER_CREATED → MONITORING.
export const SERVICE_DELIVERY_STAGES: LifecycleStage[] = LIFECYCLE_STAGES.slice(5)

// Approved Lead sources — business acquisition channels (NOT communication channels).
export const LEAD_SOURCES = ['Shop', 'Website', 'Referral', 'D2D', 'Telesales', 'B2B'] as const
export type LeadSource = typeof LEAD_SOURCES[number]

// Approved Communication channels — conversation surfaces (NOT lead sources).
export const COMMUNICATION_CHANNELS = ['WhatsApp', 'Messenger', 'SMS', 'Email', 'Calls', 'Internal Chat'] as const
export type CommunicationChannel = typeof COMMUNICATION_CHANNELS[number]

// Approved Product Catalog categories.
export const COMMERCIAL_PRODUCT_CATEGORIES = ['Internet', 'IPTV', 'Combo'] as const
export const SUPPORTING_PRODUCT_CATEGORIES = ['Hardware', 'Add-ons', 'Bundles'] as const
export const PRODUCT_CATEGORIES = [...COMMERCIAL_PRODUCT_CATEGORIES, ...SUPPORTING_PRODUCT_CATEGORIES] as const
export type ProductCategory = typeof PRODUCT_CATEGORIES[number]

// Control gate definitions — used for UI copy/help text in the pipeline view.
export const CONTROL_GATE_DEFINITIONS: Record<ControlGate, string> = {
  'Commercial Gate':  'Contract, pricing, compliance, approvals.',
  'Technical Gate':   'Feasibility, capacity, infrastructure readiness.',
  'Service Gate':     'Installation completion, billing readiness, activation approval.',
  'Operational Gate': 'SLA, quality, incidents, audits, customer satisfaction.',
}
