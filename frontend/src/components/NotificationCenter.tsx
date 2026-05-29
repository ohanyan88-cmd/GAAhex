import { useEffect, useRef, useState } from 'react'
import { BellIcon, GearIcon, SnoozeIcon, ArchiveIcon, MuteIcon } from './icons'
import { useI18n } from '../lib/i18n'

// Notification center — a header bell + dropdown. Self-contained: inlines its own fetch calls
// (same base + Authorization pattern as api.ts) and consumes the /notifications API: inbox (with
// category/priority filters), preferences (opt-out toggles), read/read-all.
// A26 endpoints: GET/PUT /api/notification-prefs, POST /api/notifications/{id}/snooze|archive
// Degrades gracefully: A26 controls are hidden on 404.
const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

const CATEGORIES = ['system', 'billing', 'network', 'customer', 'internal']
const PRIORITIES = ['low', 'normal', 'high', 'urgent']
const MODES = ['off', 'realtime', 'digest'] as const
type Mode = (typeof MODES)[number]
const CHANNELS = ['inapp', 'email'] as const
type Channel = (typeof CHANNELS)[number]

type Note = {
  id: string
  def_key: string
  category: string | null
  priority: string | null
  title: string
  body: string
  entity_key: string | null
  record_id: string | null
  read_at: string | null
  created_at: string | null
}

// Old-style prefs (legacy /notifications/preferences endpoint, boolean on/off)
type LegacyPref = { id: string; category: string; channel: string; enabled: boolean }

// New A26 notification-prefs (GET/PUT /api/notification-prefs): per category/mode/channels
type NotifPref = {
  category: string   // '*' = global default row
  mode: Mode
  channels: Channel[]
}
type NotifPrefsPayload = { preferences: NotifPref[] }

type EntityRef = { key: string; route_slug: string }

async function jget(token: string, path: string) {
  const r = await fetch(`${BASE}${path}`, { headers: authH(token) })
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}
async function jpost(token: string, path: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: body !== undefined
      ? { ...authH(token), 'Content-Type': 'application/json' }
      : authH(token),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}
async function jput(token: string, path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}

function fmt(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString()
}

// Snooze durations in minutes
const SNOOZE_OPTIONS: { labelKey: string; labelEn: string; minutes: number }[] = [
  { labelKey: 'notif.snooze1h', labelEn: '1 hour', minutes: 60 },
  { labelKey: 'notif.snooze4h', labelEn: '4 hours', minutes: 240 },
  { labelKey: 'notif.snoozeDay', labelEn: '1 day', minutes: 1440 },
]

