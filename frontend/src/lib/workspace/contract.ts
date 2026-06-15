// Workspace data contract — the SINGLE typed shape returned by GET /api/workspace?role=.
// EN: One real fetch feeds every workspace widget (§11 one-layer). The backend builds this; the
//     frontend gx-WorkspaceGrid distributes it to the zone widgets. Q2 (owner 2026-06-15):
//     contract-true SEEDED — real values where available; any sample/derived field is listed in
//     `sample[]` so the UI can mark it and Phase 3 can swap it to live. No fake-as-real.
// HY: Մեկ real fetch-ը սնում է բոլոր workspace widget-երը (§11 one-layer)։ Backend-ը կառուցում է
//     սա, frontend gx-WorkspaceGrid-ը բաշխում է zone widget-երին։ Q2 (owner 2026-06-15)՝
//     contract-true SEEDED — real արժեքներ որտեղ կա, sample/derived դաշտը նշված է `sample[]`-ում,
//     որ UI-ը մակնշի ու Phase 3-ը live դարձնի։ Ոչ մի fake-as-real։
import type { WorkspaceRole } from './registry'

/** Period-over-period trend for a KPI tile (drives arrow + semantic colour). */
export interface WsTrend {
  dir: 'up' | 'down' | 'flat'
  /** percentage change vs the prior comparable period. */
  pct: number
}

/** A KPI tile. `tone: 'gold'` marks the ONE signature accent per view (Revenue). */
export interface WsKpi {
  key: string
  /** English default; gx-WorkspaceGrid wraps with t(i18nKey, label). */
  label: string
  i18nKey: string
  value: number
  unit?: string
  trend?: WsTrend
  /** sparkline series (azure live-signal). */
  spark: number[]
  tone?: 'default' | 'gold'
}

/** One stage in the 13-stage Lead→Customer pipeline spine. */
export interface WsPipelineStage {
  key: string
  label: string
  i18nKey: string
  count: number
  /** 'active' = azure (Deal) · 'peak' = gold (Activation) · 'default' = slate. */
  tone: 'default' | 'active' | 'peak'
}

export type WsSourceTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

/** A lead in the priority queue (avatar · source badge · next-action · score). */
export interface WsQueueItem {
  id: string
  name: string
  avatarUrl?: string | null
  source: string
  sourceTone: WsSourceTone
  nextAction: string
  /** 0–100 lead score. */
  score: number
}

/** A scheduled touchpoint in today's calls timeline. */
export interface WsCall {
  id: string
  /** ISO datetime. */
  at: string
  name: string
  kind: 'call' | 'meeting' | 'followup'
  done?: boolean
}

/** Weekly goal ring (SVG progress). */
export interface WsGoal {
  label: string
  i18nKey: string
  current: number
  target: number
  /** 0–100. */
  pct: number
}

/** A deal waiting on action (rendered as an action card). */
export interface WsDeal {
  id: string
  name: string
  value: number
  stage: string
  waitingFor: string
  /** human age, e.g. '3d'. */
  age: string
}

/** A workspace alert (semantic dot; `critical` pulses). */
export interface WsAlert {
  id: string
  severity: 'info' | 'warning' | 'danger'
  text: string
  /** ISO datetime. */
  at: string
  critical?: boolean
}

/** A team-standings row (rank 1 = gold). */
export interface WsStanding {
  rank: number
  name: string
  avatarUrl?: string | null
  /** conversion %. */
  conversion: number
  revenue: number
  /** 0–100 relative bar fill. */
  barPct: number
}

/** The complete workspace payload for one role. */
export interface WorkspaceData {
  role: WorkspaceRole
  label: string
  source: 'override' | 'primary' | 'derived' | 'fallback'
  /** ISO datetime the payload was built. */
  generatedAt: string
  /** AI daily-summary line (ASK ME flavour). */
  focus: { summary: string }
  /** exactly 4 KPI tiles. */
  kpis: WsKpi[]
  /** the 13-stage pipeline distribution. */
  pipeline: { stages: WsPipelineStage[] }
  queue: WsQueueItem[]
  calls: WsCall[]
  goal: WsGoal
  deals: WsDeal[]
  alerts: WsAlert[]
  team: WsStanding[]
  /**
   * Q2 marker: dot-paths of fields whose values are sample/derived, not yet live
   * (e.g. 'kpis.conversion.spark', 'team', 'goal'). Drives a subtle "sample" hint in the UI and
   * tracks the Phase 3 live-swap. Empty array once everything is wired to live queries.
   */
  sample: string[]
}
