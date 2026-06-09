// NetworkInventoryView — Fiber Routes tab, create modal, and detail drawer.
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useI18n } from '../../lib/i18n'
import { Modal } from '../../components/Modal'
import { toast } from '../../components/Toast'
import { ErrorBanner, SkeletonRows } from '../../components/States'
import { Button, StatusPill } from '../../primitives'
import type { LoadState } from '../../primitives'
import { PlusIcon, RefreshIcon } from '../../components/icons'
import { bget, bpost } from '../../lib/billing'
import { fmtDate, timeAgo } from '../../lib/time'
import type { FiberRoute, OutagePath } from './types'
import { fiberStatusVariant, asList } from './helpers'
import { FilterSelect, TabToolbar, LoadShell, Field, SectionLabel, KvGrid } from './shared'

export function FiberTab({ state, status, onStatus, canAdmin, onNew, onReload, onOpen }: {
  state: LoadState<FiberRoute>
  status: string
  onStatus: (s: string) => void
  canAdmin: boolean
  onNew: () => void
  onReload: () => void
  onOpen: (id: string) => void
}) {
  const { t } = useI18n()
  return (
    <div>
      <TabToolbar
        left={
          <FilterSelect
            label={t('common.status', 'Status')}
            value={status}
            onChange={onStatus}
            options={[
              ['all',            t('fiber.statusAll', 'All statuses')],
              ['PLANNED',        t('fiber.statusPlanned', 'Planned')],
              ['CONSTRUCTION',   t('fiber.statusConstruction', 'Construction')],
              ['ACTIVE',         t('fiber.statusActive', 'Active')],
              ['DECOMMISSIONED', t('fiber.statusDecommissioned', 'Decommissioned')],
            ]}
          />
        }
        right={
          <>
            <Button variant="ghost" size="sm"
            onClick={onReload}>
              <RefreshIcon size={13} /> {t('common.refresh', 'Refresh')}
            </Button>
            {canAdmin && (
              <Button variant="primary" size="sm"
            onClick={onNew}>
                <PlusIcon size={13} /> {t('fiber.newRoute', 'New Fiber Route')}
              </Button>
            )}
          </>
        }
      />

      <LoadShell
        state={state}
        emptyTitle={t('fiber.emptyTitle', 'No fiber routes match this filter')}
        emptyMessage={t('fiber.emptyMsg', 'Try a different status, or add one with New Fiber Route.')}
        onRetry={onReload}
      >
        {(items) => (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="grid" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>{t('common.name', 'Name')}</th>
                    <th>{t('fiber.col.originDest', 'Origin → Destination')}</th>
                    <th className="num">{t('fiber.col.capacity', 'Capacity (Gbps)')}</th>
                    <th>{t('common.status', 'Status')}</th>
                    <th>{t('common.created', 'Created')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr
                      key={r.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => onOpen(r.id)}
                    >
                      <td style={{ fontWeight: 'var(--gx-weight-medium)' }}>{r.name ?? r.id.slice(0, 8)}</td>
                      <td>
                        <span style={{ color: 'var(--gx-text-2)' }}>
                          {r.origin_pop ?? '—'}
                        </span>
                        <span style={{ margin: '0 var(--gx-space-3)', color: 'var(--gx-text-3)' }}>→</span>
                        <span style={{ color: 'var(--gx-text-2)' }}>
                          {r.destination_pop ?? '—'}
                        </span>
                      </td>
                      <td className="num">
                        <span className="mono tnum">{r.capacity_gbps != null ? r.capacity_gbps : '—'}</span>
                      </td>
                      <td>
                        <StatusPill variant={fiberStatusVariant(r.status)} label={r.status ?? '—'} size="sm" />
                      </td>
                      <td className="muted" style={{ fontSize: 'var(--gx-text-sm)' }}>
                        <span title={r.created_at ?? undefined}>{timeAgo(r.created_at ?? null) || fmtDate(r.created_at)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </LoadShell>
    </div>
  )
}

export function FiberCreateModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: () => void
}) {
  const { token } = useAuth()
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [originPop, setOriginPop] = useState('')
  const [destPop, setDestPop] = useState('')
  const [capacity, setCapacity] = useState('')
  const [status, setStatus] = useState('PLANNED')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!name.trim()) { toast.error(t('fiber.nameRequired', 'Name is required')); return }
    setSubmitting(true)
    try {
      const body: Record<string, any> = { name: name.trim(), status }
      if (originPop.trim())   body.origin_pop = originPop.trim()
      if (destPop.trim())     body.destination_pop = destPop.trim()
      if (capacity.trim()) {
        const n = Number(capacity)
        if (isNaN(n)) { toast.error(t('fiber.capacityNumber', 'Capacity must be a number')); setSubmitting(false); return }
        body.capacity_gbps = n
      }
      await bpost(token!, '/api/fiber-routes', body)
      toast.success(t('fiber.created', 'Fiber route created'))
      onCreated()
    } catch (e) {
      toast.error((e as Error).message || t('fiber.failedCreate', 'Failed to create route'))
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => submitting ? undefined : onClose()}
      title={t('fiber.newRoute', 'New Fiber Route')}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={submitting}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="primary" size="md"
            onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? t('fiber.creating', 'Creating…') : t('fiber.createRoute', 'Create route')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-6)' }}>
        <Field label={`${t('common.name', 'Name')} *`}>
          <input className="inp inp-md" value={name} onChange={(e) => setName(e.target.value)} placeholder="Yerevan ↔ Gyumri trunk" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--gx-space-6)' }}>
          <Field label={t('fiber.originPop', 'Origin POP')}>
            <input className="inp inp-md" value={originPop} onChange={(e) => setOriginPop(e.target.value)} placeholder={t('fiber.popPlaceholder', 'POP code or name')} />
          </Field>
          <Field label={t('fiber.destPop', 'Destination POP')}>
            <input className="inp inp-md" value={destPop} onChange={(e) => setDestPop(e.target.value)} placeholder={t('fiber.popPlaceholder', 'POP code or name')} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--gx-space-6)' }}>
          <Field label={t('fiber.col.capacity', 'Capacity (Gbps)')}>
            <input className="inp inp-md" type="number" min="0" step="0.1" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 100" />
          </Field>
          <Field label={t('common.status', 'Status')}>
            <select className="inp inp-md" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="PLANNED">{t('fiber.statusPlanned', 'Planned')}</option>
              <option value="CONSTRUCTION">{t('fiber.statusConstruction', 'Construction')}</option>
              <option value="ACTIVE">{t('fiber.statusActive', 'Active')}</option>
              <option value="DECOMMISSIONED">{t('fiber.statusDecommissioned', 'Decommissioned')}</option>
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  )
}

