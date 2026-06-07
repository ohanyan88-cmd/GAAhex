import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowRightIcon, TrashIcon } from './icons'
import { Button } from '../primitives'

export type TopbarItem = { title: string; body?: string; time?: string }

// A topbar icon (Email / Messenger) that opens a small popover — a few recent items
// (scrollable) with the same footer as the bell: "Clear all" (clears the view only, no
// delete) + "View all" (into Communications). Outside-click + Escape close.
export default function TopbarMenu({ icon, itemIcon, title, emptyLabel, viewAllLabel, onViewAll, items = [] }: {
  icon: ReactNode
  itemIcon?: ReactNode
  title: string
  emptyLabel: string
  viewAllLabel: string
  onViewAll: () => void
  items?: TopbarItem[]
}) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<TopbarItem[]>(items)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Re-fill from the source whenever the popover is opened (Clear all only empties the view).
  useEffect(() => { if (open) setList(items) }, [open])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="tb-pop-wrap" ref={wrapRef}>
      <button
        className={'tb-icon' + (open ? ' on' : '')}
        aria-label={title}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open && (
        <div className="tb-pop" role="menu">
          <div className="tb-pop-head">{title}</div>
          {list.length === 0 ? (
            <div className="tb-pop-empty">{emptyLabel}</div>
          ) : (
            <div className="tb-pop-list">
              {list.map((it, i) => (
                <button key={i} type="button" className="tb-pop-item" onClick={() => { setOpen(false); onViewAll() }}>
                  {itemIcon && <span className="tb-pop-item-ic">{itemIcon}</span>}
                  <span className="tb-pop-item-main">
                    <span className="tb-pop-item-title">{it.title}</span>
                    {it.body && <span className="tb-pop-item-body">{it.body}</span>}
                    {it.time && <span className="tb-pop-item-time">{it.time}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="notif-foot">
            <Button variant="ghost" size="sm" onClick={() => setList([])} disabled={list.length === 0}>
              <TrashIcon size={13} />Clear all
            </Button>
            <span className="spacer" />
            <Button variant="ghost" size="sm" onClick={() => { setOpen(false); onViewAll() }}>
              {viewAllLabel}<ArrowRightIcon size={13} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
