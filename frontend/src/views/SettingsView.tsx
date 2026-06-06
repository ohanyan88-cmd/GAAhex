import { useEffect, useState } from 'react'
import { bget, bput } from '../lib/billing'
import { toast } from '../components/Toast'
import { PermissionDenied, SkeletonRows, EmptyState } from '../components/States'
import { GearIcon, CheckIcon } from '../components/icons'
import { useI18n, setLang, type Lang } from '../lib/i18n'
import { PageShell } from '../page-shell'

// Backend `/api/tenant/settings` (PUT) only accepts: name, currency, locale, logo_text, logo_url.
// Any field outside that allow-list 422s. We render ONLY what persists — doctrine rules 2, 3, 4.
type AppSettings = {
  name?: string
  currency?: string
  locale?: string
  logo_text?: string | null
  logo_url?: string | null
  onboarded?: boolean
  onboarded_at?: string | null
}

export default function SettingsView({ token, onSaved }: { token: string; onSaved?: (s: AppSettings) => void }) {
  const { t } = useI18n()
  const [loaded, setLoaded] = useState<AppSettings | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  // Only fields the backend actually persists.
  const [name, setName] = useState('')
  const [locale, setLocale] = useState<Lang>('en')
  const [currency, setCurrency] = useState('AMD')
  const [logoText, setLogoText] = useState('')

  async function load() {
    setLoading(true); setUnavailable(false); setDenied(false); setLoaded(null)
    const res = await bget<AppSettings>(token, '/api/tenant/settings')
    setLoading(false)
    if (res.status === 404) { setUnavailable(true); return }
    if (res.status === 403) { setDenied(true); return }
    if (!res.ok || !res.data) return
    const d = res.data
    setLoaded(d)
    setName(d.name ?? '')
    setLocale((d.locale === 'hy' ? 'hy' : 'en') as Lang)
    setCurrency(d.currency ?? 'AMD')
    setLogoText(d.logo_text ?? '')
  }

  useEffect(() => { load() }, [token])

  async function save() {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        currency: currency.trim(),
        locale,
        logo_text: logoText.trim() || null,
      }
      const updated = await bput<AppSettings>(token, '/api/tenant/settings', payload)
      toast.success(t('settings.saved', 'Settings saved'))
      setLang(locale)
      setLoaded(updated)
      onSaved?.(updated)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (denied) return <PermissionDenied message={t('settings.denied', "You don't have permission to manage settings.")} />

  const sections = !loading && !unavailable && loaded
    ? [
        {
          title: 'General',
          rows: [
            {
              label: 'Display name',
              el: <input className="inp inp-sm" style={{ width: 240 }} value={name} onChange={e => setName(e.target.value)} />,
            },
            {
              label: 'Default locale',
              el: (
                <select className="inp inp-sm" style={{ width: 240 }} value={locale} onChange={e => setLocale(e.target.value as Lang)}>
                  <option value="en">English (en)</option>
                  <option value="hy">Հայերեն (hy-AM)</option>
                </select>
              ),
            },
            {
              label: 'Currency',
              el: <input className="inp inp-sm" style={{ width: 240 }} value={currency} onChange={e => setCurrency(e.target.value)} />,
            },
            {
              label: 'Logo text',
              el: <input className="inp inp-sm" style={{ width: 240 }} value={logoText} onChange={e => setLogoText(e.target.value)} />,
            },
          ],
        },
      ]
    : []

  return (
    <PageShell
      type="CONFIGURATION"
      breadcrumb={['Admin Panel', 'Settings']}
      icon={<GearIcon size={20} />}
      title="Settings"
      subtitle="Tenant configuration"
      primaryAction={!loading && !unavailable && loaded ? {
        label: saving ? 'Saving…' : 'Save',
        onClick: save,
        disabled: saving,
        icon: <CheckIcon size={14} />,
      } : undefined}
    >
      <div style={{ maxWidth: 880 }}>
        {loading && <SkeletonRows rows={6} />}

        {!loading && (unavailable || !loaded) && (
          <EmptyState
            title={t('settings.unavailable', 'Settings unavailable')}
            message="The /api/tenant/settings endpoint did not respond."
          />
        )}

        {!loading && !unavailable && loaded && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-8)' }}>
            {sections.map(s => (
              <div className="card" key={s.title}>
                <div className="card-head"><h3>{s.title}</h3></div>
                <div style={{ padding: 'var(--gx-space-2) var(--gx-space-18) var(--gx-space-4)' }}>
                  {s.rows.map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)', padding: '13px 0', borderBottom: i < s.rows.length - 1 ? '1px solid var(--gx-border-subtle)' : 'none' }}>
                      <span style={{ fontSize: 'var(--gx-text-13)', fontWeight: 500, flex: 1 }}>{r.label}</span>
                      {r.el}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {loaded.onboarded_at && (
              <div className="hint" style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', textAlign: 'right' }}>
                Onboarded {new Date(loaded.onboarded_at).toLocaleDateString()}
              </div>
            )}
          </div>
        )}
      </div>
    </PageShell>
  )
}
