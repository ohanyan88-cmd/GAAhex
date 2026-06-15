// RecordDrawer — reusable right-side slide-over for entity detail views.
//
// Built for PROMPT 6 of the design-system reskin. The structure (hero + tabs +
// body + status select + timeline) and the CSS class names (gx-scrim,
// gx-drawer, drawer-head, drawer-hero, drawer-tabs, drawer-tab, drawer-body,
// kv, kv-k, kv-v, timeline, tl-item, tl-dot) match the kit reference at
// design-system/ui_kits/portal/interactions.jsx (lines 100-205) and
// design-system/ui_kits/portal/app.css (lines 386-406).
//
// The component is props-driven so any entity view can adopt it — Invoices is
// the first consumer (see InvoicesView.tsx). Data wiring stays in the parent;
// this component only renders.

import { useId, useState, type ReactNode } from 'react'
import Overlay from './Overlay'
import { X, LayoutList, Clock, Link as LinkIcon, MessageSquare } from 'lucide-react'
import { Button, StatusPill } from '../primitives'
import { humanRef, humanizeEntity, looksLikeRawId } from '../lib/humanize'

export type RecordDrawerStatusVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

export interface RecordDrawerField {
  key: string
  label: string
  value: ReactNode
}

export interface RecordDrawerActivity {
  ts: string
  icon?: ReactNode
  title: string
  detail?: string
}

export interface RecordDrawerRelated {
  key: string
  label: string
  href?: string
  onClick?: () => void
  meta?: string
}

export interface RecordDrawerNote {
  author: string
  ts: string
  body: string
}

export interface RecordDrawerProps {
  open: boolean
  onClose: () => void
  entityKey: string
  id: string
  title: string
  subtitle?: string
  status?: { label: string; variant: RecordDrawerStatusVariant }
  onStatusChange?: (next: string) => void
  statusOptions?: string[]
  fields: RecordDrawerField[]
  activity?: RecordDrawerActivity[]
  related?: RecordDrawerRelated[]
  notes?: RecordDrawerNote[]
  onAddNote?: (body: string) => void
  /** Secondary actions rendered in the drawer header (next to the ✕). Optional. */
  actions?: ReactNode
  /** Primary action row rendered at the BOTTOM of the drawer (kit pattern).
   * Use this for "Resolve · Assign" on tickets, "Mark Paid · Pay online" on
   * invoices — wired actions only, no inert buttons. */
  footer?: ReactNode
}

type TabKey = 'Overview' | 'Activity' | 'Related' | 'Notes'

