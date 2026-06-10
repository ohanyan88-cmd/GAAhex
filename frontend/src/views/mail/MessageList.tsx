// MessageList — middle pane (.gx-comms .mail-list, 340px). Renders MailMessageSummary
// header/snippet rows: `.mail-row.unread` (gold left border) for !flag_seen, `.mail-row.on`
// for the selected row. Owns its own loading / empty / error states. A header "Compose"
// button surfaces onCompose. D20-clean: every visual value is a `--gx-*` token via a class
// in styles/_comms.css — no inline hex/px.
import type { MessageListProps, MailMessageSummary } from './types'
import { Button } from '../../primitives'
import { LoadingState, EmptyState, ErrorBanner } from '../../components/States'
import { InboxIcon, PaperclipIcon, StarIcon, ReplyIcon, EditIcon } from '../../components/icons'

export default function MessageList({
  messages,
  loading,
  error,
  selectedMessageId,
  folderName,
  onSelectMessage,
  onRetry,
  total,
  onLoadMore,
  onCompose,
}: MessageListProps & { onCompose?: () => void }) {
  const count = messages?.length ?? 0
  const totalLabel = total != null && total > count ? `${count} / ${total}` : count > 0 ? String(count) : null

  return (
    <div className="mail-list">
      <div className="mail-list-head">
        <h3 className="mail-list-title" title={folderName ?? undefined}>
          {folderName ?? 'Messages'}
          {totalLabel && <span className="mail-list-count">  {totalLabel}</span>}
        </h3>
        {onCompose && (
          <Button variant="primary" size="sm" onClick={onCompose} aria-label="Compose new message">
            <EditIcon size={13} /> Compose
          </Button>
        )}
      </div>

      <div className="mail-list-scroll">
        {error ? (
          <ErrorBanner message={error} onRetry={onRetry} />
        ) : loading ? (
          <LoadingState message="Loading messages…" />
        ) : !messages || messages.length === 0 ? (
          <EmptyState
            icon={<InboxIcon size={40} />}
            title="No messages"
            message={folderName ? `${folderName} is empty.` : 'This folder has no messages.'}
          />
        ) : (
          <>
            {messages.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                selected={m.id === selectedMessageId}
                onSelect={onSelectMessage}
              />
            ))}
            {onLoadMore && total != null && count < total && (
              <div className="mail-list-more">
                <Button variant="ghost" size="sm" onClick={onLoadMore}>
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// MessageRow — a single header/snippet row. Unread (!flag_seen) gets the gold left border
// via `.mail-row.unread`; the open message gets `.mail-row.on`. Sender, date, flag/answered/
// attachment icons in the top line; subject + snippet below.
function MessageRow({
  message,
  selected,
  onSelect,
}: {
  message: MailMessageSummary
  selected: boolean
  onSelect: (id: string) => void
}) {
  const unread = !message.flag_seen
  const cls = ['mail-row', unread ? 'unread' : '', selected ? 'on' : ''].filter(Boolean).join(' ')
  const who =
    message.direction === 'OUTBOUND'
      ? toLabel(message.to_addrs)
      : message.from_name || message.from_addr || '(unknown sender)'

  return (
    <button
      type="button"
      className={cls}
      onClick={() => onSelect(message.id)}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="mail-row-top">
        <span className="mail-row-from" title={who}>
          {who}
        </span>
        <span className="mail-row-icons">
          {message.flag_answered && <ReplyIcon size={12} aria-label="Answered" />}
          {message.flag_flagged && <StarIcon size={12} className="flagged" aria-label="Flagged" />}
          {message.has_attachments && <PaperclipIcon size={12} aria-label="Has attachments" />}
          <span className="mail-row-date">{formatDate(message.received_at ?? message.sent_at)}</span>
        </span>
      </div>
      <div className="mail-row-subject" title={message.subject ?? undefined}>
        {message.subject || '(no subject)'}
      </div>
      {message.snippet && <div className="mail-row-snippet">{message.snippet}</div>}
    </button>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function toLabel(addrs: MailMessageSummary['to_addrs']): string {
  if (!addrs || addrs.length === 0) return '(no recipient)'
  const first = addrs[0]
  const head = first.name || first.email
  return addrs.length > 1 ? `${head} +${addrs.length - 1}` : head
}

// Compact relative-ish date: today → time, this year → "MMM D", else "MMM D, YYYY".
function formatDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
