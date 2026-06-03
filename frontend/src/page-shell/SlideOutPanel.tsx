// SlideOutPanel — universal right-side drawer.
//
// Spec (Gev, 2026-06-03): hidden by default, slides in from the right when
// any chart slice / chip / table row in the NMS dashboard is clicked. The
// drawer body is context-aware — caller hands it whatever JSX is appropriate
// for the asset class that was clicked.
//
// Styling: `.nms-drawer-*` classes in `styles/nms-tokens.css`.
// Behavior:
//   - Open state lifted to the caller (controlled component).
//   - ESC closes.
//   - Overlay click closes (unless `dismissible={false}`).
//   - Body scroll is locked while open.
//   - Animation: 280ms ease, transform-only — no layout shift.
import { useEffect } from 'react'

export interface SlideOutPanelProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  /** When false, overlay clicks don't dismiss. ESC still closes. Default true. */
  dismissible?: boolean
  /** Optional small subtitle under the title (e.g. asset class label). */
  subtitle?: string
}

export function SlideOutPanel({
  open, onClose, title, children, dismissible = true, subtitle,
}: SlideOutPanelProps) {
  // Lock body scroll while drawer is open. Restores prior overflow on close.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // ESC to close.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      <div
        className={'nms-drawer-overlay' + (open ? ' is-open' : '')}
        onClick={dismissible ? onClose : undefined}
        aria-hidden={!open}
      />
      <aside
        className={'nms-drawer' + (open ? ' is-open' : '')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nms-drawer-title"
        aria-hidden={!open}
      >
        <div className="nms-drawer-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div id="nms-drawer-title" className="nms-drawer-title">{title}</div>
            {subtitle && (
              <div style={{ fontSize: 11, color: 'var(--nms-text-3)' }}>{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            className="nms-drawer-close"
            onClick={onClose}
            aria-label="Close drawer"
          >
            ✕
          </button>
        </div>
        <div className="nms-drawer-body">
          {children}
        </div>
      </aside>
    </>
  )
}
