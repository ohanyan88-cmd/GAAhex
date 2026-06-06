import { Button } from '../primitives'
import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import {
  CalendarIcon, ChevronLeftIcon, ChevronRightIcon,
  PlusIcon, CloseIcon, CheckIcon,
} from '../components/icons'
import { usePageConfig } from '../lib/pageConfig'
import { PageShell } from '../page-shell'

import { BASE } from '../lib/config'

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

// P1 note: CalendarView has no `.view-head`/ViewHead surface today, so the Configure
// gear isn't rendered here yet — props are accepted so App.tsx can wire it uniformly.
export default function CalendarView({ token, configVersion = 0, canConfigure: _canConfigure = false, onConfigure: _onConfigure }: { token: string; configVersion?: number; canConfigure?: boolean; onConfigure?: () => void }) {
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
  const [loadError, setLoadError] = useState('')
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
    setLoadError('')
    try {
      const cr = await fetch(`${BASE}/api/calendar/calendars`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (cr.ok) setCals(await cr.json())
      else { setLoadError('Failed to load calendars'); setLoading(false); return }
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
      else setLoadError('Failed to load events')
    } catch {
      setLoadError('Network error')
    }
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
    // D18: calendar event chip fallback fill = azure-soft (chips are interactive/drillable)
    return 'var(--gx-interactive-soft)'
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

  // ── Mini calendar for the sidebar (kit .minical-grid) ────────────────────
  function MiniCal() {
    const grid = buildGrid(year, month)
    const todayIso = todayStr()
    return (
      <div className="minical">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--gx-space-4)' }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--gx-text-13)' }}>{MONTH_NAMES[month].slice(0, 3)} {year}</span>
          <span className="spacer" />
          <button className="tb-icon" style={{ width: 26, height: 26 }} onClick={prev} aria-label="Previous month">
            <ChevronLeftIcon size={15} />
          </button>
          <button className="tb-icon" style={{ width: 26, height: 26 }} onClick={next} aria-label="Next month">
            <ChevronRightIcon size={15} />
          </button>
        </div>
        <div className="minical-grid">
          {DAY_HEADERS.map((d, i) => (
            <div key={`mh-${i}`} className="minical-h">{d[0]}</div>
          ))}
          {grid.flat().map((cell, idx) => {
            if (!cell) return <button key={`mini-pad-${idx}`} className="minical-d" style={{ visibility: 'hidden' }} tabIndex={-1} />
            const iso = isoDate(cell)
            const isToday = iso === todayIso
            return (
              <button
                key={iso}
                className={'minical-d' + (isToday ? ' today' : '')}
                onClick={() => openNew(iso)}
                type="button"
                aria-label={iso}
              >
                {cell.getDate()}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Week view — kit .cal-grid with 7 cells across ────────────────────────
  function WeekView() {
    const days = weekDays()
    const todayIso = todayStr()
    return (
      <div className="cal-grid" style={{ gridAutoRows: 'minmax(160px, 1fr)', minHeight: 200 }}>
        {DAY_HEADERS.map(d => (
          <div key={`wh-${d}`} className="cal-h">{d}</div>
        ))}
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
              className={'cal-cell big'}
              onClick={() => openNew(iso)}
            >
              <span className={'cal-day' + (isToday ? ' today' : '')}>{day.getDate()}</span>
              <div className="cal-evs">
                {dayEvs.map(ev => {
                  const tone = calColor(ev)
                  return (
                    <div
                      key={ev.id}
                      className="cal-ev"
                      style={{ background: tone + '22', color: tone, borderLeft: '2px solid ' + tone }}
                      onClick={e => { e.stopPropagation(); openEdit(ev) }}
                    >
                      {!ev.all_day && (
                        <span className="mono" style={{ fontSize: 9, opacity: 0.85, marginRight: 'var(--gx-space-2)' }}>
                          {ev.start_at.slice(11, 16)}
                        </span>
                      )}
                      {ev.title}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const grid = buildGrid(year, month)
  const today = todayStr()

  // Visible (non-hidden) events — feeds upcoming list AND KPI counts so the
  // KPIs match what the user can actually see on screen.
  const visibleEvents = events.filter(e => !e.calendar_id || !hiddenCals.has(e.calendar_id))

  // Upcoming events (visible/non-hidden, future-only from "today" forward in this month).
  const upcoming = visibleEvents
    .filter(e => e.start_at.slice(0, 10) >= today)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .slice(0, 6)

  // KPI derivation — counted from the events ALREADY fetched for the current
  // range. "This week" = Mon..Sun of the calendar week containing today.
  const todayCount = visibleEvents.filter(e => e.start_at.slice(0, 10) === today).length
  const weekStartIso = (() => {
    const n = new Date()
    const day = n.getDay()
    const diff = day === 0 ? 6 : day - 1
    const mon = new Date(n)
    mon.setDate(n.getDate() - diff)
    mon.setHours(0, 0, 0, 0)
    return isoDate(mon)
  })()
  const weekEndIso = (() => {
    const n = new Date()
    const day = n.getDay()
    const diff = day === 0 ? 6 : day - 1
    const mon = new Date(n)
    mon.setDate(n.getDate() - diff + 6)
    mon.setHours(0, 0, 0, 0)
    return isoDate(mon)
  })()
  const thisWeekCount = visibleEvents.filter(e => {
    const d = e.start_at.slice(0, 10)
    return d >= weekStartIso && d <= weekEndIso
  }).length

  // Sub-toolbar lives inside the body — the PageShell ActionBar's
  // ViewSwitcher contract is for canonical view-kinds (table/board/calendar/
  // map/timeline/gallery), not calendar sub-modes like month/week, so the
  // month↔week toggle + date navigator stay in-body alongside the range label.
  const rangeLabel =
    calView === 'month' ? `${MONTH_NAMES[month]} ${year}` : weekRangeLabel(weekStart)

  const body = (
    <div className="gx-comms" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div className="cal-subbar" style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)', marginBottom: 'var(--gx-space-4)', flexWrap: 'wrap' }}>
        <div className="sub" style={{ color: 'var(--gx-text-3)', fontSize: 12.5 }}>
          {rangeLabel}
          {loading ? ' · loading…' : ''}
          {loadError ? ` · ${loadError}` : ''}
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <div className="cal-nav">
          <button className="tb-icon" onClick={calView === 'month' ? prev : prevWeek} aria-label="Previous">
            <ChevronLeftIcon size={18} />
          </button>
          <Button variant="secondary" size="sm" onClick={goToday}>Today</Button>
          <button className="tb-icon" onClick={calView === 'month' ? next : nextWeek} aria-label="Next">
            <ChevronRightIcon size={18} />
          </button>
        </div>
        <div className="seg hide-sm">
          <button type="button" className={calView === 'month' ? 'on' : ''} onClick={() => setCalView('month')}>Month</button>
          <button type="button" className={calView === 'week' ? 'on' : ''} onClick={() => setCalView('week')}>Week</button>
        </div>
      </div>

      <div className="cal-layout">
        <aside className="cal-rail hide-sm">
          <MiniCal />

          {/* Calendar filters (toggle visibility) */}
          {cals.length > 0 && (
            <>
              <div className="lbl" style={{ fontSize: 'var(--gx-text-10)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gx-text-3)', margin: '18px 0 8px' }}>Calendars</div>
              {cals.map(cal => {
                const on = !hiddenCals.has(cal.id)
                return (
                  <label key={cal.id} className="cal-cal" onClick={() => toggleCal(cal.id)}>
                    <span
                      className="cal-check"
                      style={{
                        background: on ? cal.color : 'transparent',
                        borderColor: cal.color,
                      }}
                    >
                      {on && <CheckIcon size={11} style={{ color: 'var(--gx-text-on-gold)' }} />}
                    </span>
                    <span style={{ fontSize: 12.5, color: on ? 'var(--gx-text-1)' : 'var(--gx-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cal.name}
                    </span>
                  </label>
                )
              })}
            </>
          )}

          {/* Upcoming list */}
          {upcoming.length > 0 && (
            <>
              <div className="lbl" style={{ fontSize: 'var(--gx-text-10)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gx-text-3)', margin: '18px 0 8px' }}>Upcoming</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {upcoming.map(e => {
                  const tone = calColor(e)
                  const d = new Date(e.start_at)
                  return (
                    <div
                      key={e.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openEdit(e)}
                      onKeyDown={(ke) => { if (ke.key === 'Enter' || ke.key === ' ') { ke.preventDefault(); openEdit(e) } }}
                      style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer' }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone, marginTop: 5, flexShrink: 0 }} />
                      <div style={{ fontSize: 'var(--gx-text-sm)', minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</div>
                        <div className="hint" style={{ fontSize: 'var(--gx-text-11)' }}>
                          {MONTH_NAMES[d.getMonth()].slice(0, 3)} {d.getDate()}
                          {!e.all_day && e.start_at.length > 10 ? ` · ${e.start_at.slice(11, 16)}` : ''}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </aside>

        <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          {calView === 'month' && (
            <div className="cal-grid full">
              {DAY_HEADERS.map(d => (
                <div key={d} className="cal-h">{d}</div>
              ))}
              {grid.flat().map((cell, idx) => {
                if (!cell) {
                  return (
                    <div
                      key={`pad-${idx}`}
                      className="cal-cell big off"
                      aria-hidden="true"
                    />
                  )
                }
                const dateStr = isoDate(cell)
                const isToday = dateStr === today
                const dayEvents = eventsForDay(cell)
                const visible = dayEvents.slice(0, 3)
                const overflow = dayEvents.length - visible.length

                return (
                  <div
                    key={dateStr}
                    className="cal-cell big"
                    onClick={() => openNew(dateStr)}
                  >
                    <span className={'cal-day' + (isToday ? ' today' : '')}>{cell.getDate()}</span>
                    <div className="cal-evs">
                      {visible.map(ev => {
                        const tone = calColor(ev)
                        return (
                          <div
                            key={ev.id}
                            className="cal-ev"
                            style={{ background: tone + '22', color: tone, borderLeft: '2px solid ' + tone, cursor: 'pointer' }}
                            onClick={e => { e.stopPropagation(); openEdit(ev) }}
                          >
                            {!ev.all_day && ev.start_at.length > 10 && (
                              <span className="mono" style={{ fontSize: 9, opacity: 0.85, marginRight: 'var(--gx-space-2)' }}>
                                {ev.start_at.slice(11, 16)}
                              </span>
                            )}
                            {ev.title}
                          </div>
                        )
                      })}
                      {overflow > 0 && (
                        <span
                          className="cal-more"
                          style={{ cursor: 'pointer' }}
                          onClick={e => { e.stopPropagation(); openNew(dateStr) }}
                        >
                          +{overflow} more
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', width: '100%' }}>
            {editing && (
              <Button variant="danger" size="sm"
            type="button"  onClick={handleDelete} disabled={fSaving}>
                Delete
              </Button>
            )}
            <span style={{ flex: 1 }} />
            <Button variant="ghost" size="md"
            type="button"  onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="md"
            type="button"  onClick={handleSave} disabled={fSaving}>
              {fSaving ? 'Saving...' : 'Save'}
            </Button>
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)' }}>
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
            <div style={{ display: 'flex', gap: 'var(--gx-space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
              {SWATCH_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFColor(fColor === c ? null : c)}
                  style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: c, border: 'none', cursor: 'pointer',
                    outline: fColor === c ? '2px solid var(--gx-gold)' : '2px solid transparent',
                    outlineOffset: 2,
                  }}
                  aria-label={`Color ${c}`}
                />
              ))}
              {fColor && (
                <Button variant="ghost" size="sm"
            type="button"
                  
                  style={{ padding: '0 8px', height: 24, fontSize: 'var(--gx-text-11)', display: 'flex', alignItems: 'center', gap: 'var(--gx-space-2)' }}
                  onClick={() => setFColor(null)}
                >
                  <CloseIcon size={10} /> Clear
                </Button>
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

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Workspace', 'Calendar']}
      icon={<CalendarIcon size={18} />}
      title={cfg.title}
      subtitle="Schedules & field dispatches"
      kpis={[
        { label: 'Today', value: todayCount, subtitle: todayCount === 0 ? 'no events' : undefined },
        { label: 'This week', value: thisWeekCount, subtitle: thisWeekCount === 0 ? 'no events' : undefined },
      ]}
      primaryAction={{
        label: 'New event',
        icon: <PlusIcon size={14} />,
        onClick: () => openNew(),
      }}
    >
      {body}
    </PageShell>
  )
}