export function FiberDetailDrawer({ id, onClose }: {
  id: string; onClose: () => void
}) {
  const { token } = useAuth()
  const { t } = useI18n()
  const [route, setRoute] = useState<FiberRoute | null>(null)
  const [outages, setOutages] = useState<OutagePath[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [outagesUnavailable, setOutagesUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null); setOutagesUnavailable(false)
    Promise.all([
      bget<FiberRoute>(token!, `/api/fiber-routes/${id}`),
      bget<any>(token!, `/api/fiber-routes/${id}/outage-paths`),
    ]).then(([r, o]) => {
      if (!alive) return
      if (!r.ok) { setError(`Failed to load route (${r.status})`); setLoading(false); return }
      setRoute(r.data)
      if (o.status === 404)      setOutagesUnavailable(true)
      else if (!o.ok)            setOutages([])
      else                       setOutages(asList<OutagePath>(o.data))
      setLoading(false)
    }).catch((e) => { if (alive) { setError((e as Error).message); setLoading(false) } })
    return () => { alive = false }
  }, [token, id])

  return (
    <Modal
      open
      onClose={onClose}
      title={route?.name ?? 'Fiber route'}
      subtitle={route ? `${route.origin_pop ?? '—'} → ${route.destination_pop ?? '—'}` : id}
      size="lg"
    >
      {loading && <SkeletonRows rows={4} />}
      {error && <ErrorBanner message={error} />}
      {route && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-18)' }}>
          <section>
            <SectionLabel>{t('common.details', 'Details')}</SectionLabel>
            <KvGrid rows={[
              [t('common.status', 'Status'),     route.status ? <StatusPill variant={fiberStatusVariant(route.status)} label={route.status} size="sm" /> : '—'],
              [t('fiber.col.capacity', 'Capacity'),   route.capacity_gbps != null ? `${route.capacity_gbps} Gbps` : '—'],
              [t('fiber.origin', 'Origin'),     route.origin_pop ?? '—'],
              [t('fiber.destination', 'Destination'), route.destination_pop ?? '—'],
              [t('common.created', 'Created'),    fmtDate(route.created_at)],
            ]} />
          </section>

          <section>
            <SectionLabel>{t('fiber.geoPath', 'Geo path (WKT)')}</SectionLabel>
            {route.geo_path
              ? <pre style={{
                  margin: 0, padding: 'var(--gx-space-4)',
                  background: 'var(--gx-bg-subtle)',
                  border: '1px solid var(--gx-border-subtle)',
                  borderRadius: 'var(--gx-radius-md)',
                  fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
                  fontSize: 'var(--gx-text-sm)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: 'var(--gx-text-2)',
                }}>{route.geo_path}</pre>
              : <p className="muted" style={{ margin: 0, fontSize: 'var(--gx-text-sm)' }}>{t('fiber.noGeoPath', 'No geo path recorded.')}</p>
            }
          </section>

          <section>
            <SectionLabel>{t('fiber.linkedOutages', 'Linked outage paths')}</SectionLabel>
            {outagesUnavailable && (
              <p className="muted" style={{ margin: 0, fontSize: 'var(--gx-text-sm)' }}>{t('fiber.outageEndpointNA', 'Outage-path endpoint not available.')}</p>
            )}
            {!outagesUnavailable && outages && outages.length === 0 && (
              <p className="muted" style={{ margin: 0, fontSize: 'var(--gx-text-sm)' }}>{t('fiber.noActiveOutages', 'No active outages on this route.')}</p>
            )}
            {!outagesUnavailable && outages && outages.length > 0 && (
              <table className="grid" style={{ width: '100%' }}>
                <thead><tr><th>{t('fiber.col.outage', 'Outage')}</th><th>{t('common.status', 'Status')}</th><th>{t('fiber.col.affected', 'Affected')}</th></tr></thead>
                <tbody>
                  {outages.map((o) => (
                    <tr key={o.id}>
                      <td><span className="mono">{(o.outage_id ?? o.id).slice(0, 8)}</span></td>
                      <td>{o.status ?? '—'}</td>
                      <td><span title={o.affected_at ?? undefined}>{timeAgo(o.affected_at ?? null) || '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
