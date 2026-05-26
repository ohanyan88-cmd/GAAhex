import { useEffect, useState } from 'react'
import { timeAgo } from './time'
import {
  PlusIcon, EditIcon, ArrowRightIcon, TrashIcon, MessageIcon,
  CheckIcon, CloseIcon, ClockIcon, WarningIcon, InfoIcon,
} from './icons'
import { EmptyState, PermissionDenied, ErrorBanner } from './States'

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Item = {
  id: string
  type: string
  entity_key: string | null
  record_id: string | null
  actor_user_id: string | null
  actor_name: string | null
  at: string | null
  summary: string
  data: any
}

function iconFor(type: string) {
  switch (type) {
    case 'create': return PlusIcon
    case 'update': return EditIcon
    case 'transition': return ArrowRightIcon
    case 'delete': return TrashIcon
    case 'comment': return MessageIcon
    case 'approval_requested': return ClockIcon
    case 'approval_approved': return CheckIcon
    case 'approval_rejected': return CloseIcon
    case 'action_failed': return WarningIcon
    default: return InfoIcon
  }
}

function kindClass(type: string) {
  if (type === 'delete' || type === 'action_failed' || type === 'approval_rejected') return 'ev-danger'
  if (type === 'approval_approved' || type === 'create') return 'ev-success'
  if (type === 'approval_requested') return 'ev-warning'
  return 'ev-default'
}

// ActivityTimeline — vertical timeline over GET /api/activity. With entity+record → that record's
// timeline; with neither → the global recent feed. Reused on a record (modal) and the Activity view.
export default function ActivityTimeline({ token, entity, record }: {
  token: string
  entity?: string
  record?: string
}) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  async function load() {
    setError(''); setDenied(false); setItems(null)
    try {
      const p = new URLSearchParams()
      if (entity) p.set('entity', entity)
      if (record) p.set('record', record)
      const qs = p.toString()
      const r = await fetch(`${BASE}/api/activity${qs ? `?${qs}` : ''}`, { headers: authH(token) })
      if (r.status === 403) { setDenied(true); return }
      if (!r.ok) throw new Error('Failed to load activity')
      setItems(await r.json())
    } catch (e) {
      setError((e as Error).message)
      setItems([])
    }
  }

  useEffect(() => { load() }, [token, entity, record])

  if (denied) return <PermissionDenied />
  if (error) return <ErrorBanner message={error} onRetry={load} />
  if (items === null) return <p className="muted">Loading…</p>
  if (items.length === 0) {
    return <EmptyState icon={<ClockIcon size={40} />} title="No activity yet" message="Actions on records will appear here." />
  }

  return (
    <ul className="timeline">
      {items.map((it) => {
        const Icon = iconFor(it.type)
        return (
          <li key={it.id} className="tl-item">
            <span className={'tl-dot ' + kindClass(it.type)}><Icon size={14} /></span>
            <div className="tl-body">
              <div className="tl-text">
                <strong>{it.actor_name || 'System'}</strong> {it.summary}
                {!record && it.entity_key && <span className="tl-ent"> · {it.entity_key}</span>}
              </div>
              <div className="tl-time">{timeAgo(it.at)}</div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
