// capabilities.ts — Fetches GET /api/me/capabilities (E21) once after login.
// If the endpoint 404s (sibling lane not yet merged) we degrade gracefully:
// treat the user as full-access so there is no regression for today's behaviour.
//
// Shape returned by E21:
//   { entity_key: { view: bool, create: bool, edit: bool, delete: bool } }
// e.g. { "lead": { view: true, create: false, edit: false, delete: false } }
// can() is DEFAULT-DENY (standard §4): a missing entity key or verb is denied.
// FULL_ACCESS carries a '*' wildcard that allows everything (superadmin / the caps
// endpoint not yet live) so graceful degradation survives without opening keys.

import { BASE } from './config'

export type Verb = 'view' | 'create' | 'edit' | 'delete'

/** Per-entity capability flags. Missing = full-access. */
export type EntityCaps = {
  view?: boolean
  create?: boolean
  edit?: boolean
  delete?: boolean
}

/** Full capabilities map keyed by entity_key (e.g. "lead", "customer"). */
export type Capabilities = Record<string, EntityCaps>

/** Sentinel: no restrictions at all (endpoint not available or user is superadmin).
 *  Carries the '*' wildcard so the DEFAULT-DENY `can()` still allows everything. */
export const FULL_ACCESS: Capabilities = { '*': { view: true, create: true, edit: true, delete: true } }

/**
 * Fetch capabilities once after login.
 * Degrades gracefully on 404 (E21 not deployed yet) or any network error.
 */
export async function fetchCapabilities(token: string): Promise<Capabilities> {
  try {
    const r = await fetch(`${BASE}/api/me/capabilities`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    // 404 = E21 not live yet — full-access for no regression
    if (r.status === 404) return FULL_ACCESS
    if (!r.ok) return FULL_ACCESS
    const data = await r.json()
    if (!data || typeof data !== 'object') return FULL_ACCESS
    return data as Capabilities
  } catch {
    return FULL_ACCESS
  }
}

/**
 * Check whether the user can perform `verb` on `entityKey`. DEFAULT-DENY (standard §4):
 * an unknown entity or an ungranted verb returns FALSE — actions are hidden unless
 * explicitly allowed. The only allow-all path is the `'*'` wildcard carried by
 * FULL_ACCESS (superadmin / caps endpoint not yet live), preserving graceful
 * degradation without opening every individual key.
 */
export function can(caps: Capabilities, entityKey: string, verb: Verb): boolean {
  if (caps['*']?.[verb] === true) return true   // allow-all sentinel (FULL_ACCESS)
  const entity = caps[entityKey]
  if (!entity) return false                       // unknown entity → deny
  return entity[verb] === true                    // verb must be explicitly granted
}
