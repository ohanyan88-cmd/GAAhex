// B24 — Schedule-a-report panel.
// Surfaces GET/POST /api/report-schedules (A24 endpoint).
// Degrades gracefully: if the endpoint 404s the whole panel is hidden.
// Rules: zero emoji, --gx-* tokens only, all strings via t(), a11y.

import { useEffect, useState } from 'react'
import { bget, bpost, authH, BASE } from '../lib/billing'
import type { Fetched } from '../lib/billing'
import { toast } from '../components/Toast'
import { t } from '../lib/i18n'
import { EmptyState, ErrorBanner, SkeletonRows } from '../components/States'
import { CalendarIcon, PauseIcon, PlayIcon, TrashIcon, CloseIcon } from '../components/icons'
import { Button, StatusPill} from '../primitives'

// ── Types ────────────────────────────────────────────────────────────────────

type Report = { id: string; name: string }

// Backend (report_schedules.py): status is uppercase ACTIVE|PAUSED, recipients is a list[str].
type ScheduleStatus = 'ACTIVE' | 'PAUSED'

type Schedule = {
  id: string
  report_id: string
  report_name?: string | null
  cadence: 'daily' | 'weekly' | 'monthly'
  channel: 'email' | 'slack' | 'webhook'
  recipients?: string[] | null
  status: ScheduleStatus
  next_run_at?: string | null
  created_at?: string | null
}

type CreatePayload = {
  report_id: string
  cadence: string
  channel: string
  recipients: string[]
}

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

// ── Helpers ──────────────────────────────────────────────────────────────────

const CADENCE_LABELS: Record<string, string> = {
  daily: 'sched.cadenceDaily',
  weekly: 'sched.cadenceWeekly',
  monthly: 'sched.cadenceMonthly',
}

const CHANNEL_LABELS: Record<string, string> = {
  email: 'sched.channelEmail',
  slack: 'sched.channelSlack',
  webhook: 'sched.channelWebhook',
}

