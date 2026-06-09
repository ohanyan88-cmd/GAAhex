// NotificationsPane — coordinator for the Studio Notifications group.
//
// ONE shared component drives all five Notifications leaves (email / SMS / push / in-app
// templates + Notification Rules) — DRY by design, per Gev's directive. The behavior is
// parametrized by:
//   - channel  — filters the list and locks the channel on the create form
//                ('email' | 'sms' | 'push' | 'inapp')
//   - rulesView — list and create rules (templates with a gxl_condition)
//
// Wiring:
//   GET    /meta/notification-defs[?channel=...]    → list view
//   POST   /meta/notification-defs                  → create  (409 on duplicate key)
//   PATCH  /meta/notification-defs/{key}            → update
//   DELETE /meta/notification-defs/{key}            → hard delete
//   POST   /meta/notification-defs/{key}/preview    → render title+body with sample context
//   POST   /meta/notification-defs/{key}/test-send  → emit one notification to the caller
//
// Every write is gated server-side by `config.manage`. 403 → <PermissionDenied/>.
// No mock data anywhere. Tokens: --gx-* only, no raw hex.

import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../lib/i18n'
import { useFetch } from '../hooks/useFetch'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { Button } from '../primitives'
import { PlusIcon } from '../components/icons'

import { Props, NotifDef, CHANNEL_LABELS } from './notifications/types'
import { CreateDefModal } from './notifications/CreateDefModal'
import { DetailDrawer } from './notifications/DetailDrawer'
import { NotifDefTable } from './notifications/NotifDefTable'

export default function NotificationsPane({ channel, rulesView }: Props) {
  const { t } = useI18n()
  const { token } = useAuth()

  const [showCreate, setShowCreate] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const qs = channel ? `?channel=${encodeURIComponent(channel)}` : ''
  const { data: defsRaw, loading, status, error, refetch: load } = useFetch<NotifDef[]>(`/meta/notification-defs${qs}`)

  const denied = status === 403
  const defs = Array.isArray(defsRaw) ? defsRaw : []

  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message={t('notifications.permissionDenied', "You don't have permission to manage notifications.")} />
  if (error) return <ErrorBanner message={error} onRetry={load} />

  // Rules view: only show defs that have a non-empty gxl_condition.
  let view = defs
  if (rulesView) view = view.filter((d) => !!(d.gxl_condition && d.gxl_condition.trim()))

  const q = search.trim().toLowerCase()
  const filtered = q
    ? view.filter((d) =>
        d.key.toLowerCase().includes(q) ||
        d.label.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q),
      )
    : view

  const headingLabel = rulesView ? t('notifications.rulesHeading', 'Notification Rules') : (channel ? CHANNEL_LABELS[channel] : t('notifications.templatesHeading', 'Notification Templates'))
  const headingHint = rulesView
    ? t('notifications.rulesHint', 'Notification defs gated by a GXL condition — only emit when the rule passes.')
    : t('notifications.templatesHint', 'Templates for') + ' ' + (channel ?? t('notifications.allChannels', 'all channels')) + '. ' + t('notifications.templatesHintSuffix', 'Edit, preview with sample context, and test-send to your own inbox.')
  const createLabel = rulesView ? t('notifications.newRule', 'New rule') : t('notifications.newTemplate', 'New template')

  return (
    <div>
      <div className="row" style={{ marginBottom: 'var(--gx-space-5)', alignItems: 'flex-end' }}>
        <div>
          <h3 style={{ margin: '0 0 var(--gx-space-2)' }}>{headingLabel}</h3>
          <p className="hint" style={{ margin: 0 }}>{headingHint}</p>
        </div>
        <span className="spacer" />
        <Button variant="primary" size="md"
            type="button"
          onClick={() => setShowCreate(true)}
        >
          <PlusIcon size={13} /> {createLabel}
        </Button>
      </div>

      <div style={{ marginBottom: 'var(--gx-space-4)', maxWidth: 320 }}>
        <input
          className="inp inp-md"
          placeholder={t('notifications.filterPlaceholder', 'Filter by key, label, or category…')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={q ? t('notifications.emptyFilterTitle', 'No notification defs match the filter.') : (rulesView ? t('notifications.emptyRulesTitle', 'No rules yet.') : t('notifications.emptyTemplatesTitle', 'No templates yet.'))}
          message={
            q
              ? t('common.tryDifferentQuery', 'Try a different query.')
              : t('notifications.emptyCreateHint', 'Create the first') + ' ' + (rulesView ? t('notifications.newRule', 'New rule').toLowerCase() : t('notifications.newTemplate', 'New template').toLowerCase()) + ' ' + t('notifications.emptyCreateHintSuffix', `using "${createLabel}" above.`)
          }
        />
      ) : (
        <NotifDefTable defs={filtered} onOpen={setOpenKey} />
      )}

      {showCreate && (
        <CreateDefModal
          token={token!}
          channel={channel}
          rulesView={rulesView}
          onClose={() => setShowCreate(false)}
          onCreated={(k) => {
            setShowCreate(false)
            load()
            setOpenKey(k)
          }}
        />
      )}

      {openKey && (
        <DetailDrawer
          token={token!}
          defKey={openKey}
          onClose={() => setOpenKey(null)}
          onChanged={() => load()}
          onDeleted={() => { setOpenKey(null); load() }}
        />
      )}
    </div>
  )
}