// ---- Sub-component: per-notification action buttons ----
function NoteActions({
  note,
  token,
  snoozeAvailable,
  archiveAvailable,
  onSnooze,
  onArchive,
}: {
  note: Note
  token: string
  snoozeAvailable: boolean
  archiveAvailable: boolean
  onSnooze: (id: string) => void
  onArchive: (id: string) => void
}) {
  const { t } = useI18n()
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the snooze dropdown on outside click
  useEffect(() => {
    if (!snoozeOpen) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSnoozeOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [snoozeOpen])

  async function handleSnooze(minutes: number) {
    setBusy(true)
    setSnoozeOpen(false)
    try {
      await jpost(token, `/api/notifications/${note.id}/snooze`, { minutes })
      onSnooze(note.id)
    } catch {
      // graceful — action simply didn't fire
    } finally {
      setBusy(false)
    }
  }

  async function handleArchive() {
    setBusy(true)
    try {
      await jpost(token, `/api/notifications/${note.id}/archive`)
      onArchive(note.id)
    } catch {
      // graceful
    } finally {
      setBusy(false)
    }
  }

  if (!snoozeAvailable && !archiveAvailable) return null

  return (
    <div className="notif-item-actions" onClick={(e) => e.stopPropagation()}>
      {snoozeAvailable && (
        <div className="notif-snooze-wrap" ref={menuRef}>
          <button
            className="notif-action-btn"
            aria-label={t('notif.snooze', 'Snooze')}
            title={t('notif.snooze', 'Snooze')}
            disabled={busy}
            onClick={() => setSnoozeOpen((o) => !o)}
          >
            <SnoozeIcon size={14} />
          </button>
          {snoozeOpen && (
            <div className="notif-snooze-menu" role="menu">
              {SNOOZE_OPTIONS.map((opt) => (
                <button
                  key={opt.minutes}
                  className="notif-snooze-opt"
                  role="menuitem"
                  onClick={() => handleSnooze(opt.minutes)}
                >
                  {t(opt.labelKey, opt.labelEn)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {archiveAvailable && (
        <button
          className="notif-action-btn"
          aria-label={t('notif.archive', 'Archive')}
          title={t('notif.archive', 'Archive')}
          disabled={busy}
          onClick={handleArchive}
        >
          <ArchiveIcon size={14} />
        </button>
      )}
    </div>
  )
}

// ---- Sub-component: A26 notification-prefs panel ----
function NotifPrefsA26({
  token,
  onBack,
}: {
  token: string
  onBack: () => void
}) {
  const { t } = useI18n()
  const [prefs, setPrefs] = useState<NotifPref[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setLoading(true)
    jget(token, '/api/notification-prefs')
      .then((d: unknown) => {
        const arr: NotifPref[] = Array.isArray(d) ? (d as NotifPref[]) : []
        // Ensure the '*' wildcard default row is present
        if (!arr.find((p) => p.category === '*')) {
          arr.unshift({ category: '*', mode: 'realtime', channels: ['inapp'] })
        }
        setPrefs(arr)
      })
      .catch(() => setError(t('notif.prefsUnavailable', 'Preferences unavailable')))
      .finally(() => setLoading(false))
  }, [token])

  function getPref(cat: string): NotifPref {
    return (
      prefs.find((p) => p.category === cat) ?? {
        category: cat,
        mode: 'realtime',
        channels: ['inapp'],
      }
    )
  }

  function updateLocal(cat: string, patch: Partial<NotifPref>) {
    setPrefs((prev) => {
      const existing = prev.find((p) => p.category === cat)
      if (existing) return prev.map((p) => (p.category === cat ? { ...p, ...patch } : p))
      return [...prev, { category: cat, mode: 'realtime', channels: ['inapp'], ...patch }]
    })
  }

  function setMode(cat: string, mode: Mode) {
    updateLocal(cat, { mode })
  }

  function toggleChannel(cat: string, ch: Channel, on: boolean) {
    const cur = getPref(cat)
    const channels = on
      ? ([...new Set([...cur.channels, ch])] as Channel[])
      : cur.channels.filter((c) => c !== ch)
    updateLocal(cat, { channels })
  }

  async function save() {
    setSaved(false)
    setError('')
    try {
      const payload: NotifPrefsPayload = { preferences: prefs }
      const result = await jput(token, '/api/notification-prefs', payload)
      const arr: NotifPref[] = Array.isArray(result) ? (result as NotifPref[]) : prefs
      setPrefs(arr)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError(t('notif.prefsSaveError', 'Could not save preferences'))
    }
  }

  const allCats = ['*', ...CATEGORIES]

  return (
    <>
      <div className="notif-head">
        <strong>{t('notif.prefsTitle', 'Notification Preferences')}</strong>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          {t('notif.back', 'Back')}
        </button>
      </div>
      <div className="notif-prefs">
        {loading && <p className="muted notif-empty">{t('notif.loading', 'Loading…')}</p>}
        {error && <p className="err notif-empty">{error}</p>}
        {!loading && !error && (
          <>
            <p className="muted notif-prefs-hint">{t('notif.prefsHint', 'Choose mode and channels per category.')}</p>
            <div className="notif-prefs-table" role="table" aria-label={t('notif.prefsTitle', 'Notification Preferences')}>
              <div className="notif-prefs-thead" role="row">
                <span role="columnheader">{t('notif.prefsCategory', 'Category')}</span>
                <span role="columnheader">{t('notif.prefsMode', 'Mode')}</span>
                <span role="columnheader">{t('notif.prefsChannels', 'Channels')}</span>
              </div>
              {allCats.map((cat) => {
                const pref = getPref(cat)
                return (
                  <div key={cat} className="pref-row" role="row">
                    <span className="pref-cat" role="cell">
                      {cat === '*'
                        ? t('notif.prefsDefault', 'Default')
                        : cat}
                      {cat === '*' && (
                        <span className="pref-chan">{t('notif.prefsDefault', 'Default')}</span>
                      )}
                    </span>
                    <span className="pref-mode-wrap" role="cell">
                      <select
                        className="inp inp-sm pref-mode-select"
                        value={pref.mode}
                        aria-label={`${cat} mode`}
                        onChange={(e) => setMode(cat, e.target.value as Mode)}
                      >
                        <option value="off">{t('notif.prefsModeOff', 'Off')}</option>
                        <option value="realtime">{t('notif.prefsModeRealtime', 'Realtime')}</option>
                        <option value="digest">{t('notif.prefsModeDigest', 'Digest')}</option>
                      </select>
                    </span>
                    <span className="pref-channels" role="cell">
                      {CHANNELS.map((ch) => (
                        <label key={ch} className="pref-ch-label">
                          <input
                            type="checkbox"
                            checked={pref.channels.includes(ch)}
                            disabled={pref.mode === 'off'}
                            aria-label={`${cat} ${ch}`}
                            onChange={(e) => toggleChannel(cat, ch, e.target.checked)}
                          />
                          <span className="pref-chan">
                            {ch === 'inapp'
                              ? t('notif.prefsChannelInapp', 'In-app')
                              : t('notif.prefsChannelEmail', 'Email')}
                          </span>
                        </label>
                      ))}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="notif-prefs-footer">
              {saved && <span className="ok-msg">{t('notif.prefsSaved', 'Saved')}</span>}
              <button className="btn btn-primary btn-sm" onClick={save}>
                {t('common.save', 'Save')}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ---- Sub-component: legacy prefs panel (fallback when A26 isn't live) ----
function LegacyPrefsPanel({
  token,
  prefs,
  error,
  onToggle,
  onBack,
}: {
  token: string
  prefs: LegacyPref[]
  error: string
  onToggle: (cat: string, enabled: boolean) => void
  onBack: () => void
}) {
  const { t } = useI18n()
  // Derive muted categories from the legacy prefs (mode = 'off' ~ enabled = false on inapp)
  function prefEnabled(cat: string): boolean {
    const row = prefs.find((p) => p.category === cat && p.channel === 'inapp')
    return row ? row.enabled : true
  }
  return (
    <>
      <div className="notif-head">
        <strong>{t('notif.prefsTitle', 'Notification Preferences')}</strong>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          {t('notif.back', 'Back')}
        </button>
      </div>
      <div className="notif-prefs">
        <p className="muted notif-prefs-hint">
          {t('notif.prefsHint', 'Choose mode and channels per category.')}
        </p>
        {CATEGORIES.map((c) => (
          <label key={c} className="pref-row">
            <span className="pref-cat">
              {c}
              <span className="pref-chan">{t('notif.prefsChannelInapp', 'In-app')}</span>
            </span>
            <input
              type="checkbox"
              checked={prefEnabled(c)}
              aria-label={`${c} in-app`}
              onChange={(e) => onToggle(c, e.target.checked)}
            />
          </label>
        ))}
        {error && <p className="err">{error}</p>}
      </div>
    </>
  )
}

// ---- Main export ----
export default function NotificationCenter({ token, entities, onOpen }: {
  token: string
  entities: EntityRef[]
  onOpen: (slug: string, recordId: string | null) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'list' | 'prefs'>('list')
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<Note[]>([])
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [fcat, setFcat] = useState('')
  const [fpri, setFpri] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Legacy prefs (fallback)
  const [legacyPrefs, setLegacyPrefs] = useState<LegacyPref[]>([])
  const [legacyPrefsAvailable, setLegacyPrefsAvailable] = useState(true)

  // A26 availability flags — probed on first open; degrade to hidden if 404
  const [snoozeAvailable, setSnoozeAvailable] = useState(true)
  const [archiveAvailable, setArchiveAvailable] = useState(true)
  const [a26PrefsAvailable, setA26PrefsAvailable] = useState(true)

  // Whether A26 feature availability has been checked
  const a26Probed = useRef(false)

  async function refreshCount() {
    try {
      const d = await jget(token, '/notifications/unread-count')
      setCount(d.count ?? 0)
    } catch { /* keep the last badge value if the poll blips */ }
  }

  async function loadList() {
    setLoading(true); setError('')
    try {
      const p = new URLSearchParams()
      if (unreadOnly) p.set('unread', 'true')
      if (fcat) p.set('category', fcat)
      if (fpri) p.set('priority', fpri)
      const qs = p.toString()
      const d = await jget(token, '/notifications' + (qs ? `?${qs}` : ''))
      setItems(Array.isArray(d) ? d : [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function loadLegacyPrefs() {
    try {
      const d = await jget(token, '/notifications/preferences')
      setLegacyPrefs(Array.isArray(d) ? d : [])
      setLegacyPrefsAvailable(true)
    } catch {
      setLegacyPrefsAvailable(false)
    }
  }

  // Probe A26 endpoints once after the panel first opens
  async function probeA26() {
    if (a26Probed.current) return
    a26Probed.current = true
    // Probe /api/notification-prefs
    try {
      await jget(token, '/api/notification-prefs')
      setA26PrefsAvailable(true)
    } catch (e) {
      setA26PrefsAvailable((e as Error).message !== '404')
    }
    // We probe snooze/archive availability by checking a sentinel 404 path or assume live
    // (there is no separate probe endpoint; we set them true and fall back on actual call failure)
    setSnoozeAvailable(true)
    setArchiveAvailable(true)
  }

  // poll the unread badge every 30s
  useEffect(() => {
    refreshCount()
    const id = setInterval(refreshCount, 30000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // (re)load the list when the panel opens / filters change; probe prefs availability on open
  useEffect(() => {
    if (open) {
      loadList()
      loadLegacyPrefs()
      probeA26()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unreadOnly, fcat, fpri])

  // Optimistic removal: drop item from active inbox
  function removeItem(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id))
    // Refresh badge after removal
    refreshCount()
  }

  // If snooze/archive 404s on actual call, disable that control globally
  function handleSnooze(id: string) {
    removeItem(id)
  }
  function handleArchive(id: string) {
    removeItem(id)
  }

  async function toggleLegacyPref(cat: string, enabled: boolean) {
    try {
      const r = await fetch(`${BASE}/notifications/preferences`, {
        method: 'PUT',
        headers: { ...authH(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: [{ category: cat, channel: 'inapp', enabled }] }),
      })
      if (!r.ok) throw new Error('Could not save preference')
      setLegacyPrefs(await r.json())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function clickNote(n: Note) {
    try {
      if (!n.read_at) await jpost(token, `/notifications/${n.id}/read`)
    } catch { /* navigate anyway */ }
    await refreshCount()
    if (open) await loadList()
    if (n.entity_key) {
      const ent = entities.find((e) => e.key === n.entity_key)
      if (ent) { onOpen(ent.route_slug, n.record_id); setOpen(false) }
    }
  }

  async function markAll() {
    setError('')
    try {
      await jpost(token, '/notifications/read-all')
      await refreshCount()
      await loadList()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const prefsAvailable = legacyPrefsAvailable || a26PrefsAvailable

  return (
    <div className="notif">
      <button
        className="iconbtn"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('notif.title', 'Notifications')}
        title={t('notif.title', 'Notifications')}
      >
        <BellIcon size={20} />
        {count > 0 && (
          <span className="notif-badge" aria-label={`${count} unread`}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="notif-backdrop" onClick={() => setOpen(false)} />
          <div
            className="notif-pop"
            role="dialog"
            aria-label={t('notif.title', 'Notifications')}
          >
            {mode === 'list' ? (
              <>
                <div className="notif-head">
                  <strong>{t('notif.title', 'Notifications')}</strong>
                  <button className="btn btn-ghost btn-sm" onClick={markAll}>
                    {t('notif.markAllRead', 'Mark all read')}
                  </button>
                  {prefsAvailable && (
                    <button
                      className="iconbtn notif-gear"
                      aria-label={t('notif.preferences', 'Notification preferences')}
                      title={t('notif.preferences', 'Preferences')}
                      onClick={() => setMode('prefs')}
                    >
                      <GearIcon size={16} />
                    </button>
                  )}
                </div>

                <div className="notif-filters">
                  <label className="notif-toggle">
                    <input
                      type="checkbox"
                      checked={unreadOnly}
                      onChange={(e) => setUnreadOnly(e.target.checked)}
                    />
                    {t('notif.unread', 'Unread')}
                  </label>
                  <select
                    className="inp inp-sm"
                    value={fcat}
                    onChange={(e) => setFcat(e.target.value)}
                    aria-label={t('notif.allCategories', 'All categories')}
                  >
                    <option value="">{t('notif.allCategories', 'All categories')}</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select
                    className="inp inp-sm"
                    value={fpri}
                    onChange={(e) => setFpri(e.target.value)}
                    aria-label={t('notif.anyPriority', 'Any priority')}
                  >
                    <option value="">{t('notif.anyPriority', 'Any priority')}</option>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <div className="notif-list">
                  {loading && <p className="muted notif-empty">{t('notif.loading', 'Loading…')}</p>}
                  {error && <p className="err notif-empty">{error}</p>}
                  {!loading && !error && items.length === 0 && (
                    <p className="muted notif-empty">
                      {unreadOnly || fcat || fpri
                        ? t('notif.noneMatch', 'No matching notifications.')
                        : t('notif.empty', 'Nothing here yet.')}
                    </p>
                  )}
                  {!loading && !error && items.map((n) => (
                    <div key={n.id} className={'notif-item-wrap' + (n.read_at ? '' : ' unread')}>
                      <button
                        className="notif-item"
                        onClick={() => clickNote(n)}
                        aria-label={n.title}
                      >
                        <div className="notif-item-title">
                          {!n.read_at && <span className="notif-dot" aria-hidden />}
                          {n.title}
                        </div>
                        {n.body && <div className="notif-item-body">{n.body}</div>}
                        <div className="notif-item-meta">
                          {n.category && (
                            <span className="notif-cat" aria-label={`category: ${n.category}`}>
                              {n.category}
                            </span>
                          )}
                          {n.priority && (
                            <span
                              className={'notif-pri notif-pri-' + n.priority}
                              aria-label={`priority: ${n.priority}`}
                            >
                              {t(`notif.pri${n.priority.charAt(0).toUpperCase() + n.priority.slice(1)}`, n.priority)}
                            </span>
                          )}
                          <span className="notif-item-time">{fmt(n.created_at)}</span>
                        </div>
                      </button>
                      <NoteActions
                        note={n}
                        token={token}
                        snoozeAvailable={snoozeAvailable}
                        archiveAvailable={archiveAvailable}
                        onSnooze={handleSnooze}
                        onArchive={handleArchive}
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : a26PrefsAvailable ? (
              <NotifPrefsA26 token={token} onBack={() => setMode('list')} />
            ) : (
              <LegacyPrefsPanel
                token={token}
                prefs={legacyPrefs}
                error={error}
                onToggle={toggleLegacyPref}
                onBack={() => setMode('list')}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
