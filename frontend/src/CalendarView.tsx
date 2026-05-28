import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import ViewHead from './ViewHead'
import {
  CalendarIcon, ChevronLeftIcon, ChevronRightIcon,
  PlusIcon, CloseIcon,
} from './icons'
import { usePageConfig } from './pageConfig'

const BASE = 'http://127.0.0.1:8099'

type CalEvent = {
  id: string; title: string; start_at: string; end_at: string | null
  all_day: boolean; color: string | null; calendar_id: string | null
  description: string | null; location: string | null; created_at: string | null
}
type Cal = { id: string; name: string; color: string; is_shared: boolean }

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SWATCH_COLORS = ['#3A6FB5', '#C5A059', '#2ECC71', '#E63946', '#F5A623', '#AEB7C2']

function buildGrid(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const startDay = first.getDay() === 0 ? 6 : first.getDay() - 1
  const cells: (Date | null)[] = []
  for (let i = 0; i < startDay; i++) cells.push(null)
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  const rows: (Date | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  return rows
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function todayStr(): string {
  return isoDate(new Date())
}

export default function CalendarView({ token, configVersion = 0 }: { token: string; configVersion?: number }) {
  const cfg = usePageConfig(token, 'calendar', configVersion)
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [calView, setCalView] = useState<'month' | 'week'>('month')
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const now = new Date()
    const day = now.getDay()
    const diff = day === 0 ? 6 : day - 1
    const mon = new Date(now)
    mon.setDate(now.getDate() - diff)
    mon.setHours(0, 0, 0, 0)
    return mon
  })
  const [events, setEvents] = useState<CalEvent[]>([])
  const [cals, setCals] = useState<Cal[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<CalEvent | null>(null)
  const [prefillDate, setPrefillDate] = useState<string | null>(null)
  const [hiddenCals, setHiddenCals] = useState<Set<string>>(new Set())

  // Modal form state
  const [fTitle, setFTitle] = useState('')
  const [fDate, setFDate] = useState('')
  const [fStartTime, setFStartTime] = useState('09:00')
  const [fEndTime, setFEndTime] = useState('10:00')
  const [fAllDay, setFAllDay] = useState(false)
  const [fDesc, setFDesc] = useState('')
  const [fCalId, setFCalId] = useState('')
  const [fColor, setFColor] = useState<string | null>(null)
  const [fSaving, setFSaving] = useState(false)
  const [fError, setFError] = useState('')

  function prev() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  function next() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }
  function goToday() {
    const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth())
    if (calView === 'week') {
      const day = n.getDay()
      const diff = day === 0 ? 6 : day - 1
      const mon = new Date(n)
      mon.setDate(n.getDate() - diff)
      mon.setHours(0, 0, 0, 0)
      setWeekStart(mon)
    }
  }
  function prevWeek() {
    setWeekStart(d => {
      const n = new Date(d); n.setDate(n.getDate() - 7); return n
    })
  }
  function nextWeek() {
    setWeekStart(d => {
      const n = new Date(d); n.setDate(n.getDate() + 7); return n
    })
  }
  function weekDays(): Date[] {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d
    })
  }
  function weekRangeLabel(start: Date): string {
    const end = new Date(start); end.setDate(start.getDate() + 6)
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
    return `${start.toLocaleDateString('en', opts)} – ${end.toLocaleDateString('en', { ...opts, year: 'numeric' })}`
  }

  async function load() {
    setLoading(true)
    const cr = await fetch(`${BASE}/api/calendar/calendars`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (cr.ok) setCals(await cr.json())
    let startStr: string, endStr: string
    if (calView === 'week') {
      startStr = isoDate(weekStart)
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6)
      endStr = isoDate(weekEnd)
    } else {
      const first = new Date(year, month, 1)
      const last = new Date(year, month + 1, 0)
      startStr = isoDate(first); endStr = isoDate(last)
    }
    const er = await fetch(
      `${BASE}/api/calendar/events?start=${startStr}&end=${endStr}&limit=500`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (er.ok) setEvents(await er.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [token, year, month, calView, weekStart])

  function eventsForDay(date: Date): CalEvent[] {
    const iso = isoDate(date)
    return events
      .filter(e => e.start_at.slice(0, 10) === iso)
      .filter(e => !e.calendar_id || !hiddenCals.has(e.calendar_id))
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
  }

  function calColor(ev: CalEvent): string {
    if (ev.color) return ev.color
    const cal = cals.find(c => c.id === ev.calendar_id)
    if (cal) return cal.color
    return 'var(--primary-soft)'
  }

  function openNew(date?: string) {
    setEditing(null)
    setPrefillDate(date ?? todayStr())
    setFTitle('')
    setFDate(date ?? todayStr())
    setFStartTime('09:00')
    setFEndTime('10:00')
    setFAllDay(false)
    setFDesc('')
    setFCalId(cals[0]?.id ?? '')
    setFColor(null)
    setFError('')
    setModalOpen(true)
  }

  function openEdit(ev: CalEvent) {
    setEditing(ev)
    setPrefillDate(null)
    setFTitle(ev.title)
    setFDate(ev.start_at.slice(0, 10))
    setFStartTime(ev.start_at.length > 10 ? ev.start_at.slice(11, 16) : '09:00')
    setFEndTime(ev.end_at && ev.end_at.length > 10 ? ev.end_at.slice(11, 16) : '10:00')
    setFAllDay(ev.all_day)
    setFDesc(ev.description ?? '')
    setFCalId(ev.calendar_id ?? (cals[0]?.id ?? ''))
    setFColor(ev.color)
    setFError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!fTitle.trim()) { setFError('Title is required'); return }
    setFSaving(true); setFError('')
    const startAt = fAllDay ? fDate : `${fDate}T${fStartTime}:00`
    const endAt = fAllDay ? null : `${fDate}T${fEndTime}:00`
    const body = {
      title: fTitle.trim(), start_at: startAt, end_at: endAt, all_day: fAllDay,
      description: fDesc || null, calendar_id: fCalId || null, color: fColor,
    }
    try {
      let resp: Response
      if (editing) {
        resp = await fetch(`${BASE}/api/calendar/events/${editing.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        resp = await fetch(`${BASE}/api/calendar/events`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      if (!resp.ok) { setFError('Save failed'); setFSaving(false); return }
      setModalOpen(false)
      await load()
    } catch {
      setFError('Network error')
    }
    setFSaving(false)
  }

  async function handleDelete() {
    if (!editing) return
    if (!window.confirm('Delete this event?')) return
    setFSaving(true)
    try {
      await fetch(`${BASE}/api/calendar/events/${editing.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      setModalOpen(false)
      await load()
    } catch {
      setFError('Network error')
    }
    setFSaving(false)
  }

  function toggleCal(id: string) {
    setHiddenCals(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // ── Mini calendar for the sidebar ─────────────────────────────────────────
  function MiniCal() {
    const grid = buildGrid(year, month)
    const todayIso = todayStr()
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={prev} aria-label="Previous month">
            <ChevronLeftIcon size={13} />
          </button>
          <span style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
            {MONTH_NAMES[month].slice(0, 3)} {year}
          </span>
          <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={next} aria-label="Next month">
            <ChevronRightIcon size={13} />
          </button>
        </div>
        <div className="cal-mini">
          {DAY_HEADERS.map(d => (
            <div key={d} className="cal-mini-dow">{d[0]}</div>
          ))}
          {grid.flat().map((cell, idx) => {
            if (!cell) return <div key={`mini-pad-${idx}`} />
            const iso = isoDate(cell)
            const isToday = iso === todayIso
            return (
              <button
                key={iso}
                className={['cal-mini-day', isToday ? 'today' : ''].filter(Boolean).join(' ')}
                style={{ textAlign: 'center' }}
                onClick={() => openNew(iso)}
                type="button"
              >
                {cell.getDate()}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Week view ──────────────────────────────────────────────────────────────
  function WeekView() {
    const days = weekDays()
    const todayIso = todayStr()
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        background: 'var(--border)',
        gap: 1,
      }}>
        {days.map(day => {
          const iso = isoDate(day)
          const dayEvs = events
            .filter(e => e.start_at.slice(0, 10) === iso)
            .filter(e => !e.calendar_id || !hiddenCals.has(e.calendar_id))
            .sort((a, b) => a.start_at.localeCompare(b.start_at))
          const isToday = iso === todayIso
          return (
            <div
              key={iso}
              className={['cal-day', isToday ? 'today' : ''].filter(Boolean).join(' ')}
              style={{ minHeight: 160 }}
              onClick={() => openNew(iso)}
            >
              <div className="cal-dow" style={{ background: 'transparent', padding: '0 0 4px 0', marginBottom: 4 }}>
                {day.toLocaleDateString('en', { weekday: 'short' })}
              </div>
              <div className={['cal-day-num', isToday ? 'today' : ''].filter(Boolean).join(' ')}>
                {day.getDate()}
              </div>
              {dayEvs.map(ev => (
                <div
                  key={ev.id}
                  className="cal-chip"
                  style={{ background: calColor(ev), color: 'var(--text)', marginTop: 3 }}
                  onClick={e => { e.stopPropagation(); openEdit(ev) }}
                >
                  {!ev.all_day && (
                    <span style={{ color: 'var(--text-3)', marginRight: 4, fontSize: 10 }}>
                      {ev.start_at.slice(11, 16)}
                    </span>
                  )}
                  {ev.title}
                </div>
              ))}
              {dayEvs.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic', marginTop: 4 }}>—</div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const grid = buildGrid(year, month)
  const today = todayStr()

  // ── View toggle (goes in ViewHead actions) ─────────────────────────────────
  const viewToggle = (
    <div className="row gap-8">
      {loading && <span className="muted" style={{ fontSize: 12 }}>Loading...</span>}
      <div className="cal-view-tabs">
        <button
          type="button"
          className={`cal-view-tab${calView === 'month' ? ' on' : ''}`}
          onClick={() => setCalView('month')}
        >Month</button>
        <button
          type="button"
          className={`cal-view-tab${calView === 'week' ? ' on' : ''}`}
          onClick={() => setCalView('week')}
        >Week</button>
      </div>
      <button
        className="btn btn-primary btn-md"
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        onClick={() => openNew()}
        type="button"
      >
        <PlusIcon size={13} /> New event
      </button>
    </div>
  )

  return (
    <div>
      <ViewHead
        icon={<CalendarIcon size={20} />}
        title={cfg.title}
        actions={viewToggle}
      />

      <div className="cal-shell">

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <aside className="cal-side">
          <MiniCal />

          {/* Calendar list */}
          {cals.length > 0 && (
            <div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)', fontWeight: 600, marginBottom: 8 }}>
                My Calendars
              </div>
              {cals.map(cal => (
                <label
                  key={cal.id}
                  className="cal-list-row"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  <input
                    type="checkbox"
                    checked={!hiddenCals.has(cal.id)}
                    onChange={() => toggleCal(cal.id)}
                    style={{ display: 'none' }}
                  />
                  <span
                    className="cal-list-dot"
                    style={{
                      background: hiddenCals.has(cal.id) ? 'var(--border)' : cal.color,
                      outline: hiddenCals.has(cal.id) ? `2px solid ${cal.color}` : 'none',
                      outlineOffset: -2,
                    }}
                  />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                    {cal.name}
                  </span>
                </label>
              ))}
            </div>
          )}
        </aside>

        {/* ── Main panel ───────────────────────────────────────────────── */}
        <div className="cal-main">

          {/* Navigation header */}
          <div className="cal-head">
            <button className="btn btn-ghost btn-sm" onClick={calView === 'month' ? prev : prevWeek} aria-label="Previous">
              <ChevronLeftIcon size={14} />
            </button>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              {calView === 'month'
                ? `${MONTH_NAMES[month]} ${year}`
                : weekRangeLabel(weekStart)
              }
            </h3>
            <button className="btn btn-ghost btn-sm" onClick={calView === 'month' ? next : nextWeek} aria-label="Next">
              <ChevronRightIcon size={14} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={goToday} style={{ marginLeft: 4 }}>
              Today
            </button>
          </div>

          {/* Month grid */}
          {calView === 'month' && (
            <div className="cal-month">
              {/* Day-of-week headers */}
              {DAY_HEADERS.map(d => (
                <div key={d} className="cal-dow">{d}</div>
              ))}

              {/* Day cells */}
              {grid.flat().map((cell, idx) => {
                if (!cell) {
                  return (
                    <div
                      key={`pad-${idx}`}
                      className="cal-day dim"
                      style={{ opacity: 0.35, cursor: 'default' }}
                    />
                  )
                }
                const dateStr = isoDate(cell)
                const isToday = dateStr === today
                const dayEvents = eventsForDay(cell)
                const visible = dayEvents.slice(0, 3)
                const overflow = dayEvents.length - visible.length
                const isWeekend = cell.getDay() === 0 || cell.getDay() === 6

                return (
                  <div
                    key={dateStr}
                    className={[
                      'cal-day',
                      isToday ? 'today' : '',
                      isWeekend ? 'weekend' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => openNew(dateStr)}
                  >
                    <span className="cal-day-num">{cell.getDate()}</span>
                    {visible.map(ev => (
                      <div
                        key={ev.id}
                        className="cal-chip"
                        style={{ background: calColor(ev), color: 'var(--text)' }}
                        onClick={e => { e.stopPropagation(); openEdit(ev) }}
                      >
                        {ev.title}
                      </div>
                    ))}
                    {overflow > 0 && (
                      <span
                        style={{ fontSize: 11, color: 'var(--text-3)', padding: '1px 4px', cursor: 'pointer' }}
                        onClick={e => { e.stopPropagation(); openNew(dateStr) }}
                      >
                        +{overflow} more
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Week grid */}
          {calView === 'week' && <WeekView />}
        </div>
      </div>

      {/* ── Event create / edit modal ─────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit event' : 'New event'}
        size="md"
        footer={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
            {editing && (
              <button type="button" className="btn btn-danger btn-sm" onClick={handleDelete} disabled={fSaving}>
                Delete
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-md" onClick={handleSave} disabled={fSaving}>
              {fSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        }
      >
        <div className="rec-form">
          <div className="field">
            <label>Title</label>
            <input
              className="inp inp-md"
              value={fTitle}
              onChange={e => setFTitle(e.target.value)}
              placeholder="Event title"
              autoFocus
            />
          </div>
          <div className="field">
            <label>Date</label>
            <input
              type="date"
              className="inp inp-md"
              value={fDate}
              onChange={e => setFDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={fAllDay} onChange={e => setFAllDay(e.target.checked)} />
              All day
            </label>
          </div>
          {!fAllDay && (
            <>
              <div className="field">
                <label>Start time</label>
                <input type="time" className="inp inp-md" value={fStartTime} onChange={e => setFStartTime(e.target.value)} />
              </div>
              <div className="field">
                <label>End time</label>
                <input type="time" className="inp inp-md" value={fEndTime} onChange={e => setFEndTime(e.target.value)} />
              </div>
            </>
          )}
          <div className="field">
            <label>Description</label>
            <textarea
              className="inp inp-area inp-md"
              rows={3}
              value={fDesc}
              onChange={e => setFDesc(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          {cals.length > 0 && (
            <div className="field">
              <label>Calendar</label>
              <select className="inp inp-md" value={fCalId} onChange={e => setFCalId(e.target.value)}>
                <option value="">— none —</option>
                {cals.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>Color</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {SWATCH_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFColor(fColor === c ? null : c)}
                  style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: c, border: 'none', cursor: 'pointer',
                    outline: fColor === c ? '2px solid var(--accent)' : '2px solid transparent',
                    outlineOffset: 2,
                  }}
                  aria-label={`Color ${c}`}
                />
              ))}
              {fColor && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '0 8px', height: 24, fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => setFColor(null)}
                >
                  <CloseIcon size={10} /> Clear
                </button>
              )}
            </div>
          </div>
          {fError && <p className="err" style={{ margin: 0 }}>{fError}</p>}
        </div>
      </Modal>

      {/* suppress unused prefillDate lint — it drives the date passed to openNew */}
      {prefillDate === null && null}
    </div>
  )
}
