import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../lib/i18n'
import { bget, bpost, bdel, loadCustomers } from '../lib/billing'
import { Modal, confirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from '../components/States'
import { InboxIcon, GearIcon, ServerIcon } from '../components/icons'
import { Plus, ChevronsUpDown, ArrowUp, ArrowDown, Pause, Play, Trash2 } from 'lucide-react'
import { PageShell, type KPISpec } from '../page-shell'
import RecordDrawer, { type RecordDrawerField } from '../components/RecordDrawer'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { StatusPill, Button, Pagination } from '../primitives'
import { can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { OBJ } from '../lib/permissions-constants'
import { humanizeStatus, humanRef } from '../lib/humanize'
import { SERVICE_ALL, getStatusTone, type PillVariant } from '../lib/status-constants'

// Services UI (A14 /api/services) — list + RecordDrawer detail with resources + lifecycle.
// SPEC §4.5 mandatory-approval gate is wired on the backend `suspend` transition:
// a first-call returns HTTP 202 { detail: { status: 'approval_required', approval_id, action_type } }
// (parking a PENDING approval) and the suspension only happens once an approver decides.
// We surface that via a toast so the user knows it's queued, not failed.
type Service = {
  id: string
  customer_id?: string | null
  subscription_id?: string | null
  type?: string
  name?: string
  status?: string | null
  activated_at?: string | null
  created_at?: string | null
  resources?: Resource[]
}
type Resource = {
  id: string
  kind?: string
  value?: string
  label?: string | null
  status?: string | null
  created_at?: string | null
}

const TYPES = ['internet', 'tv', 'voip', 'hosting', 'other']
const KINDS = ['ip', 'mac', 'port', 'device', 'circuit', 'other']

// DF-4 — canonical fmtDate in lib/time.ts.
import { fmtDate } from '../lib/time'

// Service status → StatusPill variant — delegated to canonical mapper (L-16).
function mapServiceStatus(s: string | null | undefined): PillVariant {
  return getStatusTone(s)
}

function renderCell(colKey: string, sv: Service, cust: (sv: Service) => string) {
  switch (colKey) {
    case 'name':
      return <span className="mono">{sv.name ?? humanRef({ id: sv.id })}</span>
    case 'customer':
      return cust(sv)
    case 'type':
      return (
        <span style={{ color: 'var(--gx-text-2)', textTransform: 'capitalize' }}>
          {sv.type ?? '—'}
        </span>
      )
    case 'status':
      return sv.status ? (
        <StatusPill
          variant={mapServiceStatus(sv.status)}
          label={humanizeStatus(sv.status)}
          size="sm"
        />
      ) : (
        <span>—</span>
      )
    case 'activated':
      return <span className="mono">{fmtDate(sv.activated_at)}</span>
    default:
      return '—'
  }
}

export default function ServicesView({
  canConfigure = false,
  configVersion = 0,
  onConfigure,
  capabilities = FULL_ACCESS,
}: {
  canConfigure?: boolean
  configVersion?: number
  onConfigure?: () => void
  capabilities?: Capabilities
}) {
  const { token } = useAuth()
  const { t } = useI18n()
  const [list, setList] = useState<Service[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const page = usePageConfig(token!, 'services', configVersion)
  const cf = useCustomFields(
    'services',
    page.customFields,
    (list ?? []).map((sv) => sv.id),
  )

  const canCreate = can(capabilities, OBJ.SERVICE, 'create')

  // Interaction state for reskin.
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [pg, setPg] = useState(1)
  const PAGE_SIZE = 25

  async function load() {
    setError('')
    setUnavailable(false)
    setDenied(false)
    setList(null)
    const p = new URLSearchParams()
    if (status) p.set('status', status)
    if (type) p.set('type', type)
    const qs = p.toString()
    const res = await bget<Service[]>(token!, `/api/services${qs ? `?${qs}` : ''}`)
    if (res.status === 404) {
      setUnavailable(true)
      setList([])
      return
    }
    if (res.status === 403) {
      setDenied(true)
      setList([])
      return
    }
    if (!res.ok) {
      setError(t('services.loadError', 'Failed to load services'))
      setList([])
      return
    }
    setList(Array.isArray(res.data) ? res.data : [])
    setNames(await loadCustomers(token!))
  }

  useEffect(() => {
    load()
  }, [token, status, type])
  useEffect(() => {
    setPg(1)
  }, [status, type, query, sortKey, sortDir])

  const cust = (sv: Service) =>
    sv.customer_id ? (names[sv.customer_id] ?? humanRef({ id: sv.customer_id })) : '—'

  const all = list ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((sv) => {
      const fields = [sv.name ?? '', cust(sv), sv.type ?? '', sv.status ?? '']
        .join(' ')
        .toLowerCase()
      return fields.includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, names])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (sv: Service): string | number => {
      switch (k) {
        case 'name':
          return sv.name ?? sv.id
        case 'customer':
          return cust(sv)
        case 'type':
          return sv.type ?? ''
        case 'status':
          return sv.status ?? ''
        case 'activated':
          return sv.activated_at ?? ''
        default:
          return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const x = get(a),
        y = get(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, names])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE)

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortKey(k)
      setSortDir(1)
    }
  }

  const pendingCount = all.filter((s) => (s.status ?? '').toUpperCase() === 'PENDING').length
  const activeCount = all.filter((s) => (s.status ?? '').toUpperCase() === 'ACTIVE').length
  const suspendedCount = all.filter((s) => (s.status ?? '').toUpperCase() === 'SUSPENDED').length
  const terminatedCount = all.filter((s) => (s.status ?? '').toUpperCase() === 'TERMINATED').length

  if (denied)
    return (
      <PermissionDenied
        message={t('services.denied', "You don't have permission to view services.")}
      />
    )

  const kpis: KPISpec[] =
    all.length > 0
      ? [
          {
            label: t('common.total', 'Total'),
            value: all.length,
            subtitle: `${activeCount} ${t('services.kpi.active', 'active')}`,
            onClick: () => setStatus(''),
          },
          {
            label: t('services.kpi.activeLabel', 'Active'),
            value: activeCount,
            subtitle: t('services.kpi.delivering', 'delivering'),
            onClick: () => setStatus('ACTIVE'),
          },
          ...(pendingCount > 0
            ? [
                {
                  label: t('services.kpi.pendingLabel', 'Pending'),
                  value: pendingCount,
                  subtitle: t('services.kpi.awaitingActivation', 'awaiting activation'),
                  onClick: () => setStatus('PENDING'),
                },
              ]
            : []),
          ...(suspendedCount > 0
            ? [
                {
                  label: t('services.kpi.suspendedLabel', 'Suspended'),
                  value: suspendedCount,
                  subtitle: t('services.kpi.actionRequired', 'action required'),
                  warning: true,
                  onClick: () => setStatus('SUSPENDED'),
                },
              ]
            : []),
          ...(terminatedCount > 0
            ? [
                {
                  label: t('services.kpi.terminatedLabel', 'Terminated'),
                  value: terminatedCount,
                  subtitle: t('services.kpi.closed', 'closed'),
                  danger: true,
                  onClick: () => setStatus('TERMINATED'),
                },
              ]
            : []),
        ]
      : []

  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={['Tech & NOC', page.title]}
      icon={<ServerIcon size={18} />}
      title={page.title}
      subtitle={t('services.subtitle', 'Active subscriber services')}
      kpis={kpis}
      primaryAction={
        canCreate
          ? {
              label: t('services.newService', 'New service'),
              icon: <Plus size={14} />,
              onClick: () => setCreateOpen(true),
            }
          : undefined
      }
      secondaryActions={
        canConfigure && onConfigure
          ? [
              {
                label: t('common.configurePageTitle', 'Configure'),
                icon: <GearIcon size={13} />,
                onClick: onConfigure,
              },
            ]
          : undefined
      }
      // TL-5 — search + type quick-filter lift into PageShell zone D.
      filters={{
        search: {
          value: query,
          onChange: setQuery,
          placeholder: t('services.searchPlaceholder', 'Search services'),
        },
        quick: [
          {
            label: 'Type',
            value: type,
            onChange: setType,
            options: [
              { value: '', label: t('services.typeAll', 'All') },
              ...TYPES.map((tp) => ({ value: tp, label: tp })),
            ],
          },
        ],
      }}
    >
      <div className="tabs">
        <button className={'tab' + (status === '' ? ' on' : '')} onClick={() => setStatus('')}>
          {t('services.tabAll', 'All')} <span className="tab-count">{all.length}</span>
        </button>
        {SERVICE_ALL.map((s) => (
          <button
            key={s}
            className={'tab' + (status === s ? ' on' : '')}
            onClick={() => setStatus(s)}
          >
            {humanizeStatus(s)}{' '}
            <span className="tab-count">
              {all.filter((x) => (x.status ?? '').toUpperCase() === s).length}
            </span>
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && (
        <div className="card" style={{ padding: 'var(--gx-space-7)' }}>
          <SkeletonRows rows={6} />
        </div>
      )}
      {unavailable && (
        <EmptyState
          icon={<ServerIcon size={40} />}
          title={t('services.unavailableTitle', "Services aren't available yet")}
          message={t(
            'services.unavailableMsg',
            'Provisioned services will appear here once the service inventory is enabled.',
          )}
        />
      )}
      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState
          icon={<InboxIcon size={40} />}
          title={t('services.emptyTitle', 'No services')}
          message={t('services.emptyMsg', 'Nothing matches this filter.')}
        />
      )}

      {list && list.length > 0 && (
        <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
          {/* TL-5 — search + type quick filter moved up to PageShell zone D. */}

          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  {page.columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      onClick={() => toggleSort(c.key)}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 'var(--gx-space-2)',
                        }}
                      >
                        {c.label}
                        {sortKey === c.key ? (
                          // D18: active sort indicator = azure (interactive cue)
                          sortDir === 1 ? (
                            <ArrowUp size={12} style={{ color: 'var(--gx-interactive)' }} />
                          ) : (
                            <ArrowDown size={12} style={{ color: 'var(--gx-interactive)' }} />
                          )
                        ) : (
                          <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />
                        )}
                      </span>
                    </th>
                  ))}
                  {cf.headers()}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((sv) => (
                  <tr key={sv.id} onClick={() => setDetailId(sv.id)}>
                    {page.columns.map((c) => (
                      <td key={c.key}>{renderCell(c.key, sv, cust)}</td>
                    ))}
                    {cf.cells(sv.id)}
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={page.columns.length + page.customFields.length}
                      style={{
                        textAlign: 'center',
                        padding: 'var(--gx-space-9)',
                        color: 'var(--gx-text-3)',
                      }}
                    >
                      {t('services.noMatch', 'No matching services.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            page={pg}
            pageCount={pageCount}
            pageSize={PAGE_SIZE}
            total={sorted.length}
            onChange={setPg}
          />
        </div>
      )}

      {detailId && (
        <ServiceDrawer
          id={detailId}
          names={names}
          capabilities={capabilities}
          onClose={() => {
            setDetailId(null)
            load()
          }}
        />
      )}

      {createOpen && (
        <CreateServiceModal
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false)
            load()
          }}
        />
      )}
    </PageShell>
  )
}

function CreateServiceModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { token } = useAuth()
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [type, setType] = useState('internet')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await bpost(token!, '/api/services', { name: name.trim(), type })
      toast.success(t('services.created', 'Service created'))
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('services.newService', 'New service')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="primary" size="md" disabled={saving || !name.trim()} onClick={submit}>
            {saving ? t('common.saving', 'Saving…') : t('common.create', 'Create')}
          </Button>
        </>
      }
    >
      <div
        className="rec-form"
        style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}
      >
        <label className="field">
          <span>{`${t('common.name', 'Name')} *`}</span>
          <input
            className="inp inp-md"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Fiber 1Gbps · Site A"
            autoFocus
          />
        </label>
        <label className="field">
          <span>{t('services.typeLabel', 'Type')}</span>
          <select className="inp inp-md" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Modal>
  )
}

// ── Service detail (RecordDrawer slide-over) ─────────────────────────────────
//
// Migrated from a full-page back-stacked detail to the shared RecordDrawer
// (same pattern as HelpdeskView ticket drawer). The lifecycle actions live in
// the drawer footer (Activate / Suspend / Terminate) and the resources table
// renders inline as a related-records card under the hero.
function ServiceDrawer({
  id,
  names,
  capabilities,
  onClose,
}: {
  id: string
  names: Record<string, string>
  capabilities: Capabilities
  onClose: () => void
}) {
  const { token } = useAuth()
  const { t } = useI18n()
  const [sv, setSv] = useState<Service | null>(null)
  const [resources, setResources] = useState<Resource[]>([])
  const [error, setError] = useState('')
  const [allocOpen, setAllocOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const canEdit = can(capabilities, OBJ.SERVICE, 'edit')

  async function load() {
    setError('')
    const res = await bget<Service>(token!, `/api/services/${id}`)
    if (!res.ok) {
      setError(
        res.status === 404
          ? t('services.notFound', 'Service not found')
          : t('services.loadServiceError', 'Failed to load service'),
      )
      return
    }
    setSv(res.data)
    setResources(res.data?.resources ?? [])
  }
  useEffect(() => {
    load()
  }, [token, id])

  // SPEC §4.5 — backend returns HTTP 202 with detail.status === 'approval_required'
  // when a `service_suspend` action is parked pending an APPROVED approval row.
  // We surface that as an informational toast rather than a destructive error.
  async function lifecycle(verb: 'activate' | 'suspend' | 'terminate') {
    if (verb === 'terminate') {
      const ok = await confirmDialog({
        title: t('services.terminateTitle', 'Terminate service'),
        message: t('services.terminateMsg', 'Terminate this service? This stops delivery.'),
        confirmLabel: t('services.terminateConfirm', 'Terminate'),
        danger: true,
      })
      if (!ok) return
    }
    if (busy) return
    setBusy(true)
    try {
      const result: any = await bpost(token!, `/api/services/${id}/${verb}`)
      // The mandatory-approval gate parks a PENDING approval and the backend response
      // body is `{ detail: { status: 'approval_required', approval_id, action_type } }`.
      // It still arrives with a 2xx status (202), so bpost resolves normally — inspect
      // the body so we can tell the user "queued for approval" instead of "Suspended".
      const approval =
        result?.detail?.status === 'approval_required'
          ? result.detail
          : result?.status === 'approval_required'
            ? result
            : null
      if (approval) {
        toast.success(
          t(
            'services.queuedForApproval',
            `${verb === 'suspend' ? 'Suspension' : 'Action'} queued for approval`,
          ),
        )
      } else {
        toast.success(t('services.lifecycleSuccess', `Service ${verb}d`))
      }
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function release(rid: string) {
    try {
      await bdel(token!, `/api/services/${id}/resources/${rid}`)
      toast.success(t('services.resourceReleased', 'Resource released'))
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const status = (sv?.status ?? '').toUpperCase()
  const custName = sv?.customer_id
    ? (names[sv.customer_id] ?? humanRef({ id: sv.customer_id }))
    : '—'

  const drawerStatus = sv?.status
    ? {
        label: humanizeStatus(sv.status),
        variant: mapServiceStatus(sv.status),
      }
    : undefined

  const fields: RecordDrawerField[] = sv
    ? [
        { key: 'customer', label: t('cust.title', 'Customer'), value: custName },
        {
          key: 'type',
          label: t('cust.type', 'Type'),
          value: sv.type ? <span style={{ textTransform: 'capitalize' }}>{sv.type}</span> : '—',
        },
        {
          key: 'activated',
          label: t('cust.activated', 'Activated'),
          value: <span className="mono">{fmtDate(sv.activated_at)}</span>,
        },
        {
          key: 'created',
          label: t('common.created', 'Created'),
          value: <span className="mono">{fmtDate(sv.created_at)}</span>,
        },
        {
          key: 'resources',
          label: `Resources (${resources.length})`,
          value: (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--gx-space-3)',
                width: '100%',
              }}
            >
              {status !== 'TERMINATED' && canEdit && (
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={Plus}
                    onClick={() => setAllocOpen(true)}
                  >
                    {t('services.allocateResource', 'Allocate resource')}
                  </Button>
                </div>
              )}
              {resources.length === 0 ? (
                <span className="muted">
                  {t('services.noResources', 'No resources allocated.')}
                </span>
              ) : (
                <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="grid-wrap">
                    <table className="grid">
                      <thead>
                        <tr>
                          <th scope="col">{t('services.resource.kind', 'Kind')}</th>
                          <th scope="col">{t('services.resource.value', 'Value')}</th>
                          <th scope="col">{t('services.resource.label', 'Label')}</th>
                          <th scope="col">{t('common.status', 'Status')}</th>
                          <th scope="col" className="actions-col">
                            <span className="sr-only">{t('common.actions', 'Actions')}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {resources.map((r) => {
                          const rs = (r.status ?? '').toUpperCase()
                          return (
                            <tr key={r.id}>
                              <td>{r.kind ?? '—'}</td>
                              <td className="mono">{r.value ?? '—'}</td>
                              <td>{r.label ?? '—'}</td>
                              <td>
                                {rs === 'RELEASED' ? (
                                  <StatusPill
                                    variant="neutral"
                                    label={t('services.resource.released', 'Released')}
                                    size="sm"
                                  />
                                ) : (
                                  <StatusPill
                                    variant="active"
                                    label={t('services.resource.allocated', 'Allocated')}
                                    size="sm"
                                  />
                                )}
                              </td>
                              <td className="actions-col">
                                <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                                  {rs !== 'RELEASED' && canEdit && (
                                    <Button variant="ghost" size="sm" onClick={() => release(r.id)}>
                                      {t('ipam.release', 'Release')}
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ),
        },
      ]
    : []

  return (
    <>
      <RecordDrawer
        open
        onClose={onClose}
        entityKey="service"
        id={sv ? sv.id : id}
        title={sv?.name ?? `Service ${humanRef({ id })}`}
        subtitle={sv?.customer_id ? custName : undefined}
        status={drawerStatus}
        fields={fields}
        footer={
          canEdit && sv ? (
            <>
              {(status === 'PENDING' || status === 'SUSPENDED') && (
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={Play}
                  disabled={busy}
                  onClick={() => lifecycle('activate')}
                >
                  {t('services.activate', 'Activate')}
                </Button>
              )}
              {status === 'ACTIVE' && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={Pause}
                  disabled={busy}
                  onClick={() => lifecycle('suspend')}
                >
                  {t('services.suspend', 'Suspend')}
                </Button>
              )}
              {status && status !== 'TERMINATED' && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={Trash2}
                  disabled={busy}
                  onClick={() => lifecycle('terminate')}
                >
                  {t('services.terminate', 'Terminate')}
                </Button>
              )}
            </>
          ) : null
        }
      />
      {error && (
        <div
          style={{
            position: 'fixed',
            top: 'var(--gx-space-8)',
            left: 'var(--gx-space-8)',
            zIndex: 'var(--gx-z-toast)',
            maxWidth: 320,
          }}
        >
          <ErrorBanner message={error} onRetry={load} />
        </div>
      )}
      {allocOpen && (
        <AllocateModal
          serviceId={id}
          onClose={() => setAllocOpen(false)}
          onDone={() => {
            setAllocOpen(false)
            load()
          }}
        />
      )}
    </>
  )
}

function AllocateModal({
  serviceId,
  onClose,
  onDone,
}: {
  serviceId: string
  onClose: () => void
  onDone: () => void
}) {
  const { token } = useAuth()
  const { t } = useI18n()
  const [kind, setKind] = useState('ip')
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!value.trim() || saving) return
    setSaving(true)
    try {
      await bpost(token!, `/api/services/${serviceId}/resources`, {
        kind,
        value: value.trim(),
        label: label.trim() || undefined,
      })
      toast.success(t('services.resource.allocatedToast', 'Resource allocated'))
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('services.allocateResource', 'Allocate resource')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="primary" size="md" disabled={saving || !value.trim()} onClick={submit}>
            {saving
              ? t('common.saving', 'Saving…')
              : t('services.resource.allocateBtn', 'Allocate')}
          </Button>
        </>
      }
    >
      <div
        className="rec-form"
        style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}
      >
        <label className="field">
          <span>{t('services.resource.kind', 'Kind')}</span>
          <select className="inp inp-md" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{`${t('services.resource.value', 'Value')} *`}</span>
          <input
            className="inp inp-md mono"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="10.0.0.5"
          />
        </label>
        <label className="field">
          <span>{t('services.resource.label', 'Label')}</span>
          <input
            className="inp inp-md"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('common.optional', 'optional')}
          />
        </label>
      </div>
    </Modal>
  )
}
