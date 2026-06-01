// Notifications client lib (P4). Extracted from NotificationCenter so the new NotificationBell
// (and any future caller) can drop in cleanly without re-implementing the fetch wiring.
// Same BASE + Authorization shape as the rest of the app (see api.ts).
//
// Server contracts (backend/app/routers/notifications.py):
//   GET    /notifications                        list (filterable; we want the active inbox)
//   GET    /notifications/unread-count           {count}
//   POST   /notifications/{id}/read              mark a single notification read
//   POST   /notifications/read-all               mark every active notification read
//   POST   /notifications/{id}/archive           remove from default inbox view
//
// There is NO server-side "clear all" — `clearAll` archives each unread item client-side
// and returns once the awaited Promise.all settles.

import { BASE } from './config'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

// Server-side shape from notifications.py:_serialize — we only consume the fields the kit needs.
export type ServerNote = {
  id: string
  def_key: string
  category: string | null
  priority: string | null
  title: string
  body: string
  entity_key: string | null
  record_id: string | null
  read_at: string | null
  created_at: string | null
}

export async function listNotifications(token: string, opts: { unread?: boolean } = {}): Promise<ServerNote[]> {
  const p = new URLSearchParams()
  if (opts.unread) p.set('unread', 'true')
  const qs = p.toString()
  const res = await fetch(`${BASE}/notifications${qs ? `?${qs}` : ''}`, { headers: authH(token) })
  if (!res.ok) throw new Error(`listNotifications: HTTP ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? (data as ServerNote[]) : []
}

export async function getUnreadCount(token: string): Promise<number> {
  const res = await fetch(`${BASE}/notifications/unread-count`, { headers: authH(token) })
  if (!res.ok) throw new Error(`getUnreadCount: HTTP ${res.status}`)
  const d = await res.json()
  return Number(d.count ?? 0)
}

export async function markRead(token: string, id: string): Promise<void> {
  const res = await fetch(`${BASE}/notifications/${id}/read`, { method: 'POST', headers: authH(token) })
  if (!res.ok) throw new Error(`markRead: HTTP ${res.status}`)
}

export async function markAllRead(token: string): Promise<void> {
  const res = await fetch(`${BASE}/notifications/read-all`, { method: 'POST', headers: authH(token) })
  if (!res.ok) throw new Error(`markAllRead: HTTP ${res.status}`)
}

// No server-side bulk-clear; archive each id in parallel and ignore individual failures.
// Returns the count of archives that succeeded.
export async function clearAll(token: string, ids: string[]): Promise<number> {
  const results = await Promise.allSettled(
    ids.map((id) => fetch(`${BASE}/notifications/${id}/archive`, { method: 'POST', headers: authH(token) })),
  )
  return results.filter((r) => r.status === 'fulfilled' && (r.value as Response).ok).length
}
