import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../lib/useFocusTrap'
import { CloseIcon, GearIcon, EditIcon, ArrowRightIcon, SearchIcon, RowsIcon } from '../components/icons'
import FieldsPane from '../studio/FieldsPane'
import WorkflowsPane from '../studio/WorkflowsPane'
import PageSettingsPane from './PageSettingsPane'
import { PAGE_SPECS } from '../lib/pageConfig'

// -----------------------------------------------------------------------
// ConfigureDrawer — right-side slide-in overlay for per-page configuration.
// Opened by the superadmin "Configure page" button; stays on the current page.
// The orchestrator wires the open/close callbacks from App.tsx.
//
// Two modes (the panel shell — header, focus-trap, scroll-lock, backdrop — is shared):
//   • ENTITY mode  (pass `slug`):    entity Fields / Workflows panes + a page switcher.
//   • PAGE mode    (pass `pageKey`): a single "Page settings" pane that edits a bespoke page's
//                                    presentation descriptor (title + columns). No entity switcher.
// -----------------------------------------------------------------------

type EntitySummary = {
  key: string
  label: string
  label_plural: string
  route_slug: string
}

type Tab = 'fields' | 'workflows'

export type ConfigureDrawerProps =
  | {
      token: string
      slug: string
      entities: EntitySummary[]
      onClose: () => void
      onSwitchPage: (slug: string) => void
      pageKey?: undefined
      onSaved?: undefined
    }
  | {
      token: string
      pageKey: string
      entities: EntitySummary[]
      onClose: () => void
      onSaved?: () => void
      slug?: undefined
      onSwitchPage?: undefined
    }

// ---------------------------------------------------------------------------
// Searchable entity dropdown
// ---------------------------------------------------------------------------
function PageSwitcher({
  entities,
  currentSlug,
  onSwitch,
}: {
  entities: EntitySummary[]
  currentSlug: string
  onSwitch: (slug: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputId = useId()

  const current = entities.find((e) => e.route_slug === currentSlug)

  const filtered = query.trim()
    ? entities.filter(
        (e) =>
          e.label_plural.toLowerCase().includes(query.toLowerCase()) ||
          e.label.toLowerCase().includes(query.toLowerCase()) ||
          e.route_slug.toLowerCase().includes(query.toLowerCase()),
      )
    : entities

  function pick(slug: string) {
    setOpen(false)
    setQuery('')
    if (slug !== currentSlug) onSwitch(slug)
  }

  // close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      const el = document.getElementById('cfg-page-switcher')
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div id="cfg-page-switcher" style={{ position: 'relative' }}>
      <label
        htmlFor={inputId}
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-3)', display: 'block', marginBottom: 5 }}
      >
        Switch page
      </label>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }}>
          <SearchIcon size={13} />
        </span>
        <input
          id={inputId}
          className="inp inp-sm"
          style={{ paddingLeft: 28 }}
          value={open ? query : (current?.label_plural ?? currentSlug)}
          placeholder="Search pages…"
          autoComplete="off"
          onFocus={() => { setOpen(true); setQuery('') }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          aria-expanded={open}
          aria-autocomplete="list"
          aria-haspopup="listbox"
        />
      </div>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-pop)',
            zIndex: 10, maxHeight: 220, overflowY: 'auto',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-3)' }}>No pages found</div>
          ) : (
            filtered.map((e) => (
              <button
                key={e.route_slug}
                type="button"
                role="option"
                aria-selected={e.route_slug === currentSlug}
                className="btn btn-ghost"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '8px 12px', borderRadius: 0, border: 0,
                  borderBottom: '1px solid var(--border-soft)',
                  background: e.route_slug === currentSlug ? 'var(--accent-soft)' : 'transparent',
                  color: e.route_slug === currentSlug ? 'var(--accent)' : 'var(--text)',
                }}
                onClick={() => pick(e.route_slug)}
              >
                <span style={{ fontSize: 13, fontWeight: 500 }}>{e.label_plural}</span>
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{e.route_slug}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drawer panel (portal, right-side slide-in)
// ---------------------------------------------------------------------------
export default function ConfigureDrawer(props: ConfigureDrawerProps) {
  const { token, entities, onClose } = props
  const isPageMode = props.pageKey != null
  const slug = props.slug
  const pageKey = props.pageKey

  const [tab, setTab] = useState<Tab>('fields')
  const titleId = useId()

  const current = !isPageMode ? entities.find((e) => e.route_slug === slug) : undefined
  const pageSpec = isPageMode ? PAGE_SPECS[pageKey!] : undefined
  const heading = isPageMode
    ? `Configure · ${pageSpec?.defaultTitle ?? pageKey}`
    : `Configure · ${current?.label_plural ?? slug}`

  // Reset tab when slug changes (switching page) — entity mode only
  useEffect(() => { setTab('fields') }, [slug])

  const panelRef = useFocusTrap<HTMLDivElement>(onClose)

  // Body scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return createPortal(
    // Backdrop — clicking outside the drawer closes it
    <div
      style={{
        position: 'fixed', inset: 0,
        zIndex: 'var(--z-modal)' as any,
        background: 'rgba(0,0,0,0.45)',
        animation: 'overlay-fade var(--dur-base) var(--ease-decelerate)',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Drawer panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: 'min(620px, 100vw)',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
          animation: 'drawer-slide-in var(--dur-base) var(--ease-decelerate)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <span style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center' }}>
            <GearIcon size={18} />
          </span>
          <h3 id={titleId} style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {heading}
          </h3>
          <button
            type="button"
            className="iconbtn"
            aria-label="Close configure drawer"
            onClick={onClose}
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Entity mode: page switcher. Page mode: a one-line context label (no entity switcher). */}
        {isPageMode ? (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 18px', borderBottom: '1px solid var(--border)',
              flexShrink: 0, background: 'var(--surface-2)',
              fontSize: 12, color: 'var(--text-3)',
            }}
          >
            <RowsIcon size={13} />
            <span>Bespoke page — editing how it presents (title and columns). Its data and tools are unchanged.</span>
          </div>
        ) : (
          <div
            style={{
              padding: '12px 18px',
              borderBottom: '1px solid var(--border)',
              flexShrink: 0,
              background: 'var(--surface-2)',
            }}
          >
            <PageSwitcher
              entities={entities}
              currentSlug={slug!}
              onSwitch={props.onSwitchPage!}
            />
          </div>
        )}

        {/* Tabs — entity mode only (page mode has a single pane). */}
        {!isPageMode && (
          <div
            style={{
              display: 'flex', gap: 6,
              padding: '12px 18px 0',
              borderBottom: '1px solid var(--border)',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              className={'tab' + (tab === 'fields' ? ' on' : '')}
              onClick={() => setTab('fields')}
            >
              <EditIcon size={13} /> Fields
            </button>
            <button
              type="button"
              className={'tab' + (tab === 'workflows' ? ' on' : '')}
              onClick={() => setTab('workflows')}
            >
              <ArrowRightIcon size={13} /> Statuses / Workflows
            </button>
          </div>
        )}

        {/* Pane content — scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px' }}>
          {isPageMode && (
            <PageSettingsPane
              key={`page-${pageKey}`}
              token={token}
              pageKey={pageKey!}
              onSaved={props.onSaved}
            />
          )}
          {!isPageMode && tab === 'fields' && (
            <FieldsPane
              key={`fields-${slug}`}
              token={token}
              initialSlug={slug!}
              lockEntity
            />
          )}
          {!isPageMode && tab === 'workflows' && (
            <WorkflowsPane
              key={`workflows-${slug}`}
              token={token}
              initialSlug={slug!}
              lockEntity
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
