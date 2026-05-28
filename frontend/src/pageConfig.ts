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
export type PageDescriptor = { title: string | null; columns: ColumnDef[] }

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
  products: {
    pageKey: 'products',
    defaultTitle: 'Products',
    defaultColumns: [
      { key: 'name', label: 'Name' },
      { key: 'key', label: 'Key' },
      { key: 'amount', label: 'Amount' },
      { key: 'cycle', label: 'Cycle' },
      { key: 'active', label: 'Active' },
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
  'resource-pools': {
    pageKey: 'resource-pools',
    defaultTitle: 'Resource Pools',
    defaultColumns: [
      { key: 'name', label: 'Name' },
      { key: 'kind', label: 'Kind' },
      { key: 'spec', label: 'Spec' },
      { key: 'allocations', label: 'Allocations' },
    ],
  },
  outbound: {
    pageKey: 'outbound',
    defaultTitle: 'Outbound Messaging',
    defaultColumns: [
      { key: 'channel', label: 'Channel' },
      { key: 'to', label: 'To' },
      { key: 'message', label: 'Message' },
      { key: 'status', label: 'Status' },
      { key: 'when', label: 'When' },
    ],
  },
}

// Build the full default descriptor for a page (all columns visible, default labels, default order).
export function defaultDescriptor(spec: PageSpec): PageDescriptor {
  return {
    title: null,
    columns: spec.defaultColumns.map((c) => ({ key: c.key, label: c.label, visible: true })),
  }
}

// Merge a saved (possibly partial / stale) descriptor onto the page's defaults so the result is
// always complete + safe to render:
//  - unknown saved columns are dropped (a column the page no longer has)
//  - columns the page added since the config was saved are appended (visible, default label)
//  - saved order is honoured; new columns trail in default order
export function resolveDescriptor(spec: PageSpec, saved: Partial<PageDescriptor> | null | undefined): PageDescriptor {
  const def = defaultDescriptor(spec)
  if (!saved || (saved.title == null && !Array.isArray(saved.columns))) return def

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
  }
}

// What a view consumes: the resolved title (override or default) and the visible columns in order.
export type AppliedPageConfig = {
  title: string                 // override if set, else the page default
  columns: ColumnDef[]          // VISIBLE columns only, in order, with resolved labels
  loaded: boolean
}

// Hook: fetch + resolve a page's config. Returns page defaults until loaded (and on any error),
// so the page always renders exactly as today when nothing is configured / the store is down.
// `reloadKey` (optional): change it to force a re-fetch — e.g. after the superadmin saves config.
export function usePageConfig(token: string, pageKey: string, reloadKey: number = 0): AppliedPageConfig {
  const spec = PAGE_SPECS[pageKey]
  const [descriptor, setDescriptor] = useState<PageDescriptor>(() => (spec ? defaultDescriptor(spec) : { title: null, columns: [] }))
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
    loaded,
  }
}

// Persist a descriptor (superadmin only — the backend gates on config.manage). Returns the saved
// descriptor or throws (so the drawer can Toast on failure).
export async function savePageConfig(token: string, pageKey: string, descriptor: PageDescriptor): Promise<void> {
  await bput(token, `/api/page-config/${pageKey}`, { config: descriptor })
}
