import { useEffect, useRef, useState } from 'react'
import { bget, bpost } from './billing'
import { PermissionDenied } from './States'
import { SparkleIcon, ArrowRightIcon } from './icons'
import { useI18n } from './i18n'

// Ask GAAex — a talk-to-your-ISP assistant. Sends a question to /api/ai/ask, which answers grounded
// in the caller's live, scoped business context. Works with no provider (deterministic readout) and
// becomes a real conversation the moment a provider (e.g. Gemini free tier) is set in backend/.env.
// Our stack only: BRAND tokens, SVG icons, i18n, no charting/markdown libs.

type Proposal = { action: string; args: Record<string, any>; summary: string }
type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
  | { role: 'proposal'; proposal: Proposal; state: 'pending' | 'done' | 'cancelled'; result?: string }
type ChatResp = { kind: 'answer'; answer: string } | ({ kind: 'proposal' } & Proposal)
type Status = { provider: string; live: boolean }

const SUGGESTIONS = [
  'What is my MRR and how many active subscriptions do I have?',
  'How many overdue invoices are there, and the total?',
  'Create a lead named Aram Petrosyan, phone 091234567, from referral',
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
      const r = await bpost<ChatResp>(token, '/api/ai/chat', { question: text })
      if (r.kind === 'proposal') {
        setMsgs((m) => [...m, { role: 'proposal', proposal: { action: r.action, args: r.args, summary: r.summary }, state: 'pending' }])
      } else {
        setMsgs((m) => [...m, { role: 'assistant', text: r.answer }])
      }
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', text: e?.message || t('ask.error', 'Something went wrong asking GAAex.') }])
    } finally {
      setBusy(false)
    }
  }

  // Execute a confirmed action via /api/ai/act (the LLM never executes — only the server, scoped + audited).
  async function confirm(idx: number) {
    const m = msgs[idx]
    if (m.role !== 'proposal' || m.state !== 'pending' || busy) return
    setBusy(true)
    try {
      const r = await bpost<{ ok: boolean; message: string }>(token, '/api/ai/act', { action: m.proposal.action, args: m.proposal.args })
      setMsgs((ms) => ms.map((x, i) => i === idx && x.role === 'proposal' ? { ...x, state: 'done', result: r.message } : x))
    } catch (e: any) {
      setMsgs((ms) => ms.map((x, i) => i === idx && x.role === 'proposal' ? { ...x, state: 'done', result: e?.message || t('ask.actError', 'Action failed.') } : x))
    } finally {
      setBusy(false)
    }
  }

  function cancel(idx: number) {
    setMsgs((ms) => ms.map((x, i) => i === idx && x.role === 'proposal' ? { ...x, state: 'cancelled' } : x))
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
            <p>{t('ask.intro', 'Ask about your ISP — revenue, overdue invoices, leads, collections. Or tell it to create a lead or move one through the pipeline; it proposes the action and acts only when you confirm.')}</p>
            <div className="ask-chips">
              {SUGGESTIONS.map((sg) => (
                <button key={sg} className="ask-chip" onClick={() => ask(sg)} disabled={busy}>{sg}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => {
          if (m.role === 'proposal') {
            return (
              <div key={i} className="ask-msg ask-assistant">
                <div className="ask-proposal">
                  <div className="ask-proposal-head"><SparkleIcon /> {t('ask.proposalTitle', 'Action proposed')}</div>
                  <div className="ask-proposal-body">{m.proposal.summary}</div>
                  {m.state === 'pending' ? (
                    <div className="ask-proposal-actions">
                      <button className="btn btn--primary btn--sm" onClick={() => confirm(i)} disabled={busy}>{t('ask.confirm', 'Confirm')}</button>
                      <button className="btn btn--sm" onClick={() => cancel(i)} disabled={busy}>{t('ask.cancel', 'Cancel')}</button>
                    </div>
                  ) : m.state === 'done' ? (
                    <div className="ask-proposal-done">{m.result}</div>
                  ) : (
                    <div className="ask-proposal-done muted">{t('ask.cancelled', 'Cancelled.')}</div>
                  )}
                </div>
              </div>
            )
          }
          return (
            <div key={i} className={`ask-msg ask-${m.role}`}>
              <div className="ask-bubble">{m.text}</div>
            </div>
          )
        })}
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
