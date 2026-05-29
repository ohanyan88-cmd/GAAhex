import { useState } from 'react'
import { Modal } from '../components/Modal'
import { BASE } from '../lib/billing'
import { useI18n, type Lang } from '../lib/i18n'
import { ErrorBanner } from '../components/States'
import { CheckIcon, BuildingIcon, ChevronLeftIcon, ArrowRightIcon } from '../components/icons'

// "Stand up a new ISP" — a 3-step wizard reachable from the login screen (so it runs UNAUTHENTICATED)
// against A19's POST /api/admin/tenants. Degrades to a clear message if that endpoint 404s.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const STEPS = 3

export default function CreateTenantWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const [step, setStep] = useState(1)
  const [companyName, setCompanyName] = useState('')
  const [currency, setCurrency] = useState('AMD')
  const [locale, setLocale] = useState<Lang>('en')
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdEmail, setCreatedEmail] = useState<string | null>(null)

  function reset() {
    setStep(1); setCompanyName(''); setCurrency('AMD'); setLocale('en')
    setAdminName(''); setAdminEmail(''); setPw(''); setPw2('')
    setError(''); setSubmitting(false); setCreatedEmail(null)
  }
  function close() { reset(); onClose() }

  const step1Valid = companyName.trim().length > 0
  const emailValid = EMAIL_RE.test(adminEmail.trim())
  const step2Valid = adminName.trim().length > 0 && emailValid && pw.length >= 8 && pw === pw2

  function next() {
    setError('')
    if (step === 1 && !step1Valid) { setError(t('wizard.errCompany', 'Company name is required')); return }
    if (step === 2 && !step2Valid) { setError(t('wizard.errStep2', 'Fix the highlighted fields to continue')); return }
    setStep((s) => Math.min(STEPS, s + 1))
  }
  function back() { setError(''); setStep((s) => Math.max(1, s - 1)) }

  async function submit() {
    setSubmitting(true); setError('')
    try {
      const r = await fetch(`${BASE}/api/admin/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName.trim(), currency, locale,
          admin_name: adminName.trim(), admin_email: adminEmail.trim(), admin_password: pw,
        }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(
          r.status === 404
            ? t('wizard.errUnavailable', 'Tenant setup isn’t available yet')
            : ((e && e.detail) || t('wizard.errFailed', 'Could not create the ISP')),
        )
      }
      setCreatedEmail(adminEmail.trim())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  // ── success screen ────────────────────────────────────────────────────────────────────────
  if (createdEmail) {
    return (
      <Modal open onClose={close} title={t('wizard.title', 'Stand up a new ISP')} size="md"
             footer={<button className="btn btn-primary btn-md" onClick={close}>{t('common.done', 'Done')}</button>}>
        <div className="state">
          <div className="state-icon" style={{ color: 'var(--success)' }}><CheckIcon size={40} /></div>
          <div className="state-title">{t('wizard.createdTitle', 'ISP created')}</div>
          <p className="state-msg">{t('wizard.success', 'ISP created — sign in as {email}').replace('{email}', createdEmail)}</p>
        </div>
      </Modal>
    )
  }

  const stepLabels = [t('wizard.stepCompany', 'Company'), t('wizard.stepAdmin', 'Admin'), t('wizard.stepReview', 'Review')]

  const footer = (
    <>
      {step > 1 && (
        <button className="btn btn-ghost btn-md" onClick={back} disabled={submitting}>
          <ChevronLeftIcon size={14} /> {t('common.back', 'Back')}
        </button>
      )}
      {step < STEPS
        ? <button className="btn btn-primary btn-md" onClick={next}>{t('common.next', 'Next')} <ArrowRightIcon size={14} /></button>
        : <button className="btn btn-accent btn-md" onClick={submit} disabled={submitting}>
            {submitting ? t('wizard.creating', 'Creating…') : t('wizard.create', 'Create ISP')}
          </button>}
    </>
  )

  return (
    <Modal open onClose={close} title={t('wizard.title', 'Stand up a new ISP')} size="md" footer={footer}>
      {/* stepper */}
      <ol className="wizard-steps" style={{ display: 'flex', gap: 8, listStyle: 'none', padding: 0, margin: '0 0 18px' }}>
        {stepLabels.map((label, i) => {
          const n = i + 1
          const active = n === step
          const done = n < step
          return (
            <li key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, opacity: active || done ? 1 : 0.55 }}>
              <span aria-hidden style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 22, height: 22, borderRadius: 'var(--r-pill, 999px)', fontSize: 12, fontWeight: 600,
                background: active ? 'var(--accent)' : done ? 'var(--success)' : 'var(--surface-2)',
                color: active || done ? 'var(--accent-text, var(--text-inv))' : 'var(--text-2)',
                border: '1px solid var(--border)',
              }}>{done ? <CheckIcon size={13} /> : n}</span>
              <span style={{ fontSize: 'var(--fs-sm, 13px)', color: active ? 'var(--text)' : 'var(--text-2)' }}>{label}</span>
            </li>
          )
        })}
      </ol>

      {error && <ErrorBanner message={error} />}

      {step === 1 && (
        <div className="rec-form">
          <label className="field"><span>{t('wizard.companyName', 'Company name')} *</span>
            <input className="inp inp-md" value={companyName} autoFocus
                   onChange={(e) => setCompanyName(e.target.value)} aria-label={t('wizard.companyName', 'Company name')} />
          </label>
          <label className="field"><span>{t('wizard.currency', 'Currency')}</span>
            <input className="inp inp-md" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label={t('wizard.currency', 'Currency')} />
          </label>
          <label className="field"><span>{t('wizard.locale', 'Language')}</span>
            <select className="inp inp-md" value={locale} onChange={(e) => setLocale(e.target.value as Lang)} aria-label={t('wizard.locale', 'Language')}>
              <option value="en">English</option>
              <option value="hy">Հայերեն</option>
            </select>
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="rec-form">
          <label className="field"><span>{t('wizard.adminName', 'Admin name')} *</span>
            <input className="inp inp-md" value={adminName} autoFocus onChange={(e) => setAdminName(e.target.value)} aria-label={t('wizard.adminName', 'Admin name')} />
          </label>
          <label className="field"><span>{t('wizard.adminEmail', 'Admin email')} *</span>
            <input className={'inp inp-md' + (adminEmail && !emailValid ? ' is-error' : '')} type="email" value={adminEmail}
                   onChange={(e) => setAdminEmail(e.target.value)} aria-label={t('wizard.adminEmail', 'Admin email')} />
            {adminEmail && !emailValid && <span className="err">{t('wizard.errEmail', 'Enter a valid email')}</span>}
          </label>
          <label className="field"><span>{t('wizard.password', 'Password')} *</span>
            <input className={'inp inp-md' + (pw && pw.length < 8 ? ' is-error' : '')} type="password" value={pw}
                   onChange={(e) => setPw(e.target.value)} aria-label={t('wizard.password', 'Password')} />
            {pw && pw.length < 8 && <span className="err">{t('wizard.errPwLen', 'At least 8 characters')}</span>}
          </label>
          <label className="field"><span>{t('wizard.confirm', 'Confirm password')} *</span>
            <input className={'inp inp-md' + (pw2 && pw !== pw2 ? ' is-error' : '')} type="password" value={pw2}
                   onChange={(e) => setPw2(e.target.value)} aria-label={t('wizard.confirm', 'Confirm password')} />
            {pw2 && pw !== pw2 && <span className="err">{t('wizard.errPwMatch', 'Passwords do not match')}</span>}
          </label>
        </div>
      )}

      {step === 3 && (
        <div className="bill-meta">
          <div><span className="muted">{t('wizard.companyName', 'Company name')}</span><div>{companyName || '—'}</div></div>
          <div><span className="muted">{t('wizard.currency', 'Currency')}</span><div>{currency || '—'}</div></div>
          <div><span className="muted">{t('wizard.locale', 'Language')}</span><div>{locale === 'hy' ? 'Հայերեն' : 'English'}</div></div>
          <div><span className="muted">{t('wizard.adminName', 'Admin name')}</span><div>{adminName || '—'}</div></div>
          <div><span className="muted">{t('wizard.adminEmail', 'Admin email')}</span><div>{adminEmail || '—'}</div></div>
        </div>
      )}
    </Modal>
  )
}
