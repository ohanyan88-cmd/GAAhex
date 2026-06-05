// SystemHealthPane — Studio-shaped pane for the System Control → System Health leaf.
//
// Operational dashboard with three honest probes:
//   1. Liveness   — GET /api/health           (unauthenticated; never errors)
//   2. Readiness  — GET /api/health/ready     (unauthenticated; SELECT 1 DB ping; 200/503)
//   3. Status     — GET /api/health/status    (authenticated; uptime + counts)
//
// Each panel: StatusPill + last-checked timestamp + auto-refresh every 30s.
// A 5xx response is rendered as DEGRADED honestly (no faking). A network failure
// is rendered as CRITICAL — the probe never reached the backend. The KPI strip
// uses the same shared KPITile primitive used across the platform.
//
// Light + dark via --gx-* tokens; zero raw hex. No emoji; inline lucide icons via
// the SVG wrapper set in components/icons.tsx.

import { useCallback, useEffect, useState } from 'react'
import { Button, KPITile, StatusPill } from '../primitives'
import { ErrorBanner } from '../components/States'
import {
  ActivityIcon, RefreshIcon, ServerIcon, CheckIcon, WarningIcon, ClockIcon,
} from '../components/icons'
import { timeAgo } from '../lib/time'

import { BASE } from '../lib/config'
const REFRESH_MS = 30_000

// ---------------------------------------------------------------------------
// Types — mirror backend/app/routers/health.py
// ---------------------------------------------------------------------------
type Liveness = { status: string; version?: string; time?: string }
type Readiness = { db: boolean; version?: string; time?: string; error?: string }
type StatusSummary = {
  service?: string
  ok: boolean
  db: boolean
  version?: string
  uptime_seconds?: number
  started_at?: string
  time?: string
  counts?: { tenants?: number; users?: number; records?: number }
  db_error?: string
}

type ProbeState<T> = {
  data: T | null
  /** HTTP status; 0 = network error (probe didn't reach the backend). */
  status: number
  /** Local timestamp when the probe last completed (ok or not). */
  lastCheckedMs: number
  /** Currently in-flight (e.g. during initial load or manual refresh). */
  loading: boolean
  /** Network-layer error message, if any. */
  netError: string | null
}

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

// Map an HTTP probe outcome to a StatusPill variant. The contract:
//   - 200 OK            → ACTIVE  ("operational")
//   - 5xx / 503         → DEGRADED ("returned but in a bad state")
//   - network / 0       → CRITICAL ("could not reach the service")
//   - other 4xx         → DEGRADED ("auth / config issue")
//   - never-loaded (-1) → NEUTRAL  ("checking…")
function variantForStatus(status: number, loading: boolean): { variant: PillVariant; label: string } {
  if (status === -1 && loading) return { variant: 'neutral', label: 'checking…' }
  if (status === 0) return { variant: 'critical', label: 'unreachable' }
  if (status >= 200 && status < 300) return { variant: 'active', label: 'operational' }
  if (status >= 500) return { variant: 'degraded', label: 'degraded' }
  if (status === 401 || status === 403) return { variant: 'degraded', label: `auth (${status})` }
  return { variant: 'degraded', label: `error (${status})` }
}

// Pretty-print uptime as e.g. "3d 4h 12m" or "47s".
function formatUptime(seconds: number | undefined): string {
  if (seconds === undefined || seconds < 0) return '—'
  const s = Math.floor(seconds)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

// ---------------------------------------------------------------------------
// One probe runner — wraps fetch with status + network-error capture.
// Auth header is optional (liveness + readiness are unauthenticated).
// ---------------------------------------------------------------------------
async function runProbe<T>(path: string, token?: string): Promise<{ status: number; data: T | null; netError: string | null }> {
  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    let data: T | null = null
    try { data = (await r.json()) as T } catch { /* non-JSON body */ }
    return { status: r.status, data, netError: null }
  } catch (e) {
    return { status: 0, data: null, netError: (e as Error).message || 'Network error' }
  }
}

