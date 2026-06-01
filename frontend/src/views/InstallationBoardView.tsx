// InstallationBoardView — Tech & NOC → Installation Board.
//
// Real kanban over orders currently in PROVISIONING, fed by NOC Phase A backend
// (GET /api/install-board). Columns map to the four install substages:
//   · Awaiting Resources   (install_substage IS NULL)
//   · Resources Allocated  (RESOURCE_ALLOC)
//   · CPE Bound            (CPE_BOUND)
//   · Activated            (ACTIVATED)
//
// Card actions advance an order through the substage pipeline:
//   · Allocate Resources → POST /api/install-board/orders/{id}/allocate-resources
//   · Bind CPE           → POST /api/install-board/orders/{id}/bind-cpe (modal)
//   · Activate           → POST /api/install-board/orders/{id}/activate
//
// Clicking a card opens a snapshot drawer (/install-summary) showing the linked
// strand / VLAN / CPE rows. Real data only — missing → empty state.
import { useEffect, useState } from 'react'
import { bget, bpost } from '../lib/billing'
import { toast } from '../components/Toast'
import { Modal } from '../components/Modal'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from '../components/States'
import { TruckIcon, RefreshIcon, ServerIcon, CheckIcon, PlusIcon, EditIcon, InfoIcon } from '../components/icons'
import { timeAgo } from '../lib/time'
import { can, type Capabilities, FULL_ACCESS } from '../lib/capabilities'
import { StatusPill } from '../primitives'
import { PageShell, type KPISpec } from '../page-shell'

type Substage = null | 'RESOURCE_ALLOC' | 'CPE_BOUND' | 'ACTIVATED'

type InstallOrder = {
  id: string
  number?: string | null
  customer_id: string | null
  status: string
  install_substage: Substage
  install_substage_at: string | null
  splitter_strand_allocation_id: string | null
  vlan_assignment_id: string | null
  cpe_binding_id: string | null
}

type InstallSummary = {
  order: {
    id: string
    number?: string | null
    customer_id: string | null
    status: string
    install_substage: Substage
    install_substage_at: string | null
  }
  splitter_strand: null | {
    id: string
    splitter_record_id: string
    strand_no: number | string
    status: string
    service_id: string | null
    allocated_at: string | null
  }
  vlan: null | {
    id: string
    pool_allocation_id: string
    vlan_value: number | string | null
    service_id: string | null
    purpose: string | null
    assigned_at: string | null
  }
  cpe: null | {
    id: string
    mac_address: string
    serial: string
    vendor: string | null
    model: string | null
    firmware: string | null
    status: string
    provisioned_at: string | null
  }
}

type ListResponse = {
  page: number
  page_size: number
  total: number
  items: InstallOrder[]
}

type ColumnKey = 'NONE' | 'RESOURCE_ALLOC' | 'CPE_BOUND' | 'ACTIVATED'

const COLUMNS: { key: ColumnKey; label: string; sub: string; tone: string }[] = [
  { key: 'NONE',           label: 'Awaiting Resources',  sub: 'Stage 9 · pending',   tone: 'var(--gx-neutral)' },
  { key: 'RESOURCE_ALLOC', label: 'Resources Allocated', sub: 'Strand + VLAN ready', tone: 'var(--gx-info)' },
  { key: 'CPE_BOUND',      label: 'CPE Bound',           sub: 'Stage 10 · hardware', tone: 'var(--gx-warning)' },
  { key: 'ACTIVATED',      label: 'Activated',           sub: 'Stage 11 · live',     tone: 'var(--gx-success)' },
]

function columnOf(order: InstallOrder): ColumnKey {
  if (!order.install_substage) return 'NONE'
  return order.install_substage as ColumnKey
}

function shortId(id: string | null | undefined, n = 8): string {
  if (!id) return '—'
  return id.length <= n ? id : id.slice(0, n)
}

interface ViewProps {
  token: string
  canConfigure?: boolean
  capabilities?: Capabilities
}