function initials(s: string): string {
  const parts = s.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function RecordDrawer({
  open,
  onClose,
  entityKey,
  id,
  title,
  subtitle,
  status,
  onStatusChange,
  statusOptions,
  fields,
  activity,
  related,
  notes,
  onAddNote,
  actions,
  footer,
}: RecordDrawerProps) {
  const [tab, setTab] = useState<TabKey>('Overview')
  const [noteDraft, setNoteDraft] = useState('')
  const titleId = useId()

  // Esc-to-close, focus-trap, initial focus, focus-return on close, body scroll-lock and
  // click-outside all come from the shared Overlay primitive (one source — §0.3/§7). This
  // component no longer hand-rolls a portal/keydown/scroll-lock of its own.
  if (!open) return null

  const tabs: Array<{ key: TabKey; icon: ReactNode }> = [
    { key: 'Overview', icon: <LayoutList size={14} /> },
    { key: 'Activity', icon: <Clock size={14} /> },
    { key: 'Related', icon: <LinkIcon size={14} /> },
    { key: 'Notes', icon: <MessageSquare size={14} /> },
  ]

  return (
    <Overlay
      onClose={onClose}
      backdropClassName="gx-scrim right"
      className="gx-drawer"
      labelledBy={titleId}
      bare
    >
      <div className="drawer-head">
        <button type="button" className="tb-icon" onClick={onClose} aria-label="Close detail">
          <X size={18} />
        </button>
        <span style={{ color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-sm)' }}>
          {/* §6 — show a raw UUID as a short #ref; pass a human number (e.g. order no.) through as-is */}
          {humanizeEntity(entityKey)} · {looksLikeRawId(id) ? humanRef({ id }) : id}
        </span>
        <span className="spacer" />
        {actions}
      </div>

      <div className="drawer-hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-7)' }}>
          <div className="avatar" style={{ width: 46, height: 46, fontSize: 'var(--gx-text-md)' }}>
            {initials(title)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              id={titleId}
              style={{
                fontFamily: 'var(--gx-font-display)',
                fontSize: 'var(--gx-text-xl)',
                fontWeight: 'var(--gx-weight-semibold)',
                letterSpacing: '-.01em',
              }}
            >
              {title}
            </div>
            {subtitle && (
              <div
                className="hint"
                style={{ marginTop: 'var(--gx-space-1)', fontSize: 'var(--gx-text-sm)' }}
              >
                {subtitle}
              </div>
            )}
          </div>
          <span className="spacer" />
          {status &&
            (onStatusChange ? (
              <select
                className="inp inp-sm"
                style={{ width: 'auto' }}
                value={status.label}
                onChange={(e) => onStatusChange(e.target.value)}
              >
                {(statusOptions ?? [status.label]).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <StatusPill variant={status.variant} label={status.label} size="sm" />
            ))}
        </div>
      </div>

      <div className="drawer-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={'drawer-tab' + (tab === t.key ? ' on' : '')}
            onClick={() => setTab(t.key)}
          >
            {t.icon}
            {t.key}
          </button>
        ))}
      </div>

      <div className="drawer-body">
        {tab === 'Overview' && (
          <div>
            {fields.length === 0 ? (
              <div className="hint">No fields to show.</div>
            ) : (
              fields.map((f) => (
                <div key={f.key} className="kv">
                  <div className="kv-k">{f.label}</div>
                  <div className="kv-v">{f.value}</div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'Activity' &&
          (activity && activity.length > 0 ? (
            <div className="timeline">
              {activity.map((a, i) => (
                <div key={i} className="tl-item">
                  <span className="tl-dot">{a.icon ?? <Clock size={13} />}</span>
                  <div>
                    <div style={{ fontSize: 'var(--gx-text-13)' }}>{a.title}</div>
                    <div
                      className="hint"
                      style={{ fontSize: 'var(--gx-text-11)', marginTop: 'var(--gx-space-1)' }}
                    >
                      {a.detail ? <span>{a.detail} · </span> : null}
                      <span>{a.ts}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="hint">No activity yet.</div>
          ))}

        {tab === 'Related' &&
          (related && related.length > 0 ? (
            <div style={{ display: 'grid', gap: 'var(--gx-space-5)' }}>
              {related.map((r) => {
                const inner = (
                  <>
                    <span
                      className="mono"
                      style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-link)' }}
                    >
                      {r.key}
                    </span>
                    <span style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-1)' }}>
                      {r.label}
                    </span>
                    {r.meta && (
                      <span
                        className="hint"
                        style={{ marginLeft: 'auto', fontSize: 'var(--gx-text-sm)' }}
                      >
                        {r.meta}
                      </span>
                    )}
                  </>
                )
                const style: React.CSSProperties = {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  border: '1px solid var(--gx-border-subtle)',
                  borderRadius: 'var(--gx-radius-md)',
                  background: 'var(--gx-surface-2)',
                  textDecoration: 'none',
                  color: 'inherit',
                  cursor: r.href || r.onClick ? 'pointer' : 'default',
                }
                if (r.href) {
                  return (
                    <a key={r.key} href={r.href} style={style}>
                      {inner}
                    </a>
                  )
                }
                return (
                  <div
                    key={r.key}
                    role={r.onClick ? 'button' : undefined}
                    tabIndex={r.onClick ? 0 : undefined}
                    onClick={r.onClick}
                    onKeyDown={(e) => {
                      if (r.onClick && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        r.onClick()
                      }
                    }}
                    style={style}
                  >
                    {inner}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="hint">Nothing linked.</div>
          ))}

        {tab === 'Notes' && (
          <>
            {(notes ?? []).length === 0 && !onAddNote && <div className="hint">No notes yet.</div>}
            {(notes ?? []).map((n, i) => (
              <div
                key={i}
                style={{
                  padding: 'var(--gx-space-5) var(--gx-space-6)',
                  border: '1px solid var(--gx-border-subtle)',
                  borderRadius: 'var(--gx-radius-md)',
                  background: 'var(--gx-surface-2)',
                  marginBottom: 'var(--gx-space-3)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 'var(--gx-text-sm)',
                    color: 'var(--gx-text-3)',
                  }}
                >
                  <span style={{ fontWeight: 'var(--gx-weight-semibold)' }}>{n.author}</span>
                  <span>{n.ts}</span>
                </div>
                <div
                  style={{
                    marginTop: 'var(--gx-space-3)',
                    fontSize: 'var(--gx-text-13)',
                    color: 'var(--gx-text-1)',
                    lineHeight: 1.5,
                  }}
                >
                  {n.body}
                </div>
              </div>
            ))}
            {onAddNote && (
              <div style={{ marginTop: 'var(--gx-space-5)' }}>
                <textarea
                  className="inp"
                  rows={3}
                  placeholder="Add a note…"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  style={{ width: '100%', resize: 'vertical' }}
                />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    marginTop: 'var(--gx-space-3)',
                  }}
                >
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    disabled={!noteDraft.trim()}
                    onClick={() => {
                      const body = noteDraft.trim()
                      if (!body) return
                      onAddNote(body)
                      setNoteDraft('')
                    }}
                  >
                    Post note
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {footer && (
        <div
          className="drawer-foot"
          style={{
            display: 'flex',
            gap: 'var(--gx-space-3)',
            justifyContent: 'flex-end',
            alignItems: 'center',
            padding: 'var(--gx-space-6) var(--gx-space-20)',
            borderTop: '1px solid var(--gx-border-subtle)',
            background: 'var(--gx-surface-2)',
            flexShrink: 0,
          }}
        >
          {footer}
        </div>
      )}
    </Overlay>
  )
}
