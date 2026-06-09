// NetworkInventoryView — pure helper functions (status variants, formatters, fetch util).
import type { LoadState } from '../../primitives'
import { bget } from '../../lib/billing'

export function fiberStatusVariant(s: string | null | undefined): 'active' | 'degraded' | 'critical' | 'neutral' | 'info' {
  const v = (s ?? '').toUpperCase()
  if (v === 'ACTIVE' || v === 'LIVE') return 'active'
  if (v === 'CONSTRUCTION') return 'info'
  if (v === 'PLANNED') return 'neutral'
  if (v === 'DECOMMISSIONED') return 'critical'
  return 'neutral'
}

export function broadcastStatusVariant(s: string | null | undefined): 'active' | 'degraded' | 'critical' | 'neutral' | 'info' {
  const v = (s ?? '').toLowerCase()
  if (v === 'complete') return 'active'
  if (v === 'sending') return 'info'
  if (v === 'failed') return 'critical'
  if (v === 'draft') return 'neutral'
  return 'neutral'
}

export function ipamStatusVariant(s: string | null | undefined): 'active' | 'degraded' | 'critical' | 'neutral' | 'info' {
  const v = (s ?? '').toLowerCase()
  if (v === 'active') return 'active'
  if (v === 'released') return 'neutral'
  return 'neutral'
}

export function radiusStatusVariant(s: string | null | undefined): 'active' | 'degraded' | 'critical' | 'neutral' | 'info' {
  const v = (s ?? '').toLowerCase()
  if (v === 'active') return 'active'
  if (v === 'stopped') return 'neutral'
  return 'neutral'
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !isFinite(Number(n))) return '—'
  const v = Number(n)
  if (v === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log10(Math.abs(v)) / 3))
  const scaled = v / Math.pow(1000, i)
  return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[i]}`
}

// Tolerant list extractor — backend may return `[…]` or `{ items:[…] }` or `{ results:[…] }`.
export function asList<T>(raw: any): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (Array.isArray(raw?.items)) return raw.items as T[]
  if (Array.isArray(raw?.results)) return raw.results as T[]
  return []
}

// 403 / 404 / error funnel reused by every tab loader. Mutates the supplied setter.
export async function fetchList<T>(token: string, path: string, set: (s: LoadState<T>) => void): Promise<void> {
  set({ state: 'loading' })
  const res = await bget<any>(token, path)
  if (res.status === 403) { set({ state: 'denied' }); return }
  if (res.status === 404) { set({ state: 'unavailable' }); return }
  if (!res.ok)            { set({ state: 'error', message: `Failed to load (${res.status})` }); return }
  const items = asList<T>(res.data)
  if (items.length === 0) { set({ state: 'empty' }); return }
  set({ state: 'ok', items })
}
