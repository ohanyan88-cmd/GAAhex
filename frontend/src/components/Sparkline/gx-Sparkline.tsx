// gx-Sparkline — a tiny trend line for KPI tiles (§2 azure live-signal).
// EN: Presentational SVG polyline. Azure by default; the 'gold' variant is the ONE signature
//     accent (used on the Revenue KPI). Tokens-only — the stroke colour comes from CSS classes
//     (.gx-spark / .gx-spark-gold), never an inline hex. Scales to its container via viewBox.
// HY: Presentational SVG polyline։ Լռելյայն azure; 'gold' variant-ը միակ ստորագրային շեշտն է
//     (Revenue KPI-ի վրա)։ Միայն token — stroke-ի գույնը CSS class-ից է, ոչ inline hex։
//     Չափվում է իր container-ին viewBox-ով։

export interface GxSparklineProps {
  /** The series to plot (>= 2 points, else nothing renders). */
  data: number[]
  /** 'gold' = the single signature accent (Revenue); default azure. */
  variant?: 'azure' | 'gold'
  /** Accessible label; when omitted the chart is decorative (aria-hidden). */
  ariaLabel?: string
}

const VIEW_W = 100
const VIEW_H = 28

export function GxSparkline({ data, variant = 'azure', ariaLabel }: GxSparklineProps) {
  if (!Array.isArray(data) || data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const step = VIEW_W / (data.length - 1)
  const points = data
    .map((v, i) => {
      const x = i * step
      const y = VIEW_H - ((v - min) / span) * VIEW_H
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  const cls = variant === 'gold' ? 'gx-spark gx-spark-gold' : 'gx-spark'
  const decorative = !ariaLabel
  return (
    <svg
      className={cls}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : ariaLabel}
    >
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
