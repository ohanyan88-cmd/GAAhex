// Dashboard-local types and constants shared between charts.tsx and the
// DashboardView coordinator.

export type Range = '7d' | '30d' | 'qtd' | 'ytd'

export function sinceDate(r: Range): string {
  const now = new Date()
  if (r === '7d')  { const d = new Date(now); d.setDate(d.getDate() - 7);  return d.toISOString().slice(0, 10) }
  if (r === '30d') { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) }
  if (r === 'qtd') { const q = Math.floor(now.getMonth() / 3) * 3; return new Date(now.getFullYear(), q, 1).toISOString().slice(0, 10) }
  return new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10)
}

// D18: distinct-identity palette (plan slices, lead sources, sankey nodes) →
// categorical viz palette --viz-1..--viz-8 (locked, color-blind aware). Raw
// Tier-0 azure + inline hex both violated D18; all routed through viz tokens.
export const PLAN_COLORS = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-5)', 'var(--viz-4)', 'var(--viz-7)']
