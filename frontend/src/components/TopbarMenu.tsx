import { useState, type ReactNode } from 'react'
import { ArrowRightIcon } from './icons'

// A topbar icon (Email / Messenger) that opens a small popover — quick preview now
// (empty state until a backend feeds it) with a "View all" link into Communications.
export default function TopbarMenu({ icon, title, emptyLabel, viewAllLabel, onViewAll }: {
  icon: ReactNode
  title: string
  emptyLabel: string
  viewAllLabel: string
  onViewAll: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="tb-pop-wrap">
      <button
        className="tb-icon"
        aria-label={title}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open && (
        <>
          <button type="button" className="tb-lang-backdrop" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="tb-pop" role="menu">
            <div className="tb-pop-head">{title}</div>
            <div className="tb-pop-empty">{emptyLabel}</div>
            <button type="button" className="tb-pop-foot" onClick={() => { onViewAll(); setOpen(false) }}>
              <span>{viewAllLabel}</span>
              <ArrowRightIcon size={14} aria-hidden />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
