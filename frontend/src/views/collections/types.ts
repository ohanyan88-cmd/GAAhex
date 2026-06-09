// Pure types, constants, and helpers for CollectionsView and its sub-components.

export type DunningStep = { day_offset: number; action: string; params: Record<string, unknown> }

export type DunningPolicy = {
  id: string
  tenant_id?: string
  name: string
  description?: string | null
  is_default: boolean
  active: boolean
  steps_json: DunningStep[]
  applies_to_tariff_plan_ids?: string[] | null
  created_at?: string | null
  updated_at?: string | null
}

export type DunningCaseStatus = 'active' | 'cured' | 'escalated' | 'closed'

export type DunningCase = {
  id: string
  account_id: string
  triggering_invoice_id: string
  policy_id: string
  current_step_index: number
  step_entered_at: string | null
  next_action_at: string | null
  status: DunningCaseStatus
  opened_at: string | null
  cured_at: string | null
  closed_at: string | null
  closed_reason: string | null
}

export type CollectionsTab = 'cases' | 'policies'

export type PolicyDraft = {
  id?: string
  name: string
  description: string
  is_default: boolean
  active: boolean
  steps_text: string         // raw JSON textarea content
}

// Canonical 5-step ladder used as the default seed when admin creates a new policy.
export const DEFAULT_STEPS_JSON = JSON.stringify(
  [
    { day_offset: 3, action: 'notice', params: { template: 'dunning_notice_1' } },
    { day_offset: 7, action: 'notice', params: { template: 'dunning_notice_2' } },
    { day_offset: 14, action: 'throttle', params: { kbps: 256 } },
    { day_offset: 21, action: 'walled_garden', params: { redirect_url: 'https://payment.example.com' } },
    { day_offset: 45, action: 'terminate', params: {} },
  ],
  null,
  4,
)

export const EMPTY_POLICY_DRAFT: PolicyDraft = {
  name: '',
  description: '',
  is_default: false,
  active: true,
  steps_text: DEFAULT_STEPS_JSON,
}

export const PAGE_SIZE = 25

// Backend may return either a bare array or {items,total,page} envelope. Normalize.
export function unwrapList<T>(payload: unknown): { items: T[]; total: number; page: number } {
  if (Array.isArray(payload)) return { items: payload as T[], total: payload.length, page: 1 }
  if (payload && typeof payload === 'object') {
    const p = payload as { items?: unknown; total?: unknown; page?: unknown }
    if (Array.isArray(p.items)) {
      return {
        items: p.items as T[],
        total: typeof p.total === 'number' ? p.total : (p.items as T[]).length,
        page: typeof p.page === 'number' ? p.page : 1,
      }
    }
  }
  return { items: [], total: 0, page: 1 }
}

// Validate user-edited steps_json text. Returns parsed array on success, error string on failure.
export function validateStepsJson(text: string): { ok: true; steps: DunningStep[] } | { ok: false; err: string } {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch (e) { return { ok: false, err: 'Invalid JSON: ' + (e as Error).message } }
  if (!Array.isArray(parsed)) return { ok: false, err: 'Steps must be a JSON array' }
  const steps: DunningStep[] = []
  for (let i = 0; i < parsed.length; i++) {
    const s = parsed[i] as Record<string, unknown> | undefined
    if (!s || typeof s !== 'object') return { ok: false, err: `Step #${i + 1} must be an object` }
    if (!Number.isInteger(s.day_offset)) return { ok: false, err: `Step #${i + 1}: day_offset must be an integer` }
    if (typeof s.action !== 'string' || !s.action.trim()) return { ok: false, err: `Step #${i + 1}: action must be a non-empty string` }
    if (!s.params || typeof s.params !== 'object' || Array.isArray(s.params)) return { ok: false, err: `Step #${i + 1}: params must be an object` }
    steps.push({ day_offset: s.day_offset as number, action: s.action, params: s.params as Record<string, unknown> })
  }
  return { ok: true, steps }
}

// Case status → pill variant.
export function caseStatusVariant(s: DunningCaseStatus): 'active' | 'degraded' | 'critical' | 'neutral' {
  switch (s) {
    case 'active': return 'critical'   // an active dunning case is bad news
    case 'escalated': return 'degraded'
    case 'cured': return 'active'
    case 'closed': return 'neutral'
    default: return 'neutral'
  }
}

// Helpers
export function shortId(id: string | null | undefined): string {
  if (!id) return '—'
  return id.slice(0, 8)
}

// Best-effort sweep-result summary. The backend's `/api/dunning/run` response shape isn't strictly
// pinned at the UI layer — accept common counter keys (advanced/cured/closed/processed) if present.
export function summarizeSweep(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const r = result as Record<string, unknown>
  const parts: string[] = []
  const tryCount = (key: string, label: string) => {
    const v = r[key]
    if (typeof v === 'number') parts.push(`${v} ${label}`)
  }
  tryCount('processed', 'processed')
  tryCount('advanced', 'advanced')
  tryCount('cured', 'cured')
  tryCount('closed', 'closed')
  tryCount('escalated', 'escalated')
  return parts.join(' · ')
}
