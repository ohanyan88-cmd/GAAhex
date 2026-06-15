import type { CSSProperties, ReactNode } from 'react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../lib/useFocusTrap'

// Overlay — the single portal/overlay primitive every modal-family component sits on:
// a body-portaled backdrop (--z-modal) + a focus-trapped panel with Esc-to-close, click-outside,
// and body scroll-lock. Theme-aware and reduced-motion aware.

// One-modal-at-a-time guard (§7/§8 — no ad-hoc stacking): ref-count open overlays so the body
// scroll-lock engages on the FIRST overlay and releases only when the LAST one closes. Without this,
// each Overlay restored overflow on its own unmount — stacking (e.g. a confirmDialog over a Modal)
// would leave the page scroll-unlocked while a modal was still open, or locked with none open.
let _openOverlays = 0
let _bodyOverflowBeforeLock = ''

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

  // lock background scroll while open — ref-counted so stacked overlays don't fight over it
  useEffect(() => {
    if (_openOverlays === 0) {
      _bodyOverflowBeforeLock = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    _openOverlays++
    return () => {
      _openOverlays--
      if (_openOverlays === 0) document.body.style.overflow = _bodyOverflowBeforeLock
    }
  }, [])

  return createPortal(
    <div
      className={backdropClassName}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
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
