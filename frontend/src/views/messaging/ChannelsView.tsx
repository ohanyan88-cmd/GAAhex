// Messaging Channels — per-tenant SMS / Telegram / WhatsApp configuration (config surface for the
// /api/messaging backend). Each tenant manages its own channel accounts; secrets are write-only.
// Telegram is live; SMS (Viva Armenia) + WhatsApp accounts can be configured and go live once the
// provider gateways are wired. D20-clean: no inline hex/px; primitives + token classes only.
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Button, Input, FormField, StatusPill } from '../../primitives'
import { Select } from '../../components/Select'
import { Modal } from '../../components/Modal'
import { EmptyState, LoadingState, ErrorBanner } from '../../components/States'
import { toast } from '../../components/Toast'
import { MessageIcon, PlusIcon, TrashIcon, RefreshIcon } from '../../components/icons'
import * as api from '../../lib/messaging'
import type { ChannelAccount, ChannelKind, ChannelAccountInput } from '../../lib/messaging'

const CHANNELS: { value: ChannelKind; label: string; tokenLabel: string; senderLabel: string }[] = [
  { value: 'TELEGRAM', label: 'Telegram', tokenLabel: 'Bot token', senderLabel: 'Default chat / @username' },
  { value: 'SMS', label: 'SMS (Viva Armenia)', tokenLabel: 'API key / token', senderLabel: 'Sender ID' },
  { value: 'WHATSAPP', label: 'WhatsApp Business', tokenLabel: 'Access token', senderLabel: 'WABA phone number' },
]

function statusVariant(s: string): 'active' | 'critical' | 'neutral' {
  if (s === 'CONNECTED') return 'active'
  if (s === 'CONN_ERROR' || s === 'AUTH_ERROR') return 'critical'
  return 'neutral'
}

type Draft = ChannelAccountInput & { id?: string; has_token?: boolean }

const BLANK: Draft = { channel: 'TELEGRAM', display_name: '', sender_id: '', secret_token: '', config: {} }

export default function ChannelsView() {
  const { token } = useAuth()
  const [accounts, setAccounts] = useState<ChannelAccount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [saving, setSaving] = useState(false)

  async function reload() {
    setError(null)
    const r = await api.listAccounts(token!)
    if (r.ok) setAccounts(r.data || [])
    else { setAccounts([]); setError('Failed to load channels') }
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [])

  function openCreate() { setDraft({ ...BLANK }); setOpen(true) }
  function openEdit(a: ChannelAccount) {
    setDraft({ id: a.id, channel: a.channel, display_name: a.display_name, sender_id: a.sender_id || '',
      secret_token: '', config: a.config || {}, has_token: a.has_token, is_default: a.is_default, is_active: a.is_active })
    setOpen(true)
  }

  async function save() {
    if (!draft.display_name.trim()) { toast.error('Display name is required'); return }
    setSaving(true)
    try {
      const payload: Partial<ChannelAccountInput> = {
        channel: draft.channel, display_name: draft.display_name.trim(),
        sender_id: draft.sender_id || undefined, config: draft.config,
      }
      if (draft.secret_token) payload.secret_token = draft.secret_token   // write-only
      if (draft.id) await api.updateAccount(token!, draft.id, payload)
      else await api.createAccount(token!, payload as ChannelAccountInput)
      toast.success('Channel saved')
      setOpen(false)
      await reload()
    } catch (e: any) {
      toast.error(e?.message || 'Save failed')
    } finally { setSaving(false) }
  }

  async function test(a: ChannelAccount) {
    try {
      const r = await api.testAccount(token!, a.id)
      r.ok ? toast.success(`${a.display_name}: connected`) : toast.error(`${a.display_name}: ${r.detail || r.status}`)
      await reload()
    } catch (e: any) { toast.error(e?.message || 'Test failed') }
  }

  async function remove(a: ChannelAccount) {
    if (!confirm(`Delete channel "${a.display_name}"?`)) return
    try { await api.deleteAccount(token!, a.id); await reload() }
    catch (e: any) { toast.error(e?.message || 'Delete failed') }
  }

  const meta = CHANNELS.find((c) => c.value === draft.channel)!

  return (
    <div className="gx-page-pad">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="gx-page-title"><MessageIcon size={20} /> Messaging Channels</h2>
        <Button variant="primary" onClick={openCreate}><PlusIcon size={15} /> Add channel</Button>
      </div>
      <p className="muted">Per-tenant SMS, Telegram, and WhatsApp — each tenant sends from its own credentials.</p>

      {accounts === null ? <LoadingState /> : error ? <ErrorBanner message={error} onRetry={reload} /> :
        accounts.length === 0 ? (
          <EmptyState icon={<MessageIcon size={40} />} title="No channels yet"
            message="Add a Telegram bot, SMS sender, or WhatsApp account to send notifications from your own credentials."
            action={<Button variant="primary" onClick={openCreate}><PlusIcon size={15} /> Add channel</Button>} />
        ) : (
          <div className="gx-stack">
            {accounts.map((a) => (
              <div key={a.id} className="gx-card row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>{a.display_name}</strong> <span className="muted">· {CHANNELS.find((c) => c.value === a.channel)?.label || a.channel}</span>
                  {a.sender_id ? <div className="muted">{a.sender_id}</div> : null}
                  {a.last_error ? <div className="muted">{a.last_error}</div> : null}
                </div>
                <div className="row" style={{ gap: 'var(--gx-space-2)', alignItems: 'center' }}>
                  <StatusPill variant={statusVariant(a.status)} label={a.status} size="sm" />
                  <Button variant="ghost" size="sm" onClick={() => test(a)}><RefreshIcon size={14} /> Test</Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(a)}><TrashIcon size={14} /></Button>
                </div>
              </div>
            ))}
          </div>
        )}

      {open && (
        <Modal open={open} onClose={() => setOpen(false)} title={draft.id ? 'Edit channel' : 'Add channel'}
          footer={<>
            <Button variant="tertiary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>Save</Button>
          </>}>
          <div className="gx-stack">
            <FormField label="Channel">
              <Select value={draft.channel}
                options={CHANNELS.map((c) => c.label)}
                onChange={(label) => {
                  const c = CHANNELS.find((x) => x.label === label)!
                  setDraft((d) => ({ ...d, channel: c.value }))
                }} />
            </FormField>
            <FormField label="Display name" required>
              <Input value={draft.display_name} onChange={(e) => setDraft((d) => ({ ...d, display_name: e.target.value }))}
                placeholder="e.g. HouseNet Notifier" />
            </FormField>
            <FormField label={meta.senderLabel}>
              <Input value={draft.sender_id || ''} onChange={(e) => setDraft((d) => ({ ...d, sender_id: e.target.value }))} />
            </FormField>
            <FormField label={meta.tokenLabel} hint={draft.has_token ? '•••• set — type to replace' : undefined}>
              <Input type="password" value={draft.secret_token || ''}
                onChange={(e) => setDraft((d) => ({ ...d, secret_token: e.target.value }))}
                placeholder={draft.has_token ? '•••• set — replace?' : ''} />
            </FormField>
            {draft.channel === 'WHATSAPP' && (
              <FormField label="Phone number ID (WABA)">
                <Input value={(draft.config?.phone_number_id as string) || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, config: { ...d.config, phone_number_id: e.target.value } }))} />
              </FormField>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