function fmtNextRun(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

// Backend stores status uppercase (ACTIVE | PAUSED). Map to a StatusPill variant + label.
function mapStatus(status: ScheduleStatus): { label: string; variant: PillVariant } {
  if (status === 'PAUSED') return { label: t('sched.paused_label', 'Paused'), variant: 'neutral' }
  return { label: t('sched.active', 'Active'), variant: 'active' }
}

// Comma-separated input → trimmed, de-empty'd array (what the backend requires).
function parseRecipients(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScheduleItem({
  sched,
  token,
  onMutate,
}: {
  sched: Schedule
  token: string
  onMutate: () => void
}) {
  const [busy, setBusy] = useState(false)
  const isPaused = sched.status === 'PAUSED'
  const pill = mapStatus(sched.status)

  async function togglePause() {
    setBusy(true)
    const action = isPaused ? 'resume' : 'pause'
    try {
      const r = await fetch(`${BASE}/api/report-schedules/${sched.id}/${action}`, {
        method: 'POST',
        headers: authH(token),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      toast.success(
        action === 'pause' ? t('sched.paused', 'Schedule paused') : t('sched.resumed', 'Schedule resumed'),
      )
      onMutate()
    } catch {
      toast.error(t('sched.saveError', 'Could not update schedule'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      const r = await fetch(`${BASE}/api/report-schedules/${sched.id}`, {
        method: 'DELETE',
        headers: authH(token),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      toast.success(t('sched.deleted', 'Schedule deleted'))
      onMutate()
    } catch {
      toast.error(t('sched.saveError', 'Could not delete schedule'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr>
      <td>
        <strong>{sched.report_name ?? sched.report_id}</strong>
      </td>
      <td style={{ color: 'var(--gx-text-2)', fontSize: 12 }}>
        {t(CADENCE_LABELS[sched.cadence] ?? 'sched.cadence', sched.cadence)}
      </td>
      <td style={{ color: 'var(--gx-text-2)', fontSize: 12 }}>
        {t(CHANNEL_LABELS[sched.channel] ?? 'sched.channel', sched.channel)}
      </td>
      <td style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>
        {sched.next_run_at ? fmtNextRun(sched.next_run_at) : '—'}
      </td>
      <td>
        <StatusPill variant={pill.variant} label={pill.label} size="sm" />
      </td>
      <td className="actions-col" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <Button variant="ghost" size="sm"
            type="button"
          
          disabled={busy}
          onClick={togglePause}
          aria-label={isPaused ? t('sched.resume', 'Resume') : t('sched.pause', 'Pause')}
          title={isPaused ? t('sched.resume', 'Resume') : t('sched.pause', 'Pause')}
          style={{ marginRight: 6 }}>
          {isPaused ? <PlayIcon size={13} /> : <PauseIcon size={13} />}
        </Button>
        <Button variant="danger" size="sm"
            type="button"
          
          disabled={busy}
          onClick={remove}
          aria-label={t('sched.delete', 'Delete')}
          title={t('sched.delete', 'Delete')}>
          <TrashIcon size={13} />
        </Button>
      </td>
    </tr>
  )
}

// ── New-schedule form ─────────────────────────────────────────────────────────

function ScheduleForm({
  token,
  reports,
  onCreated,
  onCancel,
}: {
  token: string
  reports: Report[]
  onCreated: () => void
  onCancel: () => void
}) {
  const [reportId, setReportId] = useState(reports[0]?.id ?? '')
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [channel, setChannel] = useState<'email' | 'slack' | 'webhook'>('email')
  const [recipients, setRecipients] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!reportId) return
    setSaving(true)
    try {
      const payload: CreatePayload = {
        report_id: reportId,
        cadence,
        channel,
        recipients: parseRecipients(recipients),
      }
      await bpost(token, '/api/report-schedules', payload)
      toast.success(t('sched.created', 'Schedule created'))
      onCreated()
    } catch (err) {
      toast.error((err as Error).message || t('sched.saveError', 'Could not save schedule'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="rec-form" onSubmit={submit} aria-label={t('sched.new', '+ Schedule')}>
      {/* Report picker */}
      <label className="field">
        <span>{t('sched.report', 'Report')} *</span>
        <select
          className="inp inp-md"
          value={reportId}
          onChange={(e) => setReportId(e.target.value)}
          required
        >
          {reports.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </label>

      {/* Cadence */}
      <label className="field">
        <span>{t('sched.cadence', 'Cadence')}</span>
        <select
          className="inp inp-md"
          value={cadence}
          onChange={(e) => setCadence(e.target.value as 'daily' | 'weekly' | 'monthly')}
        >
          <option value="daily">{t('sched.cadenceDaily', 'Daily')}</option>
          <option value="weekly">{t('sched.cadenceWeekly', 'Weekly')}</option>
          <option value="monthly">{t('sched.cadenceMonthly', 'Monthly')}</option>
        </select>
      </label>

      {/* Channel */}
      <label className="field">
        <span>{t('sched.channel', 'Channel')}</span>
        <select
          className="inp inp-md"
          value={channel}
          onChange={(e) => setChannel(e.target.value as 'email' | 'slack' | 'webhook')}
        >
          <option value="email">{t('sched.channelEmail', 'Email')}</option>
          <option value="slack">{t('sched.channelSlack', 'Slack')}</option>
          <option value="webhook">{t('sched.channelWebhook', 'Webhook')}</option>
        </select>
      </label>

      {/* Recipients — comma-separated; submitted as a list[str] per backend contract. */}
      <label className="field">
        <span>{t('sched.recipients', 'Recipients')}</span>
        <input
          type="text"
          className="inp inp-md"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          placeholder={t('sched.recipientsHint', 'Comma-separated emails / IDs')}
        />
      </label>

      {/* Actions — spans full grid width */}
      <div className="rec-form-actions">
        <Button variant="gold" size="md"
            type="submit"
          
          disabled={saving || !reportId}>
          {saving ? t('common.saving', 'Saving…') : t('sched.save', 'Save schedule')}
        </Button>
        <Button variant="ghost" size="md"
            type="button"
          
          onClick={onCancel}
          aria-label={t('common.close', 'Close')}>
          <CloseIcon size={14} />
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function ReportSchedulePanel({
  token,
  reports,
}: {
  token: string
  reports: Report[]
}) {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)

  async function load() {
    setError('')
    const res: Fetched<Schedule[]> = await bget(token, '/api/report-schedules')
    if (res.status === 404) { setUnavailable(true); setSchedules([]); return }
    if (!res.ok) { setError(t('sched.loadError', 'Failed to load schedules')); setSchedules([]); return }
    setSchedules(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token])

  // Hidden entirely if the endpoint is 404 — graceful degradation
  if (unavailable) return null

  return (
    <section className="card" aria-label={t('sched.title', 'Schedules')}>
      <div className="view-head" style={{ marginBottom: 0 }}>
        <CalendarIcon size={18} aria-hidden />
        <h3 style={{ margin: 0 }}>{t('sched.title', 'Schedules')}</h3>
        {!showForm && reports.length > 0 && (
          <div className="view-head-actions">
            <Button variant="primary" size="sm"
            type="button"
              
              onClick={() => setShowForm(true)}
            >
              {t('sched.new', '+ Schedule')}
            </Button>
          </div>
        )}
      </div>

      {showForm && (
        <ScheduleForm
          token={token}
          reports={reports}
          onCreated={() => { setShowForm(false); load() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {error && <ErrorBanner message={error} onRetry={load} />}

      {schedules === null && !error && <SkeletonRows rows={2} />}

      {schedules !== null && schedules.length === 0 && !error && (
        <EmptyState
          title={t('sched.noSchedules', 'No schedules yet')}
          message={t('sched.noSchedulesMsg', 'Schedule a report to receive it on a recurring cadence.')}
        />
      )}

      {schedules !== null && schedules.length > 0 && (
        <div className="grid-wrap">
          <table className="grid" role="list">
            <thead>
              <tr>
                <th scope="col">{t('sched.report', 'Report')}</th>
                <th scope="col">{t('sched.cadence', 'Cadence')}</th>
                <th scope="col">{t('sched.channel', 'Channel')}</th>
                <th scope="col">{t('sched.nextRun', 'Next')}</th>
                <th scope="col">{t('sched.status', 'Status')}</th>
                <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <ScheduleItem key={s.id} sched={s} token={token} onMutate={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
