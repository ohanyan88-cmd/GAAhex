// NotificationBell (P4) — replaces the old NotificationCenter. Wired to the real
// /notifications API (see lib/notifications.ts). Polls the unread count every 60s and
// refetches the list every time the popover opens. Same shape as the kit's NotificationBell
// in design-system/ui_kits/portal/Shell.jsx — no kit mock SEED, just live data.
import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, Trash2, ArrowRight, AlertTriangle, CheckCircle2, Server as ServerIcon, Receipt, Wand2, Info } from 'lucide-react'
import { toast } from './Toast'
import { listNotifications, getUnreadCount, markRead, markAllRead, type ServerNote } from '../lib/notifications'
import { Button } from '../primitives'  // T-P3-7

type EntityRef = { key: string; route_slug: string }

// Map server category → kit icon + tone (CSS var). Falls back to a neutral info icon.
// Keep this table small and stable; new categories show the fallback until added here.
function decorate(n: ServerNote): { Icon: typeof Bell; tone: string } {
  const cat = (n.category || '').toLowerCase()
  const pri = (n.priority || '').toLowerCase()
  if (pri === 'urgent' || pri === 'high') return { Icon: AlertTriangle, tone: 'var(--gx-danger)' }
  if (cat === 'system') return { Icon: ServerIcon, tone: 'var(--gx-info)' }
  if (cat === 'billing') return { Icon: Receipt, tone: 'var(--gx-gold)' }
  if (cat === 'network') return { Icon: ServerIcon, tone: 'var(--gx-info)' }
  if (cat === 'customer') return { Icon: CheckCircle2, tone: 'var(--gx-success)' }
  if (cat === 'internal') return { Icon: Wand2, tone: 'var(--gx-text-2)' }
  return { Icon: Info, tone: 'var(--gx-text-2)' }
}

// "5m ago" / "2h ago" / "Yesterday" / a real date once it's older than a week.
function relTime(iso: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const now = Date.now()
  const sec = Math.max(0, Math.floor((now - t) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day === 1) return 'Yesterday'
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function NotificationBell({
  token,
  entities = [],
  onOpen: onOpenEntity,
  onViewAll,
}: {
  token: string
  entities?: EntityRef[]
  onOpen?: (slug: string) => void
  onViewAll?: () => void
}) {
  const [items, setItems] = useState<ServerNote[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Poll the unread badge every 60s; reload the list every time the popover opens.
  async function refreshCount() {
    try { setUnread(await getUnreadCount(token)) } catch { /* keep last */ }
  }
  async function reloadList() {
    try { setItems(await listNotifications(token)) } catch { /* keep last */ }
  }

  useEffect(() => {
    refreshCount()
    const id = setInterval(refreshCount, 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    if (open) reloadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Outside-click + Escape close — kit pattern.
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleMarkAll() {
    try {
      await markAllRead(token)
      setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })))
      setUnread(0)
    } catch (err) {
      toast.error(`Could not mark all read: ${(err as Error).message}`)
    }
  }

  function handleClearAll() {
    // Clears the popover view only — does NOT delete. The notifications stay in the DB
    // and remain on the full Notifications page ("View all").
    if (items.length === 0) return
    setItems([])
  }

  async function handleItemClick(n: ServerNote) {
    // Mark read first (cheap & idempotent), then navigate if the note points at an entity record.
    if (!n.read_at) {
      try { await markRead(token, n.id) } catch { /* navigate anyway */ }
      setItems((prev) => prev.map((it) => (it.id === n.id ? { ...it, read_at: new Date().toISOString() } : it)))
      setUnread((u) => Math.max(0, u - 1))
    }
    if (n.entity_key && onOpenEntity) {
      const ent = entities.find((e) => e.key === n.entity_key)
      if (ent) {
        onOpenEntity(ent.route_slug)
        setOpen(false)
      }
    }
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        className={'tb-icon' + (open ? ' on' : '')}
        aria-label="Notifications"
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={18} />
        {unread > 0 && <span className="ndot" />}
      </button>

      {open && (
        <div className="menu fade-fast notif-pop" onClick={(e) => e.stopPropagation()}>
          <div className="notif-head">Notifications</div>

          <div className="notif-list">
            {items.length === 0 && (
              <div className="stub" style={{ padding: '36px var(--gx-space-20)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--gx-space-5)' }}>
                <div className="si" style={{ width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gx-text-3)' }}>
                  <BellOff size={20} />
                </div>
                <div style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)' }}>You&rsquo;re all caught up</div>
              </div>
            )}
            {items.map((n) => {
              const { Icon } = decorate(n)
              const isUnread = !n.read_at
              return (
                <button
                  key={n.id}
                  className={'notif-item' + (isUnread ? ' unread' : '')}
                  onClick={() => handleItemClick(n)}
                >
                  <span className="notif-ic"><Icon size={16} /></span>
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)' }}>
                      <span style={{ fontSize: 'var(--gx-text-sm)', fontWeight: 'var(--gx-weight-semibold)' }}>{n.title}</span>
                      {isUnread && <span style={{ width: 'var(--gx-space-3)', height: 'var(--gx-space-3)', borderRadius: '50%', background: 'var(--gx-primary)', marginLeft: 'auto', flexShrink: 0 }} />}
                    </span>
                    {n.body && (
                      <span style={{ display: 'block', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-2)', marginTop: 'var(--gx-space-1)', lineHeight: 1.4 }}>
                        {n.body}
                      </span>
                    )}
                    <span style={{ display: 'block', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', marginTop: 3 }}>
                      {relTime(n.created_at)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {items.length > 0 && (
            <div className="notif-foot">
              <Button variant="ghost" size="sm" onClick={handleClearAll} style={{ color: 'var(--gx-text-3)' }}>
                <Trash2 size={13} />Clear all
              </Button>
              <span className="spacer" />
              <Button variant="ghost" size="sm" onClick={() => { setOpen(false); onViewAll?.() }}>
                View all<ArrowRight size={13} />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