export default function InstallationBoardView({
  token,
  canConfigure = false,
  capabilities = FULL_ACCESS,
}: ViewProps) {
  const canEdit = canConfigure || can(capabilities, 'order', 'edit')

  const [orders, setOrders] = useState<InstallOrder[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [bindForOrder, setBindForOrder] = useState<InstallOrder | null>(null)
  const [summaryFor, setSummaryFor] = useState<InstallOrder | null>(null)

  async function load(opts: { silent?: boolean } = {}) {
    if (opts.silent) setReloading(true)
    else setLoading(true)
    setError(null); setDenied(false); setNotFound(false)
    const r = await bget<ListResponse>(token, `/api/install-board?page=1`)
    if (r.status === 403) { setDenied(true); setLoading(false); setReloading(false); return }
    if (r.status === 404) { setNotFound(true); setOrders([]); setLoading(false); setReloading(false); return }
    if (!r.ok || !r.data) {
      setError(`Failed to load installation board (HTTP ${r.status})`)
      setLoading(false); setReloading(false); return
    }
    const items = Array.isArray(r.data.items) ? r.data.items : []
    setOrders(items)
    setLoading(false); setReloading(false)
  }

  useEffect(() => {
    void load()
  }, [token])

  function handleActionError(e: unknown, fallback: string) {
    const err = e as Error & { status?: number }
    const msg = err?.message || fallback
    if (err?.status === 409) toast.error(msg)
    else if (err?.status === 403) toast.error("You don't have permission for this action")
    else toast.error(msg)
  }

  async function allocate(order: InstallOrder) {
    setBusyOrderId(order.id)
    try {
      await bpost(token, `/api/install-board/orders/${order.id}/allocate-resources`)
      toast.success('Resources allocated')
      await load({ silent: true })
    } catch (e) {
      handleActionError(e, 'Could not allocate resources')
    } finally {
      setBusyOrderId(null)
    }
  }

  async function activate(order: InstallOrder) {
    setBusyOrderId(order.id)
    try {
      await bpost(token, `/api/install-board/orders/${order.id}/activate`)
      toast.success('Service activated')
      await load({ silent: true })
    } catch (e) {
      handleActionError(e, 'Could not activate service')
    } finally {
      setBusyOrderId(null)
    }
  }

  // Client-derived KPIs — count by column.
  const all = orders ?? []
  const byCol: Record<ColumnKey, InstallOrder[]> = {
    NONE: [], RESOURCE_ALLOC: [], CPE_BOUND: [], ACTIVATED: [],
  }
  for (const o of all) byCol[columnOf(o)].push(o)

  const kpis: KPISpec[] = loading
    ? [
        { label: 'Awaiting',   value: 0, loading: true },
        { label: 'Allocated',  value: 0, loading: true },
        { label: 'CPE Bound',  value: 0, loading: true },
        { label: 'Activated',  value: 0, loading: true },
      ]
    : all.length === 0
    ? []
    : [
        { label: 'Awaiting',  value: byCol.NONE.length,           subtitle: 'no resources yet' },
        { label: 'Allocated', value: byCol.RESOURCE_ALLOC.length, subtitle: 'strand + VLAN' },
        { label: 'CPE Bound', value: byCol.CPE_BOUND.length,      subtitle: 'hardware paired' },
        { label: 'Activated', value: byCol.ACTIVATED.length,      subtitle: 'service live', premium: byCol.ACTIVATED.length > 0 },
      ]

  if (denied) {
    return <PermissionDenied message="You don't have permission to view the installation board." />
  }

  return (
    <PageShell
      type="pipeline"
      breadcrumb={['Tech & NOC', 'Installation Board']}
      icon={<TruckIcon size={18} />}
      title="Installation Board"
      subtitle="Service activation pipeline · stages 9–11"
      kpis={kpis.length > 0 ? kpis : undefined}
      primaryAction={{
        label: reloading ? 'Refreshing…' : 'Refresh',
        icon: <RefreshIcon size={13} />,
        onClick: () => { void load({ silent: true }) },
        disabled: loading || reloading,
      }}
    >
      {loading && <SkeletonRows rows={4} />}
      {error && <ErrorBanner message={error} onRetry={() => { void load() }} />}
      {notFound && !loading && (
        <EmptyState
          icon={<ServerIcon size={40} />}
          title="Installation board not available"
          message="The /api/install-board endpoint isn't reachable yet."
        />
      )}
      {!loading && !error && !notFound && all.length === 0 && (
        <EmptyState
          icon={<TruckIcon size={40} />}
          title="Nothing in provisioning"
          message="No orders are currently in the provisioning stage."
        />
      )}
      {!loading && !error && !notFound && all.length > 0 && (
        <div className="kanban">
          {COLUMNS.map((col) => {
            const items = byCol[col.key]
            return (
              <div key={col.key} className="kcol">
                <div className="kcol-head">
                  <span
                    style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: col.tone, flexShrink: 0,
                    }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--gx-text-1)' }}>{col.label}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--gx-text-3)' }}>{col.sub}</span>
                  </div>
                  <span className="kcol-count">{items.length}</span>
                </div>
                <div className="kcol-body">
                  {items.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      column={col.key}
                      canEdit={canEdit}
                      busy={busyOrderId === order.id}
                      onOpen={() => setSummaryFor(order)}
                      onAllocate={() => void allocate(order)}
                      onBind={() => setBindForOrder(order)}
                      onActivate={() => void activate(order)}
                    />
                  ))}
                  {items.length === 0 && (
                    <div
                      style={{
                        padding: 16,
                        textAlign: 'center',
                        color: 'var(--gx-text-3)',
                        fontSize: 12,
                        borderRadius: 6,
                        border: '1px dashed var(--gx-border)',
                      }}
                    >
                      No orders in this stage
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {bindForOrder && (
        <BindCpeModal
          token={token}
          order={bindForOrder}
          onClose={() => setBindForOrder(null)}
          onBound={async () => {
            setBindForOrder(null)
            await load({ silent: true })
          }}
        />
      )}

      {summaryFor && (
        <InstallSummaryModal
          token={token}
          order={summaryFor}
          onClose={() => setSummaryFor(null)}
        />
      )}
    </PageShell>
  )
}

/* ─── Card ──────────────────────────────────────────────────────────────── */

function OrderCard({
  order,
  column,
  canEdit,
  busy,
  onOpen,
  onAllocate,
  onBind,
  onActivate,
}: {
  order: InstallOrder
  column: ColumnKey
  canEdit: boolean
  busy: boolean
  onOpen: () => void
  onAllocate: () => void
  onBind: () => void
  onActivate: () => void
}) {
  // Card click → open summary. Action buttons stop propagation so they don't
  // accidentally trigger the drawer.
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div
      className="kcard"
      onClick={onOpen}
      style={{ cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
    >
      <div
        className="mono"
        style={{ fontSize: 11, color: 'var(--gx-link)', marginBottom: 4 }}
        title={order.id}
      >
        {order.number ? order.number : `ord-${shortId(order.id)}`}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--gx-text-3)', marginBottom: 8 }}>
        Customer <span className="mono" title={order.customer_id ?? ''}>{shortId(order.customer_id, 8)}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--gx-text-3)', marginBottom: 10 }}>
        {order.install_substage_at ? timeAgo(order.install_substage_at) : 'no timestamp'}
      </div>

      <div onClick={stop} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {column === 'NONE' && canEdit && (
          <button
            className="btn btn-primary btn-sm"
            onClick={onAllocate}
            disabled={busy}
            style={{ fontSize: 11 }}
          >
            <PlusIcon size={11} />
            {busy ? 'Allocating…' : 'Allocate Resources'}
          </button>
        )}
        {column === 'RESOURCE_ALLOC' && canEdit && (
          <button
            className="btn btn-primary btn-sm"
            onClick={onBind}
            disabled={busy}
            style={{ fontSize: 11 }}
          >
            <EditIcon size={11} />
            Bind CPE
          </button>
        )}
        {column === 'CPE_BOUND' && canEdit && (
          <button
            className="btn btn-primary btn-sm"
            onClick={onActivate}
            disabled={busy}
            style={{ fontSize: 11 }}
          >
            <CheckIcon size={11} />
            {busy ? 'Activating…' : 'Activate'}
          </button>
        )}
        {column === 'ACTIVATED' && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: 'var(--gx-success-fg, var(--gx-success))',
            }}
          >
            <CheckIcon size={11} />
            Activated · {order.install_substage_at ? timeAgo(order.install_substage_at) : '—'}
          </span>
        )}
        {!canEdit && column !== 'ACTIVATED' && (
          <span style={{ fontSize: 11, color: 'var(--gx-text-3)', fontStyle: 'italic' }}>
            Read-only
          </span>
        )}
      </div>
    </div>
  )
}

