// capabilities.ts — Fetches GET /api/me/capabilities (E21) once after login.
// If the endpoint 404s (sibling lane not yet merged) we degrade gracefully:
// treat the user as full-access so there is no regression for today's behaviour.
//
// Shape returned by E21:
//   { entity_key: { view: bool, create: bool, edit: bool, delete: bool } }
// e.g. { "lead": { view: true, create: false, edit: false, delete: false } }
// A missing entity key also means full-access (default-open).

const BASE = 'http://127.0.0.1:8099'

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

/** Sentinel: no restrictions at all (endpoint not available or user is superadmin). */
export const FULL_ACCESS: Capabilities = {}

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
 * Check whether the user can perform `verb` on `entityKey`.
 * Full-access (FULL_ACCESS or missing key) always returns true.
 */
export function can(caps: Capabilities, entityKey: string, verb: Verb): boolean {
  const entity = caps[entityKey]
  if (!entity) return true           // no restriction defined → full-access
  const flag = entity[verb]
  if (flag === undefined) return true // verb not mentioned → full-access
  return flag
}
