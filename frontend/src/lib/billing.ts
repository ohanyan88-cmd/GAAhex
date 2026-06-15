// Billing API helpers + types — matches the merged A9 contract (backend/app/routers/billing.py).
// Money is integer luma (minor units; 100 = 1 ֏). Optional endpoints (products, dunning) are
// treated as "not available yet" on 404 and degrade quietly.
//
// AC-1/AC-2/AC-3 — this module is the **canonical admin API client**:
//   * `authH(token)` is the single Bearer-header factory; do NOT redefine in views.
//   * `bget`/`bpost`/`bpatch`/`bput`/`bdel` are the only ways to hit the backend; raw
//     `fetch()` in views is the AC-2 anti-pattern. Use `openDocument` for HTML blobs.
//   * Every response is funneled through `intercept401` which dispatches the
//     `gaahex:auth-401` DOM event so `App.tsx` (or future AuthContext) can clear
//     React state and bounce to login.
import { BASE } from './config'
export { BASE }
export const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

// AC-3 — centralized 401 intercept. Dispatches a DOM event so the React layer
// can clear token state and re-render the login screen. We do NOT call
// window.location.href here because the admin SPA owns its own login route via
// React state; a full reload would lose any in-flight UX context.
const AUTH_401_EVENT = 'gaahex:auth-401' as const
function intercept401(status: number): void {
  if (status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_401_EVENT))
  }
}
export { AUTH_401_EVENT }

// VA-5 — discriminated status unions. Source of truth: docs/standards/14-enum-registry.md.
// These will be auto-generated once DF-8 (openapi-typescript) lands; until then
// keep them in sync manually. Any typo in a status string literal now fails at compile.
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'OVERDUE' | 'VOID'
export type SubscriptionStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED'
export type PaymentMethodKind = 'cash' | 'card' | 'transfer'

export type Subscription = {
  id: string
  customer_id?: string | null
  owner_node_id?: string | null
  plan_name?: string
  amount?: number // luma
  cycle?: string // monthly | yearly
  status?: SubscriptionStatus | null
  started_at?: string | null
  next_invoice_at?: string | null
  created_at?: string | null
  [k: string]: any
}

export type InvoiceLine = {
  id?: string
  description?: string
  quantity?: number
  unit_amount?: number // luma (negative ⇒ discount line)
  line_total?: number // luma
  [k: string]: any
}

export type Invoice = {
  id: string
  number?: string
  customer_id?: string | null
  status?: InvoiceStatus | null
  period_start?: string | null
  period_end?: string | null
  total?: number // luma
  paid_total?: number // luma — sum of recorded payments
  balance?: number // luma — total minus paid_total
  issued_at?: string | null
  due_at?: string | null
  created_at?: string | null
  lines?: InvoiceLine[]
  [k: string]: any
}

export type Payment = {
  id: string
  invoice_id: string
  amount: number // luma
  method: PaymentMethodKind
  paid_at: string | null
  note: string | null
  created_at: string | null
}

export type Party = {
  id: string
  type?: string // individual | organization | carrier
  name?: string
  parent_party_id?: string | null
  parent_name?: string | null
  status?: string | null
  created_at?: string | null
  [k: string]: any
}

export type Product = {
  id: string
  key?: string
  name?: string
  description?: string | null
  default_amount?: number // luma
  cycle?: string
  active?: boolean
  created_at?: string | null
  [k: string]: any
}

export type Fetched<T> = { status: number; ok: boolean; data: T | null }

// GET that never throws — returns status so callers can tell 404 (degrade) from real errors.
export async function bget<T = any>(token: string, path: string): Promise<Fetched<T>> {
  const r = await fetch(`${BASE}${path}`, { headers: authH(token) })
  intercept401(r.status) // AC-3
  let data: any = null
  try {
    data = await r.json()
  } catch {
    /* empty/non-json body */
  }
  return { status: r.status, ok: r.ok, data }
}

// POST/PATCH that throws on failure (so action handlers can Toast). The thrown Error has `.status`.
async function send<T = any>(token: string, method: string, path: string, body?: any): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  intercept401(r.status) // AC-3
  let data: any = null
  try {
    data = await r.json()
  } catch {
    /* ignore */
  }
  if (!r.ok) {
    const d = data?.detail
    const err = new Error(
      typeof d === 'string' ? d : d ? JSON.stringify(d) : `Request failed (${r.status})`,
    ) as Error & { status?: number }
    err.status = r.status
    throw err
  }
  return data as T
}
export const bpost = <T = any>(token: string, path: string, body?: any) =>
  send<T>(token, 'POST', path, body)
