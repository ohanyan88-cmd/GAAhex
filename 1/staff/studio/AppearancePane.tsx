import { useEffect, useState } from 'react'
import { LoadingState, ErrorBanner, PermissionDenied } from '../components/States'
import { BuildingIcon, CheckIcon, EditIcon } from '../components/icons'

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: 'Bearer ' + token })

// ── Types ─────────────────────────────────────────────────────────────────────

// Shape derived from tenant_settings.py _serialize():
//   name, currency, locale, logo_text, onboarded, onboarded_at
// PUT /api/tenant/settings accepts: name, currency, locale, logo_text
type Settings = {
  name: string
  currency: string
  locale: string
  logo_text: string | null
  onboarded: boolean
  onboarded_at: string | null
}

// The four editable fields — exactly what the backend's allowed set accepts.
type FormState = {
  name: string
  currency: string
  locale: string
  logo_text: string
}

class FetchError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function jreq(token: string, path: string, method = 'GET', body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: { ...authH(token), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
  const r = await fetch(`${BASE}${path}`, opts)
  const data = await r.json().catch(() => ({ detail: 'Error' }))
  if (!r.ok) throw new FetchError(data.detail || `Request failed (${r.status})`, r.status)
  return data
}

const LOCALES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'hy', label: 'Armenian (hy)' },
]

// ── Main pane ─────────────────────────────────────────────────────────────────

export default function AppearancePane({ token }: { token: string }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  // form state
  const [form, setForm] = useState<FormState>({ name: '', currency: '', locale: 'en', logo_text: '' })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

  function loadSettings() {
    let alive = true
    setLoading(true); setError(''); setDenied(false); setSaved(false)
    jreq(token, '/api/tenant/settings')
      .then((s: Settings) => {
        if (!alive) return
        setSettings(s)
        setForm({
          name: s.name ?? '',
          currency: s.currency ?? 'AMD',
          locale: s.locale ?? 'en',
          logo_text: s.logo_text ?? '',
        })
      })
      .catch((e: unknown) => {
        if (!alive) return
        if (e instanceof FetchError && e.status === 403) setDenied(true)
        else setError((e as Error).message)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }

  useEffect(loadSettings, [token])

  function patch(field: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
    setDirty(true)
    setSaved(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaveError(''); setSaving(true); setSaved(false)
    try {
      const payload: Record<string, string | null> = {
        name: form.name.trim(),
        currency: form.currency.trim().toUpperCase(),
        locale: form.locale,
        logo_text: form.logo_text.trim() || null,
      }
      const updated: Settings = await jreq(token, '/api/tenant/settings', 'PUT', payload)
      setSettings(updated)
      setForm({
        name: updated.name ?? '',
        currency: updated.currency ?? 'AMD',
        locale: updated.locale ?? 'en',
        logo_text: updated.logo_text ?? '',
      })
      setDirty(false)
      setSaved(true)
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to edit tenant settings." />
  if (error) return <ErrorBanner message={error} onRetry={loadSettings} />

  return (
    <div>
      <div className="row" style={{ marginBottom: 18 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>Appearance</h3>
          <p className="hint" style={{ margin: 0 }}>
            Tenant identity — name, locale, currency, and the logo mark shown in the header.
          </p>
        </div>
      </div>

      {saveError && <ErrorBanner message={saveError} />}

      {saved && (
        <div
          className="error-banner"
          style={{ marginBottom: 16, borderLeftColor: 'var(--success)', background: 'var(--success-soft)' }}
          role="status"
        >
          <CheckIcon size={16} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
          <div>
            <div className="error-banner-title" style={{ color: 'var(--text)' }}>Saved</div>
            <div className="error-banner-msg">Tenant settings updated successfully.</div>
          </div>
        </div>
      )}

      <form onSubmit={submit}>
        <div className="section-head" style={{ marginTop: 0 }}>
          <BuildingIcon size={15} className="section-icon" /> Identity
        </div>

        <div className="rec-form">
          <label className="field">
            <span>Tenant name *</span>
            <input
              className="inp inp-md"
              value={form.name}
              onChange={(e) => patch('name', e.target.value)}
              placeholder="Acme ISP"
              required
            />
            <span className="hint">Shown in the app header and on documents.</span>
          </label>

          <label className="field">
            <span>Logo text</span>
            <input
              className="inp inp-md"
              value={form.logo_text}
              onChange={(e) => patch('logo_text', e.target.value)}
              placeholder="ACME"
            />
            <span className="hint">Short initials or wordmark. Leave blank to use the tenant name.</span>
          </label>
        </div>

        <div className="section-head">
          <EditIcon size={15} className="section-icon" /> Locale and currency
        </div>

        <div className="rec-form">
          <label className="field">
            <span>Locale</span>
            <select
              className="inp inp-md"
              value={form.locale}
              onChange={(e) => patch('locale', e.target.value)}
            >
              {LOCALES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
            <span className="hint">Controls date, number, and UI string formatting.</span>
          </label>

          <label className="field">
            <span>Currency code</span>
            <input
              className="inp inp-md"
              value={form.currency}
              onChange={(e) => patch('currency', e.target.value.toUpperCase())}
              placeholder="AMD"
              maxLength={8}
            />
            <span className="hint">3–8 alphabetic characters, e.g. AMD, USD, EUR.</span>
          </label>
        </div>

        {settings && (
          <div className="section-head">
            <CheckIcon size={15} className="section-icon" /> Onboarding status
          </div>
        )}

        {settings && (
          <div style={{ marginBottom: 20 }}>
            {settings.onboarded ? (
              <div
                className="error-banner"
                style={{ borderLeftColor: 'var(--success)', background: 'var(--success-soft)' }}
              >
                <CheckIcon size={16} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div className="error-banner-title" style={{ color: 'var(--text)' }}>Onboarding complete</div>
                  <div className="error-banner-msg">
                    Marked as onboarded on {settings.onboarded_at
                      ? new Date(settings.onboarded_at).toLocaleDateString()
                      : '—'}.
                  </div>
                </div>
              </div>
            ) : (
              <p className="hint">Onboarding not yet completed for this tenant.</p>
            )}
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <button
            type="submit"
            className="btn btn-accent btn-sm"
            disabled={saving || !dirty}
          >
            <CheckIcon size={13} /> {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </div>
  )
}