// ---------------------------------------------------------------------------
// Single status panel — one probe per panel.
// ---------------------------------------------------------------------------
function ProbePanel({
  title,
  description,
  endpoint,
  probe,
  onRefresh,
  children,
}: {
  title: string
  description: string
  endpoint: string
  probe: ProbeState<unknown>
  onRefresh: () => void
  children?: React.ReactNode
}) {
  const v = variantForStatus(probe.status, probe.loading)

  return (
    <div
      className="card"
      style={{
        padding: 'var(--gx-space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--gx-space-3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h4 style={{ margin: 0, fontSize: 14 }}>{title}</h4>
            <StatusPill variant={v.variant} label={v.label} size="sm" />
          </div>
          <p className="hint" style={{ margin: 0, fontSize: 12 }}>{description}</p>
          <p
            className="mono hint"
            style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--gx-text-3)' }}
          >
            {endpoint}
          </p>
        </div>
        <Button variant="ghost" size="sm" iconOnly
            type="button"
          
          onClick={onRefresh}
          disabled={probe.loading}
          aria-label={`Refresh ${title}`}
          title="Refresh now">
          <RefreshIcon size={13} />
        </Button>
      </div>

      {probe.netError && (
        <div
          style={{
            padding: 'var(--gx-space-3)',
            background: 'var(--gx-danger-soft, var(--gx-surface-2))',
            border: '1px solid var(--gx-border)',
            borderRadius: 'var(--gx-radius-md)',
            color: 'var(--gx-danger-fg, var(--gx-text-1))',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <WarningIcon size={12} />
          <span>Network error: {probe.netError}</span>
        </div>
      )}

      {children}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--gx-text-3)',
          fontSize: 11.5,
          marginTop: 'var(--gx-space-2)',
        }}
      >
        <ClockIcon size={11} />
        <span>
          {probe.lastCheckedMs > 0
            ? `Last checked ${timeAgo(new Date(probe.lastCheckedMs).toISOString())}`
            : 'Not yet checked'}
        </span>
        {probe.loading && (
          <span style={{ color: 'var(--gx-text-2)' }}>· refreshing…</span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main pane
// ---------------------------------------------------------------------------
export default function SystemHealthPane({ token }: { token: string }) {
  const [liveness, setLiveness] = useState<ProbeState<Liveness>>({
    data: null, status: -1, lastCheckedMs: 0, loading: true, netError: null,
  })
  const [readiness, setReadiness] = useState<ProbeState<Readiness>>({
    data: null, status: -1, lastCheckedMs: 0, loading: true, netError: null,
  })
  const [status, setStatus] = useState<ProbeState<StatusSummary>>({
    data: null, status: -1, lastCheckedMs: 0, loading: true, netError: null,
  })
  const [autoRefresh, setAutoRefresh] = useState(true)

  const checkLiveness = useCallback(async () => {
    setLiveness(p => ({ ...p, loading: true }))
    const r = await runProbe<Liveness>('/api/health')
    setLiveness({ data: r.data, status: r.status, lastCheckedMs: Date.now(), loading: false, netError: r.netError })
  }, [])

  const checkReadiness = useCallback(async () => {
    setReadiness(p => ({ ...p, loading: true }))
    const r = await runProbe<Readiness>('/api/health/ready')
    setReadiness({ data: r.data, status: r.status, lastCheckedMs: Date.now(), loading: false, netError: r.netError })
  }, [])

  const checkStatus = useCallback(async () => {
    setStatus(p => ({ ...p, loading: true }))
    const r = await runProbe<StatusSummary>('/api/health/status', token)
    setStatus({ data: r.data, status: r.status, lastCheckedMs: Date.now(), loading: false, netError: r.netError })
  }, [token])

  const checkAll = useCallback(() => {
    void checkLiveness()
    void checkReadiness()
    void checkStatus()
  }, [checkLiveness, checkReadiness, checkStatus])

  // Initial load
  useEffect(() => {
    checkAll()
  }, [checkAll])

  // Auto-refresh every 30s
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => { checkAll() }, REFRESH_MS)
    return () => clearInterval(id)
  }, [autoRefresh, checkAll])

  // Overall headline pill: the worst of the three probes wins.
  const headline = (() => {
    const probes = [liveness, readiness, status]
    const variants = probes.map(p => variantForStatus(p.status, p.loading).variant)
    if (variants.includes('critical')) return { variant: 'critical' as PillVariant, label: 'CRITICAL' }
    if (variants.includes('degraded')) return { variant: 'degraded' as PillVariant, label: 'DEGRADED' }
    if (variants.every(v => v === 'active')) return { variant: 'active' as PillVariant, label: 'OPERATIONAL' }
    return { variant: 'neutral' as PillVariant, label: 'CHECKING' }
  })()

  const dbProbeOk = readiness.status >= 200 && readiness.status < 300 && readiness.data?.db === true
  const statusOk = status.status >= 200 && status.status < 300 && status.data?.ok === true

  return (
    <div>
      {/* ---- header + headline ---- */}
      <div className="row" style={{ marginBottom: 'var(--gx-space-5)', alignItems: 'flex-end' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h3 style={{ margin: 0 }}>System Health</h3>
            <StatusPill variant={headline.variant} label={headline.label} />
          </div>
          <p className="hint" style={{ margin: 0 }}>
            Live operational probes. Auto-refresh every {Math.round(REFRESH_MS / 1000)}s.
            A 5xx response shows as <strong>degraded</strong>; a network failure shows as <strong>critical</strong>.
          </p>
        </div>
        <span className="spacer" />
        <label className="row" style={{ gap: 6, fontSize: 12, alignItems: 'center', marginRight: 8 }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          <span>Auto-refresh</span>
        </label>
        <Button variant="ghost" size="md"
            type="button"
          
          onClick={checkAll}
          aria-label="Refresh all probes">
          <RefreshIcon size={13} /> Refresh all
        </Button>
      </div>

      {/* ---- KPI strip (data from /api/health/status when available) ---- */}
      {status.data?.counts && statusOk && (
        <div className="kpi-strip" style={{ marginBottom: 12 }}>
          <KPITile
            label="Uptime"
            value={formatUptime(status.data.uptime_seconds)}
            subtitle={status.data.started_at ? `since ${timeAgo(status.data.started_at)}` : undefined}
            icon={ClockIcon}
            size="sm"
          />
          <KPITile
            label="Tenants"
            value={status.data.counts.tenants ?? 0}
            icon={ServerIcon}
            size="sm"
          />
          <KPITile
            label="Users"
            value={status.data.counts.users ?? 0}
            icon={ActivityIcon}
            size="sm"
          />
          <KPITile
            label="Records"
            value={status.data.counts.records ?? 0}
            icon={CheckIcon}
            size="sm"
          />
        </div>
      )}

      {/* ---- panels grid ---- */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 'var(--gx-space-4)',
        }}
      >
        <ProbePanel
          title="Liveness"
          description="The backend process is up and answering requests. Does not touch the database."
          endpoint="GET /api/health"
          probe={liveness}
          onRefresh={checkLiveness}
        >
          {liveness.status >= 200 && liveness.status < 300 && liveness.data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="hint">Reported status</span>
                <span className="mono">{liveness.data.status}</span>
              </div>
              {liveness.data.version && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="hint">Version</span>
                  <span className="mono">{liveness.data.version}</span>
                </div>
              )}
            </div>
          )}
        </ProbePanel>

        <ProbePanel
          title="Readiness (Database)"
          description="Pings the database with SELECT 1. Reports 503 if the DB is unreachable."
          endpoint="GET /api/health/ready"
          probe={readiness}
          onRefresh={checkReadiness}
        >
          {readiness.data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="hint">Database</span>
                {dbProbeOk
                  ? <StatusPill variant="active" label="connected" size="sm" />
                  : <StatusPill variant="critical" label="down" size="sm" />}
              </div>
              {readiness.data.error && (
                <div
                  style={{
                    marginTop: 'var(--gx-space-2)',
                    padding: 6,
                    background: 'var(--gx-surface-2)',
                    border: '1px solid var(--gx-border-subtle)',
                    borderRadius: 'var(--gx-radius-md)',
                    fontSize: 11.5,
                    color: 'var(--gx-danger-fg, var(--gx-text-1))',
                    wordBreak: 'break-word',
                  }}
                >
                  {readiness.data.error}
                </div>
              )}
            </div>
          )}
        </ProbePanel>

        <ProbePanel
          title="Operational Status"
          description="Authenticated summary: uptime, version, headline counts. Requires a valid session."
          endpoint="GET /api/health/status"
          probe={status}
          onRefresh={checkStatus}
        >
          {status.status === 401 || status.status === 403 ? (
            <ErrorBanner message="Sign-in required to read the operational status summary." />
          ) : status.data && statusOk ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="hint">Service</span>
                <span className="mono">{status.data.service ?? '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="hint">Version</span>
                <span className="mono">{status.data.version ?? '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="hint">Uptime</span>
                <span className="mono">{formatUptime(status.data.uptime_seconds)}</span>
              </div>
              {status.data.db_error && (
                <div
                  style={{
                    marginTop: 'var(--gx-space-2)',
                    padding: 6,
                    background: 'var(--gx-surface-2)',
                    border: '1px solid var(--gx-border-subtle)',
                    borderRadius: 'var(--gx-radius-md)',
                    fontSize: 11.5,
                    color: 'var(--gx-danger-fg, var(--gx-text-1))',
                    wordBreak: 'break-word',
                  }}
                >
                  DB error: {status.data.db_error}
                </div>
              )}
            </div>
          ) : null}
        </ProbePanel>
      </div>
    </div>
  )
}
