import { useEffect, useRef, useState } from 'react'
import { bget, bpost } from '../lib/billing'
import { PermissionDenied } from '../components/States'
import { SparkleIcon, ArrowRightIcon } from '../components/icons'
import { useI18n } from '../lib/i18n'
import { Button } from '../primitives'

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
    <div className="gx-comms comms-shell">
      <div className="comms-head">
        <div className="vh-ic"><SparkleIcon size={18} /></div>
        <div>
          <h1 style={{ fontFamily: 'var(--gx-font-display)', fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: '-.02em' }}>
            {t('ask.title', 'Ask GAAex')}
          </h1>
          <div className="hint" style={{ fontSize: 12 }}>
            {status?.live ? `${t('ask.brain', 'AI')} · ${status.provider}` : brain}
          </div>
        </div>
        <span className="spacer" />
        <span className="badge" title={t('ask.brainHint', 'Which AI brain is answering. Set AI_PROVIDER in backend/.env to upgrade.')}>
          {status?.live ? `${t('ask.brain', 'AI')}: ${status.provider}` : brain}
        </span>
      </div>

      <div className="msgr" style={{ gridTemplateColumns: '1fr 244px' }}>
        {/* ── Chat pane ───────────────────────────────────────────── */}
        <div className="chat">
          <div className="chat-wrap">
            <div className="chat-body">
              {msgs.length === 0 && (
                <div className="bubble-row in">
                  <div className="bubble-wrap">
                    <div className="bubble in">
                      {t('ask.intro', 'Ask about your ISP — revenue, overdue invoices, leads, collections. Or tell it to create a lead or move one through the pipeline; it proposes the action and acts only when you confirm.')}
                    </div>
                  </div>
                </div>
              )}
              {msgs.map((m, i) => {
                if (m.role === 'proposal') {
                  return (
                    <div key={i} className="bubble-row in">
                      <div className="bubble-wrap" style={{ maxWidth: '78%' }}>
                        <div className="bubble in" style={{ maxWidth: '100%' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--gx-info-fg)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                            <SparkleIcon size={12} /> {t('ask.proposalTitle', 'Action proposed')}
                          </div>
                          <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--gx-text-1)' }}>{m.proposal.summary}</div>
                          {m.state === 'pending' ? (
                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                              <Button variant="primary" size="sm" onClick={() => confirm(i)} disabled={busy}>{t('ask.confirm', 'Confirm')}</Button>
                              <Button variant="ghost" size="sm" onClick={() => cancel(i)} disabled={busy}>{t('ask.cancel', 'Cancel')}</Button>
                            </div>
                          ) : m.state === 'done' ? (
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--gx-success-fg, var(--success))', marginTop: 8 }}>{m.result}</div>
                          ) : (
                            <div style={{ fontSize: 12.5, color: 'var(--gx-text-3)', marginTop: 8 }}>{t('ask.cancelled', 'Cancelled.')}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                }
                const dir = m.role === 'user' ? 'out' : 'in'
                return (
                  <div key={i} className={'bubble-row ' + dir}>
                    <div className="bubble-wrap">
                      <div className={'bubble ' + dir} style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                    </div>
                  </div>
                )
              })}
              {busy && (
                <div className="bubble-row in">
                  <div className="bubble-wrap">
                    <div className="bubble in typing" aria-label={t('ask.thinking', 'Thinking…')}>
                      <span /><span /><span />
                    </div>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>

          <form className="chat-composer" onSubmit={(e) => { e.preventDefault(); ask(q) }}>
            <input
              className="inp"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              disabled={busy}
              placeholder={t('ask.placeholder', 'Ask GAAex anything about your business…')}
              aria-label={t('ask.title', 'Ask GAAex')}
              autoFocus
              style={{ flex: 1 }}
            />
            <Button variant="primary" type="submit" disabled={busy || !q.trim()}>
              <ArrowRightIcon size={14} />
              <span className="sr-only">{t('ask.send', 'Send')}</span>
            </Button>
          </form>
        </div>

        {/* ── Suggestions / context aside ─────────────────────────── */}
        <aside className="chat-info">
          <div className="hint" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gx-text-3)', padding: '0 0 8px' }}>
            {t('ask.suggestionsTitle', 'Try asking')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {SUGGESTIONS.map((sg) => (
              <button
                key={sg}
                className="info-act"
                onClick={() => ask(sg)}
                disabled={busy}
                style={{ textAlign: 'left', fontSize: 11.5, lineHeight: 1.4 }}
              >
                {sg}
              </button>
            ))}
          </div>
          <div className="hint" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gx-text-3)', padding: '18px 0 8px' }}>
            {t('ask.brainLabel', 'Brain')}
          </div>
          <div className="kv" style={{ padding: '6px 0' }}>
            <span className="kv-k" style={{ width: 70 }}>{t('ask.providerLabel', 'Provider')}</span>
            <span className="kv-v">{status?.provider ?? '—'}</span>
          </div>
          <div className="kv" style={{ padding: '6px 0' }}>
            <span className="kv-k" style={{ width: 70 }}>{t('ask.modeLabel', 'Mode')}</span>
            <span className="kv-v">{status?.live ? t('ask.modeLive', 'Live') : t('ask.modeLocal', 'Built-in')}</span>
          </div>
        </aside>
      </div>
    </div>
  )
}
