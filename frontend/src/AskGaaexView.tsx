import { useEffect, useRef, useState } from 'react'
import { bget, bpost } from './billing'
import { PermissionDenied } from './States'
import { SparkleIcon, ArrowRightIcon } from './icons'
import { useI18n } from './i18n'

// Ask GAAex — a talk-to-your-ISP assistant. Sends a question to /api/ai/ask, which answers grounded
// in the caller's live, scoped business context. Works with no provider (deterministic readout) and
// becomes a real conversation the moment a provider (e.g. Gemini free tier) is set in backend/.env.
// Our stack only: BRAND tokens, SVG icons, i18n, no charting/markdown libs.

type Msg = { role: 'user' | 'assistant'; text: string; provider?: string }
type AskResp = { answer: string; provider: string; grounded: boolean }
type Status = { provider: string; live: boolean }

const SUGGESTIONS = [
  'What is my MRR and how many active subscriptions do I have?',
  'How many overdue invoices are there, and the total?',
  'How many new leads came in the last 30 days?',
  'How much did we collect this month vs last month?',
]

export default function AskGaaexView({ token }: { token: string }) {
  const { t } = useI18n()
  const [status, setStatus] = useState<Status | null>(null)
  const [denied, setDenied] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    (async () => {
      const r = await bget<Status>(token, '/api/ai/status')
      if (r.status === 403) { setDenied(true); return }
      if (r.ok && r.data) setStatus(r.data)
    })()
  }, [token])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  async function ask(question: string) {
    const text = question.trim()
    if (!text || busy) return
    setMsgs((m) => [...m, { role: 'user', text }])
    setQ(''); setBusy(true)
    try {
      const r = await bpost<AskResp>(token, '/api/ai/ask', { question: text })
      setMsgs((m) => [...m, { role: 'assistant', text: r.answer, provider: r.provider }])
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', text: e?.message || t('ask.error', 'Something went wrong asking GAAex.') }])
    } finally {
      setBusy(false)
    }
  }

  if (denied) return <PermissionDenied message={t('ask.denied', "You don't have permission to use the assistant.")} />

  const brain = !status ? '…'
    : status.live ? t('ask.brainLive', `Live · ${status.provider}`).replace('{p}', status.provider)
    : t('ask.brainLocal', 'Built-in (no external AI configured)')

  return (
    <div className="ask-wrap">
      <div className="view-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}><SparkleIcon /> {t('ask.title', 'Ask GAAex')}</h2>
        <span className="badge" title={t('ask.brainHint', 'Which AI brain is answering. Set AI_PROVIDER in backend/.env to upgrade.')}>
          {status?.live ? `${t('ask.brain', 'AI')}: ${status.provider}` : brain}
        </span>
      </div>

      <div className="ask-thread">
        {msgs.length === 0 && (
          <div className="ask-intro muted">
            <p>{t('ask.intro', 'Ask about your ISP — revenue, overdue invoices, leads, collections. Answers use your live, permission-scoped data.')}</p>
            <div className="ask-chips">
              {SUGGESTIONS.map((sg) => (
                <button key={sg} className="ask-chip" onClick={() => ask(sg)} disabled={busy}>{sg}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ask-msg ask-${m.role}`}>
            <div className="ask-bubble">{m.text}</div>
          </div>
        ))}
        {busy && <div className="ask-msg ask-assistant"><div className="ask-bubble muted">{t('ask.thinking', 'Thinking…')}</div></div>}
        <div ref={endRef} />
      </div>

      <form className="ask-input" onSubmit={(e) => { e.preventDefault(); ask(q) }}>
        <input className="inp" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy}
               placeholder={t('ask.placeholder', 'Ask GAAex anything about your business…')} aria-label={t('ask.title', 'Ask GAAex')} autoFocus />
        <button className="btn btn--primary" type="submit" disabled={busy || !q.trim()} aria-label={t('ask.send', 'Send')}>
          <ArrowRightIcon />
        </button>
      </form>
    </div>
  )
}
