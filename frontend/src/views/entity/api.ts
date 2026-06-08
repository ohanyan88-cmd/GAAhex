import { BASE } from '../../lib/config'
import { authH } from '../../lib/billing'
import type { ExportFormats } from './types'

// B25 — probe format availability: HEAD /{slug}/export?format=X; 404 → hide that button.
export async function probeEntityExportFormats(token: string, slug: string): Promise<ExportFormats> {
  async function probe(format: string): Promise<boolean> {
    try {
      const ctrl = new AbortController()
      const tid = setTimeout(() => ctrl.abort(), 3000)
      const r = await fetch(`${BASE}/api/${slug}/export?format=${format}`, {
        method: 'HEAD',
        headers: authH(token),
        signal: ctrl.signal,
      })
      clearTimeout(tid)
      return r.status !== 404
    } catch {
      return true  // network error / abort → assume available; real download will surface the error
    }
  }
  const [xlsx, pdf] = await Promise.all([probe('xlsx'), probe('pdf')])
  return { csv: true, xlsx, pdf }
}

// PATCH lives here (api.ts is out of this lane) — same shape as api.ts's helpers.
export async function patchRecord(token: string, slug: string, id: string, data: Record<string, unknown>) {
  const r = await fetch(`${BASE}/api/${slug}/${id}`, {
    method: 'PATCH',
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Error' }))
    const d = e.detail ?? 'Error'
    throw new Error(typeof d === 'string' ? d : JSON.stringify(d))
  }
  return r.json()
}
