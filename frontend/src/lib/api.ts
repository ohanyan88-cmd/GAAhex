import { BASE } from './config'
import { authH } from './billing'  // AC-1 — canonical Bearer-header factory

export async function login(email: string, password: string): Promise<string> {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) throw new Error('Invalid credentials')
  return (await r.json()).access_token as string
}

export async function me(token: string) {
  const r = await fetch(`${BASE}/auth/me`, { headers: authH(token) })
  if (!r.ok) throw new Error('Auth failed')
  return r.json()
}

export async function orgTree() {
  const r = await fetch(`${BASE}/org-tree`)
  if (!r.ok) throw new Error('Failed to load org tree')
  return r.json()
}

// ── Org structure WRITE endpoints (gated on config.manage). Shape mirrors backend/app/routers/
// org_nodes.py: create POST /api/org/nodes {type,name,code?,parent_id?}; update PATCH
// /api/org/nodes/{id} {name?,code?,parent_id?} (parent_id present ⇒ move; null/"" ⇒ root);
// delete DELETE /api/org/nodes/{id} → {ok,id}, or 409 with a detail message if the node has children.
export type OrgNodeOut = {
  id: string
  type: string
  name: string
  code: string | null
  path: string
  parent_id: string | null
}

// A write error that carries the HTTP status so callers can branch on it (e.g. delete 409 = has children).
export class OrgWriteError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'OrgWriteError'
    this.status = status
  }
}

