// ComposeModal — compose / reply / forward. Implements ComposeModalProps from ./types VERBATIM.
//
// - Account picker (defaults to defaultAccountId), To / Cc recipient chips (RecipientField),
//   a Bcc field revealed on demand, Subject, a plain <textarea> body, and pre-uploaded
//   attachment chips (via the `uploadAttachment` prop → attachment_ids on the payload).
// - Send calls onSend(payload). The draft is KEPT on send error (a toast surfaces the reason),
//   so the operator can retry without re-typing. On success the modal closes + resets.
// - `initial` pre-fills reply/forward context (to/cc/subject/body + in_reply_to/references).
//
// HARD RULES honored: no raw fetch (network goes through the props the parent wired to
// lib/mail.ts), reuses Modal/Button/Input primitives, D20-clean (.mail-compose* classes,
// every visual value a --gx-* token — no inline hex/px).
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Paperclip, Send, X } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Button } from '../../primitives'
import { Input } from '../../primitives'
import { toast } from '../../components/Toast'
import RecipientField, { recipientsValid } from './RecipientField'
import type { ComposeModalProps, MailAddress, MailSendInput } from './types'

type UploadedAttachment = {
  attachment_id: string
  filename: string
  size_bytes: number
  content_type: string
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function ComposeModal({
  open,
  accounts,
  defaultAccountId,
  initial,
  onClose,
  onSend,
  uploadAttachment,
}: ComposeModalProps) {
  const [accountId, setAccountId] = useState<string>('')
  const [to, setTo] = useState<MailAddress[]>([])
  const [cc, setCc] = useState<MailAddress[]>([])
  const [bcc, setBcc] = useState<MailAddress[]>([])
  const [showCc, setShowCc] = useState(false)
  const [showBcc, setShowBcc] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([])
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)

  const fileRef = useRef<HTMLInputElement | null>(null)
  const accountSelectId = useId()
  const subjectId = useId()
  const bodyId = useId()

  // (Re)seed state from `initial` whenever the modal transitions to open or the
  // prefill context changes (reply vs forward vs fresh compose).
  useEffect(() => {
    if (!open) return
    setAccountId(defaultAccountId ?? accounts[0]?.id ?? '')
    const seedTo = initial?.to ?? []
    const seedCc = initial?.cc ?? []
    setTo(seedTo)
    setCc(seedCc)
    setBcc([])
    setShowCc(seedCc.length > 0)
    setShowBcc(false)
    setSubject(initial?.subject ?? '')
    setBody(initial?.text ?? initial?.html ?? '')
    setAttachments([])
    setSending(false)
    setUploading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const canSend = useMemo(() => {
    if (!accountId) return false
    if (to.length === 0) return false
    if (!recipientsValid(to) || !recipientsValid(cc) || !recipientsValid(bcc)) return false
    return !sending && !uploading
  }, [accountId, to, cc, bcc, sending, uploading])

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        try {
          const up = await uploadAttachment(file)
          setAttachments((prev) => [...prev, up])
        } catch (e) {
          toast.error(`Couldn't attach ${file.name}: ${(e as Error).message}`)
        }
      }
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.attachment_id !== id))
  }

  const handleSend = async () => {
    if (!canSend) return
    const payload: MailSendInput = {
      account_id: accountId,
      to,
      subject: subject.trim(),
    }
    if (cc.length) payload.cc = cc
    if (bcc.length) payload.bcc = bcc
    if (body) payload.text = body
    if (attachments.length) payload.attachment_ids = attachments.map((a) => a.attachment_id)
    if (initial?.in_reply_to) payload.in_reply_to = initial.in_reply_to
    if (initial?.references?.length) payload.references = initial.references

    setSending(true)
    try {
      await onSend(payload)
      // Success — close + reset (state resets on next open via the effect).
      onClose()
    } catch (e) {
      // KEEP the draft so the operator can retry without re-typing.
      toast.error((e as Error).message || 'Failed to send message')
      setSending(false)
    }
  }

  if (!open) return null

  const footer = (
    <>
      <Button variant="ghost" size="md" onClick={onClose} disabled={sending}>
        Cancel
      </Button>
      <Button
        variant="primary"
        size="md"
        leftIcon={Send}
        loading={sending}
        disabled={!canSend}
        onClick={() => { void handleSend() }}
      >
        Send
      </Button>
    </>
  )

  return (
    <Modal open={open} onClose={onClose} title="New message" size="lg" footer={footer}>
      <div className="mail-compose">
        <div className="mail-compose-account">
          <label className="mail-compose-label" htmlFor={accountSelectId}>From</label>
          <select
            id={accountSelectId}
            className="mail-compose-select"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.length === 0 && <option value="">No accounts configured</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name ? `${a.display_name} <${a.email_address}>` : a.email_address}
              </option>
            ))}
          </select>
        </div>

        <RecipientField label="To" value={to} onChange={setTo} placeholder="name@example.com" />

        {showCc
          ? <RecipientField label="Cc" value={cc} onChange={setCc} placeholder="name@example.com" />
          : (
            <Button variant="link" size="sm" onClick={() => setShowCc(true)}>Add Cc</Button>
          )}

        {showBcc
          ? <RecipientField label="Bcc" value={bcc} onChange={setBcc} placeholder="name@example.com" />
          : (
            <Button variant="link" size="sm" onClick={() => setShowBcc(true)}>Add Bcc</Button>
          )}

        <div className="mail-compose-account">
          <label className="mail-compose-label" htmlFor={subjectId}>Subject</label>
          <Input id={subjectId} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
        </div>

        <div className="mail-compose-account">
          <label className="mail-compose-label" htmlFor={bodyId}>Message</label>
          <textarea
            id={bodyId}
            className="mail-compose-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message…"
          />
        </div>

        <div className="mail-compose-attach">
          <div>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => { void onPickFiles(e.target.files) }}
            />
            <Button
              variant="secondary"
              size="sm"
              leftIcon={Paperclip}
              loading={uploading}
              onClick={() => fileRef.current?.click()}
            >
              Attach files
            </Button>
          </div>
          {attachments.length > 0 && (
            <div className="mail-compose-attach-list">
              {attachments.map((a) => (
                <span key={a.attachment_id} className="mail-compose-attach-chip" title={`${a.filename} · ${fmtBytes(a.size_bytes)}`}>
                  <span>{a.filename}</span>
                  <button
                    type="button"
                    className="mail-compose-attach-x"
                    aria-label={`Remove ${a.filename}`}
                    onClick={() => removeAttachment(a.attachment_id)}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
