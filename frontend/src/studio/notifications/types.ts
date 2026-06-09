// Shared types, constants, and API helpers for the notifications sub-modules.

import { BASE } from '../../lib/config'
import { authH } from '../../lib/billing'

export const CATEGORIES = ['system', 'billing', 'network', 'customer', 'internal']
export const PRIORITIES = ['critical', 'warning', 'info']

export class FetchError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export async function apiFetch(token: string, path: string, opts?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...authH(token), 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Request failed' }))
    throw new FetchError(e.detail || `HTTP ${r.status}`, r.status)
  }
  if (r.status === 204) return null
  return r.json()
}

export type NotifChannel = 'email' | 'sms' | 'push' | 'inapp'

export type NotifDef = {
  key: string
  label: string
  channel: string
  category: string
  priority: string
  title_template: string
  body_template: string
  enabled: boolean
  gxl_condition: string | null
  created_at: string | null
}

export type Props = {
  /** When set, the list is filtered by channel and the create form locks `channel`. */
  channel?: NotifChannel
  /** When true, surface notification rules (any def with a non-empty gxl_condition). */
  rulesView?: boolean
}

export const CHANNEL_LABELS: Record<NotifChannel, string> = {
  email: 'Email Templates',
  sms: 'SMS Templates',
  push: 'Push Notifications',
  inapp: 'In-App Notifications',
}
