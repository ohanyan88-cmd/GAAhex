// Shared types, constants, and API helpers for the webhooks sub-modules.

import { BASE } from '../../lib/config'
import { authH } from '../../lib/billing'

export const EVENT_OPTIONS = [
  'create', 'update', 'delete', 'transition', 'comment', 'payment',
  'approval_requested', 'approval_approved', 'approval_rejected',
]

export class FetchError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export async function apiFetch<T = unknown>(token: string, path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...authH(token),
      ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts?.headers ?? {}),
    },
  })
  if (!r.ok) {
    let detail = `HTTP ${r.status}`
    try {
      const j = await r.json()
      detail = j?.detail || detail
    } catch { /* empty body */ }
    throw new FetchError(detail, r.status)
  }
  if (r.status === 204) return null as T
  return (await r.json()) as T
}

export type Webhook = {
  id: string
  name: string
  url: string
  events: string[]
  active: boolean
  has_secret: boolean
  created_at: string | null
}

export type Delivery = {
  id: string
  event_type?: string
  status?: string | null
  status_code?: number | null
  attempts?: number
  created_at?: string | null
  error?: string | null
}

export type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

export function mapDeliveryStatus(status: string | null | undefined): { label: string; variant: PillVariant } {
  const s = (status ?? '').toUpperCase()
  const label = status ?? '—'
  if (s === 'SENT') return { label, variant: 'active' }
  if (s === 'FAILED') return { label, variant: 'critical' }
  if (s === 'QUEUED') return { label, variant: 'info' }
  return { label, variant: 'neutral' }
}
