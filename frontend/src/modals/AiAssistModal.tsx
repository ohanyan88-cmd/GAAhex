import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import { bpost } from '../lib/billing'
import { ErrorBanner } from '../components/States'
import { SparkleIcon } from '../components/icons'
import { useI18n } from '../lib/i18n'

// Light AI touchpoint (E18). For a lead → POST /api/ai/score-lead (score + band); for anything else
// → POST /api/ai/summarize (text). Deterministic backend results expected. Degrades on 404.
type Result = { score?: number; band?: string; summary?: string; [k: string]: any }

const BAND_CLASS: Record<string, string> = { hot: 'pill pill-danger', warm: 'pill', cold: 'pill pill-muted', high: 'pill pill-success', low: 'pill pill-muted' }

export default function AiAssistModal({ token, entityKey, recordId, label, onClose }: {
  token: string
  entityKey: string
  recordId: string
  label: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const isLead = entityKey === 'lead'
  const [res, setRes] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function run() {
    setLoading(true); setError(''); setRes(null)
    try {
      const data = isLead
        ? await bpost<Result>(token, '/api/ai/score-lead', { lead_id: recordId, record_id: recordId })
        : await bpost<Result>(token, '/api/ai/summarize', { entity: entityKey, id: recordId, record_id: recordId })
      setRes(data || {})
    } catch (e) {
      const err = e as Error & { status?: number }
      setError(err.status === 404 ? t('ai.unavailable', "AI assist isn't available yet") : err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [token, entityKey, recordId])

  return (
    <Modal open onClose={onClose} title={`${t('ai.title', 'AI assist')} · ${label}`} size="sm">
      {loading && <p className="muted">{t('ai.thinking', 'Thinking…')}</p>}
      {error && <ErrorBanner message={error} onRetry={run} />}

      {res && !error && isLead && (
        <div className="ai-result">
          <div className="ai-score">
            <SparkleIcon size={18} />
            <span className="ai-score-num">{res.score != null ? res.score : '—'}</span>
            {res.band && <span className={BAND_CLASS[String(res.band).toLowerCase()] ?? 'pill'}>{res.band}</span>}
          </div>
          <p className="muted">{t('ai.leadHint', 'Lead score is a deterministic heuristic from the lead’s fields.')}</p>
        </div>
      )}

      {res && !error && !isLead && (
        <div className="ai-result">
          <p className="ai-summary">{res.summary || t('ai.noSummary', 'No summary returned.')}</p>
        </div>
      )}
    </Modal>
  )
}
