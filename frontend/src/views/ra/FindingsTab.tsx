import { ListChecks, Play, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, KPITile, StatusPill } from '../../primitives'
import { PermissionDenied, EmptyState, ErrorBanner } from '../../components/States'
import RowActionsMenu, { type RowAction } from '../../components/RowActionsMenu'
import { SearchIcon, CheckIcon, EditIcon, CloseIcon } from '../../components/icons'
import { timeAgo } from '../../lib/time'
import type { FindingType, FindingSeverity, FindingStatus, RaFinding, RaScanRun, FindingsState } from './types'
import { FINDING_TYPE_LABEL, STATUS_LABEL, statusToPill, severityToPill } from './types'

function FilterSelect({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: [string, string][]
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>
      <span>{label}</span>
      <select
        className="inp inp-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: 'var(--gx-text-sm)' }}
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

function TypeChip({ type, severity }: { type: FindingType; severity: FindingSeverity }) {
  const tone = severity === 'critical' || severity === 'high'
    ? { bg: 'var(--gx-danger-soft)', fg: 'var(--gx-danger)' }
    : severity === 'medium'
      ? { bg: 'var(--gx-warning-soft)', fg: 'var(--gx-warning)' }
      : { bg: 'var(--gx-bg-subtle)', fg: 'var(--gx-text-2)' }
  return (
    <span style={{
      display: 'inline-block',
      padding: 'var(--gx-space-1) var(--gx-space-4)',
      background: tone.bg,
      color: tone.fg,
      borderRadius: 'var(--gx-radius-full)',
      fontSize: 'var(--gx-text-11)',
      fontWeight: 'var(--gx-weight-semibold)',
      whiteSpace: 'nowrap',
    }}>
      {FINDING_TYPE_LABEL[type]}
    </span>
  )
}

export function FindingsTab(props: {
  state: FindingsState
  statusFilter: FindingStatus | 'all'
  onStatusFilter: (s: FindingStatus | 'all') => void
  typeFilter: FindingType | 'all'
  onTypeFilter: (t: FindingType | 'all') => void
  severityFilter: FindingSeverity | 'all'
  onSeverityFilter: (s: FindingSeverity | 'all') => void
  canAdmin: boolean
  onRunScan: () => void
  lastScan: RaScanRun | null
  kpiCounts: { open: number; investigating: number; resolved: number; false_positive: number }
  pageRows: RaFinding[]
  page: number
  pageCount: number
  onPage: (p: number) => void
  totalRows: number
  pageSize: number
  onRetry: () => void
  onAck: (f: RaFinding) => void
  onOpenResolve: (f: RaFinding) => void
  onOpenMarkFP: (f: RaFinding) => void
  onOpenDrawer: (f: RaFinding) => void
}) {
  const {
    state, statusFilter, onStatusFilter, typeFilter, onTypeFilter,
    severityFilter, onSeverityFilter, canAdmin, onRunScan, lastScan,
    kpiCounts, pageRows, page, pageCount, onPage, totalRows, pageSize,
    onRetry, onAck, onOpenResolve, onOpenMarkFP, onOpenDrawer,
  } = props

  if (state.state === 'denied') {
    return <PermissionDenied message="You don't have permission to view revenue assurance findings." />
  }

  if (state.state === 'unavailable') {
    return (
      <EmptyState
        icon={<ListChecks size={40} />}
        title="Revenue Assurance endpoints not yet available"
        message="The findings worklist will appear once the Phase B.3 backend is live."
      />
    )
  }

  return (
    <div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 'var(--gx-space-4)', alignItems: 'center',
        marginBottom: 'var(--gx-space-5)',
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gx-space-3)', alignItems: 'center' }}>
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={(v) => onStatusFilter(v as FindingStatus | 'all')}
            options={[
              ['all', 'All statuses'],
              ['open', 'Open'],
              ['investigating', 'Investigating'],
              ['resolved', 'Resolved'],
              ['false_positive', 'False positive'],
            ]}
          />
          <FilterSelect
            label="Type"
            value={typeFilter}
            onChange={(v) => onTypeFilter(v as FindingType | 'all')}
            options={[
              ['all', 'All types'],
              ['unbilled_service', FINDING_TYPE_LABEL.unbilled_service],
              ['uninvoiced_subscription', FINDING_TYPE_LABEL.uninvoiced_subscription],
              ['orphan_invoice', FINDING_TYPE_LABEL.orphan_invoice],
            ]}
          />
          <FilterSelect
            label="Severity"
            value={severityFilter}
            onChange={(v) => onSeverityFilter(v as FindingSeverity | 'all')}
            options={[
              ['all', 'All severities'],
              ['critical', 'Critical'],
              ['high', 'High'],
              ['medium', 'Medium'],
              ['low', 'Low'],
            ]}
          />
        </div>

        <span style={{ flex: 1 }} />

        {lastScan && (
          <span style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>
            Last scan: <strong style={{ color: 'var(--gx-text-2)' }} title={lastScan.started_at}>
              {timeAgo(lastScan.started_at) || 'just now'}
            </strong>
            {' '}· {lastScan.findings_count} finding{lastScan.findings_count === 1 ? '' : 's'}
          </span>
        )}
        <Button variant="ghost" size="sm"
            onClick={onRetry}
          title="Reload findings">
          <RefreshCw size={13} /> Refresh
        </Button>
        {canAdmin && (
          <Button variant="primary" size="sm"
            onClick={onRunScan}
            title="Start a new scan run">
            <Play size={13} /> Run Scan
          </Button>
        )}
      </div>

      {state.state === 'ok' && (
        <div className="kpi-strip" style={{ marginBottom: 'var(--gx-space-8)' }}>
          <KPITile
            label="Open"
            value={kpiCounts.open}
            size="sm"
            danger={kpiCounts.open > 0}
          />
          <KPITile
            label="Investigating"
            value={kpiCounts.investigating}
            size="sm"
            warning={kpiCounts.investigating > 0}
          />
          <KPITile
            label="Resolved"
            value={kpiCounts.resolved}
            size="sm"
          />
          <KPITile
            label="False positives"
            value={kpiCounts.false_positive}
            size="sm"
            muted
          />
        </div>
      )}

      {state.state === 'loading' && (
        <p className="muted" style={{ padding: 'var(--gx-space-18)' }}>Loading findings…</p>
      )}

      {state.state === 'error' && (
        <ErrorBanner message={state.message} onRetry={onRetry} />
      )}

      {state.state === 'empty' && (
        <EmptyState
          icon={<SearchIcon size={40} />}
          title="No findings to triage."
          message={lastScan
            ? `Last scan ${timeAgo(lastScan.started_at) || 'just now'}.`
            : 'Run a scan to detect revenue leakage.'}
          action={canAdmin ? (
            <Button variant="primary" size="sm"
            onClick={onRunScan}>
              <Play size={13} /> Run Scan
            </Button>
          ) : undefined}
        />
      )}

      {state.state === 'ok' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead>
                <tr>
                  <th scope="col">Detected</th>
                  <th scope="col">Type</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Summary</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((f) => {
                  const actionable = f.status === 'open' || f.status === 'investigating'
                  return (
                    <tr
                      key={f.id}
                      onClick={() => onOpenDrawer(f)}
                      style={{ cursor: 'pointer' }}
                      title="View finding details"
                    >
                      <td>
                        <span title={f.detected_at} style={{ color: 'var(--gx-text-2)' }}>
                          {timeAgo(f.detected_at) || '—'}
                        </span>
                      </td>
                      <td>
                        <TypeChip type={f.finding_type} severity={f.severity} />
                      </td>
                      <td>
                        <StatusPill
                          variant={severityToPill(f.severity)}
                          label={f.severity}
                          size="sm"
                        />
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)' }}>
                          <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', textTransform: 'uppercase' }}>
                            {f.entity_type}
                          </span>
                          <span className="mono" style={{ fontSize: 'var(--gx-text-sm)' }}>
                            {f.entity_id ? f.entity_id.slice(0, 8) : '—'}
                          </span>
                        </span>
                      </td>
                      <td style={{ maxWidth: 360 }}>
                        <span style={{
                          display: 'inline-block', maxWidth: '100%',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          verticalAlign: 'bottom',
                        }} title={f.summary}>
                          {f.summary}
                        </span>
                      </td>
                      <td>
                        <StatusPill
                          variant={statusToPill(f.status)}
                          label={STATUS_LABEL[f.status]}
                          size="sm"
                        />
                      </td>
                      <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const actions: RowAction[] = []
                          if (actionable && f.status === 'open') {
                            actions.push({ key: 'ack', label: 'Acknowledge', icon: <CheckIcon size={14} />, onClick: () => onAck(f) })
                          }
                          if (actionable) {
                            actions.push({ key: 'resolve', label: 'Resolve', icon: <EditIcon size={14} />, onClick: () => onOpenResolve(f) })
                          }
                          if (actionable && canAdmin) {
                            actions.push({ key: 'fp', label: 'Mark false positive', icon: <CloseIcon size={14} />, danger: true, onClick: () => onOpenMarkFP(f) })
                          }
                          if (actions.length === 0) return null
                          return <RowActionsMenu actions={actions} ariaLabel="Finding actions" />
                        })()}
                      </td>
                    </tr>
                  )
                })}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 'var(--gx-space-9)', color: 'var(--gx-text-3)' }}>
                      No findings on this page.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="table-foot">
            <span className="hint">
              {totalRows === 0
                ? '0 findings'
                : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalRows)} of ${totalRows}`}
            </span>
            <span className="spacer" />
            <div style={{ display: 'flex', gap: 'var(--gx-space-2)' }}>
              <Button variant="ghost" size="sm" iconOnly
            disabled={page <= 1}
                onClick={() => onPage(Math.max(1, page - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft size={15} />
              </Button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).slice(0, 5).map((p) => (
                <button
                  key={p}
                  className={'btn btn-sm btn-icon ' + (p === page ? 'btn-secondary' : 'btn-ghost')}
                  onClick={() => onPage(p)}
                >{p}</button>
              ))}
              <Button variant="ghost" size="sm" iconOnly
            disabled={page>= pageCount}
                onClick={() => onPage(Math.min(pageCount, page + 1))}
                aria-label="Next page"
              >
                <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
