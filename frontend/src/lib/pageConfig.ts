// -----------------------------------------------------------------------------
// pageConfig — the "configure in place" client layer for BESPOKE pages.
//
// A bespoke view (e.g. Services) keeps ALL of its hand-built data + tools and layers a small
// presentation descriptor on top: a title override and per-column controls (visible / label /
// order). The descriptor is tenant-scoped and superadmin-editable, persisted at
// GET/PUT /api/page-config/{pageKey}.  No saved config ⇒ page defaults (identical to today).
//
// HOW TO ADOPT ON ANOTHER BESPOKE VIEW (~10 lines) — see ServicesView.tsx for the live example:
//   1. Register the page in PAGE_CONFIGS below: a pageKey, a default title, and the page's
//      DEFAULT_COLUMNS (key + default label, in default order).
//   2. In App.tsx add the view.type to BESPOKE_PAGE_KEYS so the Configure button + drawer light up.
//   3. In the view: `const cfg = usePageConfig(token, 'yourKey')` then render
//      `cfg.title` for the heading and iterate `cfg.columns` (already filtered+ordered+labelled)
//      to drive your <thead>/<td> instead of a hardcoded column list.
// Everything else in the view (data fetch, actions, detail panes) is untouched.
// -----------------------------------------------------------------------------
import { useEffect, useState } from 'react'
import { bget, bput } from './billing'

export type ColumnDef = { key: string; label: string; visible: boolean }

// A superadmin-defined REAL data field added to a bespoke page. The DEFINITION lives in the
// page-config descriptor (persisted via PUT /api/page-config/{key}); the per-row VALUE is stored
// separately (page_field_value table) and edited inline in the view. Adding/removing a field never
// touches the page's hand-coded engine — values are rendered + persisted generically.
export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'boolean'
export type CustomFieldDef = {
  key: string                  // auto-derived from the label; stable identifier for the value map
  label: string                // column header
  type: CustomFieldType
  options?: string[]           // for type 'select'
}
export type PageDescriptor = { title: string | null; columns: ColumnDef[]; customFields: CustomFieldDef[] }

// Per-page registry: the page's identity + its default presentation. Defaults are the single
// source of truth for "what the page looks like with no saved config".
export type PageSpec = {
  pageKey: string
  defaultTitle: string
  // Default columns in default order. label here is the default label.
  defaultColumns: { key: string; label: string }[]
}

