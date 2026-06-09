import { Button } from '../primitives'
import { useState } from 'react'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { t } from '../lib/i18n'
import { BASE as API } from '../lib/billing'
import { useAuth } from '../context/AuthContext'

// SecurityModal — "Security & Sign-in" for the signed-in user only: change own password
// (POST /api/me/password). MFA + active sessions are honest "Coming soon" placeholders — they are
// labelled stubs, NOT fake controls. Boundary: nothing here touches other users or tenant config.
export default function SecurityModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { token } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (next.length < 8) {
      setErr(t('security.pwTooShort', 'New password must be at least 8 characters.'))
      return
    }
    setBusy(true)
    try {
      const r = await fetch(`${API}/api/me/password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token!}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: next }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErr(data.detail || t('security.pwFailed', 'Could not change password.'))
        return
      }
      toast.success(t('security.pwChanged', 'Password changed'))
      setCurrent(''); setNext('')
    } catch (e2) {
      setErr((e2 as Error).message || t('security.pwFailed', 'Could not change password.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('security.title', 'Security & Sign-in')} size="sm">
      <form className="security-modal" onSubmit={onSubmit}>
        <div className="security-section-label">{t('security.changePw', 'Change password')}</div>

        <label className="field-block">
          <span className="field-label">{t('security.current', 'Current password')}</span>
          <input
            className="inp inp-md"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            aria-label={t('security.current', 'Current password')}
          />
        </label>

        <label className="field-block">
          <span className="field-label">{t('security.new', 'New password')}</span>
          <input
            className="inp inp-md"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            aria-label={t('security.new', 'New password')}
          />
          <span className="hint">{t('security.newHint', 'At least 8 characters.')}</span>
        </label>

        {err && <p className="err" role="alert">{err}</p>}

        <div className="profile-modal-foot">
          <Button variant="primary" size="md"
            type="submit"  disabled={busy || !current || !next}>
            {busy ? t('common.saving', 'Saving…') : t('security.updatePw', 'Update password')}
          </Button>
        </div>

        <div className="menu-sep" style={{ margin: 'var(--gx-space-7) 0' }} />

        <div className="security-stub">
          <div className="security-stub-title">{t('security.mfa', 'Two-factor authentication (MFA)')}</div>
          <div className="security-stub-note">{t('common.comingSoon', 'Coming soon')}</div>
        </div>
        <div className="security-stub">
          <div className="security-stub-title">{t('security.sessions', 'Active sessions & devices')}</div>
          <div className="security-stub-note">{t('common.comingSoon', 'Coming soon')}</div>
        </div>
      </form>
    </Modal>
  )
}
