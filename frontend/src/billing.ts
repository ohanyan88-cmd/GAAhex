// Billing API helpers + types — matches the merged A9 contract (backend/app/routers/billing.py).
// Money is integer luma (minor units; 100 = 1 ֏). Optional endpoints (products, dunning) are
// treated as "not available yet" on 404 and degrade quietly.
export const BASE = 'http://127.0.0.1:8099'
export const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

export type Subscription = {
  id: string
  customer_id?: string | null
  owner_node_id?: string | null
  plan_name?: string
  amount?: number          // luma
  cycle?: string           // monthly | yearly
  status?: string | null   // ACTIVE | SUSPENDED | CANCELLED
  started_at?: string | null
  next_invoice_at?: string | null
  created_at?: string | null
  [k: string]: any
}

export type InvoiceLine = {
  id?: string
  description?: string
  quantity?: number
  unit_amount?: number     // luma (negative ⇒ discount line)
  line_total?: number      // luma
  [k: string]: any
}

export type Invoice = {
  id: string
  number?: string
  customer_id?: string | null
  status?: string | null   // DRAFT | ISSUED | PAID | VOID (| OVERDUE if dunning sets it)
  period_start?: string | null
  period_end?: string | null
  total?: number           // luma
  issued_at?: string | null
  due_at?: string | null
  created_at?: string | null
  lines?: InvoiceLine[]
  [k: string]: any
}

export type Payment = {
  id: string
  invoice_id?: string
  amount?: number          // luma
  method?: string          // cash | card | transfer
  paid_at?: string | null
  note?: string | null
  created_at?: string | null
}

export type Party = {
  id: string
  type?: string                 // individual | organization | carrier
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
  default_amount?: number   // luma
  cycle?: string
  active?: boolean
  created_at?: string | null
  [k: string]: any
}

export type Fetched<T> = { status: number; ok: boolean; data: T | null }

// GET that never throws — returns status so callers can tell 404 (degrade) from real errors.
export async function bget<T = any>(token: string, path: string): Promise<Fetched<T>> {
  const r = await fetch(`${BASE}${path}`, { headers: authH(token) })
  let data: any = null
  try { data = await r.json() } catch { /* empty/non-json body */ }
  return { status: r.status, ok: r.ok, data }
}

// POST/PATCH that throws on failure (so action handlers can Toast). The thrown Error has `.status`.
async function send<T = any>(token: string, method: string, path: string, body?: any): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data: any = null
  try { data = await r.json() } catch { /* ignore */ }
  if (!r.ok) {
    const d = data?.detail
    const err = new Error(typeof d === 'string' ? d : d ? JSON.stringify(d) : `Request failed (${r.status})`) as Error & { status?: number }
    err.status = r.status
    throw err
  }
  return data as T
}
export const bpost = <T = any>(token: string, path: string, body?: any) => send<T>(token, 'POST', path, body)
export const bpatch = <T = any>(token: string, path: string, body?: any) => send<T>(token, 'PATCH', path, body)
export const bdel = <T = any>(token: string, path: string) => send<T>(token, 'DELETE', path)

// Open an auth'd document endpoint (branded HTML) in a new tab. A plain GET link can't carry the
// Authorization header, so we fetch→blob→object-URL. Opens a blank tab synchronously (within the
// click gesture) to avoid popup blocking, then points it at the blob. Returns an error message or null.
export async function openDocument(token: string, path: string): Promise<string | null> {
  const win = window.open('', '_blank')
  try {
    const r = await fetch(`${BASE}${path}`, { headers: authH(token) })
    if (!r.ok) throw new Error(r.status === 404 ? 'Document not available' : r.status === 403 ? 'Not allowed' : `Failed (${r.status})`)
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    if (win) win.location.href = url
    else { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.click() }   // popup blocked → fallback
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
  return Object.entries(map).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))
}

// Active products for pickers/catalog. Empty if unavailable.
export async function loadProducts(token: string, activeOnly = false): Promise<Product[]> {
  const res = await bget<Product[]>(token, `/api/products${activeOnly ? '?active=true' : ''}`)
  return res.ok && Array.isArray(res.data) ? res.data : []
}
