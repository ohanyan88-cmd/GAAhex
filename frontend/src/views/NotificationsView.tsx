// NotificationsView — Workspace → Notifications (the bell's "View all" target).
// Full-page inbox over the same /notifications API the bell uses.
import { useEffect, useState } from 'react'
import { listNotifications, markRead, markAllRead, clearAll, type ServerNote } from '../lib/notifications'
import { PageShell } from '../page-shell'
import { Button } from '../primitives'
import { BellIcon, MuteIcon, TrashIcon } from '../components/icons'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../context/AuthContext'

function relTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso).getTime()
  const diff = Math.max(0, Date.now() - d)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotificationsView() {
  const { t } = useI18n()
  const { token } = useAuth()
  const [items, setItems] = useState<ServerNote[]>([])

  const load = () => { if (token) listNotifications(token).then(setItems).catch(() => {}) }
  useEffect(() => { load() }, [token])

  const unread = items.filter((n) => !n.read_at).length

  async function onItem(n: ServerNote) {
    if (token && !n.read_at) { await markRead(token, n.id); load() }
  }
  async function onMarkAll() { if (token) { await markAllRead(token); load() } }
  async function onClear() { if (token) { await clearAll(token, items.map((n) => n.id)); load() } }

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Workspace', 'Notifications']}
      icon={<BellIcon size={18} />}
      title={t('notifications.title', 'Notifications')}
      subtitle={t('notifications.subtitle', 'Your inbox')}
    >
      <div className="card np-card">
        <div className="np-head">
          <span className="np-count">
            {unread > 0 ? `${unread} ${t('notifications.unread', 'unread')}` : t('notifications.allRead', 'All caught up')}
          </span>
          <span className="spacer" />
          <Button variant="ghost" size="sm" onClick={onMarkAll} disabled={unread === 0}>
            {t('notifications.markAll', 'Mark all read')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClear} disabled={items.length === 0}>
            <TrashIcon size={13} /> {t('notifications.clearAll', 'Clear all')}
          </Button>
        </div>

        {items.length === 0 ? (
          <div className="np-empty">
            <MuteIcon size={22} />
            <span>{t('notifications.empty', 'You’re all caught up')}</span>
          </div>
        ) : (
          <div className="np-list">
            {items.map((n) => (
              <button key={n.id} type="button" className={'np-row' + (n.read_at ? '' : ' unread')} onClick={() => onItem(n)}>
                <span className="np-ic"><BellIcon size={16} /></span>
                <span className="np-main">
                  <span className="np-title">{n.title}</span>
                  {n.body && <span className="np-body">{n.body}</span>}
                  <span className="np-time">{relTime(n.created_at)}</span>
                </span>
                {!n.read_at && <span className="np-dot" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  )
}
