import { useEffect, useState } from 'react'
import { healthCheck } from '../lib/api'
import { useI18n } from '../lib/i18n'

type Status = 'checking' | 'ok' | 'error'

/**
 * B22 — unobtrusive system-status chip.
 * Reads GET /api/health once on mount (+ manual re-check on click).
 * If /api/health 404s (E22 not merged), shows nothing.
 */
export default function SystemStatusChip() {
  const { t } = useI18n()
  const [status, setStatus] = useState<Status>('checking')
  const [unavailable, setUnavailable] = useState(false)

  async function check() {
    setStatus('checking')
    try {
      const result = await healthCheck()
      setStatus(result)
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    // Non-breaking: if the endpoint doesn't exist, hide the chip.
    fetch('http://127.0.0.1:8099/api/health')
      .then((r) => {
        if (r.status === 404) { setUnavailable(true); return }
        return r.ok ? setStatus('ok') : setStatus('error')
      })
      .catch(() => setStatus('error'))
  }, [])

  if (unavailable) return null

  const chipCls =
    status === 'ok' ? 'status-chip status-chip-ok' :
    status === 'error' ? 'status-chip status-chip-err' :
    'status-chip status-chip-loading'

  const label =
    status === 'ok' ? t('status.operational', 'Operational') :
    status === 'error' ? t('status.issue', 'Issue') :
    t('status.checking', 'Checking…')

  return (
    <button
      className={chipCls}
      onClick={check}
      title={t('status.label', 'System status')}
      aria-label={`${t('status.label', 'System status')}: ${label}`}
      style={{ cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}
    >
      <span className="status-chip-dot" aria-hidden />
      <span>{label}</span>
    </button>
  )
}
