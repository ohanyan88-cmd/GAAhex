import { useEffect, useState } from 'react'
import { bget, bput } from '../lib/billing'
import { toast } from '../components/Toast'
import { PermissionDenied } from '../components/States'
import { GearIcon, CheckIcon, EditIcon } from '../components/icons'
import { useI18n, setLang, type Lang } from '../lib/i18n'
import ViewHead from '../components/ViewHead'

type TenantSettings = {
  name?: string
  currency?: string
  locale?: string
  logo_text?: string
  timezone?: string
  require_2fa?: boolean
  auto_assign?: boolean
  lazy_schema_validation?: boolean
  send_outage_notifications?: boolean
  default_role?: string
  session_timeout_hours?: number
  row_level_security?: boolean
  onboarded?: boolean
  [k: string]: any
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)} className={'gx-toggle' + (value ? ' on' : '')}>
      <span className="knob" />
    </button>
  )
}

export default function SettingsView({ token, onSaved }: { token: string; onSaved?: (s: TenantSettings) => void }) {
  const { t } = useI18n()
  const [loaded, setLoaded] = useState<TenantSettings | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [saving, setSaving] = useState(false)

  // General
  const [name, setName] = useState('')
  const [locale, setLocale] = useState('en')
  const [currency, setCurrency] = useState('AMD')
  const [timezone, setTimezone] = useState('')
  const [logoText, setLogoText] = useState('')

  // Behavior (boolean flags)
  const [require2fa, setRequire2fa] = useState(false)
  const [autoAssign, setAutoAssign] = useState(true)
  const [lazySchema, setLazySchema] = useState(true)
  const [outageNotif, setOutageNotif] = useState(false)

  // Access
  const [defaultRole, setDefaultRole] = useState('')
  const [sessionTimeout, setSessionTimeout] = useState(8)
  const [rls, setRls] = useState(false)

  async function load() {
    setUnavailable(false); setDenied(false); setLoaded(null)
    const res = await bget<TenantSettings>(token, '/api/tenant/settings')
    if (res.status === 404) { setUnavailable(true); return }
    if (res.status === 403) { setDenied(true); return }
    if (!res.ok || !res.data) return
    const d = res.data
    setLoaded(d)
    setName(d.name ?? '')
    setLocale(d.locale ?? 'en')
    setCurrency(d.currency ?? 'AMD')
    setTimezone(d.timezone ?? '')
    setLogoText(d.logo_text ?? '')
    setRequire2fa(d.require_2fa ?? false)
    setAutoAssign(d.auto_assign ?? true)
    setLazySchema(d.lazy_schema_validation ?? true)
    setOutageNotif(d.send_outage_notifications ?? false)
    setDefaultRole(d.default_role ?? '')
    setSessionTimeout(d.session_timeout_hours ?? 8)
    setRls(d.row_level_security ?? false)
  }

  useEffect(() => { load() }, [token])

  async function save() {
    setSaving(true)
    try {
      const updated = await bput<TenantSettings>(token, '/api/tenant/settings', {
        name: name.trim(), currency: currency.trim(), locale, logo_text: logoText.trim(),
        timezone: timezone.trim() || undefined,
        require_2fa: require2fa, auto_assign: autoAssign,
        lazy_schema_validation: lazySchema, send_outage_notifications: outageNotif,
        default_role: defaultRole || undefined,
        session_timeout_hours: sessionTimeout,
        row_level_security: rls,
      })
      toast.success(t('settings.saved', 'Settings saved'))
      if (locale === 'en' || locale === 'hy') setLang(locale as Lang)
      const merged = updated ?? loaded ?? {}
      setLoaded({ ...merged })
      onSaved?.(merged)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (denied) return <PermissionDenied message={t('settings.denied', "You don't have permission to manage settings.")} />

  const sections = [
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
            <select className="inp inp-sm" style={{ width: 240 }} value={locale} onChange={e => setLocale(e.target.value)}>
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
          label: 'Time zone',
          el: loaded && !loaded.timezone
            ? <span className="hint" style={{ fontSize: 12 }}>Wire timezone field in /api/tenant/settings</span>
            : <input className="inp inp-sm" style={{ width: 240 }} value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="Asia/Yerevan" />,
        },
        {
          label: 'Logo text',
          el: <input className="inp inp-sm" style={{ width: 240 }} value={logoText} onChange={e => setLogoText(e.target.value)} />,
        },
      ],
    },
    {
      title: 'Behavior',
      rows: [
        { label: 'Require 2FA for staff', el: <Toggle value={require2fa} onChange={setRequire2fa} /> },
        { label: 'Auto-assign work items', el: <Toggle value={autoAssign} onChange={setAutoAssign} /> },
        { label: 'Lazy schema validation', el: <Toggle value={lazySchema} onChange={setLazySchema} /> },
        { label: 'Send outage notifications', el: <Toggle value={outageNotif} onChange={setOutageNotif} /> },
      ],
    },
    {
      title: 'Access',
      rows: [
        {
          label: 'Default role',
          el: loaded && !loaded.default_role
            ? <span className="hint" style={{ fontSize: 12 }}>Wire default_role in /api/tenant/settings</span>
            : <input className="inp inp-sm" style={{ width: 240 }} value={defaultRole} onChange={e => setDefaultRole(e.target.value)} placeholder="Agent" />,
        },
        {
          label: 'Session timeout (hours)',
          el: (
            <select className="inp inp-sm" style={{ width: 240 }} value={sessionTimeout} onChange={e => setSessionTimeout(Number(e.target.value))}>
              {[1, 4, 8, 24, 48].map(h => <option key={h} value={h}>{h} hours</option>)}
            </select>
          ),
        },
        { label: 'Row-level security', el: <Toggle value={rls} onChange={setRls} /> },
      ],
    },
  ]

  return (
    <div className="view-inner fade" style={{ maxWidth: 880 }}>
      <div className="crumbs">
        <span>System</span><span className="sep">/</span>
        <span style={{ color: 'var(--gx-text-1)' }}>{t('nav.settings', 'Settings')}</span>
      </div>

      <ViewHead
        icon={<GearIcon size={20} />}
        title={t('nav.settings', 'Settings')}
        sub="Tenant configuration · enforced by the kernel"
        actions={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => toast.info('Open Studio — configure entities and workflows')}>
              <EditIcon size={14} style={{ color: 'var(--gx-gold)' }} />Open in Studio
            </button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
              <CheckIcon size={14} />{saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      />

      {unavailable && (
        <div className="hint" style={{ textAlign: 'center', padding: '30px 0' }}>
          Wire /api/tenant/settings to populate.
        </div>
      )}
      {!loaded && !unavailable && (
        <div className="hint" style={{ padding: 16 }}>Loading…</div>
      )}

      {loaded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sections.map(s => (
            <div className="card" key={s.title}>
              <div className="card-head"><h3>{s.title}</h3></div>
              <div style={{ padding: '4px 18px 8px' }}>
                {s.rows.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '13px 0', borderBottom: i < s.rows.length - 1 ? '1px solid var(--gx-border-subtle)' : 'none' }}>
                    <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{r.label}</span>
                    {r.el}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
