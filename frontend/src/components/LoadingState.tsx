// LoadingState — polished, kind-driven loading indicator for the app shell.
//
// Three flavors covering the loading patterns the views actually use:
//   - kind="rows"   (default): skeleton list with 3–5 shimmering rows. Best
//                              inside a card/table where layout is row-based.
//   - kind="card":             centered spinner inside a padded card. Best
//                              when a whole section is gated on one fetch.
//   - kind="inline":           tiny spinner + inline label. Best inside
//                              toolbars / status strips where vertical space
//                              is constrained.
//
// CSS reused from the existing design system:
//   - `.skel` + shimmer keyframe live in `_addendum.css`.
//   - `.empty-state` is the project's state-card surface from `_states.css`.
//   - `SpinnerIcon` already wires its own keyframe inline, so we don't need
//     extra animation CSS here.
//
// NOTE: this is a NEW helper alongside the legacy `LoadingState` in
// `components/States.tsx`. The legacy one (`<LoadingState />` with optional
// `message`) stays untouched so the dozens of existing callers don't move.
// New code should reach for THIS one when it wants the richer `kind` API.
import { SpinnerIcon } from './icons'

type Kind = 'card' | 'rows' | 'inline'

interface Props {
  kind?: Kind
  /** Optional override label. Falls back to a kind-appropriate default. */
  label?: string
  /** Number of skeleton rows when `kind="rows"`. Clamped to 1–8. Default 4. */
  rows?: number
}

export default function LoadingState({ kind = 'rows', label, rows = 4 }: Props) {
  if (kind === 'inline') {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-busy="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--gx-space-3)',
          fontSize: 'var(--gx-text-sm)',
          color: 'var(--gx-text-3)',
        }}
      >
        <SpinnerIcon size={12} />
        <span>{label ?? 'Loading…'}</span>
      </span>
    )
  }

  if (kind === 'card') {
    return (
      <div
        className="empty-state"
        role="status"
        aria-live="polite"
        aria-busy="true"
        style={{ borderStyle: 'solid' }}
      >
        <SpinnerIcon size={24} />
        <p style={{ margin: 0, fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)' }}>
          {label ?? 'Loading…'}
        </p>
      </div>
    )
  }

  // kind === 'rows'
  const n = Math.max(1, Math.min(8, rows))
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label ?? 'Loading…'}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-3)', padding: '12px 0' }}
    >
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)' }}>
          <div className="skel" style={{ height: 12, width: i % 3 === 0 ? '60%' : '90%' }} />
          {i % 2 === 0 && (
            <div className="skel" style={{ height: 8, width: '40%' }} />
          )}
        </div>
      ))}
    </div>
  )
}
