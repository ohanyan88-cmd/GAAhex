import { useEffect, useState } from 'react'
import { WarningIcon } from './icons'

// RefPicker — resolves a `ref` field to a dropdown of the target entity's records.
// The backend stores a ref's target as the entity KEY in field.config.target (see seed.py /
// meta.py). We map that key → route_slug via /meta/entities, then load the target's records.

import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

type EntityMeta = { key: string; label: string; label_plural: string; route_slug: string; icon?: string }
type Row = Record<string, any>

// The actual config key is `target`; accept `entity`/`ref_entity` too, and fail soft if absent.
export function refTargetKey(config: any): string | null {
  if (!config) return null
  return config.target ?? config.entity ?? config.ref_entity ?? null
}

// A human label for a referenced record: prefer a name-ish field, else the id.
export function recordLabel(r: Row): string {
  return r?.name ?? r?.title ?? r?.subject ?? r?.label ?? String(r?.id ?? '')
}

// Resolve a target entity key/slug to its route slug via /meta/entities.
async function resolveSlug(token: string, targetKey: string): Promise<string | null> {
  const r = await fetch(`${BASE}/meta/entities`, { headers: authH(token) })
  if (!r.ok) throw new Error('Failed to load entities')
  const ents: EntityMeta[] = await r.json()
  const target = ents.find((e) => e.key === targetKey || e.route_slug === targetKey)
  return target ? target.route_slug : null
}

// Build an { id -> label } map for a target entity (used to display refs in the list).
export async function loadRefLabels(token: string, targetKey: string): Promise<Record<string, string>> {
  const slug = await resolveSlug(token, targetKey)
  if (!slug) return {}
  const r = await fetch(`${BASE}/api/${slug}`, { headers: authH(token) })
  if (!r.ok) return {}
  const rows: Row[] = await r.json()
  const map: Record<string, string> = {}
  rows.forEach((row) => { map[row.id] = recordLabel(row) })
  return map
}

export default function RefPicker({ token, targetKey, value, onChange }: {
  token: string
  targetKey: string | null
  value: any
  onChange: (v: any) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    async function load() {
      if (!targetKey) { setErr('no target entity configured'); return }
      setLoading(true); setErr('')
      try {
        const slug = await resolveSlug(token, targetKey)
        if (!slug) throw new Error(`unknown target '${targetKey}'`)
        const r = await fetch(`${BASE}/api/${slug}`, { headers: authH(token) })
        if (!r.ok) throw new Error('failed to load options')
        const data: Row[] = await r.json()
        if (alive) setRows(data)
      } catch (e) {
        if (alive) setErr((e as Error).message)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [token, targetKey])

  if (err) return <em className="muted"><WarningIcon size={13} /> {err}</em>

  return (
    <select className="inp inp-md" value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={loading}>
      <option value="">{loading ? 'Loading…' : '— none —'}</option>
      {rows.map((r) => <option key={r.id} value={r.id}>{recordLabel(r)}</option>)}
    </select>
  )
}
