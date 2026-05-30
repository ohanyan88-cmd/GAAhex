// Donut — hand-rolled SVG ring with a centre label and a legend.
// Lifted from design-system/ui_kits/portal/interactions.jsx (lines 208-226).
// Math unchanged; TS-typed, props-driven, viz-token defaults for segment colors.

export interface DonutDatum {
  label: string
  value: number
  color?: string
}

export interface DonutProps {
  data: DonutDatum[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerCaption?: string
}

// Categorical viz palette — order matches gaaex-tokens.css --viz-1..8.
const VIZ_FALLBACK = [
  'var(--viz-1)',
  'var(--viz-2)',
  'var(--viz-3)',
  'var(--viz-4)',
  'var(--viz-5)',
  'var(--viz-6)',
  'var(--viz-7)',
  'var(--viz-8)',
]

export function Donut({
  data,
  size = 150,
  thickness = 14,
  centerLabel,
  centerCaption,
}: DonutProps) {
  const total = data.reduce((s, d) => s + (d.value || 0), 0)
  const r = size / 2 - thickness / 2 - 6
  const c = size / 2
  const circ = 2 * Math.PI * r
  let acc = 0

  return (
    <div className="gx-donut">
      <div className="gx-donut-ring" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ transform: 'rotate(-90deg)' }}
          aria-label={centerLabel ? `${centerLabel} ${centerCaption || ''}`.trim() : 'breakdown'}
        >
          {/* Background track */}
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke="var(--gx-surface-2)"
            strokeWidth={thickness}
          />
          {total > 0 &&
            data.map((d, i) => {
              const frac = (d.value || 0) / total
              const dash = frac * circ
              const stroke = d.color || VIZ_FALLBACK[i % VIZ_FALLBACK.length]
              const el = (
                <circle
                  key={i}
                  cx={c}
                  cy={c}
                  r={r}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={thickness}
                  strokeDasharray={`${dash} ${circ - dash}`}
                  strokeDashoffset={-acc * circ}
                />
              )
              acc += frac
              return el
            })}
        </svg>
        {(centerLabel || centerCaption) && (
          <div className="gx-donut-center">
            {centerLabel && <div className="gx-donut-total">{centerLabel}</div>}
            {centerCaption && <div className="gx-donut-cap">{centerCaption}</div>}
          </div>
        )}
      </div>
      <div className="gx-donut-legend">
        {data.map((d, i) => {
          const swatch = d.color || VIZ_FALLBACK[i % VIZ_FALLBACK.length]
          const pct = total > 0 ? Math.round(((d.value || 0) / total) * 100) : 0
          return (
            <div key={i} className="gx-donut-row">
              <span className="gx-donut-dot" style={{ background: swatch }} />
              <span className="gx-donut-name" title={d.label}>
                {d.label}
              </span>
              <span className="gx-donut-pct">{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Donut
