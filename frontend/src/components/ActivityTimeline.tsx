import { useEffect, useMemo, useState } from 'react'
import { timeAgo } from '../lib/time'
import {
  humanizeEntity, humanizeAction, indefinite,
  initials, avatarPalette, dayBucketKey, dayBucketLabel,
} from '../lib/humanize'
import {
  PlusIcon, EditIcon, ArrowRightIcon, TrashIcon, MessageIcon,
  CheckIcon, CloseIcon, ClockIcon, WarningIcon, InfoIcon,
  UsersIcon, ActivityIcon,
} from './icons'
import { EmptyState, PermissionDenied, ErrorBanner } from './States'

import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

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

// The badge "kind" determines the colored ring around the action-type icon.
type BadgeKind = 'default' | 'success' | 'warning' | 'danger' | 'info'

function actionIconFor(type: string) {
  switch (type) {
    case 'create': return PlusIcon
    case 'update': return EditIcon
    case 'transition':
    case 'status_change': return ArrowRightIcon
    case 'delete': return TrashIcon
    case 'comment': return MessageIcon
    case 'approval_requested': return ClockIcon
    case 'approval_approved': return CheckIcon
    case 'approval_rejected': return CloseIcon
    case 'action_failed': return WarningIcon
    case 'assign':
    case 'assigned':
    case 'unassign': return UsersIcon
    default: return InfoIcon
  }
}

function badgeKindFor(type: string): BadgeKind {
  if (type === 'delete' || type === 'action_failed' || type === 'approval_rejected') return 'danger'
  if (type === 'approval_approved' || type === 'create') return 'success'
  if (type === 'approval_requested') return 'warning'
  if (type === 'transition' || type === 'status_change' || type === 'update') return 'info'
  return 'default'
}

/**
 * Build the "sentence" displayed in a row. Examples:
 *   "Demo Admin created a Work Order"
 *   "Demo Admin changed status of an Invoice"
 *   "Demo Admin commented on a Ticket"
 *
 * If the row is rendered INSIDE a single record's drawer, we already know what
 * record we're looking at, so we drop the entity from the sentence (the kit's
 * per-record timeline lives in the drawer; ActivityFeedView is the global one).
 */
function buildSentence(item: Item, inRecordContext: boolean): string {
  const verb = humanizeAction(item.type)
  if (inRecordContext) return verb
  const entity = humanizeEntity(item.entity_key)
  if (!entity) return verb
  return `${verb} ${indefinite(entity)} ${entity}`
}

/** Short record reference chip, if a record id is present. */
function recordRef(item: Item): string | null {
  if (!item.record_id) return null
  // Show first 8 chars — long enough to disambiguate, short enough to read.
  // If the audit `data` carries a friendlier ref (e.g. `code`, `number`), prefer it.
  const friendly =
    item.data?.code ||
    item.data?.number ||
    item.data?.ref ||
    item.data?.subject ||
    item.data?.title ||
    null
  if (friendly && typeof friendly === 'string') return friendly
  return item.record_id.slice(0, 8)
}

export type ActivityNavTarget =
  | { type: 'helpdesk'; openTicketId: string }
  | { type: 'entity'; slug: string; recordId: string }

function navTargetFor(item: Item): ActivityNavTarget | null {
  if (!item.entity_key || !item.record_id) return null
  if (item.entity_key === 'helpdesk_ticket') {
    return { type: 'helpdesk', openTicketId: item.record_id }
  }
  // Generic entities: the App router resolves slug → EntityView; this is the
  // same pattern DashboardView uses to route activity rows.
  return { type: 'entity', slug: item.entity_key, recordId: item.record_id }
}