export const PAGE_SPECS: Record<string, PageSpec> = {
  services: {
    pageKey: 'services',
    defaultTitle: 'Services',
    defaultColumns: [
      { key: 'name', label: 'Service' },
      { key: 'customer', label: 'Customer' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'activated', label: 'Activated' },
    ],
  },
  invoices: {
    pageKey: 'invoices',
    defaultTitle: 'Invoices',
    defaultColumns: [
      { key: 'number', label: 'Invoice' },
      { key: 'customer', label: 'Customer' },
      { key: 'issued', label: 'Issued' },
      { key: 'due', label: 'Due' },
      { key: 'status', label: 'Status' },
      { key: 'amount', label: 'Amount' },
    ],
  },
  payments: {
    pageKey: 'payments',
    defaultTitle: 'Payments',
    defaultColumns: [
      { key: 'invoice', label: 'Invoice' },
      { key: 'customer', label: 'Customer' },
      { key: 'method', label: 'Method' },
      { key: 'date', label: 'Date' },
      { key: 'amount', label: 'Amount (֏)' },
      { key: 'note', label: 'Note' },
    ],
  },
  subscriptions: {
    pageKey: 'subscriptions',
    defaultTitle: 'Subscriptions',
    defaultColumns: [
      { key: 'customer', label: 'Customer' },
      { key: 'plan', label: 'Plan' },
      { key: 'cycle', label: 'Cycle' },
      { key: 'status', label: 'Status' },
      { key: 'mrr', label: 'MRR (֏)' },
    ],
  },
  accounts: {
    pageKey: 'accounts',
    defaultTitle: 'Accounts',
    defaultColumns: [
      { key: 'type', label: 'Type' },
      { key: 'holder', label: 'Holder' },
      { key: 'currency', label: 'Currency' },
      { key: 'cycle', label: 'Cycle' },
      { key: 'status', label: 'Status' },
    ],
  },
  usage: {
    pageKey: 'usage',
    defaultTitle: 'Usage',
    defaultColumns: [
      { key: 'subscription', label: 'Subscription' },
      { key: 'metric', label: 'Metric' },
      { key: 'quantity', label: 'Quantity' },
      { key: 'rate', label: 'Rate' },
      { key: 'amount', label: 'Amount' },
      { key: 'rated', label: 'Rated' },
    ],
  },
  webhooks: {
    pageKey: 'webhooks',
    defaultTitle: 'Webhooks',
    defaultColumns: [
      { key: 'name', label: 'Name' },
      { key: 'url', label: 'URL' },
      { key: 'events', label: 'Events' },
      { key: 'secret', label: 'Secret' },
      { key: 'active', label: 'Active' },
    ],
  },
  // Title-only pages: widgets/charts/tree/detail — no column config.
  dashboards: {
    pageKey: 'dashboards',
    defaultTitle: 'Dashboard',
    defaultColumns: [],
  },
  org: {
    pageKey: 'org',
    defaultTitle: 'Org',
    defaultColumns: [],
  },
  gateway: {
    pageKey: 'gateway',
    defaultTitle: 'Payment Gateway',
    defaultColumns: [],
  },
  customer: {
    pageKey: 'customer',
    defaultTitle: 'Customer',
    defaultColumns: [],
  },
  reports: {
    pageKey: 'reports',
    defaultTitle: 'Reports',
    defaultColumns: [],
  },
  'revenue-assurance': {
    pageKey: 'revenue-assurance',
    defaultTitle: 'Revenue Assurance',
    defaultColumns: [],
  },
  calendar: {
    pageKey: 'calendar',
    defaultTitle: 'Calendar',
    defaultColumns: [],
  },
  mytasks: {
    pageKey: 'mytasks',
    defaultTitle: 'My Tasks',
    defaultColumns: [],
  },
  'my-approvals': {
    pageKey: 'my-approvals',
    defaultTitle: 'My Approvals',
    defaultColumns: [],
  },
  'activity-feed': {
    pageKey: 'activity-feed',
    defaultTitle: 'Activity Feed',
    defaultColumns: [],
  },
  'saved-views': {
    pageKey: 'saved-views',
    defaultTitle: 'Saved Views',
    defaultColumns: [],
  },
  // Table-capable pages.
  helpdesk: {
    pageKey: 'helpdesk',
    defaultTitle: 'Helpdesk',
    defaultColumns: [
      { key: 'subject', label: 'Subject' },
      { key: 'customer', label: 'Customer' },
      { key: 'priority', label: 'Priority' },
      { key: 'status', label: 'Status' },
      { key: 'assignee', label: 'Assignee' },
      { key: 'sla', label: 'SLA' },
    ],
  },
  workitems: {
    pageKey: 'workitems',
    defaultTitle: 'Work Items',
    defaultColumns: [
      { key: 'title', label: 'Title' },
      { key: 'kind', label: 'Kind' },
      { key: 'customer', label: 'Customer' },
      { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' },
      { key: 'assignee', label: 'Assignee' },
      { key: 'due', label: 'Due' },
      { key: 'scheduled', label: 'Scheduled' },
    ],
  },
}

// Build the full default descriptor for a page (all columns visible, default labels, default order).
export function defaultDescriptor(spec: PageSpec): PageDescriptor {
  return {
    title: null,
    columns: spec.defaultColumns.map((c) => ({ key: c.key, label: c.label, visible: true })),
    customFields: [],
  }
}

// Sanitize the saved customFields blob (defensive — it's an open JSON store): keep only well-formed
// defs with a key + a known type, de-dupe keys, normalize select options.
const CUSTOM_FIELD_TYPES: CustomFieldType[] = ['text', 'number', 'date', 'select', 'boolean']
function resolveCustomFields(saved: unknown): CustomFieldDef[] {
  if (!Array.isArray(saved)) return []
  const out: CustomFieldDef[] = []
  const seen = new Set<string>()
  for (const raw of saved) {
    if (!raw || typeof raw !== 'object') continue
    const d = raw as Record<string, unknown>
    const key = typeof d.key === 'string' ? d.key.trim() : ''
    const type = d.type as CustomFieldType
    if (!key || seen.has(key) || !CUSTOM_FIELD_TYPES.includes(type)) continue
    seen.add(key)
    const def: CustomFieldDef = { key, label: (typeof d.label === 'string' && d.label.trim()) || key, type }
    if (type === 'select') {
      def.options = Array.isArray(d.options) ? d.options.map((o) => String(o).trim()).filter(Boolean) : []
    }
    out.push(def)
  }
  return out
}

// Merge a saved (possibly partial / stale) descriptor onto the page's defaults so the result is
// always complete + safe to render:
//  - unknown saved columns are dropped (a column the page no longer has)
//  - columns the page added since the config was saved are appended (visible, default label)
//  - saved order is honoured; new columns trail in default order
export function resolveDescriptor(spec: PageSpec, saved: Partial<PageDescriptor> | null | undefined): PageDescriptor {
  const def = defaultDescriptor(spec)
  if (!saved || (saved.title == null && !Array.isArray(saved.columns) && !Array.isArray(saved.customFields))) return def

  const known = new Map(def.columns.map((c) => [c.key, c]))
  const out: ColumnDef[] = []
  const seen = new Set<string>()

  for (const sc of saved.columns ?? []) {
    const base = known.get(sc.key)
    if (!base || seen.has(sc.key)) continue   // drop unknown / duplicate
    seen.add(sc.key)
    out.push({
      key: sc.key,
      label: (sc.label && sc.label.trim()) || base.label,
      visible: sc.visible !== false,
    })
  }
  // append any page columns the saved config didn't mention (newly added since save)
  for (const c of def.columns) {
    if (!seen.has(c.key)) out.push({ ...c })
  }

  return {
    title: saved.title != null && String(saved.title).trim() !== '' ? String(saved.title) : null,
    columns: out,
    customFields: resolveCustomFields(saved.customFields),
  }
}

// What a view consumes: the resolved title (override or default) and the visible columns in order.
export type AppliedPageConfig = {
  title: string                 // override if set, else the page default
  columns: ColumnDef[]          // VISIBLE columns only, in order, with resolved labels
  customFields: CustomFieldDef[] // superadmin-added real data fields (extra columns, edited inline)
  loaded: boolean
}

// Hook: fetch + resolve a page's config. Returns page defaults until loaded (and on any error),
// so the page always renders exactly as today when nothing is configured / the store is down.
// `reloadKey` (optional): change it to force a re-fetch — e.g. after the superadmin saves config.
export function usePageConfig(token: string, pageKey: string, reloadKey: number = 0): AppliedPageConfig {
  const spec = PAGE_SPECS[pageKey]
  const [descriptor, setDescriptor] = useState<PageDescriptor>(() => (spec ? defaultDescriptor(spec) : { title: null, columns: [], customFields: [] }))
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    setLoaded(false)
    if (!spec) { setLoaded(true); return }
    bget<{ config?: Partial<PageDescriptor> }>(token, `/api/page-config/${pageKey}`)
      .then((res) => {
        if (!alive) return
        setDescriptor(resolveDescriptor(spec, res.ok ? res.data?.config : null))
      })
      .catch(() => { if (alive) setDescriptor(defaultDescriptor(spec)) })
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [token, pageKey, reloadKey])

  return {
    title: descriptor.title ?? (spec?.defaultTitle ?? pageKey),
    columns: descriptor.columns.filter((c) => c.visible),
    customFields: descriptor.customFields,
    loaded,
  }
}

