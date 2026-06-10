// RecipientField — to/cc/bcc address chips + free-typed entry. Emits the full
// MailAddress[] on every change. Implements RecipientFieldProps from ./types VERBATIM.
//
// Typing an address and pressing Enter/Tab/comma (or blurring) commits a chip.
// Backspace on an empty input removes the last chip. Invalid emails are still kept
// (so a typo isn't silently dropped) but flagged with the `.invalid` chip class so
// ComposeModal can block Send. D20-clean: all visuals via .mail-recip* classes.
import { useId, useState } from 'react'
import { X } from 'lucide-react'
import type { MailAddress } from './types'
import type { RecipientFieldProps } from './types'

// Lightweight RFC-ish email check — good enough to flag obvious typos in the UI;
// the backend is the real authority.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim())
}

// Parse a typed token into a MailAddress. Supports `Name <email>` and bare `email`.
function parseAddress(raw: string): MailAddress | null {
  const s = raw.trim().replace(/[,;]+$/, '').trim()
  if (!s) return null
  const m = s.match(/^(.*)<\s*([^>]+)\s*>$/)
  if (m) {
    const name = m[1].trim().replace(/^["']|["']$/g, '').trim()
    return { name: name || null, email: m[2].trim() }
  }
  return { email: s }
}

function labelFor(addr: MailAddress): string {
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email
}

export default function RecipientField({ label, value, onChange, placeholder }: RecipientFieldProps) {
  const [draft, setDraft] = useState('')
  const inputId = useId()

  const commit = (raw: string) => {
    // A single token may contain comma/semicolon separated addresses (paste).
    const parts = raw.split(/[,;]/).map((p) => p.trim()).filter(Boolean)
    if (parts.length === 0) return
    const parsed = parts.map(parseAddress).filter((a): a is MailAddress => a != null)
    if (parsed.length === 0) return
    // De-dupe by lowercased email against existing + within the batch.
    const seen = new Set(value.map((a) => a.email.toLowerCase()))
    const next = [...value]
    for (const a of parsed) {
      const key = a.email.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      next.push(a)
    }
    onChange(next)
    setDraft('')
  }

  const removeAt = (idx: number) => {
    const next = value.slice()
    next.splice(idx, 1)
    onChange(next)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',' || e.key === ';') {
      if (draft.trim()) {
        e.preventDefault()
        commit(draft)
      }
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      e.preventDefault()
      removeAt(value.length - 1)
    }
  }

  return (
    <div className="mail-compose-account">
      <label className="mail-compose-label" htmlFor={inputId}>{label}</label>
      <div className="mail-recip">
        {value.map((addr, i) => {
          const valid = isValidEmail(addr.email)
          return (
            <span key={`${addr.email}-${i}`} className={valid ? 'mail-recip-chip' : 'mail-recip-chip invalid'} title={labelFor(addr)}>
              <span>{labelFor(addr)}</span>
              <button
                type="button"
                className="mail-recip-chip-x"
                aria-label={`Remove ${addr.email}`}
                onClick={(e) => { e.stopPropagation(); removeAt(i) }}
              >
                <X size={11} />
              </button>
            </span>
          )
        })}
        <input
          id={inputId}
          className="mail-recip-input"
          type="text"
          value={draft}
          placeholder={value.length === 0 ? placeholder : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => { if (draft.trim()) commit(draft) }}
          autoComplete="off"
          aria-label={label}
        />
      </div>
    </div>
  )
}

// Exposed so ComposeModal can validate before enabling Send without re-deriving the regex.
export function recipientsValid(addrs: MailAddress[]): boolean {
  return addrs.every((a) => isValidEmail(a.email))
}