// ActivityTimeline — vertical timeline over GET /api/activity. With entity+record → that
// record's timeline (kit's per-record drawer); with neither → the global recent feed
// shown on the Activity Feed page.
export default function ActivityTimeline({ token, entity, record, onNavigate }: {
  token: string
  entity?: string
  record?: string
  /** Called when a row is clicked AND the row has a navigable target. */
  onNavigate?: (target: ActivityNavTarget) => void
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

  // Drawer (per-record) context — keep the kit's simpler look. The global feed
  // (no entity/record) gets the full redesigned treatment.
  const inRecordContext = Boolean(entity || record)

  // Group items by day-bucket key. Items are returned newest-first by the
  // backend; we preserve that order within each group.
  const grouped = useMemo(() => {
    if (!items) return []
    const buckets = new Map<string, { label: string; items: Item[] }>()
    for (const it of items) {
      const k = dayBucketKey(it.at)
      let bucket = buckets.get(k)
      if (!bucket) {
        bucket = { label: dayBucketLabel(it.at), items: [] }
        buckets.set(k, bucket)
      }
      bucket.items.push(it)
    }
    // Sort keys descending (newest first). Day-key is yyyy-mm-dd so string sort works.
    return Array.from(buckets.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, value]) => ({ key, ...value }))
  }, [items])

  if (denied) return <PermissionDenied />
  if (error) return <ErrorBanner message={error} onRetry={load} />
  if (items === null) return <ActivitySkeleton />
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<ActivityIcon size={40} />}
        title="No activity yet"
        message="Actions on records will appear here."
      />
    )
  }

  // --- per-record (drawer) context: keep the simpler kit timeline ---
  if (inRecordContext) {
    return (
      <ul className="timeline">
        {items.map((it) => {
          const Icon = actionIconFor(it.type)
          const kind = badgeKindFor(it.type)
          return (
            <li key={it.id} className="tl-item">
              <span className={`tl-dot ev-${kind}`}><Icon size={14} /></span>
              <div className="tl-body">
                <div className="tl-text">
                  <strong>{it.actor_name || 'System'}</strong>{' '}
                  <span>{buildSentence(it, true)}</span>
                </div>
                <div className="tl-time">{timeAgo(it.at)}</div>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  // --- global feed: redesigned per-row, day-grouped ---
  return (
    <div className="act-feed" role="feed" aria-label="Activity feed">
      {grouped.map((group) => (
        <section key={group.key} className="act-group" aria-label={group.label}>
          <header className="act-day-head">
            <span>{group.label}</span>
            <span className="act-day-count">{group.items.length}</span>
          </header>
          <ul className="act-list">
            {group.items.map((it) => {
              const Icon = actionIconFor(it.type)
              const kind = badgeKindFor(it.type)
              const actorSeed = it.actor_user_id || it.actor_name || it.actor_user_id || 'system'
              const palette = avatarPalette(actorSeed)
              const ref = recordRef(it)
              const target = navTargetFor(it)
              const clickable = !!target && !!onNavigate
              const onClick = clickable ? () => onNavigate!(target!) : undefined

              return (
                <li
                  key={it.id}
                  className={'act-row' + (clickable ? ' is-clickable' : '')}
                  onClick={onClick}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onKeyDown={clickable ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!() }
                  } : undefined}
                  aria-label={clickable ? `Open ${humanizeEntity(it.entity_key)} ${ref ?? ''}`.trim() : undefined}
                >
                  <div className={`act-avatar p${palette}`} aria-hidden="true">
                    <span className="act-avatar-init">{initials(it.actor_name)}</span>
                    <span className={`act-badge ev-${kind}`} aria-hidden="true">
                      <Icon size={10} />
                    </span>
                  </div>
                  <div className="act-body">
                    <div className="act-text">
                      <span className="act-actor">{it.actor_name || 'System'}</span>{' '}
                      <span className="act-verb">{buildSentence(it, false)}</span>
                      {ref && (
                        <>
                          {' '}
                          <span className="act-ref mono">{ref}</span>
                        </>
                      )}
                    </div>
                    <div className="act-meta">
                      <span className="act-time">{timeAgo(it.at)}</span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ActivitySkeleton() {
  return (
    <div className="act-feed" aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="act-row act-row-skel">
          <div className="act-avatar act-avatar-skel skel" />
          <div className="act-body" style={{ gap: 'var(--gx-space-3)' }}>
            <div className="skel skel-row" />
            <div className="skel skel-row" style={{ width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}