/* ─── Bind CPE Modal ────────────────────────────────────────────────────── */

function BindCpeModal({
  token,
  order,
  onClose,
  onBound,
}: {
  token: string
  order: InstallOrder
  onClose: () => void
  onBound: () => void
}) {
  const [mac, setMac] = useState('')
  const [serial, setSerial] = useState('')
  const [vendor, setVendor] = useState('')
  const [model, setModel] = useState('')
  const [firmware, setFirmware] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const canSubmit = mac.trim().length > 0 && serial.trim().length > 0 && !saving

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true); setErr(null)
    try {
      await bpost(token, `/api/install-board/orders/${order.id}/bind-cpe`, {
        mac_address: mac.trim().toLowerCase(),
        serial: serial.trim(),
        vendor: vendor.trim() || undefined,
        model: model.trim() || undefined,
        firmware: firmware.trim() || undefined,
      })
      toast.success('CPE bound to order')
      onBound()
    } catch (e) {
      const e2 = e as Error & { status?: number }
      const msg = e2?.message || 'Could not bind CPE'
      setErr(msg)
      if (e2?.status === 409) toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Bind CPE"
      subtitle={order.number ? `Order ${order.number}` : `Order ${shortId(order.id, 12)}`}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            form="bind-cpe-form"
            className="btn btn-primary btn-md"
            disabled={!canSubmit}
          >
            {saving ? 'Binding…' : 'Bind CPE'}
          </button>
        </>
      }
    >
      <form id="bind-cpe-form" onSubmit={submit} className="rec-form" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {err && <ErrorBanner message={err} />}
        <label className="field">
          <span>MAC address *</span>
          <input
            className="inp inp-md"
            value={mac}
            onChange={(e) => setMac(e.target.value)}
            placeholder="aa:bb:cc:dd:ee:ff"
            required
            autoFocus
          />
        </label>
        <label className="field">
          <span>Serial *</span>
          <input
            className="inp inp-md"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            placeholder="Device serial"
            required
          />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="field">
            <span>Vendor</span>
            <input className="inp inp-md" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="(optional)" />
          </label>
          <label className="field">
            <span>Model</span>
            <input className="inp inp-md" value={model} onChange={(e) => setModel(e.target.value)} placeholder="(optional)" />
          </label>
        </div>
        <label className="field">
          <span>Firmware</span>
          <input className="inp inp-md" value={firmware} onChange={(e) => setFirmware(e.target.value)} placeholder="(optional)" />
        </label>
      </form>
    </Modal>
  )
}

