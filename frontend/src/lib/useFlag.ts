/**
 * useFlag — thin interface over the DB-backed feature-flag system.
 *
 * Call sites:
 *   const enabled = useFlag('new-dashboard')
 *
 * Swap the implementation for OpenFeature later by replacing _fetchFlags()
 * and the cache internals — all call sites stay the same.
 */
import { useState, useEffect } from 'react'
import { BASE, authH } from './billing'

export interface FlagRecord {
  id: string
  key: string
  label: string
  enabled: boolean
  role_scope: string | null
}

// ── module-level cache (one fetch per session, re-fetch after 5 min) ─────────

let _cache: FlagRecord[] | null = null
let _fetchedAt = 0
let _inflight: Promise<FlagRecord[]> | null = null
const STALE_MS = 5 * 60 * 1000

async function _fetchFlags(token: string): Promise<FlagRecord[]> {
  if (_inflight) return _inflight
  const now = Date.now()
  if (_cache !== null && now - _fetchedAt < STALE_MS) return _cache

  _inflight = fetch(`${BASE}/api/feature-flags`, { headers: authH(token) })
    .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((data: FlagRecord[]) => {
      _cache = Array.isArray(data) ? data : []
      _fetchedAt = Date.now()
      return _cache
    })
    .catch(() => {
      _cache = _cache ?? []   // keep stale on error; safe default = []
      return _cache
    })
    .finally(() => { _inflight = null })

  return _inflight
}

/** Force-invalidate the module-level cache (e.g. after a PATCH). */
export function invalidateFlagCache(): void {
  _cache = null
  _fetchedAt = 0
}

// ── hook ─────────────────────────────────────────────────────────────────────

/**
 * useFlag(key, token?, userRole?)
 *
 * Returns true when the flag is enabled. If `role_scope` is set on the flag
 * it additionally requires that `userRole` matches — client-side convenience
 * filter only, NOT a security boundary.
 *
 * Returns false when: flag missing, fetch failed, or role_scope mismatch.
 */
export function useFlag(key: string, token?: string, userRole?: string): boolean {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (!token) return
    let alive = true
    _fetchFlags(token).then(flags => {
      if (!alive) return
      const flag = flags.find(f => f.key === key)
      if (!flag || !flag.enabled) { setEnabled(false); return }
      if (flag.role_scope && userRole !== flag.role_scope) { setEnabled(false); return }
      setEnabled(true)
    })
    return () => { alive = false }
  }, [key, token, userRole])

  return enabled
}
