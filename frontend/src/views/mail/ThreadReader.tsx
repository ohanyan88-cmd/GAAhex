// ThreadReader — the right reader pane (.gx-comms .mail-read). Renders the opened
// message: a header (subject + from/to/cc + date) with a flag/action toolbar (seen,
// flagged via patchMessageFlags through onToggleFlag; reply/forward/delete), the body
// via the MessageBody subcomponent (DOMPurify-sanitized HTML + "Show images" toggle,
// plain-text fallback), and AttachmentChips for downloadable attachments.
//
// HARD RULES: no raw fetch (actions flow up to MailView via callbacks), no inline
// hex/px — `.gx-comms .mail-read*` token classes only; inbound HTML is rendered ONLY
// through the MessageBody DOMPurify path.
import { useEffect, useState } from 'react'
import { Reply, Forward } from 'lucide-react'  // Button.leftIcon expects a raw LucideIcon
import { Button } from '../../primitives'
import { LoadingState, EmptyState, ErrorBanner } from '../../components/States'
import { MailIcon, StarIcon, CheckIcon, TrashIcon } from '../../components/icons'
import type { ThreadReaderProps, MailAddress } from './types'
import MessageBody from './MessageBody'
import AttachmentChips from './AttachmentChips'

// Render an address list as "Name <email>"-ish, falling back to the bare email.
function formatAddrs(addrs: MailAddress[] | undefined | null): string {
  if (!addrs || addrs.length === 0) return ''
  return addrs.map((a) => (a.name ? a.name : a.email)).join(', ')
}

// Absolute, locale-aware timestamp for the message header (full date + time).
function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mail-read-meta-row">
      <span className="mail-read-meta-label">{label}</span>
      <span className="mail-read-meta-val">{children}</span>
    </div>
  )
}

export default function ThreadReader({
  message,
  loading,
  error,
  onToggleFlag,
  onReply,
  onForward,
  onDelete,
  onRetry,
  onDownloadAttachment,
}: ThreadReaderProps) {
  // Remote-image gate lives here so it resets every time a different message opens.
  const [showImages, setShowImages] = useState(false)
  useEffect(() => { setShowImages(false) }, [message?.id])

  // ── Pane-level states (the pane owns its own loading/error/empty) ───────────
  if (loading) {
    return <div className="mail-read"><LoadingState message="Opening message…" /></div>
  }
  if (error) {
    return <div className="mail-read"><ErrorBanner message={error} onRetry={onRetry} /></div>
  }
  if (!message) {
    return (
      <div className="mail-read">
        <EmptyState
          icon={<MailIcon size={40} />}
          title="No message selected"
          message="Pick a message from the list to read it here."
        />
      </div>
    )
  }

  const fromLabel = message.from_name || message.from_addr || 'Unknown sender'
  const dateLabel = formatDate(message.received_at ?? message.sent_at)
  const toLabel = formatAddrs(message.to_addrs)
  const ccLabel = formatAddrs(message.cc_addrs)

  return (
    <div className="mail-read">
      <div className="mail-read-head">
        {/* action / flag toolbar */}
        <div className="mail-read-bar">
          <button
            type="button"
            className={`tb-icon${message.flag_flagged ? ' flagged' : ''}`}
            aria-pressed={message.flag_flagged}
            title={message.flag_flagged ? 'Unflag' : 'Flag'}
            onClick={() => onToggleFlag('flagged', !message.flag_flagged)}
          >
            <StarIcon size={16} />
          </button>
          <button
            type="button"
            className={`tb-icon${message.flag_seen ? ' seen' : ''}`}
            aria-pressed={message.flag_seen}
            title={message.flag_seen ? 'Mark as unread' : 'Mark as read'}
            onClick={() => onToggleFlag('seen', !message.flag_seen)}
          >
            <CheckIcon size={16} />
          </button>
          <span className="spacer" />
          <Button variant="secondary" size="sm" leftIcon={Reply} onClick={() => onReply(message)}>
            Reply
          </Button>
          <Button variant="ghost" size="sm" leftIcon={Forward} onClick={() => onForward(message)}>
            Forward
          </Button>
          <button
            type="button"
            className="tb-icon"
            title="Delete"
            aria-label="Delete message"
            onClick={() => onDelete(message.id)}
          >
            <TrashIcon size={16} />
          </button>
        </div>

        {/* subject + addresses + date */}
        <h2 className="mail-read-subject">{message.subject || '(no subject)'}</h2>
        <div className="mail-read-meta">
          <MetaRow label="From">
            <span className="who">{fromLabel}</span>
            {message.from_name && message.from_addr ? ` <${message.from_addr}>` : ''}
            {dateLabel && <span className="mail-read-date">{dateLabel}</span>}
          </MetaRow>
          {toLabel && <MetaRow label="To">{toLabel}</MetaRow>}
          {ccLabel && <MetaRow label="Cc">{ccLabel}</MetaRow>}
        </div>
      </div>

      {/* body + attachments */}
      <div className="mail-read-scroll">
        <MessageBody
          html={message.body_html}
          text={message.body_text}
          showImages={showImages}
          onShowImages={() => setShowImages(true)}
        />
        <AttachmentChips
          attachments={message.attachments}
          onDownload={onDownloadAttachment}
        />
      </div>
    </div>
  )
}
