// AttachmentChips — chip row for a message's attachments. Each chip triggers the
// auth'd blob download via onDownload (the parent fetches downloadAttachmentUrl with
// authH(token)→blob; a plain <a href> can't carry the Bearer header). D20-clean:
// `.gx-comms .mail-chip*` token classes only — no inline hex/px.
import { PaperclipIcon, DownloadIcon } from '../../components/icons'
import type { AttachmentChipsProps, MailAttachmentMeta } from './types'

// Human-readable byte size (KB/MB) using the mono `.mail-chip-meta` slot.
function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function AttachmentChips({ attachments, onDownload }: AttachmentChipsProps) {
  if (!attachments || attachments.length === 0) return null

  // Inline parts (content_id images embedded in the HTML body) aren't listed as
  // downloadable chips — only real file attachments are.
  const files = attachments.filter((a) => !a.is_inline)
  if (files.length === 0) return null

  return (
    <div className="mail-attachments">
      {files.map((att: MailAttachmentMeta) => {
        // STORED = bytes are persisted and fetchable; any other state can't be downloaded.
        const downloadable = att.download_state === 'STORED'
        const sizeLabel = formatSize(att.size_bytes)
        const stateLabel =
          att.download_state === 'PENDING' ? 'syncing…'
            : att.download_state === 'FAILED' ? 'unavailable'
            : att.download_state === 'SKIPPED_OVERSIZE' ? 'too large'
            : sizeLabel
        return (
          <button
            key={att.id}
            type="button"
            className="mail-chip"
            disabled={!downloadable}
            onClick={() => downloadable && onDownload(att)}
            title={downloadable ? `Download ${att.filename}` : `${att.filename} — ${stateLabel}`}
          >
            <span className="mail-chip-ic">
              {downloadable ? <DownloadIcon size={14} /> : <PaperclipIcon size={14} />}
            </span>
            <span className="mail-chip-body">
              <span className="mail-chip-name">{att.filename}</span>
              {stateLabel && <span className="mail-chip-meta">{stateLabel}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
