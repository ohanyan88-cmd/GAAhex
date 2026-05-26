import { useEffect, useState } from 'react'
import { BellIcon } from './icons'

// Notification center — a header bell + dropdown. Self-contained: inlines its own fetch calls
// (same base + Authorization pattern as api.ts) and consumes the /notifications API.
const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Note = {
  id: string
  def_key: string
  title: string
  body: string
  entity_key: string | null
  record_id: string | null
  read_at: string | null
  created_at: string | null
}
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
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<Note[]>([])
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function refreshCount() {
    try {
      const d = await jget(token, '/notifications/unread-count')
      setCount(d.count ?? 0)
    } catch { /* keep the last badge value if the poll blips */ }
  }

  async function loadList() {
    setLoading(true); setError('')
    try {
      const d = await jget(token, '/notifications' + (unreadOnly ? '?unread=true' : ''))
      setItems(Array.isArray(d) ? d : [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // poll the unread badge every 30s
  useEffect(() => {
    refreshCount()
    const id = setInterval(refreshCount, 30000)
    return () => clearInterval(id)
  }, [token])

  // (re)load the list whenever the panel opens or the filter flips
  useEffect(() => {
    if (open) loadList()
  }, [open, unreadOnly])

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
            <div className="notif-head">
              <strong>Notifications</strong>
              <label className="notif-toggle">
                <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
                unread only
              </label>
              <button className="btn btn-ghost btn-sm" onClick={markAll}>Mark all read</button>
            </div>
            <div className="notif-list">
              {loading && <p className="muted notif-empty">Loading…</p>}
              {error && <p className="err notif-empty">{error}</p>}
              {!loading && !error && items.length === 0 && (
                <p className="muted notif-empty">{unreadOnly ? 'No unread notifications.' : 'Nothing here yet.'}</p>
              )}
              {!loading && !error && items.map((n) => (
                <button
                  key={n.id}
                  className={'notif-item' + (n.read_at ? '' : ' unread')}
                  onClick={() => clickNote(n)}
                >
                  <div className="notif-item-title">
                    {!n.read_at && <span className="notif-dot" aria-hidden />}
                    {n.title}
                  </div>
                  {n.body && <div className="notif-item-body">{n.body}</div>}
                  <div className="notif-item-time">
                    {fmt(n.created_at)}{n.entity_key ? ` · ${n.entity_key}` : ''}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
