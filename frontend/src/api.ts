const BASE = 'http://127.0.0.1:8099'

export async function login(email: string, password: string): Promise<string> {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) throw new Error('Invalid credentials')
  const data = await r.json()
  return data.access_token as string
}

export async function me(token: string) {
  const r = await fetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) throw new Error('Auth failed')
  return r.json()
}

export async function orgTree() {
  const r = await fetch(`${BASE}/api/org-tree`)
  if (!r.ok) throw new Error('Failed to load org tree')
  return r.json()
}