export const bpatch = <T = any>(token: string, path: string, body?: any) =>
  send<T>(token, 'PATCH', path, body)
export const bput = <T = any>(token: string, path: string, body?: any) =>
  send<T>(token, 'PUT', path, body)
export const bdel = <T = any>(token: string, path: string) => send<T>(token, 'DELETE', path)

// AC — single low-level auth'd fetch returning the raw Response, for the cases the typed helpers
// can't cover: reading response headers (X-Total-Count), blobs, FormData, or per-call 404→null
// branching. Funnels through intercept401 like every other helper, so 401 handling is universal.
// `lib/api.ts` routes ALL its calls through this, so there is one client surface, not two.
export async function bfetch(
  token: string | null,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = { ...(token ? authH(token) : {}), ...(init?.headers ?? {}) }
  const r = await fetch(`${BASE}${path}`, { ...init, headers })
  intercept401(r.status) // AC-3
  return r
}

// Opt-in snake_case → camelCase key mapper for the data seam (standard §12 camelCase wire). NOT applied
// blanket — that would break the many snake_case consumers; pages opt in as they migrate (Phase 6 tracer).
function toCamel(s: string): string {
  return s.replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase())
}
export function camelKeys<T = any>(input: unknown): T {
  if (Array.isArray(input)) return input.map((v) => camelKeys(v)) as unknown as T
  if (input && typeof input === 'object' && (input as object).constructor === Object) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(input as Record<string, unknown>)) {
      out[toCamel(k)] = camelKeys((input as Record<string, unknown>)[k])
    }
    return out as T
  }
  return input as T
}

// Multipart file upload — no Content-Type override; browser sets multipart/form-data + boundary.
export async function bupload<T = any>(token: string, path: string, form: FormData): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: authH(token), body: form })
  intercept401(r.status)
  let data: any = null
  try {
    data = await r.json()
  } catch {
    /* non-json body */
  }
  if (!r.ok) {
    const d = data?.detail
    const err = new Error(
      typeof d === 'string' ? d : d ? JSON.stringify(d) : `Upload failed (${r.status})`,
    ) as Error & { status?: number }
    err.status = r.status
    throw err
  }
  return data as T
}

// Open an auth'd document endpoint (branded HTML) in a new tab. A plain GET link can't carry the
// Authorization header, so we fetch→blob→object-URL. Opens a blank tab synchronously (within the
// click gesture) to avoid popup blocking, then points it at the blob. Returns an error message or null.
export async function openDocument(token: string, path: string): Promise<string | null> {
  const win = window.open('', '_blank')
  try {
    const r = await fetch(`${BASE}${path}`, { headers: authH(token) })
    if (!r.ok)
      throw new Error(
        r.status === 404
          ? 'Document not available'
          : r.status === 403
            ? 'Not allowed'
            : `Failed (${r.status})`,
      )
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    if (win) win.location.href = url
    else {
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.click()
    } // popup blocked → fallback
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    return null
  } catch (e) {
    if (win) win.close()
    return (e as Error).message
  }
}

// Resolve customer_id → display name via the CRM customer entity. Empty map if unavailable.
export async function loadCustomers(token: string): Promise<Record<string, string>> {
  const res = await bget<any[]>(token, '/api/customers')
  if (!res.ok || !Array.isArray(res.data)) return {}
  const map: Record<string, string> = {}
  for (const r of res.data) map[r.id] = r.name ?? r.title ?? String(r.id).slice(0, 8)
  return map
}

// Customer options [{id,label}] for pickers (sorted by label). Empty if unavailable.
export async function loadCustomerOptions(token: string): Promise<{ id: string; label: string }[]> {
  const map = await loadCustomers(token)
  return Object.entries(map)
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

// Active products for pickers/catalog. Empty if unavailable.
export async function loadProducts(token: string, activeOnly = false): Promise<Product[]> {
  const res = await bget<Product[]>(token, `/api/products${activeOnly ? '?active=true' : ''}`)
  return res.ok && Array.isArray(res.data) ? res.data : []
}
