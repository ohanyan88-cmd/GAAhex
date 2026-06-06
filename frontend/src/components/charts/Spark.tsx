// Sparkline — hand-rolled SVG polyline.
// Lifted (math + look) from design-system/ui_kits/portal/Views.jsx (lines 17-19),
// generalized to accept a real numeric series instead of a fixed points string.

export interface SparkProps {
  values?: number[]
  color?: string
  width?: number
  height?: number
  strokeWidth?: number
}

// Kit default fallback path so a series-less call still renders something visually consistent
// with the design system reference.
const FALLBACK = '0,18 14,14 28,16 42,8 56,11 70,4 84,9 98,2'

export function Spark({
  values,
  color = 'var(--gx-primary)',
  width = 100,
  height = 22,
  strokeWidth = 1.5,
}: SparkProps) {
  let pts = FALLBACK
  if (values && values.length > 1) {
    const max = Math.max(...values)
    const min = Math.min(...values)
    const range = max - min || 1
    const pad = 2
    const innerH = height - pad * 2
    const innerW = width
    pts = values
      .map((v, i) => {
        const x = (i * innerW) / (values.length - 1)
        const y = height - pad - ((v - min) / range) * innerH
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default Spark
