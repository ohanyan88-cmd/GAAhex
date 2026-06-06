import type { ReactNode, CSSProperties } from 'react'
import { useEffect, useId, useState } from 'react'
import Overlay from './Overlay'
import { CloseIcon } from './icons'
import { Button } from '../primitives'  // T-P3-7

export type ModalSize = 'sm' | 'md' | 'lg' | 'fullscreen'

// Constrained kit widths — no more full-bleed `lg` with dead space on the right.
// The kit RecordModal/RecordDrawer pattern caps detail panels at ~520–640px; we
// follow the same scale here so every Modal caller benefits from one fix.
const SIZE_MAX: Record<ModalSize, number | undefined> = {
  sm: 420,
  md: 560,
  lg: 640,
  fullscreen: undefined,
}

// Modal — built on the Overlay primitive. Kit chrome: scrim backdrop, .gx-dialog panel,
// .gx-dialog-head title row, scrollable body, optional footer row with border-top.
//
// API contract (Modal owns the close affordance — callers must NOT add another):
//   - The HEADER renders the ONE ✕ close button. Callers MUST NOT pass a "Close"
//     button in `footer` — that was the source of the "3 redundant close buttons"
//     bug. The footer is for ACTIONS (Cancel + Save, Resolve, Confirm, etc.).
//   - `subtitle` adds a secondary line under the title (e.g. record id, customer).
//   - `hero` is an optional richer header block rendered below the title row —
//     for status pills + meta inline with the title.
export function Modal({ open, onClose, title, subtitle, size = 'md', children, footer, hero }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  size?: ModalSize
  children: ReactNode
  footer?: ReactNode
  hero?: ReactNode
}) {
  const titleId = useId()
  if (!open) return null
  const maxW = SIZE_MAX[size]
  // The outer .gx-dialog wrapper (from Overlay) has CSS `width:100%` which
  // would blow out our constraint — explicitly cap it here so the dialog
  // doesn't stretch full-bleed. Inner panel is just a flex column.
  const wrapperStyle: CSSProperties = maxW
    ? { width: '100%', maxWidth: maxW }
    : { width: '100%', height: '100%' }
  const panelStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: size === 'fullscreen' ? '100%' : 'calc(100vh - 48px)',
    width: '100%',
  }
  return (
    <Overlay
      onClose={onClose}
      backdropClassName="gx-scrim"
      className="gx-dialog"
      labelledBy={titleId}
      style={wrapperStyle}
      bare
    >
      <div style={panelStyle}>
        <div className="gx-dialog-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-1)', minWidth: 0, flex: 1 }}>
            <h3 id={titleId} style={{ margin: 0, fontSize: 'var(--gx-text-md)', fontWeight: 600, color: 'var(--gx-text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h3>
            {subtitle && (
              <div style={{ fontSize: 11.5, color: 'var(--gx-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {subtitle}
              </div>
            )}
          </div>
          <button type="button" className="tb-icon" aria-label="Close" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </div>
        {hero && (
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gx-border-subtle)', background: 'var(--gx-surface-2)', flexShrink: 0 }}>
            {hero}
          </div>
        )}
        <div style={{ padding: '18px 20px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {children}
        </div>
        {footer && (
          <div style={{
            display: 'flex',
            gap: 'var(--gx-space-5)',
            justifyContent: 'flex-end',
            padding: '12px 20px',
            borderTop: '1px solid var(--gx-border-subtle)',
            background: 'var(--gx-surface-2)',
          }}>
            {footer}
          </div>
        )}
      </div>
    </Overlay>
  )
}

// MO-6 — ModalFooterActions. Every Modal caller used to copy-paste the same
// "Cancel + primary action" button pair. This helper standardizes the
// footer-row markup so a future style change (Cancel goes from `btn-ghost`
// to `btn-secondary`, primary becomes loading-spinner-aware, etc.) lands in
// one place. Pass into Modal's `footer` prop.
export function ModalFooterActions({
  onCancel,
  onConfirm,
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  confirmDisabled = false,
  danger = false,
}: {
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  cancelLabel?: string
  confirmLabel?: string
  confirmDisabled?: boolean
  /** Use the danger variant on the primary button (red — for destructive flows). */
  danger?: boolean
}) {
  return (
    <>
      <Button variant="ghost" size="md" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button
        variant={danger ? 'danger' : 'primary'}
        size="md"
        disabled={confirmDisabled}
        onClick={() => { void onConfirm() }}
      >
        {confirmLabel}
      </Button>
    </>
  )
}


// ── confirmDialog: a promise-based confirm that replaces window.confirm ──────────────────────────
export type ConfirmOptions = {
  title?: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}
type ConfirmRequest = { opts: ConfirmOptions; resolve: (ok: boolean) => void }

let confirmListener: ((req: ConfirmRequest) => void) | null = null

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!confirmListener) {
      // host not mounted — degrade to the native confirm rather than hang
      resolve(window.confirm(typeof opts.message === 'string' ? opts.message : 'Are you sure?'))
      return
    }
    confirmListener({ opts, resolve })
  })
}

// Mount ONCE (e.g. in main.tsx). Renders the active confirm request as a Modal.
// Picks up the PROMPT 9 kit chrome automatically via the refactored <Modal/>.
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null)

  useEffect(() => {
    confirmListener = (r) => setReq(r)
    return () => { confirmListener = null }
  }, [])

  if (!req) return null
  const close = (ok: boolean) => { req.resolve(ok); setReq(null) }
  const { opts } = req

  return (
    <Modal
      open
      onClose={() => close(false)}
      title={opts.title ?? 'Confirm'}
      size="sm"
      footer={
        <ModalFooterActions
          onCancel={() => close(false)}
          onConfirm={() => close(true)}
          cancelLabel={opts.cancelLabel}
          confirmLabel={opts.confirmLabel ?? 'Confirm'}
          danger={!!opts.danger}
        />
      }
    >
      <p style={{ margin: 0, color: 'var(--gx-text-2)', fontSize: 'var(--gx-text-13)', lineHeight: 1.5 }}>{opts.message}</p>
    </Modal>
  )
}
