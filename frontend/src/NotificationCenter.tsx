import { useEffect, useState } from 'react'
import { BellIcon, GearIcon } from './icons'

// Notification center — a header bell + dropdown. Self-contained: inlines its own fetch calls
// (same base + Authorization pattern as api.ts) and consumes the /notifications API: inbox (with
// category/priority filters), preferences (opt-out toggles), read/read-all.
const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

// The known preference categories (the backend stores category on each NotificationDef; this is
// the curated set the prefs UI exposes). Degrades quietly if /preferences isn't available.
const CATEGORIES = ['system', 'billing', 'network', 'customer', 'internal']
const PRIORITIES = ['low', 'normal', 'high', 'urgent']

type Note = {
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
type Pref = { id: string; category: string; channel: string; enabled: boolean }
type EntityRef = { key: string; route_slug: string }

async function jget(token: string, path: string) {
  const r = await fetch(`${BASE}${path}`, { headers: authH(token) })
  if (!r.ok) throw new Error(`Failed to load ${path}`)
  return r.json()
}
async function jpost(token: string, path: string) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: authH(token) })
  if (!r.ok) throw new Error(`Action failed (${path})`)
  return r.json()
}

function fmt(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString()
}

export default function NotificationCenter({ token, entities, onOpen }: {
  token: string
  entities: EntityRef[]
  onOpen: (slug: string, recordId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'list' | 'prefs'>('list')
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<Note[]>([])
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [fcat, setFcat] = useState('')
  const [fpri, setFpri] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [prefs, setPrefs] = useState<Pref[]>([])
  const [prefsAvailable, setPrefsAvailable] = useState(true)

  async function refreshCount() {
    try {
      const d = await jget(token, '/notifications/unread-count')
      setCount(d.count ?? 0)
    } catch { /* keep the last badge value if the poll blips */ }
  }

  async function loadList() {
    setLoading(true); setError('')
    try {
      const p = new URLSearchParams()
      if (unreadOnly) p.set('unread', 'true')
      if (fcat) p.set('category', fcat)
      if (fpri) p.set('priority', fpri)
      const qs = p.toString()
      const d = await jget(token, '/notifications' + (qs ? `?${qs}` : ''))
      setItems(Array.isArray(d) ? d : [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function loadPrefs() {
    try {
      const d = await jget(token, '/notifications/preferences')
      setPrefs(Array.isArray(d) ? d : [])
      setPrefsAvailable(true)
    } catch {
      setPrefsAvailable(false)
    }
  }

  // poll the unread badge every 30s
  useEffect(() => {
    refreshCount()
    const id = setInterval(refreshCount, 30000)
    return () => clearInterval(id)
  }, [token])

  // (re)load the list when the panel opens / filters change; probe prefs availability on open
  useEffect(() => {
    if (open) { loadList(); loadPrefs() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unreadOnly, fcat, fpri])

  function prefEnabled(cat: string): boolean {
    const row = prefs.find((p) => p.category === cat && p.channel === 'inapp')
    return row ? row.enabled : true     // default-on
  }

  async function togglePref(cat: string, enabled: boolean) {
    try {
      const r = await fetch(`${BASE}/notifications/preferences`, {
        method: 'PUT',
        headers: { ...authH(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: [{ category: cat, channel: 'inapp', enabled }] }),
      })
      if (!r.ok) throw new Error('Could not save preference')
      setPrefs(await r.json())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function clickNote(n: Note) {
    try {
      if (!n.read_at) await jpost(token, `/notifications/${n.id}/read`)
    } catch { /* navigate anyway */ }
    await refreshCount()
    if (open) await loadList()
    if (n.entity_key) {
      const ent = entities.find((e) => e.key === n.entity_key)
      if (ent) { onOpen(ent.route_slug, n.record_id); setOpen(false) }
    }
  }

  async function markAll() {
    setError('')
    try {
      await jpost(token, '/notifications/read-all')
      await refreshCount()
      await loadList()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="notif">
      <button className="iconbtn" onClick={() => setOpen((o) => !o)} aria-label="Notifications" title="Notifications">
        <BellIcon size={20} />
        {count > 0 && <span className="notif-badge">{count > 99 ? '99+' : count}</span>}
      </button>

      {open && (
        <>
          <div className="notif-backdrop" onClick={() => setOpen(false)} />
          <div className="notif-pop">
            {mode === 'list' ? (
              <>
                <div className="notif-head">
                  <strong>Notifications</strong>
                  <button className="btn btn-ghost btn-sm" onClick={markAll}>Mark all read</button>
                  {prefsAvailable && (
                    <button className="iconbtn notif-gear" aria-label="Notification preferences" title="Preferences" onClick={() => setMode('prefs')}>
                      <GearIcon size={16} />
                    </button>
                  )}
                </div>

                <div className="notif-filters">
                  <label className="notif-toggle">
                    <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
                    unread
                  </label>
                  <select className="inp inp-sm" value={fcat} onChange={(e) => setFcat(e.target.value)} aria-label="Filter by category">
                    <option value="">All categories</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select className="inp inp-sm" value={fpri} onChange={(e) => setFpri(e.target.value)} aria-label="Filter by priority">
                    <option value="">Any priority</option>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                <div className="notif-list">
                  {loading && <p className="muted notif-empty">Loading…</p>}
                  {error && <p className="err notif-empty">{error}</p>}
                  {!loading && !error && items.length === 0 && (
                    <p className="muted notif-empty">{unreadOnly || fcat || fpri ? 'No matching notifications.' : 'Nothing here yet.'}</p>
                  )}
                  {!loading && !error && items.map((n) => (
                    <button key={n.id} className={'notif-item' + (n.read_at ? '' : ' unread')} onClick={() => clickNote(n)}>
                      <div className="notif-item-title">
                        {!n.read_at && <span className="notif-dot" aria-hidden />}
                        {n.title}
                      </div>
                      {n.body && <div className="notif-item-body">{n.body}</div>}
                      <div className="notif-item-meta">
                        {n.category && <span className="notif-cat">{n.category}</span>}
                        {n.priority && <span className={'notif-pri notif-pri-' + n.priority}>{n.priority}</span>}
                        <span className="notif-item-time">{fmt(n.created_at)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="notif-head">
                  <strong>Preferences</strong>
                  <button className="btn btn-ghost btn-sm" onClick={() => setMode('list')}>Back</button>
                </div>
                <div className="notif-prefs">
                  <p className="muted notif-prefs-hint">In-app notifications by category. Turn a category off to stop receiving it.</p>
                  {CATEGORIES.map((c) => (
                    <label key={c} className="pref-row">
                      <span className="pref-cat">{c}<span className="pref-chan">in-app</span></span>
                      <input type="checkbox" checked={prefEnabled(c)} onChange={(e) => togglePref(c, e.target.checked)} />
                    </label>
                  ))}
                  {error && <p className="err">{error}</p>}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
