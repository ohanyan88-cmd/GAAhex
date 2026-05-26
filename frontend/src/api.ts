const BASE = 'http://127.0.0.1:8099'

const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

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
