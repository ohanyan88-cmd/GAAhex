// NetworkInventoryView — Mass Broadcasts tab and create modal.
import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Modal } from '../../components/Modal'
import { toast } from '../../components/Toast'
import { Button, StatusPill } from '../../primitives'
import type { LoadState } from '../../primitives'
import { PlusIcon, RefreshIcon } from '../../components/icons'
import { bpost } from '../../lib/billing'
import { fmtDate, timeAgo } from '../../lib/time'
import type { Broadcast, BroadcastChannel } from './types'
import { broadcastStatusVariant } from './helpers'
import { FilterSelect, TabToolbar, LoadShell, Field } from './shared'

export function BroadcastTab({ state, status, onStatus, canAdmin, onNew, onSend, onReload }: {
  state: LoadState<Broadcast>
  status: string
  onStatus: (s: string) => void
  canAdmin: boolean
  onNew: () => void
  onSend: (b: Broadcast) => void
  onReload: () => void
}) {
  return (
    <div>
      <TabToolbar
        left={
          <FilterSelect
            label="Status"
            value={status}
            onChange={onStatus}
            options={[
              ['all',      'All statuses'],
              ['draft',    'Draft'],
              ['sending',  'Sending'],
              ['complete', 'Complete'],
              ['failed',   'Failed'],
            ]}
          />
        }
        right={
          <>
            <Button variant="ghost" size="sm"
            onClick={onReload}>
              <RefreshIcon size={13} /> Refresh
            </Button>
            {canAdmin && (
              <Button variant="primary" size="sm"
            onClick={onNew}>
                <PlusIcon size={13} /> New Broadcast
              </Button>
            )}
          </>
        }
      />

      <LoadShell
        state={state}
        emptyTitle="No broadcasts to show"
        emptyMessage="Mass broadcasts created from incidents will appear here."
        onRetry={onReload}
      >
        {(items) => (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="grid" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Template</th>
                    <th className="num">Recipients</th>
                    <th className="num">Sent</th>
                    <th className="num">Failed</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th className="actions-col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => {
                    const isDraft = (b.status ?? '').toLowerCase() === 'draft'
                    return (
                      <tr key={b.id}>
                        <td style={{ fontWeight: 'var(--gx-weight-medium)' }}>{b.channel ?? '—'}</td>
                        <td><span className="mono" style={{ fontSize: 'var(--gx-text-sm)' }}>{b.template_id ? b.template_id.slice(0, 12) : '—'}</span></td>
                        <td className="num"><span className="mono tnum">{b.recipient_count ?? '—'}</span></td>
                        <td className="num"><span className="mono tnum">{b.sent_count ?? '—'}</span></td>
                        <td className="num"><span className="mono tnum">{b.failed_count ?? '—'}</span></td>
                        <td>
                          <StatusPill variant={broadcastStatusVariant(b.status)} label={b.status ?? '—'} size="sm" />
                        </td>
                        <td className="muted" style={{ fontSize: 'var(--gx-text-sm)' }}>
                          <span title={b.created_at ?? undefined}>{timeAgo(b.created_at ?? null) || fmtDate(b.created_at)}</span>
                        </td>
                        <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            {canAdmin && isDraft && (
                              <Button variant="ghost" size="sm" onClick={() => onSend(b)}>Send</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </LoadShell>
    </div>
  )
}

export function BroadcastCreateModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: () => void
}) {
  const { token } = useAuth()
  const [channel, setChannel] = useState<BroadcastChannel>('sms')
  const [templateId, setTemplateId] = useState('')
  const [audienceJson, setAudienceJson] = useState('{}')
  const [incidentId, setIncidentId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setSubmitting(true)
    try {
      // Parse the audience filter as JSON; reject invalid input rather than silently sending garbage.
      let audience: any = {}
      const txt = audienceJson.trim()
      if (txt) {
        try { audience = JSON.parse(txt) }
        catch { toast.error('Audience filter must be valid JSON'); setSubmitting(false); return }
      }
      const body: Record<string, any> = {
        channel,
        audience_filter_json: audience,
      }
      if (templateId.trim())  body.template_id = templateId.trim()
      if (incidentId.trim())  body.incident_record_id = incidentId.trim()
      await bpost(token!, '/api/broadcasts', body)
      toast.success('Broadcast drafted')
      onCreated()
    } catch (e) {
      toast.error((e as Error).message || 'Failed to create broadcast')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => submitting ? undefined : onClose()}
      title="New Broadcast"
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" size="md"
            onClick={submit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create draft'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-6)' }}>
        <Field label="Channel *">
          <select className="inp inp-md" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
            <option value="voice">Voice</option>
            <option value="push">Push</option>
          </select>
        </Field>
        <Field label="Template ID">
          <input className="inp inp-md" value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="template UUID or key" />
        </Field>
        <Field label="Incident record ID (optional)">
          <input className="inp inp-md" value={incidentId} onChange={(e) => setIncidentId(e.target.value)} placeholder="incident UUID" />
        </Field>
        <Field label="Audience filter (JSON)">
          <textarea
            className="inp inp-md"
            rows={5}
            value={audienceJson}
            onChange={(e) => setAudienceJson(e.target.value)}
            placeholder='{ "region": "Yerevan", "service_status": "ACTIVE" }'
            style={{
              fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
              fontSize: 'var(--gx-text-sm)',
            }}
          />
        </Field>
      </div>
    </Modal>
  )
}
