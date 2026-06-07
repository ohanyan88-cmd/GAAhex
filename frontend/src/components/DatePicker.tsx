import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, CalendarIcon } from './icons'

// DatePicker — a token-styled calendar that replaces the browser-native <input type="date">.
// Value is an ISO `yyyy-mm-dd` string (same as the native input), so callers/storage are
// unchanged. The popover is positioned `fixed` (anchored to the control) and opened on the
// next tick — same approach as the Select dropdown, so it floats above a modal's overflow
// and the opening click can't land on a day cell.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function pad(n: number): string { return n < 10 ? `0${n}` : String(n) }
function toISO(y: number, m: number, d: number): string { return `${y}-${pad(m + 1)}-${pad(d)}` }
function parseISO(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) }
}
function fmtDisplay(s: string): string {
  const p = parseISO(s)
  if (!p) return ''
  return `${MONTHS[p.m].slice(0, 3)} ${p.d}, ${p.y}`
}

function anchorRect(el: HTMLElement | null): CSSProperties | undefined {
  if (!el) return undefined
  const r = el.getBoundingClientRect()
  return { position: 'fixed', top: r.bottom + 4, left: r.left }
}

export function DatePicker({ value, onChange, placeholder = 'Select date…' }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties | undefined>(undefined)
  const ctrlRef = useRef<HTMLDivElement>(null)

  const now = new Date()
  const sel = parseISO(value)
  // The month currently shown in the grid — defaults to the selected date, else this month.
  const [view, setView] = useState<{ y: number; m: number }>(
    sel ? { y: sel.y, m: sel.m } : { y: now.getFullYear(), m: now.getMonth() },
  )

  function openCal() {
    setPos(anchorRect(ctrlRef.current))
    setView(sel ? { y: sel.y, m: sel.m } : { y: now.getFullYear(), m: now.getMonth() })
    setTimeout(() => setOpen(true), 0)
  }
  function toggle() { if (open) setOpen(false); else openCal() }
  function pick(y: number, m: number, d: number) { onChange(toISO(y, m, d)); setOpen(false) }

  // 6×7 grid of day cells (with leading/trailing spill days from adjacent months, dimmed).
  const cells = useMemo(() => {
    const startDow = new Date(view.y, view.m, 1).getDay()       // 0 = Sunday
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
    const daysInPrev = new Date(view.y, view.m, 0).getDate()
    const out: Array<{ y: number; m: number; d: number; cur: boolean }> = []
    // leading spill — tail of the previous month
    const pm = view.m === 0 ? 11 : view.m - 1
    const py = view.m === 0 ? view.y - 1 : view.y
    for (let i = startDow - 1; i >= 0; i--) out.push({ y: py, m: pm, d: daysInPrev - i, cur: false })
    // current month
    for (let d = 1; d <= daysInMonth; d++) out.push({ y: view.y, m: view.m, d, cur: true })
    // trailing spill — head of the next month, padded to a full 6-week grid
    const nm = view.m === 11 ? 0 : view.m + 1
    const ny = view.m === 11 ? view.y + 1 : view.y
    let nd = 1
    while (out.length < 42) out.push({ y: ny, m: nm, d: nd++, cur: false })
    return out
  }, [view])

  function step(delta: number) {
    setPos(anchorRect(ctrlRef.current))
    setView((v) => {
      const m = v.m + delta
      if (m < 0) return { y: v.y - 1, m: 11 }
      if (m > 11) return { y: v.y + 1, m: 0 }
      return { y: v.y, m }
    })
  }

  const todayISO = toISO(now.getFullYear(), now.getMonth(), now.getDate())

  return (
    <div className="dp">
      <div
        ref={ctrlRef}
        className="inp inp-md dp-control"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
      >
        <span className={value ? '' : 'dp-ph'}>{value ? fmtDisplay(value) : placeholder}</span>
        <CalendarIcon size={15} className="dp-cal-icon" />
      </div>
      {open && (
        <>
          <button type="button" className="dp-backdrop" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="dp-pop" style={pos}>
            <div className="dp-head">
              <span className="dp-title">{MONTHS[view.m]} {view.y}</span>
              <div className="dp-nav">
                <button type="button" className="dp-nav-btn" aria-label="Previous month" onClick={() => step(-1)}>
                  <ChevronLeftIcon size={16} />
                </button>
                <button type="button" className="dp-nav-btn" aria-label="Next month" onClick={() => step(1)}>
                  <ChevronRightIcon size={16} />
                </button>
              </div>
            </div>
            <div className="dp-weekdays">
              {WEEKDAYS.map((w) => <span key={w} className="dp-weekday">{w}</span>)}
            </div>
            <div className="dp-grid">
              {cells.map((c, i) => {
                const iso = toISO(c.y, c.m, c.d)
                const cls = 'dp-day'
                  + (c.cur ? '' : ' dp-day-spill')
                  + (iso === value ? ' dp-day-sel' : '')
                  + (iso === todayISO ? ' dp-day-today' : '')
                return (
                  <button key={i} type="button" className={cls} onClick={() => pick(c.y, c.m, c.d)}>
                    {c.d}
                  </button>
                )
              })}
            </div>
            <div className="dp-foot">
              <button type="button" className="dp-foot-btn" onClick={() => { onChange(''); setOpen(false) }}>Clear</button>
              <button type="button" className="dp-foot-btn dp-foot-today" onClick={() => pick(now.getFullYear(), now.getMonth(), now.getDate())}>Today</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default DatePicker
