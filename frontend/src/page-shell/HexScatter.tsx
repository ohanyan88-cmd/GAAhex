import { useMemo } from 'react'

// Aurora-Glass signature: a faint, RANDOM hexagon scatter — unique per page mount, so no
// two screens feel identical (Brand v3.0 §2). Brand-hued via tokens; the geometry (size /
// position / rotation) is generated per instance — the documented dynamic-geometry case,
// like the chart SVGs. Decorative only: aria-hidden + pointer-events:none, sits below the
// glass surfaces (z-index 0).
const HUES = ['var(--gx-cobalt)', 'var(--gx-interactive)', 'var(--gx-gold)', 'var(--gx-interactive)']

export function HexScatter({ count = 16 }: { count?: number }) {
  const hexes = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        size: Math.round(40 + Math.random() * 200),
        left: Math.random() * 100,
        top: Math.random() * 100,
        opacity: 0.04 + Math.random() * 0.08,
        rotate: Math.round(Math.random() * 60),
        filled: Math.random() < 0.28,
        stroke: 1.5 + Math.random(),
        hue: HUES[Math.floor(Math.random() * HUES.length)],
      })),
    [count],
  )

  return (
    <div className="ps-hexscatter" aria-hidden="true">
      {hexes.map((h, i) => (
        <svg
          key={i}
          width={h.size}
          height={h.size}
          viewBox="0 0 100 100"
          style={{
            left: `${h.left}%`,
            top: `${h.top}%`,
            opacity: h.opacity,
            transform: `translate(-50%, -50%) rotate(${h.rotate}deg)`,
          }}
        >
          <polygon
            points="50,3 93,27 93,73 50,97 7,73 7,27"
            fill={h.filled ? h.hue : 'none'}
            stroke={h.hue}
            strokeWidth={h.stroke}
          />
        </svg>
      ))}
    </div>
  )
}
