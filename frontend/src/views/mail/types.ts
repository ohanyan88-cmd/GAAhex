// Shared types + EXACT leaf-component prop contracts for the Mail module UI.
// The component agents implement to these interfaces VERBATIM — do not invent fields.
//
// Conventions inherited from the codebase:
//   * Enum string literals are the backend's UPPER_SNAKE_CASE values (file 14).
//   * Money/dates are strings (ISO) or null; `[k: string]: any` tolerates additive
//     backend fields without a frontend break (the billing.ts/helpdesk.ts posture).
//   * Secrets are WRITE-ONLY: reads expose `has_password`, never the value.

import type { ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// 1. DOMAIN TYPES (mirror /api/mail/* responses)
// ─────────────────────────────────────────────────────────────────────────────

export type MailAccountStatus = 'PENDING' | 'CONNECTED' | 'AUTH_ERROR' | 'CONN_ERROR' | 'DISABLED'
export type MailTransportSecurity = 'SSL' | 'STARTTLS' | 'NONE'
export type MailAuthType = 'PASSWORD' | 'OAUTH2'
export type MailFolderRole =
  | 'INBOX' | 'SENT' | 'DRAFTS' | 'TRASH' | 'SPAM' | 'ARCHIVE' | 'CUSTOM'
export type MailMessageDirection = 'INBOUND' | 'OUTBOUND'
export type MailSendStatus = 'QUEUED' | 'SENT' | 'FAILED' | 'BOUNCED'
export type MailAttachmentDownloadState = 'PENDING' | 'STORED' | 'FAILED' | 'SKIPPED_OVERSIZE'

// An RFC address pair. Backend serializes to/from [{name,email}] JSONB.
export type MailAddress = { name?: string | null; email: string }

// GET /api/mail/accounts[/{id}] — secrets NEVER returned; `has_password` reflects whether
// a credential is stored (the UI shows "•••• set — replace?").
export type MailAccount = {
  id: string
  display_name: string
  email_address: string
  imap_host: string
  imap_port: number
  imap_security: MailTransportSecurity
  smtp_host: string
  smtp_port: number
  smtp_security: MailTransportSecurity
  auth_type: MailAuthType
  auth_username?: string | null
  has_password: boolean
  is_system_sender: boolean
  is_default: boolean
  sync_enabled: boolean
  status: MailAccountStatus
  last_error?: string | null
  last_sync_at?: string | null
  created_at?: string | null
  [k: string]: any
}

// Write payload for POST/PATCH /api/mail/accounts. `secret_password` is sent ONLY when the
// operator typed a new value; omit it on PATCH to leave the stored credential untouched.
export type MailAccountInput = {
  display_name: string
  email_address: string
  imap_host: string
  imap_port: number
  imap_security: MailTransportSecurity
  smtp_host: string
  smtp_port: number
  smtp_security: MailTransportSecurity
  auth_type: MailAuthType
  auth_username?: string | null
  secret_password?: string
  is_system_sender?: boolean
  is_default?: boolean
  sync_enabled?: boolean
}

// POST /api/mail/accounts/{id}/test
export type MailAccountTestResult = {
  imap_ok: boolean
  smtp_ok: boolean
  detail?: string | null
}

// POST /api/mail/accounts/{id}/sync
export type MailSyncTriggerResult = { queued: boolean; detail?: string | null }

// GET /api/mail/accounts/{id}/folders
export type MailFolder = {
  id: string
  account_id: string
  imap_path: string
  display_name: string
  role?: MailFolderRole | null
  unseen_count: number
  total_count: number
  last_sync_at?: string | null
  [k: string]: any
}

// Row shape for GET /api/mail/messages (header/snippet columns only — no body).
export type MailMessageSummary = {
  id: string
  account_id: string
  folder_id?: string | null
  thread_id: string
  message_id?: string | null
  from_addr?: string | null
  from_name?: string | null
  to_addrs: MailAddress[]
  subject?: string | null
  snippet?: string | null
  direction: MailMessageDirection
  flag_seen: boolean
  flag_flagged: boolean
  flag_answered: boolean
  has_attachments: boolean
  size_bytes?: number | null
  sent_at?: string | null
  received_at?: string | null
  send_status?: MailSendStatus | null
  [k: string]: any
}

// Attachment metadata (bytes fetched lazily via downloadAttachmentUrl).
export type MailAttachmentMeta = {
  id: string
  message_id: string
  filename: string
  content_type: string
  size_bytes: number
  is_inline: boolean
  content_id?: string | null
  download_state: MailAttachmentDownloadState
  [k: string]: any
}

// GET /api/mail/messages/{id} — full message (body + attachments). Opening marks seen.
export type MailMessageFull = MailMessageSummary & {
  cc_addrs: MailAddress[]
  bcc_addrs: MailAddress[]
  reply_to_addrs: MailAddress[]
  in_reply_to?: string | null
  references_raw?: string | null
  body_text?: string | null
  body_html?: string | null
  send_error?: string | null
  attachments: MailAttachmentMeta[]
}

// Query params for GET /api/mail/messages.
export type MailMessageListFilters = {
  account_id: string
  folder_id?: string
  q?: string
  unseen?: boolean
  limit?: number
  offset?: number
}

// listMessages() normalizes body + X-Total-Count into one shape for pagination.
export type MailMessageListResult = {
  items: MailMessageSummary[]
  total: number
}

// PATCH /api/mail/messages/{id} — flags/move. Omitted keys are left unchanged.
export type MailFlagPatch = {
  seen?: boolean
  flagged?: boolean
  answered?: boolean
  folder_id?: string
}

// POST /api/mail/messages/send.
export type MailSendInput = {
  account_id: string
  to: MailAddress[]
  cc?: MailAddress[]
  bcc?: MailAddress[]
  subject: string
  html?: string
  text?: string
  attachment_ids?: string[]
  in_reply_to?: string
  references?: string[]
}

export type MailSendResult = {
  message_id: string
  status: MailSendStatus
  detail?: string | null
  [k: string]: any
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. LEAF COMPONENT PROP CONTRACTS (implement VERBATIM)
// ─────────────────────────────────────────────────────────────────────────────

// FolderSidebar — left pane (200px). Lists folders for the selected account, the active
// folder highlighted, unread badges; a gear opens MailAccountSettings.
export type FolderSidebarProps = {
  account: MailAccount | null
  accounts: MailAccount[]
  folders: MailFolder[] | null
  loading: boolean
  selectedFolderId: string | null
  onSelectFolder: (folderId: string) => void
  onSelectAccount: (accountId: string) => void
  onOpenSettings: () => void
  onCompose: () => void
}

// MessageList — middle pane (340px). Header/snippet rows; `.mail-row.unread` gold border
// for !flag_seen; selected row highlighted. Owns its own loading/empty/error states.
export type MessageListProps = {
  messages: MailMessageSummary[] | null
  loading: boolean
  error: string | null
  selectedMessageId: string | null
  folderName: string | null
  onSelectMessage: (messageId: string) => void
  onRetry: () => void
  total?: number
  onLoadMore?: () => void
}

// ThreadReader — right pane (1fr). Renders the opened message header + body via MessageBody
// + AttachmentChips, with flag/reply/forward/delete actions.
export type ThreadReaderProps = {
  message: MailMessageFull | null
  loading: boolean
  error: string | null
  onToggleFlag: (flag: 'seen' | 'flagged' | 'answered', value: boolean) => void
  onReply: (message: MailMessageFull) => void
  onForward: (message: MailMessageFull) => void
  onDelete: (messageId: string) => void
  onRetry: () => void
  onDownloadAttachment: (attachment: MailAttachmentMeta) => void
}

// MessageBody — renders inbound HTML ONLY through DOMPurify (never raw
// dangerouslySetInnerHTML); remote images gated behind `showImages` (default off).
export type MessageBodyProps = {
  html?: string | null
  text?: string | null
  showImages: boolean
  onShowImages: () => void
}

// AttachmentChips — chip row; click triggers the auth'd blob download.
export type AttachmentChipsProps = {
  attachments: MailAttachmentMeta[]
  onDownload: (attachment: MailAttachmentMeta) => void
}

// ComposeModal — compose / reply / forward. `initial` pre-fills reply/forward context.
export type ComposeInitial = {
  to?: MailAddress[]
  cc?: MailAddress[]
  subject?: string
  html?: string
  text?: string
  in_reply_to?: string
  references?: string[]
}

export type ComposeModalProps = {
  open: boolean
  accounts: MailAccount[]
  defaultAccountId: string | null
  initial?: ComposeInitial
  onClose: () => void
  onSend: (payload: MailSendInput) => Promise<void>
  uploadAttachment: (file: File) => Promise<{ attachment_id: string; filename: string; size_bytes: number; content_type: string }>
}

// RecipientField — to/cc/bcc address chips + free-typed entry. Emits the full list on change.
export type RecipientFieldProps = {
  label: string
  value: MailAddress[]
  onChange: (next: MailAddress[]) => void
  placeholder?: string
}

// MailAccountSettings — Identity / IMAP / SMTP / Auth groups; Test / Save / Sync now /
// Set default / Delete. Opened from the gear or ?settings=1. Password is write-only:
// the field shows "•••• set — replace?" and transmits only a newly typed value.
export type MailAccountSettingsProps = {
  open: boolean
  account: MailAccount | null  // null = create-new mode
  onClose: () => void
  onSave: (id: string | null, data: MailAccountInput | Partial<MailAccountInput>) => Promise<void>
  onTest: (id: string) => Promise<MailAccountTestResult>
  onSyncNow: (id: string) => Promise<void>
  onSetDefault: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

// MailView's first-run EmptyState action slot (kept here so leaves can reference it).
export type MailEmptyStateAction = { label: string; onClick: () => void; icon?: ReactNode }
