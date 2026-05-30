// metrics.ts — Home dashboard time-series endpoints. One thin helper per series so the
// view doesn't have to know route paths or response shapes.

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

export type RevenueRange = '30d' | 'qtd' | 'ytd'

/** One month bucket from /api/metrics/revenue. Money is luma; divide by 100 for display. */
export type RevenueBucket = {
  month: string      // 'YYYY-MM'
  revenue: number    // luma
  churn: number      // count of cancelled subscriptions in that month
}

export type RevenueSeries = {
  range: RevenueRange
  buckets: RevenueBucket[]
}

/**
 * GET /api/metrics/revenue?range=... — throws on non-2xx so callers can hide the widget.
 * 403 (invoice.view missing) and 5xx both bubble as Error.
 */
export async function fetchRevenueSeries(token: string, range: RevenueRange): Promise<RevenueSeries> {
  const r = await fetch(`${BASE}/api/metrics/revenue?range=${encodeURIComponent(range)}`, {
    headers: authH(token),
  })
  if (!r.ok) throw new Error(`metrics.revenue ${r.status}`)
  const data = await r.json()
  if (!data || !Array.isArray(data.buckets)) throw new Error('metrics.revenue: bad shape')
  return data as RevenueSeries
}
