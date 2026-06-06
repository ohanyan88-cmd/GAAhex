// DR-1 — <StudioDrawer> primitive.
//
// Studio panes (EntitiesPane, NotificationsPane, WebhooksPane) all hand-rolled the
// same right-edge drawer chrome:
//   <div onClick={...closeOnBackdrop} style={{position:'fixed',inset:0,background:'var(--gx-overlay)',zIndex:100,...}}>
//     <div style={{borderLeft, width, height:'100vh', overflowY:'auto', padding, boxShadow}}>
//       <div className="row" style={{alignItems:'center', marginBottom: 'var(--gx-space-6)'}}>
//         <h3>{title}</h3><span className="spacer"/>
//         <button className="btn btn-ghost btn-sm" onClick={onClose}><CloseIcon/></button>
//       </div>
//       {children}
//     </div>
//   </div>
//
// This primitive collapses that into one component, built on the same
// <Overlay/> + .gx-scrim primitives as <Modal/>. It owns: portal, focus trap,
// Esc-to-close, click-outside-to-close, body scroll lock, the close icon
// button, and the standard title row.
//
// API contract (matches <Modal/>):
//   - The drawer header renders the close ✕ button. Callers MUST NOT add
//     another inside `children`.
//   - `actions` is an optional ReactNode rendered to the right of the title
//     (e.g. "Save", "Delete" pill, status select). It sits in the same row
//     as the close button.
//   - `bodyPadding` defaults to `'18px 20px'`; pass `'0'` for full-bleed
//     children that render their own padded sections.
//   - `width` is a CSS length (default `'min(720px, 100%)'`).
import type { CSSProperties, ReactNode } from 'react'
import { useId } from 'react'
import Overlay from '../components/Overlay'
import { CloseIcon } from '../components/icons'

export type StudioDrawerProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Optional element placed to the right of the title (e.g. a Save button). */
  actions?: ReactNode
  /** Drawer panel content. */
  children: ReactNode
  /** Override the default `min(720px, 100%)` width. */
  width?: string
  /** Override the default `'18px 20px'` body padding. Pass `'0'` for flush. */
  bodyPadding?: CSSProperties['padding']
}

export function StudioDrawer({
  open,
  onClose,
  title,
  actions,
  children,
  width = 'min(720px, 100%)',
  bodyPadding = '18px 20px',
}: StudioDrawerProps) {
  const titleId = useId()
  if (!open) return null

  // `bare` tells Overlay to skip the `.gx-dialog` wrapper so we render the
  // drawer-specific panel ourselves. Width and full-height come from inline
  // style; the rest of the chrome (border, surface, shadow) lives in CSS via
  // `.gx-drawer` so light/dark themes work without re-binding tokens here.
  const panelStyle: CSSProperties = {
    width,
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
  }

  return (
    <Overlay
      onClose={onClose}
      backdropClassName="gx-scrim right"
      className="gx-drawer"
      labelledBy={titleId}
      style={panelStyle}
      bare
    >
      <div className="drawer-head" style={{ alignItems: 'center', gap: 'var(--gx-space-5)' }}>
        <h3
          id={titleId}
          style={{ margin: 0, fontSize: 'var(--gx-text-md)', fontWeight: 600, color: 'var(--gx-text-1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {title}
        </h3>
        {actions}
        <button
          type="button"
          className="tb-icon"
          aria-label="Close drawer"
          onClick={onClose}
        >
          <CloseIcon size={16} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: bodyPadding, minHeight: 0 }}>
        {children}
      </div>
    </Overlay>
  )
}

export default StudioDrawer