/* ─── Install Summary Modal ─────────────────────────────────────────────── */

function InstallSummaryModal({
  token,
  order,
  onClose,
}: {
  token: string
  order: InstallOrder
  onClose: () => void
}) {
  const [summary, setSummary] = useState<InstallSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setSummary(null); setError(null)
    bget<InstallSummary>(token, `/api/install-board/orders/${order.id}/install-summary`)
      .then((r) => {
        if (!alive) return
        if (!r.ok || !r.data) {
          setError(`Failed to load install summary (HTTP ${r.status})`)
          return
        }
        setSummary(r.data)
      })
    return () => { alive = false }
  }, [token, order.id])

  const substageVariant = (sub: Substage) => {
    if (sub === 'ACTIVATED') return 'active' as const
    if (sub === 'CPE_BOUND') return 'degraded' as const
    if (sub === 'RESOURCE_ALLOC') return 'info' as const
    return 'neutral' as const
  }
  const substageLabel = (sub: Substage) => {
    if (sub === 'ACTIVATED') return 'Activated'
    if (sub === 'CPE_BOUND') return 'CPE Bound'
    if (sub === 'RESOURCE_ALLOC') return 'Resources Allocated'
    return 'Awaiting Resources'
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Installation snapshot"
      subtitle={order.number ? `Order ${order.number}` : `Order ${shortId(order.id, 12)}`}
      size="lg"
      hero={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <StatusPill variant={substageVariant(order.install_substage)} label={substageLabel(order.install_substage)} />
          <span style={{ fontSize: 11.5, color: 'var(--gx-text-3)' }}>
            Updated {order.install_substage_at ? timeAgo(order.install_substage_at) : '—'}
          </span>
        </div>
      }
    >
      {error && <ErrorBanner message={error} />}
      {!summary && !error && <SkeletonRows rows={3} />}
      {summary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <SummarySection
            title="Order"
            icon={<InfoIcon size={13} />}
            rows={[
              ['Order ID', <span className="mono" title={summary.order.id}>{shortId(summary.order.id, 12)}</span>],
              ['Number',   summary.order.number ?? '—'],
              ['Customer', <span className="mono" title={summary.order.customer_id ?? ''}>{shortId(summary.order.customer_id, 12)}</span>],
              ['Status',   summary.order.status],
              ['Substage', substageLabel(summary.order.install_substage)],
            ]}
          />
          <SummarySection
            title="Splitter strand"
            icon={<ServerIcon size={13} />}
            empty={!summary.splitter_strand && 'No strand allocated yet'}
            rows={summary.splitter_strand ? [
              ['Strand #',  String(summary.splitter_strand.strand_no)],
              ['Splitter',  <span className="mono" title={summary.splitter_strand.splitter_record_id}>{shortId(summary.splitter_strand.splitter_record_id, 12)}</span>],
              ['Status',    summary.splitter_strand.status],
              ['Allocated', summary.splitter_strand.allocated_at ? timeAgo(summary.splitter_strand.allocated_at) : '—'],
            ] : []}
          />
          <SummarySection
            title="VLAN assignment"
            icon={<ServerIcon size={13} />}
            empty={!summary.vlan && 'No VLAN assigned yet'}
            rows={summary.vlan ? [
              ['VLAN',     summary.vlan.vlan_value != null ? String(summary.vlan.vlan_value) : '—'],
              ['Purpose',  summary.vlan.purpose ?? '—'],
              ['Assigned', summary.vlan.assigned_at ? timeAgo(summary.vlan.assigned_at) : '—'],
            ] : []}
          />
          <SummarySection
            title="CPE binding"
            icon={<ServerIcon size={13} />}
            empty={!summary.cpe && 'No CPE bound yet'}
            rows={summary.cpe ? [
              ['MAC',         <span className="mono">{summary.cpe.mac_address}</span>],
              ['Serial',      <span className="mono">{summary.cpe.serial}</span>],
              ['Vendor',      summary.cpe.vendor ?? '—'],
              ['Model',       summary.cpe.model ?? '—'],
              ['Firmware',    summary.cpe.firmware ?? '—'],
              ['Status',      summary.cpe.status],
              ['Provisioned', summary.cpe.provisioned_at ? timeAgo(summary.cpe.provisioned_at) : '—'],
            ] : []}
          />
        </div>
      )}
    </Modal>
  )
}

function SummarySection({
  title,
  icon,
  rows,
  empty,
}: {
  title: string
  icon: React.ReactNode
  rows: Array<[string, React.ReactNode]>
  empty?: string | false
}) {
  return (
    <section>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.06em', color: 'var(--gx-text-3)',
        marginBottom: 8,
      }}>
        {icon}<span>{title}</span>
      </div>
      {empty ? (
        <div style={{
          padding: 12,
          fontSize: 12.5,
          color: 'var(--gx-text-3)',
          background: 'var(--gx-surface-2)',
          border: '1px dashed var(--gx-border)',
          borderRadius: 6,
        }}>
          {empty}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '140px 1fr',
          rowGap: 6,
          columnGap: 12,
          fontSize: 12.5,
        }}>
          {rows.map(([k, v], i) => (
            <div key={i} style={{ display: 'contents' }}>
              <div style={{ color: 'var(--gx-text-3)' }}>{k}</div>
              <div style={{ color: 'var(--gx-text-1)' }}>{v}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
