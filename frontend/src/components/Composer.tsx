import { useRef, useState } from 'react'
import EmojiPicker from './EmojiPicker'
import { SmileIcon } from './icons'
import { Button } from '../primitives'  // T-P3-7

// Composer — a message/comment input shared by the comments panel and the messages view:
// a textarea (inp inp-area) + the EmojiPicker (inserts at the cursor) + a Send button.
// onSend returns a promise; the field clears on success. Cmd/Ctrl+Enter sends.
export default function Composer({ onSend, placeholder = 'Write a message…' }: {
  onSend: (body: string) => Promise<void>
  placeholder?: string
}) {
  const [body, setBody] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const emojiBtnRef = useRef<HTMLButtonElement>(null)

  function insert(char: string) {
    const el = taRef.current
    if (!el) { setBody((b) => b + char); return }
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    const next = body.slice(0, start) + char + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + char.length
      el.setSelectionRange(pos, pos)
    })
  }

  async function send() {
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await onSend(text)
      setBody('')
      setEmojiOpen(false)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="composer">
      <textarea
        ref={taRef}
        className="inp inp-md inp-area"
        rows={2}
        placeholder={placeholder}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
      />
      <div className="composer-actions">
        <div className="emoji-anchor">
          <button ref={emojiBtnRef} type="button" className="iconbtn" aria-label="Insert emoji" title="Insert emoji" onClick={() => setEmojiOpen((o) => !o)}>
            <SmileIcon size={18} />
          </button>
          {emojiOpen && <EmojiPicker anchor={emojiBtnRef.current} onPick={insert} onClose={() => setEmojiOpen(false)} />}
        </div>
        <Button variant="primary" size="sm" disabled={sending || !body.trim()} onClick={send} loading={sending}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  )
}
