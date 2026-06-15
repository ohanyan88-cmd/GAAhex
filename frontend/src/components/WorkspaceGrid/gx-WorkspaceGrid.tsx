// gx-WorkspaceGrid — the role-driven operating center body (Phase 2).
// EN: Composes the workspace leaf widgets into the locked zone layout from ONE typed
//     WorkspaceData payload (§11 one fetch): top meta · KPI strip (reuses KPITile) · focus band ·
//     pipeline spine · 2-col working zone (queue + calls | goal + deals + alerts) · team strip.
//     Owns the page-level loading/error states for the single fetch; each widget owns its own
//     empty state. Permission gating is the caller's responsibility — only the handlers the user
//     is allowed are passed in, so no dead buttons ever render.
// HY: Կազմում է workspace leaf widget-երը կողպված zone layout-ի մեջ՝ ՄԵԿ typed WorkspaceData
//     payload-ից (§11 մեկ fetch)՝ top meta · KPI strip (KPITile reuse) · focus band · pipeline
//     spine · 2-սյունակ working zone · team strip։ Page-level loading/error-ը այստեղ է; ամեն
//     widget իր empty state-ն ունի։ Permission gating-ը caller-ինն է — ոչ մի dead button։
import { useMemo } from 'react'
import { KPITile } from '../../primitives'
import { t, localeTag } from '../../lib/i18n'
import type { WorkspaceData, WsKpi } from '../../lib/workspace/contract'
import type { WorkspaceRole } from '../../lib/workspace/registry'
import { GxSparkline } from '../Sparkline/gx-Sparkline'
import { GxFocusBand } from '../FocusBand/gx-FocusBand'
import { GxPipelineSpine } from '../PipelineSpine/gx-PipelineSpine'
import { GxGoalRing } from '../GoalRing/gx-GoalRing'
import { GxQueueWidget } from '../QueueWidget/gx-QueueWidget'
import { GxCallsTimeline } from '../CallsTimeline/gx-CallsTimeline'
import { GxDealsWidget } from '../DealsWidget/gx-DealsWidget'
import { GxAlertList } from '../AlertList/gx-AlertList'
import { GxStandings } from '../Standings/gx-Standings'

export interface GxWorkspaceGridProps {
  /** The single workspace payload (null while loading or on error). */
  data: WorkspaceData | null
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  /** ASK ME deep-link from the focus band. */
  onAsk?: () => void
  /** Pipeline stage drill-down. */
  onStageClick?: (key: string) => void
  /** Queue / calls / deal / alert row navigation (caller-gated). */
  onSelectLead?: (id: string) => void
  onSelectCall?: (id: string) => void
  onOpenDeal?: (id: string) => void
  onSelectAlert?: (id: string) => void
  onSelectTeammate?: (name: string) => void
  /** Role switcher (optional) — the "Change layout" control. */
  roles?: { value: WorkspaceRole; label: string }[]
  currentRole?: WorkspaceRole
  onRoleChange?: (role: WorkspaceRole) => void
}

/** Map a KPI's trend into KPITile's delta props. */
function deltaOf(kpi: WsKpi): { delta?: string; deltaPositive?: boolean } {
  if (!kpi.trend) return {}
  const { dir, pct } = kpi.trend
  const sign = pct > 0 ? '+' : ''
  return { delta: `${sign}${pct}%`, deltaPositive: dir === 'up' }
}

export function GxWorkspaceGrid({
  data,
  loading,
  error,
  onRetry,
  onAsk,
  onStageClick,
  onSelectLead,
  onSelectCall,
  onOpenDeal,
  onSelectAlert,
  onSelectTeammate,
  roles,
  currentRole,
  onRoleChange,
}: GxWorkspaceGridProps) {
  const dateLabel = useMemo(() => {
    if (!data?.generatedAt) return ''
    const d = new Date(data.generatedAt)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleDateString(localeTag(), { weekday: 'long', day: 'numeric', month: 'long' })
  }, [data?.generatedAt])

  // Page-level states for the single fetch (widgets own their own empty states).
  if (loading && !data) {
    return (
      <div className="gx-ws-page-state" aria-busy="true" aria-live="polite">
        {t('ws.loading', 'Loading your workspace…')}
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="gx-ws-page-state" role="alert">
        <span>{t('ws.error', 'Couldn’t load your workspace.')}</span>
        {onRetry && (
          <button type="button" className="gx-widget-retry" onClick={onRetry}>
            {t('ws.widget.retry', 'Retry')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="gx-ws">
      {/* top meta: date · spacer · sample marker · role switcher */}
      <div className="gx-ws-top">
        {dateLabel && <span className="gx-ws-date">{dateLabel}</span>}
        <span className="gx-ws-top-spacer" />
        {data.sample.length > 0 && (
          <span className="gx-ws-sample">{t('ws.sample', 'Sample data')}</span>
        )}
        {roles && roles.length > 0 && onRoleChange && (
          <select
            className="gx-ws-role"
            aria-label={t('ws.roleSwitch', 'Workspace layout')}
            value={currentRole ?? data.role}
            onChange={(e) => onRoleChange(e.target.value as WorkspaceRole)}
          >
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* KPI strip — reuses KPITile; the Revenue tile carries the single gold sparkline. */}
      <div className="gx-ws-kpis">
        {data.kpis.map((kpi) => (
          <KPITile
            key={kpi.key}
            label={t(kpi.i18nKey, kpi.label)}
            value={kpi.value.toLocaleString(localeTag())}
            unit={kpi.unit}
            {...deltaOf(kpi)}
            chart={
              <GxSparkline data={kpi.spark} variant={kpi.tone === 'gold' ? 'gold' : 'azure'} />
            }
          />
        ))}
      </div>

      {/* focus band — AI daily summary (owns its own .gx-ws-focus wrapper) */}
      <GxFocusBand summary={data.focus.summary} onAsk={onAsk} />

      {/* pipeline spine — 13-stage distribution */}
      <GxPipelineSpine stages={data.pipeline.stages} onStageClick={onStageClick} />

      {/* working zone — left: queue + calls · right: goal + deals + alerts */}
      <div className="gx-ws-work">
        <div className="gx-ws-col">
          <GxQueueWidget items={data.queue} onSelect={onSelectLead} />
          <GxCallsTimeline calls={data.calls} onSelect={onSelectCall} />
        </div>
        <div className="gx-ws-col">
          <GxGoalRing goal={data.goal} />
          <GxDealsWidget deals={data.deals} onOpen={onOpenDeal} />
          <GxAlertList alerts={data.alerts} onSelect={onSelectAlert} />
        </div>
      </div>

      {/* team strip — full-width standings (rank 1 = gold) */}
      <GxStandings team={data.team} onSelect={onSelectTeammate} />
    </div>
  )
}
