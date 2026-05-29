import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../lib/useFocusTrap'

// Overlay — the single portal/overlay primitive every modal-family component sits on:
// a body-portaled backdrop (--z-modal) + a focus-trapped panel with Esc-to-close, click-outside,
// and body scroll-lock. Theme-aware (inherits the :root / [data-theme] CSS vars) and
// reduced-motion aware (animations collapse via the global media query).
export default function Overlay({ onClose, children, className = '', labelledBy, role = 'dialog' }: {
  onClose: () => void
  children: ReactNode
  className?: string
  labelledBy?: string
  role?: string
}) {
  const ref = useFocusTrap<HTMLDivElement>(onClose)

  // lock background scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return createPortal(
    <div
      className="overlay-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={ref}
        className={'overlay-panel ' + className}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
