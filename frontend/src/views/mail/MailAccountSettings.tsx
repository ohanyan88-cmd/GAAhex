// MailAccountSettings — Identity / IMAP / SMTP / Auth field groups inside a Modal,
// opened from the FolderSidebar gear or ?settings=1. Edits the passed `account`, or
// creates a new one when `account === null`. Actions: Test connection, Save, Sync now,
// Set default, Delete.
//
// HARD RULES honored:
//   * No raw fetch — all network goes through the parent's onSave/onTest/onSyncNow/
//     onSetDefault/onDelete handlers (wired to lib/mail.ts in MailView).
//   * No inline hex/px — every visual value is a --gx-* token via a CSS class
//     (.rec-form* sections + .field grids + primitives). D20-clean.
//   * Password is WRITE-ONLY: GET never returns the secret. When a credential is already
//     stored we show the "•••• set — replace?" affordance and transmit `secret_password`
//     ONLY when the operator types a new value. On create, the field is a normal entry.
//   * The UI never sends tenant_id (JWT + RLS server-side).
import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../components/Modal'
import { confirmDialog } from '../../components/Modal'
import { Button } from '../../primitives'
import { Input } from '../../primitives'
import { FormField } from '../../primitives'
import { StatusPill } from '../../primitives'
import { Select } from '../../components/Select'
import { toast } from '../../components/Toast'
import {
  UserIcon,
  InboxIcon,
  SendHorizontalIcon,
  ShieldIcon,
  RefreshIcon,
  StarIcon,
  TrashIcon,
  CheckIcon,
  CloseIcon,
} from '../../components/icons'
import type {
  MailAccountSettingsProps,
  MailAccountInput,
  MailTransportSecurity,
  MailAuthType,
  MailAccountStatus,
  MailAccountTestResult,
} from './types'

// ── Enum option lists (B1 UPPER_SNAKE_CASE values; the Select shows them verbatim) ──
const SECURITY_OPTS: MailTransportSecurity[] = ['SSL', 'STARTTLS', 'NONE']
const AUTH_OPTS: MailAuthType[] = ['PASSWORD', 'OAUTH2']

// Map the account status enum → StatusPill variant (no new colors; reuse the family).
const STATUS_PILL: Record<MailAccountStatus, { variant: 'active' | 'degraded' | 'critical' | 'neutral' | 'info'; label: string }> = {
  CONNECTED:  { variant: 'active',   label: 'Connected' },
  PENDING:    { variant: 'info',     label: 'Pending' },
  AUTH_ERROR: { variant: 'critical', label: 'Auth error' },
  CONN_ERROR: { variant: 'critical', label: 'Connection error' },
  DISABLED:   { variant: 'neutral',  label: 'Disabled' },
}

// The editable form shape — secret_password kept separate so we only ever transmit a typed value.
type FormState = {
  display_name: string
  email_address: string
  imap_host: string
  imap_port: string
  imap_security: MailTransportSecurity
  smtp_host: string
  smtp_port: string
  smtp_security: MailTransportSecurity
  auth_type: MailAuthType
  auth_username: string
  sync_enabled: boolean
}

const BLANK: FormState = {
  display_name: '',
  email_address: '',
  imap_host: '',
  imap_port: '993',
  imap_security: 'SSL',
  smtp_host: '',
  smtp_port: '465',
  smtp_security: 'SSL',
  auth_type: 'PASSWORD',
  auth_username: '',
  sync_enabled: true,
}