async function orgWrite(token: string, path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  const r = await fetch(`${BASE}/api/org/${path}`, {
    method,
    headers: { ...authH(token), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Error' }))
    throw new OrgWriteError(r.status, e.detail || 'Error')
  }
  return r.json()
}

export async function createOrgNode(
  token: string,
  data: { type: string; name: string; code?: string; parent_id?: string | null },
): Promise<OrgNodeOut> {
  return orgWrite(token, 'nodes', 'POST', data)
}

export async function renameOrgNode(token: string, id: string, name: string): Promise<OrgNodeOut> {
  return orgWrite(token, `nodes/${id}`, 'PATCH', { name })
}

export async function moveOrgNode(token: string, id: string, parent_id: string | null): Promise<OrgNodeOut> {
  return orgWrite(token, `nodes/${id}`, 'PATCH', { parent_id })
}

export async function deleteOrgNode(token: string, id: string): Promise<{ ok: boolean; id: string }> {
  return orgWrite(token, `nodes/${id}`, 'DELETE')
}

export async function getEntities(token: string) {
  const r = await fetch(`${BASE}/meta/entities`, { headers: authH(token) })
  if (!r.ok) throw new Error('Failed to load entities')
  return r.json()
}

export async function getEntityDef(token: string, slug: string) {
  const r = await fetch(`${BASE}/meta/entities/${slug}`, { headers: authH(token) })
  if (!r.ok) throw new Error('Failed to load entity definition')
  return r.json()
}

export async function listRecords(token: string, slug: string) {
  const r = await fetch(`${BASE}/api/${slug}`, { headers: authH(token) })
  if (!r.ok) throw new Error('Failed to load records')
  return r.json()
}

/** Paginated list fetch — returns both rows and the X-Total-Count header (null when absent). */
export async function listRecordsPaged(
  token: string,
  slug: string,
  params: URLSearchParams,
): Promise<{ rows: Record<string, unknown>[]; total: number | null; status: number; response: Response }> {
  const qs = params.toString()
  const r = await fetch(`${BASE}/api/${slug}${qs ? `?${qs}` : ''}`, { headers: authH(token) })
  const totalRaw = r.headers.get('X-Total-Count')
  const total = totalRaw !== null ? parseInt(totalRaw, 10) : null
  const rows = r.ok ? await r.json() : []
  return { rows, total, status: r.status, response: r }
}

export async function healthCheck(): Promise<'ok' | 'error'> {
  try {
    const r = await fetch(`${BASE}/api/health`)
    return r.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

export async function createRecord(token: string, slug: string, data: Record<string, unknown>) {
  const r = await fetch(`${BASE}/api/${slug}`, {
    method: 'POST',
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Error' }))
    throw new Error(e.detail || 'Error')
  }
  return r.json()
}

export async function createEntity(token: string, def: Record<string, unknown>) {
  const r = await fetch(`${BASE}/meta/entities`, {
    method: 'POST',
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(def),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Error' }))
    throw new Error(e.detail || 'Error')
  }
  return r.json()
}

export async function transitionRecord(token: string, slug: string, id: string, to: string) {
  const r = await fetch(`${BASE}/api/${slug}/${id}/transition`, {
    method: 'POST',
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ to }),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Error' }))
    throw new Error(e.detail || 'Error')
  }
  return r.json()
}

// ── B27 — cross-entity search (A27) + saved/recent/suggest (E27) ─────────────

/** A facet bucket (count for a given entity key or status value). */
export type SearchFacet = { key: string; label: string; count: number }

/** Facets returned alongside search results. */
export type SearchFacets = {
  entity?: SearchFacet[]
  status?: SearchFacet[]
}

/** A single highlighted fragment: start/end character offsets + whether it is a match. */
export type HighlightSpan = { start: number; end: number; highlight: boolean }

/** One result hit from /api/search. */
export type SearchHit = {
  id: string
  label: string
  snippet: string
  status: string | null
  /** Optional character-offset highlight map for snippet (A27 richer response). */
  highlight_spans?: HighlightSpan[]
}

/** One result group from /api/search (grouped by entity). */
export type SearchGroup = {
  entity_key: string
  label_plural: string
  route_slug: string
  matches: SearchHit[]
}

/** Full /api/search response (A27). */
export type SearchResponse = {
  groups?: SearchGroup[]
  facets?: SearchFacets
} | SearchGroup[]  // older array-only format for backward compat

/** GET /api/search — degrades to [] on 404.
 *  A27 returns facets only on the opt-in envelope (?view=hits), as a FLAT hit list with facet
 *  COUNT MAPS and a `<mark>`-wrapped `highlight` string. The palette renders GROUPS with a `snippet`
 *  the safe <mark> parser reads, and facet BUCKET ARRAYS — so this adapter translates all three. */
export async function crossSearch(
  token: string,
  q: string,
  entity?: string,
  status?: string,
): Promise<{ groups: SearchGroup[]; facets: SearchFacets | null }> {
  const params = new URLSearchParams({ q, view: 'hits', facets: 'true' })
  if (entity) params.set('entity', entity)
  if (status) params.set('status', status)
  const r = await fetch(`${BASE}/api/search?${params}`, { headers: authH(token) })
  if (!r.ok) return { groups: [], facets: null }
  const data = await r.json()
  // Old array-only format: already grouped, no facets.
  if (Array.isArray(data)) return { groups: data as SearchGroup[], facets: null }
  const obj = data as {
    groups?: SearchGroup[]
    hits?: Array<Record<string, unknown>>
    facets?: { entity?: unknown; status?: unknown }
  }
  // Group the flat hit list by entity_key into the palette's grouped shape.
  let groups: SearchGroup[]
  if (obj.groups) {
    groups = obj.groups
  } else {
    const byEntity = new Map<string, SearchGroup>()
    for (const h of obj.hits ?? []) {
      const ek = String(h.entity_key)
      let g = byEntity.get(ek)
      if (!g) {
        g = {
          entity_key: ek,
          label_plural: typeof h.label_plural === 'string' ? h.label_plural : ek,
          route_slug: typeof h.route_slug === 'string' ? h.route_slug : ek,
          matches: [],
        }
        byEntity.set(ek, g)
      }
      // Feed A27's <mark>-wrapped (HTML-escaped) `highlight` string in as the snippet so the
      // palette's safe <mark> parser highlights it; fall back to the plain snippet.
      g.matches.push({
        id: String(h.id),
        label: String(h.label ?? ''),
        snippet: typeof h.highlight === 'string' ? h.highlight : String(h.snippet ?? ''),
        status: (h.status as string | null) ?? null,
        highlight_spans: h.highlight_spans as HighlightSpan[] | undefined,
      })
    }
    groups = Array.from(byEntity.values())
  }
  // Normalize facets: A27 returns {entity:{key:count}}; the UI wants bucket arrays.
  const toBuckets = (m: unknown): SearchFacet[] | undefined => {
    if (!m) return undefined
    if (Array.isArray(m)) return m as SearchFacet[]
    return Object.entries(m as Record<string, number>).map(([key, count]) => ({ key, label: key, count }))
  }
  const rf = obj.facets
  const facets: SearchFacets | null = rf
    ? { entity: toBuckets(rf.entity), status: toBuckets(rf.status) }
    : null
  return { groups, facets }
}

/** GET /api/search/suggest?q= — degrades to [] on 404. */
export async function searchSuggest(token: string, q: string): Promise<string[]> {
  const r = await fetch(`${BASE}/api/search/suggest?q=${encodeURIComponent(q)}`, { headers: authH(token) })
  if (!r.ok) return []
  const data = await r.json()
  return Array.isArray(data) ? data : (data.suggestions ?? [])
}

export type SavedSearch = { id: string; name: string; query: string; pinned?: boolean }
export type RecentSearch = { id?: string; query: string; ran_at?: string }

/** GET /api/saved-searches — degrades gracefully on 404 (returns null = feature unavailable). */
export async function getSavedSearches(token: string): Promise<SavedSearch[] | null> {
  const r = await fetch(`${BASE}/api/saved-searches`, { headers: authH(token) })
  if (r.status === 404) return null
  if (!r.ok) return []
  const data = await r.json()
  return Array.isArray(data) ? data : (data.items ?? [])
}

/** POST /api/saved-searches — save a query. Returns null on 404 (unavailable). */
export async function saveSearch(token: string, name: string, query: string): Promise<SavedSearch | null> {
  const r = await fetch(`${BASE}/api/saved-searches`, {
    method: 'POST',
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, query }),
  })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('save-search-error')
  return r.json()
}

/** GET /api/recent-searches — degrades gracefully on 404 (returns null = feature unavailable). */
export async function getRecentSearches(token: string): Promise<RecentSearch[] | null> {
  const r = await fetch(`${BASE}/api/recent-searches`, { headers: authH(token) })
  if (r.status === 404) return null
  if (!r.ok) return []
  const data = await r.json()
  return Array.isArray(data) ? data : (data.items ?? [])
}

// ── B28 — outbound compose (A28 POST /api/outbound/compose) ──────────────────

/** POST /api/outbound/compose — compose and send a new outbound message. Never throws. */
export async function composeOutbound(
  token: string,
  payload: { channel: string; to: string; subject?: string; body: string },
): Promise<{ ok: boolean; status?: string; error?: string }> {
  try {
    const r = await fetch(`${BASE}/api/outbound/compose`, {
      method: 'POST',
      headers: { ...authH(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (r.status === 201) {
      const data = await r.json()
      return { ok: true, status: data.status }
    }
    const errBody = await r.json().catch(() => ({ detail: 'Unknown error' }))
    return { ok: false, error: errBody.detail ?? 'Unknown error' }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
