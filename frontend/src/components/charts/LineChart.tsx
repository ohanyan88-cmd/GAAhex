// LineChart — hand-rolled SVG polyline with optional area fill.
// Lifted from design-system/ui_kits/portal/interactions.jsx (lines 227-242).
// Math unchanged; TS-typed, supports multiple series, dashed line, and gridlines.

export interface LineSeries {
  label: string
  values: number[]
  color?: string
  dashed?: boolean
  fillUnder?: boolean
}

export interface LineChartProps {
  series: LineSeries[]
  height?: number
  showArea?: boolean
  showLegend?: boolean
}

export function LineChart({
  series,
  height = 170,
  showArea = true,
  showLegend = true,
}: LineChartProps) {
  const W = 480
  const H = height
  const pad = 8
  const allValues = series.flatMap((s) => s.values)
  const safeMax = allValues.length ? Math.max(...allValues) : 1
  const max = safeMax * 1.1 || 1
  const lengths = series.map((s) => s.values.length).filter((n) => n > 1)
  const refLen = lengths.length ? Math.max(...lengths) : 1

  const x = (i: number, n: number) => pad + (i * (W - pad * 2)) / Math.max(n - 1, 1)
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2)

  return (
    <div className="gx-linechart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height }}
        preserveAspectRatio="none"
        aria-hidden
      >
        {/* Gridlines (4 horizontals @ 25/50/75/100%) */}
        {[0.25, 0.5, 0.75, 1].map((g, i) => (
          <line
            key={i}
            x1={pad}
            x2={W - pad}
            y1={H - pad - g * (H - pad * 2)}
            y2={H - pad - g * (H - pad * 2)}
            stroke="var(--gx-border-subtle)"
            strokeWidth="1"
          />
        ))}
        {series.map((s, si) => {
          if (!s.values.length) return null
          const pts = s.values
            .map((v, i) => `${x(i, Math.max(s.values.length, refLen))},${y(v)}`)
            .join(' ')
          const lastX = x(s.values.length - 1, Math.max(s.values.length, refLen))
          const area = `${pad},${H - pad} ${pts} ${lastX},${H - pad}`
          const stroke = s.color || `var(--viz-${(si % 8) + 1})`
          const wantsArea = showArea && (s.fillUnder ?? si === 0)
          return (
            <g key={si}>
              {wantsArea && <polygon points={area} fill={stroke} opacity="0.10" />}
              <polyline
                points={pts}
                fill="none"
                stroke={stroke}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={s.dashed ? '4 4' : undefined}
              />
            </g>
          )
        })}
      </svg>
      {showLegend && (
        <div className="gx-linechart-legend">
          {series.map((s, si) => (
            <span key={si} className="gx-linechart-legend-item">
              <span
                className="gx-linechart-legend-dot"
                style={{
                  background: s.color || `var(--viz-${(si % 8) + 1})`,
                  opacity: s.dashed ? 0.7 : 1,
                }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default LineChart
