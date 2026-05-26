// Billing API helpers + types (A9 contract). Self-contained: own fetch wrappers (same base + auth
// pattern as api.ts). All billing endpoints are optional — callers treat 404 as "not available yet"
// and degrade quietly until A9 is merged.
export const BASE = 'http://127.0.0.1:8099'
export const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

export type Subscription = {
  id: string
  customer?: string
  customer_name?: string
  plan?: string
  amount?: number          // minor units (÷100 = ֏)
  cycle?: string
  status?: string | null
  created_at?: string | null
  [k: string]: any
}

export type InvoiceLine = {
  description?: string
  quantity?: number
  unit_amount?: number     // minor units
  amount?: number          // minor units
  [k: string]: any
}

export type Invoice = {
  id: string
  number?: string
  customer?: string
  customer_name?: string
  status?: string | null
  subtotal?: number
  tax?: number
  total?: number           // minor units
  due_date?: string | null
  issued_at?: string | null
  lines?: InvoiceLine[]
  [k: string]: any
}

export type Payment = {
  id: string
  amount?: number          // minor units
  method?: string
  reference?: string
  created_at?: string | null
}

export type Fetched<T> = { status: number; ok: boolean; data: T | null }

// GET that never throws — returns status so callers can tell 404 (degrade) from real errors.
export async function bget<T = any>(token: string, path: string): Promise<Fetched<T>> {
  const r = await fetch(`${BASE}${path}`, { headers: authH(token) })
  let data: any = null
  try { data = await r.json() } catch { /* empty/non-json body */ }
  return { status: r.status, ok: r.ok, data }
}

// POST that throws on failure (so action handlers can Toast the message).
export async function bpost<T = any>(token: string, path: string, body?: any): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data: any = null
  try { data = await r.json() } catch { /* ignore */ }
  if (!r.ok) {
    const d = data?.detail
    throw new Error(typeof d === 'string' ? d : d ? JSON.stringify(d) : `Request failed (${r.status})`)
  }
  return data as T
}
