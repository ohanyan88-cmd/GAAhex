import type { CSSProperties, ReactNode } from 'react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../lib/useFocusTrap'

// Overlay — the single portal/overlay primitive every modal-family component sits on:
// a body-portaled backdrop (--z-modal) + a focus-trapped panel with Esc-to-close, click-outside,
// and body scroll-lock. Theme-aware and reduced-motion aware.
export default function Overlay({
  onClose,
  children,
  className = '',
  labelledBy,
  role = 'dialog',
  backdropClassName = 'gx-scrim',
  bare = false,
  style,
}: {
  onClose: () => void
  children: ReactNode
  className?: string
  labelledBy?: string
  role?: string
  backdropClassName?: string
  bare?: boolean
  /** Inline style applied to the dialog panel — used by Modal to enforce
   * a constrained maxWidth that overrides the .gx-dialog `width:100%` default. */
  style?: CSSProperties
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
      className={backdropClassName}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={ref}
        className={(bare ? '' : 'gx-dialog ') + className}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        style={style}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
