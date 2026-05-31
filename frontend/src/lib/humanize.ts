// humanize.ts — turn machine strings into human-readable labels.
//
// Why: Backend records carry machine keys (`work_order`, `helpdesk_ticket`,
// `app_user`) and event types (`approval_requested`, `transition`). The UI
// should never surface those raw — every Workspace surface (Activity Feed,
// the Recent Activity widget, etc.) goes through these helpers.
//
// Doctrine: real data only. We never invent a label for an unknown entity;
// we fall back to a Title-Cased version of the key so the user always sees
// something readable even for entities the kit didn't know about.

const ENTITY_OVERRIDES: Record<string, string> = {
  // Built-in entities
  work_order: 'Work Order',
  workitem: 'Work Item',
  work_item: 'Work Item',
  helpdesk_ticket: 'Helpdesk Ticket',
  ticket: 'Ticket',
  app_user: 'User',
  customer: 'Customer',
  invoice: 'Invoice',
  payment: 'Payment',
  subscription: 'Subscription',
  product: 'Product',
  service: 'Service',
  order: 'Order',
  entity_def: 'Entity',
  field_def: 'Field',
  org_node: 'Organization Node',
  approval: 'Approval',
  comment: 'Comment',
  attachment: 'Attachment',
  webhook: 'Webhook',
  webhook_endpoint: 'Webhook Endpoint',
  resource_pool: 'Resource Pool',
  account: 'Account',
  party: 'Party',
  calendar_event: 'Event',
  notification: 'Notification',
  message: 'Message',
  view: 'Saved View',
  saved_view: 'Saved View',
}

/** Turn an entity_key like `work_order` into "Work Order". */
export function humanizeEntity(key: string | null | undefined): string {
  if (!key) return ''
  const k = key.toLowerCase()
  if (ENTITY_OVERRIDES[k]) return ENTITY_OVERRIDES[k]
  // Default: snake_case / kebab-case → Title Case
  return k
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const ACTION_VERBS: Record<string, string> = {
  create: 'created',
  created: 'created',
  update: 'updated',
  updated: 'updated',
  delete: 'deleted',
  deleted: 'deleted',
  transition: 'changed status of',
  status_change: 'changed status of',
  comment: 'commented on',
  commented: 'commented on',
  assign: 'assigned',
  assigned: 'assigned',
  unassign: 'unassigned',
  approval_requested: 'requested approval for',
  approval_approved: 'approved',
  approval_rejected: 'rejected',
  action_failed: 'failed to act on',
}

/** Map an action `type` to a past-tense verb phrase. */
export function humanizeAction(type: string | null | undefined): string {
  if (!type) return 'updated'
  const t = type.toLowerCase()
  return ACTION_VERBS[t] || type.replace(/_/g, ' ')
}

/** Indefinite article ("a" / "an") for the next word. */
export function indefinite(next: string): string {
  if (!next) return 'a'
  return /^[aeiou]/i.test(next.trim()) ? 'an' : 'a'
}

/** Stable two-letter initials for an avatar from a display name. */
export function initials(name: string | null | undefined): string {
  if (!name) return '·'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Deterministic palette index for an avatar background, derived from a stable key
 * (user id or display name). 6 buckets — keep in sync with the CSS palette
 * (`.act-avatar.pN` in styles.css).
 */
export function avatarPalette(seed: string | null | undefined): number {
  if (!seed) return 0
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 6
}

/** Short, friendly day-bucket label for activity grouping. */
export function dayBucketLabel(iso: string | null | undefined): string {
  if (!iso) return 'Earlier'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'Earlier'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) {
    return target.toLocaleDateString(undefined, { weekday: 'long' })
  }
  // > 7 days: short date
  return target.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: target.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

/** A stable sort/group key — yyyy-mm-dd — so chronological order survives grouping. */
export function dayBucketKey(iso: string | null | undefined): string {
  if (!iso) return '0000-00-00'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '0000-00-00'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
