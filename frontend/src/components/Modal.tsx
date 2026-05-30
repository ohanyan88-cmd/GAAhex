import type { ReactNode, CSSProperties } from 'react'
import { useEffect, useId, useState } from 'react'
import Overlay from './Overlay'
import { CloseIcon } from './icons'

export type ModalSize = 'sm' | 'md' | 'lg' | 'fullscreen'

// PROMPT 9 — Modal now renders with the design-kit `.gx-scrim` + `.gx-dialog` chrome.
// Public API is UNCHANGED (open/onClose/title/size/children/footer). Sizing maps to the
// kit's max-width pattern (kit `.gx-dialog` is width:100% with a max-width on the panel).
const SIZE_MAX: Record<ModalSize, number | undefined> = {
  sm: 420,
  md: 560,
  lg: 860,
  fullscreen: undefined, // fullscreen → no max, the .gx-dialog-fullscreen class fills the scrim
}

// Modal — built on the Overlay primitive. Kit chrome: scrim backdrop, .gx-dialog panel,
// .gx-dialog-head title row, scrollable body, optional footer row with border-top.
export function Modal({ open, onClose, title, size = 'md', children, footer }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  size?: ModalSize
  children: ReactNode
  footer?: ReactNode
}) {
  const titleId = useId()
  if (!open) return null
  const maxW = SIZE_MAX[size]
  const panelStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: size === 'fullscreen' ? '100%' : 'calc(100vh - 48px)',
    ...(maxW ? { maxWidth: maxW } : { width: '100%', height: '100%', maxHeight: '100%' }),
  }
  return (
    <Overlay
      onClose={onClose}
      backdropClassName="gx-scrim"
      className={`gx-dialog modal-${size}`}
      labelledBy={titleId}
      bare
    >
      <div style={panelStyle}>
        <div className="gx-dialog-head">
          <h3 id={titleId} style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--gx-text-1)' }}>{title}</h3>
          <span style={{ flex: 1 }} />
          <button type="button" className="tb-icon" aria-label="Close" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </div>
        <div style={{ padding: '18px 20px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {children}
        </div>
        {footer && (
          <div style={{
            display: 'flex',
            gap: 10,
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
        <>
          <button className="btn btn-ghost btn-md" onClick={() => close(false)}>{opts.cancelLabel ?? 'Cancel'}</button>
          <button className={'btn btn-md ' + (opts.danger ? 'btn-danger' : 'btn-primary')} onClick={() => close(true)}>
            {opts.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, color: 'var(--gx-text-2)', fontSize: 13, lineHeight: 1.5 }}>{opts.message}</p>
    </Modal>
  )
}