// Persist a descriptor (superadmin only — the backend gates on config.manage). Returns the saved
// descriptor or throws (so the drawer can Toast on failure).
export async function savePageConfig(token: string, pageKey: string, descriptor: PageDescriptor): Promise<void> {
  await bput(token, `/api/page-config/${pageKey}`, { config: descriptor })
}

// -----------------------------------------------------------------------------
// Custom field VALUES (the per-row data for superadmin-added fields).
// -----------------------------------------------------------------------------
export type PageValueMap = Record<string, Record<string, any>>  // { rowId: { fieldKey: value } }

// Batch-fetch the saved custom-field values for a set of rows. Returns {} on error / no values
// (so the page renders blank cells, never breaks). Rows without saved values are simply omitted.
export async function fetchPageValues(token: string, pageKey: string, ids: string[]): Promise<PageValueMap> {
  const list = ids.filter(Boolean)
  if (list.length === 0) return {}
  const res = await bget<PageValueMap>(token, `/api/page-config/${pageKey}/values?ids=${encodeURIComponent(list.join(','))}`)
  return res.ok && res.data && typeof res.data === 'object' ? res.data : {}
}

// Upsert one row's custom-field values. Returns the saved data; throws on failure (caller toasts).
export async function savePageValue(token: string, pageKey: string, rowId: string, data: Record<string, any>): Promise<Record<string, any>> {
  const res = await bput<{ row_id: string; data: Record<string, any> }>(token, `/api/page-config/${pageKey}/values/${encodeURIComponent(rowId)}`, data)
  return res?.data ?? data
}

// Derive a safe field key from a human label: lowercase, alnum+underscore, leading-alpha. Used by
// the drawer so a superadmin only types a label.
export function deriveFieldKey(label: string): string {
  const k = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[a-z]/.test(k) ? k.slice(0, 60) : `f_${k}`.slice(0, 60)
}
