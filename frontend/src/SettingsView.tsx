import { useEffect, useState } from 'react'
import { bget, bput } from './billing'
import { toast } from './Toast'
import { EmptyState, ErrorBanner, PermissionDenied } from './States'
import { GearIcon } from './icons'
import { useI18n, setLang, type Lang } from './i18n'

// Tenant settings (E19): GET/PUT /api/tenant/settings. Edits name/currency/locale/logo_text with a
// saved toast. Degrades to "not available yet" on 404 and "denied" on 403 (lanes land together).
type TenantSettings = {
  name?: string
  currency?: string
  locale?: string
  logo_text?: string
  onboarded?: boolean
  [k: string]: any
}

export default function SettingsView({ token, onSaved }: { token: string; onSaved?: (s: TenantSettings) => void }) {
  const { t } = useI18n()
  const [loaded, setLoaded] = useState<TenantSettings | null>(null)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('AMD')
  const [locale, setLocale] = useState<string>('en')
  const [logoText, setLogoText] = useState('')

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setLoaded(null)
    const res = await bget<TenantSettings>(token, '/api/tenant/settings')
    if (res.status === 404) { setUnavailable(true); return }
    if (res.status === 403) { setDenied(true); return }
    if (!res.ok || !res.data) { setError(t('settings.loadError', 'Failed to load settings')); return }
    const d = res.data
    setLoaded(d)
    setName(d.name ?? ''); setCurrency(d.currency ?? 'AMD'); setLocale(d.locale ?? 'en'); setLogoText(d.logo_text ?? '')
  }

  useEffect(() => { load() }, [token])

  async function save() {
    setSaving(true)
    try {
      const updated = await bput<TenantSettings>(token, '/api/tenant/settings', {
        name: name.trim(), currency: currency.trim(), locale, logo_text: logoText.trim(),
      })
      toast.success(t('settings.saved', 'Settings saved'))
      if (locale === 'en' || locale === 'hy') setLang(locale as Lang)   // reflect the locale change live
      setLoaded(updated ?? { name, currency, locale, logo_text: logoText })
      onSaved?.(updated ?? { name, currency, locale, logo_text: logoText })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (denied) return <PermissionDenied message={t('settings.denied', "You don't have permission to manage settings.")} />

  return (
    <div>
      <div className="view-head"><h2>{t('nav.settings', 'Settings')}</h2></div>

      {unavailable && (
        <EmptyState icon={<GearIcon size={40} />} title={t('settings.unavailable', "Settings aren't available yet")}
                    message={t('settings.unavailableMsg', 'Tenant settings will appear here once enabled.')} />
      )}
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!loaded && !unavailable && !error && <p className="muted">{t('common.loading', 'Loading…')}</p>}

      {loaded && (
        <>
          <div className="bill-meta">
            <div><span className="muted">{t('settings.logoText', 'Logo text')}</span><div>{loaded.logo_text || 'GAAex'}</div></div>
            <div><span className="muted">{t('wizard.locale', 'Language')}</span><div>{(loaded.locale ?? 'en') === 'hy' ? 'Հայերեն' : 'English'}</div></div>
          </div>

          <div className="rec-form">
            <label className="field"><span>{t('common.name', 'Name')}</span>
              <input className="inp inp-md" value={name} onChange={(e) => setName(e.target.value)} aria-label={t('common.name', 'Name')} />
            </label>
            <label className="field"><span>{t('wizard.currency', 'Currency')}</span>
              <input className="inp inp-md" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label={t('wizard.currency', 'Currency')} />
            </label>
            <label className="field"><span>{t('wizard.locale', 'Language')}</span>
              <select className="inp inp-md" value={locale} onChange={(e) => setLocale(e.target.value)} aria-label={t('wizard.locale', 'Language')}>
                <option value="en">English</option>
                <option value="hy">Հայերեն</option>
              </select>
            </label>
            <label className="field"><span>{t('settings.logoText', 'Logo text')}</span>
              <input className="inp inp-md" value={logoText} onChange={(e) => setLogoText(e.target.value)} aria-label={t('settings.logoText', 'Logo text')} />
            </label>
            <div className="rec-form-actions">
              <button className="btn btn-primary btn-md" onClick={save} disabled={saving}>
                {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
