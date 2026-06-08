import type { PageType } from '../../page-shell'

// ── Core entity types ──────────────────────────────────────────────────────────

export type Field = { key: string; label: string; type: string; required: boolean; order: number; config: any; editable?: boolean }
export type Status = { key: string; label: string; order: number; is_initial: boolean }
export type Transition = { from: string; to: string }
export type Def = { key: string; label: string; label_plural: string; route_slug: string; fields: Field[]; statuses: Status[]; transitions: Transition[] }

// Drafts = initial status (is_initial === true)
// History = terminal statuses (no outgoing transitions)
// Active = everything else
export type StatusGroups = { drafts: string[]; active: string[]; history: string[] }

export type StatusTab = 'all' | 'active' | 'history' | 'drafts'
export type Row = Record<string, any>
export type Mode = 'idle' | 'creating' | 'editing'
export type SavedView = { id: string | number; name: string; q?: string; filter?: string; sort?: string }
export type ExportFormats = { csv: boolean; xlsx: boolean; pdf: boolean }

// PageShell metadata per known slug
export type SlugMeta = { breadcrumb: string[]; type: PageType; subtitle?: string }

export const SLUG_META: Record<string, SlugMeta> = {
  'leads':                { breadcrumb: ['CRM', 'Leads'],                    type: 'REGISTRY' },
  'customers':            { breadcrumb: ['CRM', 'Customers'],                type: 'REGISTRY' },
  'campaigns':            { breadcrumb: ['CRM', 'Campaigns'],                type: 'REGISTRY' },
  'users':                { breadcrumb: ['Admin Panel', 'Users'],            type: 'CONFIGURATION' },
  'roles':                { breadcrumb: ['Admin Panel', 'Roles'],            type: 'CONFIGURATION' },
  'incidents':            { breadcrumb: ['NMS', 'Incidents'],         type: 'OPERATIONS' },
  'assets':               { breadcrumb: ['NMS', 'Assets'],            type: 'OPERATIONS' },
  'expenses':             { breadcrumb: ['Enterprise', 'Finance'],           type: 'REGISTRY' },
  'employees':            { breadcrumb: ['Enterprise', 'HR'],                type: 'REGISTRY' },
  'purchase-orders':      { breadcrumb: ['Enterprise', 'Procurement'],       type: 'REGISTRY' },
  'contracts':            { breadcrumb: ['Enterprise', 'Legal'],             type: 'REGISTRY' },
  'notification-rules':   { breadcrumb: ['Admin Panel', 'Notifications'],    type: 'CONFIGURATION' },
}

// ── Pure helper functions ──────────────────────────────────────────────────────

export function deriveStatusGroups(def: Def): StatusGroups {
  const statuses = def.statuses ?? []
  const transitions = def.transitions ?? []
  if (statuses.length === 0) return { drafts: [], active: [], history: [] }
  const outgoing = new Set(transitions.map((t) => t.from))
  const drafts: string[] = []
  const history: string[] = []
  const active: string[] = []
  for (const s of statuses) {
    if (s.is_initial) { drafts.push(s.key); continue }
    if (!outgoing.has(s.key)) { history.push(s.key); continue }
    active.push(s.key)
  }
  return { drafts, active, history }
}

// Group form fields by their config.section for the create/edit modal.
export function groupFieldsBySection(fields: Field[]): Array<{ section: string | null; fields: Field[] }> {
  const groups: Array<{ section: string | null; fields: Field[] }> = []
  for (const f of fields) {
    const section: string | null = f.config?.section ?? null
    let g = groups.find((x) => x.section === section)
    if (!g) { g = { section, fields: [] }; groups.push(g) }
    g.fields.push(f)
  }
  return groups
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')
}

export function pagePropsForSlug(slug: string, def: Def | null): { breadcrumb: string[]; type: PageType; title: string; subtitle: string } {
  const meta = SLUG_META[slug] ?? { breadcrumb: ['Records', capitalize(slug)], type: 'REGISTRY' as PageType }
  const title = def?.label_plural ?? capitalize(slug)
  const subtitle = meta.subtitle ?? ''
  return { breadcrumb: meta.breadcrumb, type: meta.type, title, subtitle }
}

export function errFieldOf(msg: string): string | null {
  const m = msg.match(/'([^']+)'/)
  return m ? m[1] : null
}

// ── Status → StatusPill variant mapping ───────────────────────────────────────

export type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

export function mapEntityStatus(status: string, def?: Def): PillVariant {
  const s = String(status ?? '').toLowerCase().replace(/[\s-]+/g, '_')
  if (['done', 'closed', 'active', 'paid', 'resolved', 'won', 'succeeded', 'enabled', 'completed'].includes(s)) return 'active'
  if (['cancelled', 'canceled', 'void', 'expired', 'failed', 'critical', 'lost', 'error', 'disabled', 'rejected', 'churned'].includes(s)) return 'critical'
  if (['pending', 'draft', 'new', 'prospect', 'open', 'qualified', 'sent', 'issued'].includes(s)) return 'info'
  if (['suspended', 'degraded', 'past_due', 'throttled', 'on_hold', 'blocked', 'warning'].includes(s)) return 'degraded'
  if (['in_progress', 'negotiation', 'processing'].includes(s)) return 'info'
  if (def) {
    const meta = (def.statuses ?? []).find((x) => x.key === status)
    if (meta?.is_initial) return 'info'
    const hasOutgoing = (def.transitions ?? []).some((t) => t.from === status)
    if (!hasOutgoing && meta) return 'neutral'
  }
  return 'neutral'
}

// ── Date helpers for leads KPI computation ─────────────────────────────────────

export function startOfWeekMonday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const sinceMon = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - sinceMon)
  return d
}

const _MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function fmtDay(d: Date): string {
  return `${_MONTHS[d.getMonth()]} ${d.getDate()}`
}