export default function MailAccountSettings({
  open,
  account,
  onClose,
  onSave,
  onTest,
  onSyncNow,
  onSetDefault,
  onDelete,
}: MailAccountSettingsProps) {
  const isEdit = !!account
  const [form, setForm] = useState<FormState>(BLANK)
  // Write-only secret: empty string ⇒ "leave stored credential untouched" on edit.
  const [secret, setSecret] = useState('')
  const [replacePwd, setReplacePwd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [testResult, setTestResult] = useState<MailAccountTestResult | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Hydrate the form whenever the modal opens or the target account changes.
  useEffect(() => {
    if (!open) return
    setSecret('')
    setReplacePwd(false)
    setTestResult(null)
    setErrors({})
    if (account) {
      setForm({
        display_name: account.display_name ?? '',
        email_address: account.email_address ?? '',
        imap_host: account.imap_host ?? '',
        imap_port: String(account.imap_port ?? ''),
        imap_security: account.imap_security ?? 'SSL',
        smtp_host: account.smtp_host ?? '',
        smtp_port: String(account.smtp_port ?? ''),
        smtp_security: account.smtp_security ?? 'SSL',
        auth_type: account.auth_type ?? 'PASSWORD',
        auth_username: account.auth_username ?? '',
        sync_enabled: account.sync_enabled ?? true,
      })
    } else {
      setForm(BLANK)
    }
  }, [open, account])

  // On edit, a password is already stored unless the operator chose to replace it.
  const hasStoredPassword = !!account?.has_password
  // Whether the secret field is "live" (a new value being typed): always on create; on edit
  // only after the operator clicks "replace".
  const secretActive = !isEdit || replacePwd

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setTestResult(null)
  }

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!form.display_name.trim()) e.display_name = 'Required'
    if (!form.email_address.trim()) e.email_address = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email_address.trim())) e.email_address = 'Enter a valid email'
    if (!form.imap_host.trim()) e.imap_host = 'Required'
    if (!form.smtp_host.trim()) e.smtp_host = 'Required'
    const imapPort = Number(form.imap_port)
    if (!form.imap_port.trim() || !Number.isInteger(imapPort) || imapPort <= 0) e.imap_port = 'Port required'
    const smtpPort = Number(form.smtp_port)
    if (!form.smtp_port.trim() || !Number.isInteger(smtpPort) || smtpPort <= 0) e.smtp_port = 'Port required'
    // Password is mandatory on create (and when replacing); on edit-keep it stays stored.
    if (form.auth_type === 'PASSWORD' && secretActive && !secret) {
      e.secret_password = isEdit ? 'Enter the new password' : 'Required'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // Assemble the write payload. On edit, send a Partial and omit secret_password unless typed.
  function buildPayload(): MailAccountInput | Partial<MailAccountInput> {
    const base: MailAccountInput = {
      display_name: form.display_name.trim(),
      email_address: form.email_address.trim(),
      imap_host: form.imap_host.trim(),
      imap_port: Number(form.imap_port),
      imap_security: form.imap_security,
      smtp_host: form.smtp_host.trim(),
      smtp_port: Number(form.smtp_port),
      smtp_security: form.smtp_security,
      auth_type: form.auth_type,
      auth_username: form.auth_username.trim() || null,
      sync_enabled: form.sync_enabled,
    }
    // Transmit the secret ONLY when the operator typed a new value.
    if (secretActive && secret) base.secret_password = secret
    return base
  }

  async function handleSave() {
    if (saving) return
    if (!validate()) return
    setSaving(true)
    try {
      await onSave(account?.id ?? null, buildPayload())
      // Parent reloads accounts + toasts success and (on create) keeps the modal open via
      // its own state; we close here so the operator returns to the mailbox.
      onClose()
    } catch (e) {
      toast.error((e as Error).message || 'Could not save the account.')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (!account || testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await onTest(account.id)
      setTestResult(res)
      if (res.imap_ok && res.smtp_ok) toast.success('IMAP and SMTP connected.')
      else toast.warning(res.detail || 'One or more connections failed.')
    } catch (e) {
      toast.error((e as Error).message || 'Connection test failed.')
    } finally {
      setTesting(false)
    }
  }

  async function handleSync() {
    if (!account || syncing) return
    setSyncing(true)
    try {
      await onSyncNow(account.id)
    } catch (e) {
      toast.error((e as Error).message || 'Could not queue a sync.')
    } finally {
      setSyncing(false)
    }
  }

  async function handleSetDefault() {
    if (!account || account.is_default) return
    try {
      await onSetDefault(account.id)
      toast.success('Default sending account updated.')
    } catch (e) {
      toast.error((e as Error).message || 'Could not set the default account.')
    }
  }

  async function handleDelete() {
    if (!account) return
    const ok = await confirmDialog({
      title: 'Delete mail account',
      message: `Remove “${account.display_name || account.email_address}”? Synced folders and messages for this account will be removed from GAAhex.`,
      confirmLabel: 'Delete account',
      danger: true,
    })
    if (!ok) return
    try {
      await onDelete(account.id)
      // Parent owns the close on success.
    } catch (e) {
      toast.error((e as Error).message || 'Could not delete the account.')
    }
  }

  const statusMeta = useMemo(
    () => (account ? STATUS_PILL[account.status] ?? STATUS_PILL.PENDING : null),
    [account],
  )

  if (!open) return null

  const title = isEdit ? 'Mail account settings' : 'Add a mail account'
  const subtitle = isEdit ? (account?.email_address ?? undefined) : 'Connect an IMAP/SMTP mailbox'

  // Header status + last-error live in the modal hero (only meaningful when editing).
  const hero = isEdit && account ? (
    <div className="row flex-wrap gap-12">
      {statusMeta && <StatusPill variant={statusMeta.variant} label={statusMeta.label} size="sm" />}
      {account.is_default && <StatusPill variant="info" label="Default sender" size="sm" />}
      {account.last_error && <span className="field-error">{account.last_error}</span>}
    </div>
  ) : undefined

  const footer = (
    <>
      {isEdit && (
        <Button variant="danger" size="md" onClick={handleDelete}>
          <TrashIcon size={13} /> Delete
        </Button>
      )}
      <span className="spacer" />
      <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
      <Button variant="primary" size="md" loading={saving} onClick={handleSave}>
        {isEdit ? 'Save changes' : 'Add account'}
      </Button>
    </>
  )

  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} size="lg" hero={hero} footer={footer}>
      <div className="rec-form rec-form-modal">
        {/* Identity */}
        <section className="rec-form-section">
          <div className="rec-form-section-head"><UserIcon size={13} /> Identity</div>
          <div className="rec-form-grid">
            <FormField label="Display name" required error={errors.display_name}>
              <Input
                value={form.display_name}
                onChange={(e) => set('display_name', e.target.value)}
                placeholder="Support · Billing · Sales"
                error={errors.display_name}
              />
            </FormField>
            <FormField label="Email address" required error={errors.email_address}>
              <Input
                type="email"
                value={form.email_address}
                onChange={(e) => set('email_address', e.target.value)}
                placeholder="you@example.com"
                error={errors.email_address}
              />
            </FormField>
          </div>
        </section>

        {/* IMAP (inbound) */}
        <section className="rec-form-section">
          <div className="rec-form-section-head"><InboxIcon size={13} /> IMAP · inbound</div>
          <div className="rec-form-grid">
            <FormField label="IMAP host" required error={errors.imap_host}>
              <Input
                value={form.imap_host}
                onChange={(e) => set('imap_host', e.target.value)}
                placeholder="imap.example.com"
                error={errors.imap_host}
              />
            </FormField>
            <FormField label="Port" required error={errors.imap_port}>
              <Input
                type="number"
                value={form.imap_port}
                onChange={(e) => set('imap_port', e.target.value)}
                placeholder="993"
                error={errors.imap_port}
              />
            </FormField>
            <FormField label="Security">
              <Select
                value={form.imap_security}
                options={SECURITY_OPTS}
                onChange={(v) => set('imap_security', (v || 'SSL') as MailTransportSecurity)}
              />
            </FormField>
          </div>
        </section>

        {/* SMTP (outbound) */}
        <section className="rec-form-section">
          <div className="rec-form-section-head"><SendHorizontalIcon size={13} /> SMTP · outbound</div>
          <div className="rec-form-grid">
            <FormField label="SMTP host" required error={errors.smtp_host}>
              <Input
                value={form.smtp_host}
                onChange={(e) => set('smtp_host', e.target.value)}
                placeholder="smtp.example.com"
                error={errors.smtp_host}
              />
            </FormField>
            <FormField label="Port" required error={errors.smtp_port}>
              <Input
                type="number"
                value={form.smtp_port}
                onChange={(e) => set('smtp_port', e.target.value)}
                placeholder="465"
                error={errors.smtp_port}
              />
            </FormField>
            <FormField label="Security">
              <Select
                value={form.smtp_security}
                options={SECURITY_OPTS}
                onChange={(v) => set('smtp_security', (v || 'SSL') as MailTransportSecurity)}
              />
            </FormField>
          </div>
        </section>

        {/* Auth */}
        <section className="rec-form-section">
          <div className="rec-form-section-head"><ShieldIcon size={13} /> Authentication</div>
          <div className="rec-form-grid">
            <FormField label="Auth type">
              <Select
                value={form.auth_type}
                options={AUTH_OPTS}
                onChange={(v) => set('auth_type', (v || 'PASSWORD') as MailAuthType)}
              />
            </FormField>
            <FormField label="Username" hint="Defaults to the email address">
              <Input
                value={form.auth_username}
                onChange={(e) => set('auth_username', e.target.value)}
                placeholder={form.email_address || 'login@example.com'}
                autoComplete="off"
              />
            </FormField>
            {form.auth_type === 'PASSWORD' && (
              <FormField
                label="Password"
                error={errors.secret_password}
                hint={secretActive ? 'Stored encrypted; never returned by the API' : undefined}
              >
                {/* Write-only: on edit with a stored credential, show the masked affordance
                    until the operator chooses to replace it. */}
                {isEdit && hasStoredPassword && !replacePwd ? (
                  <div className="row gap-8">
                    <span className="muted">•••• set</span>
                    <Button variant="link" size="sm" onClick={() => { setReplacePwd(true); setSecret('') }}>
                      replace?
                    </Button>
                  </div>
                ) : (
                  <div className="row gap-8">
                    <Input
                      type="password"
                      value={secret}
                      onChange={(e) => { setSecret(e.target.value); setTestResult(null) }}
                      placeholder="App password or mailbox password"
                      autoComplete="new-password"
                      error={errors.secret_password}
                      style={{ flex: 1 }}
                    />
                    {isEdit && hasStoredPassword && (
                      <Button
                        variant="tertiary"
                        size="sm"
                        onClick={() => { setReplacePwd(false); setSecret(''); setErrors((e) => ({ ...e, secret_password: '' })) }}
                      >
                        <CloseIcon size={12} /> keep stored
                      </Button>
                    )}
                  </div>
                )}
              </FormField>
            )}
          </div>
        </section>

        {/* Sync toggle + connection/management actions (edit only) */}
        {isEdit && account && (
          <section className="rec-form-section">
            <div className="rec-form-section-head"><RefreshIcon size={13} /> Sync &amp; status</div>
            <div className="rec-form-grid rec-form-grid-bare">
              <label className="row gap-8" style={{ gridColumn: '1 / -1' }}>
                <input
                  type="checkbox"
                  checked={form.sync_enabled}
                  onChange={(e) => set('sync_enabled', e.target.checked)}
                />
                <span>Sync this mailbox automatically</span>
              </label>

              {testResult && (
                <div className="row flex-wrap gap-12" style={{ gridColumn: '1 / -1' }}>
                  <span className="row gap-4">
                    {testResult.imap_ok ? <CheckIcon size={13} /> : <CloseIcon size={13} />}
                    <span className={testResult.imap_ok ? '' : 'field-error'}>IMAP {testResult.imap_ok ? 'OK' : 'failed'}</span>
                  </span>
                  <span className="row gap-4">
                    {testResult.smtp_ok ? <CheckIcon size={13} /> : <CloseIcon size={13} />}
                    <span className={testResult.smtp_ok ? '' : 'field-error'}>SMTP {testResult.smtp_ok ? 'OK' : 'failed'}</span>
                  </span>
                  {testResult.detail && <span className="muted">{testResult.detail}</span>}
                </div>
              )}

              <div className="row flex-wrap gap-8" style={{ gridColumn: '1 / -1' }}>
                <Button variant="secondary" size="sm" loading={testing} onClick={handleTest}>
                  Test connection
                </Button>
                <Button variant="ghost" size="sm" loading={syncing} onClick={handleSync}>
                  <RefreshIcon size={12} /> Sync now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={account.is_default}
                  onClick={handleSetDefault}
                >
                  <StarIcon size={12} /> {account.is_default ? 'Default sender' : 'Set as default'}
                </Button>
              </div>
            </div>
          </section>
        )}
      </div>
    </Modal>
  )
}
