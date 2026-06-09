// WebhooksPane — coordinator for the Developer → Webhooks Studio leaf.
//
// Wiring (real, no mocks):
//   GET    /api/webhooks                       → list
//   POST   /api/webhooks                       → create  (config.manage server-side gate)
//   GET    /api/webhooks/{id}                  → detail / drawer reload
//   PATCH  /api/webhooks/{id}                  → update + secret rotation ({secret} key)
//   DELETE /api/webhooks/{id}                  → hard delete
//   POST   /api/webhooks/{id}/test             → fire a sample event
//   GET    /api/webhooks/{id}/deliveries       → delivery log (newest first)
//
// 403 → <PermissionDenied/>. Other errors → <ErrorBanner/>. No mock data.
// Light + dark via --gx-* tokens; zero raw hex.

import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useFetch } from '../hooks/useFetch'
import { Button, KPITile } from '../primitives'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { PlusIcon, ServerIcon } from '../components/icons'

import { Webhook } from './webhooks/types'
import { CreateWebhookModal } from './webhooks/CreateWebhookModal'
import { DetailDrawer } from './webhooks/DetailDrawer'
import { WebhookTable } from './webhooks/WebhookTable'

export default function WebhooksPane() {
  const { token } = useAuth()
  const { data: hooksData, loading, status, error, refetch } = useFetch<Webhook[]>('/api/webhooks')

  const [showCreate, setShowCreate] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  if (loading) return <LoadingState />
  if (status === 403) return <PermissionDenied message="You don't have permission to manage webhooks." />
  if (error) return <ErrorBanner message={error} onRetry={refetch} />

  const hooks: Webhook[] = Array.isArray(hooksData) ? hooksData : []

  const total = hooks.length
  const activeCount = hooks.filter(w => w.active !== false).length
  const signedCount = hooks.filter(w => w.has_secret).length

  const q = search.trim().toLowerCase()
  const filtered = q
    ? hooks.filter((w) =>
        (w.name || '').toLowerCase().includes(q) ||
        (w.url || '').toLowerCase().includes(q) ||
        (w.events || []).some(e => e.toLowerCase().includes(q)),
      )
    : hooks

  return (
    <div>
      <div className="row" style={{ marginBottom: 'var(--gx-space-5)', alignItems: 'flex-end' }}>
        <div>
          <h3 style={{ margin: '0 0 var(--gx-space-2)' }}>Webhooks</h3>
          <p className="hint" style={{ margin: 0 }}>
            Forward platform events to external HTTPS endpoints. Deliveries are
            HMAC-SHA256 signed when a secret is set; retries are recorded in the
            delivery log per endpoint.
          </p>
        </div>
        <span className="spacer" />
        <Button variant="primary" size="md"
            type="button"
          onClick={() => setShowCreate(true)}
        >
          <PlusIcon size={13} /> New webhook
        </Button>
      </div>

      {total > 0 && (
        <div className="kpi-strip" style={{ marginBottom: 'var(--gx-space-6)' }}>
          <KPITile
            label="Endpoints"
            value={total}
            subtitle={`${activeCount} enabled`}
            size="sm"
          />
          <KPITile
            label="Signed"
            value={signedCount}
            subtitle="HMAC-secured"
            size="sm"
          />
          <KPITile
            label="Disabled"
            value={total - activeCount}
            subtitle="no deliveries"
            size="sm"
            muted
          />
        </div>
      )}

      <div style={{ marginBottom: 'var(--gx-space-4)', maxWidth: 320 }}>
        <input
          className="inp inp-md"
          placeholder="Filter by name, URL, or event…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ServerIcon size={40} />}
          title={q ? 'No webhooks match the filter.' : 'No webhooks yet.'}
          message={
            q
              ? 'Try a different query.'
              : 'Create the first endpoint with "New webhook" above. Once active, it will receive subscribed events.'
          }
        />
      ) : (
        <WebhookTable hooks={filtered} onOpen={setOpenId} />
      )}

      {showCreate && (
        <CreateWebhookModal
          token={token!}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false)
            refetch()
            setOpenId(id)
          }}
        />
      )}

      {openId && (
        <DetailDrawer
          token={token!}
          hookId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => refetch()}
          onDeleted={() => { setOpenId(null); refetch() }}
        />
      )}
    </div>
  )
}
