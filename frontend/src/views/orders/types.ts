// Orders domain — shared types and pure helper functions.
// Extracted from OrdersView.tsx; no logic changes.
import { SERVICE_DELIVERY_STAGES } from '../../lib/lifecycle'

export type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

// ── Stage 8 types ────────────────────────────────────────────────────────────
// Mirrors the response shape of POST /api/orders/{id}/stage8-check.
export type Stage8CheckKey = 'credit_check' | 'deposit' | 'payment_method' | 'mandatory_approvals'
export type Stage8CheckStatus = 'PASS' | 'FAIL' | 'PENDING' | 'NOT_REQUIRED' | 'EXPIRED' | 'NOT_LINKED'
export type Stage8Status = {
  pass: boolean
  blockers: string[]
  checks: Record<Stage8CheckKey, Stage8CheckStatus>
}

// ── Order row ────────────────────────────────────────────────────────────────
// Mirrors the dict shape from orders.py::_order(). Stage 8 fields are optional —
// when the backend serializer hasn't been extended to include them they're simply
// undefined and the UI degrades (pill shows "Pending", deposit buttons hide).
export type OrderRow = {
  id: string
  number: string
  customer_id: string | null
  owner_node_id: string | null
  status: string                          // DRAFT | SUBMITTED | PROVISIONING | COMPLETED | CANCELLED
  total: number                           // luma
  created_at: string | null
  items?: OrderItemRow[]
  // ── Stage 8 (Phase B.1) ──
  control_pass?: boolean | null
  control_pass_at?: string | null
  control_gate_block_reason?: string | null
  deposit_required?: string | number | null     // Decimal AMD, serialized as string
  deposit_collected?: string | number | null
  deposit_held_until?: string | null
  payment_method_id?: string | null
  deposit_payment_id?: string | null
}

export type OrderItemRow = {
  id: string
  product_id: string | null
  description: string
  quantity: number
  unit_amount: number                     // luma
  line_total: number                      // luma
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

// Order statuses are the SST fulfillment stages (lifecycle.ts #6-13).
export function mapOrderStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toLowerCase()
  if (v === 'activation') return 'active'
  if (['scheduling', 'config', 'installation', 'connection_test'].includes(v)) return 'degraded'
  if (v === 'cancelled' || v === 'install_failed') return 'critical'
  return 'info' // order_created, order_validated, payment_confirmed
}

// Friendly verb for the next /advance hop, derived from the order's current SST stage.
const _NEXT_VERB: Record<string, string> = {
  order_validated: 'Schedule', scheduling: 'Config', config: 'Install',
  installation: 'Test', connection_test: 'Confirm Payment', payment_confirmed: 'Activate',
}
export function nextAdvanceLabel(status: string): string | null {
  return _NEXT_VERB[(status ?? '').toLowerCase()] ?? null
}

// The order's forward fulfillment chain = the SST service-delivery stages (lifecycle.ts), UPPER_SNAKE to
// match the backend status strings (B1b 2026-06-14, no exception) — the SINGLE source, NOT a parallel
// hardcoded map. Returns the {to} target for the unified transition route
// (POST /api/orders/{id}/transition), or null at the chain end.
const _ORDER_CHAIN: string[] = SERVICE_DELIVERY_STAGES.map((s) => s.key)
export function nextOrderStatus(status: string): string | null {
  const cur = (status ?? '').toUpperCase()
  if (cur === 'ORDER_CREATED') return _ORDER_CHAIN[0] ?? null   // /submit: sales-terminal → first order stage
  const i = _ORDER_CHAIN.indexOf(cur)
  return i >= 0 && i + 1 < _ORDER_CHAIN.length ? _ORDER_CHAIN[i + 1] : null
}

// Stage 8 column pill — derived from the persisted control_pass verdict on the
// order row. Clicking the pill opens the full Stage 8 drawer (which fetches the
// fresh predicate via /stage8-check).
export function stage8RowPill(o: OrderRow): { variant: PillVariant; label: string; title?: string } {
  const cp = o.control_pass
  if (cp === true)  return { variant: 'active',   label: 'Pass' }
  if (cp === false) return { variant: 'critical', label: 'Fail', title: o.control_gate_block_reason ?? undefined }
  return { variant: 'neutral', label: 'Pending' }
}

// Map a Stage 8 per-check status → pill variant.
export function stage8CheckVariant(s: Stage8CheckStatus): PillVariant {
  switch (s) {
    case 'PASS':         return 'active'
    case 'FAIL':         return 'critical'
    case 'PENDING':      return 'info'
    case 'NOT_REQUIRED': return 'neutral'
    case 'EXPIRED':      return 'critical'
    case 'NOT_LINKED':   return 'critical'
    default:             return 'neutral'
  }
}

// Decimal-or-number → number (luma-free; the deposit fields are AMD Decimals
// serialized as strings, NOT luma — backend collect_deposit body is "amount").
export function toAmd(v: string | number | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === 'string' ? parseFloat(v) : v
  return isFinite(n) ? n : 0
}
