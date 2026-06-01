// SavedViewsView — Workspace → Saved Views.
//
// Real data from GET /api/views?entity={key}. The backend requires an entity_key
// query param (one entity at a time), so this view fans out across every entity
// the user can see (from /meta/entities) and aggregates the results into a single
// list — owned + shared (tenant-wide) views together.
//
// Clicking a row navigates to that saved view's entity page via the onOpenEntity
// callback (the App router opens an EntityView for that slug). Per doctrine, only
// rows that actually have a real navigable entity are interactive.
//
// No mock fallbacks: per-entity fetch failures are swallowed (some entities may
// be 403 to this user); a fully empty aggregate → empty state.

import { useEffect, useState } from 'react'
import ViewHead from '../components/ViewHead'
import { EmptyState, SkeletonRows, ErrorBanner } from '../components/States'
import { BookmarkIcon, InboxIcon } from '../components/icons'
import { getEntities } from '../lib/api'

import { BASE } from '../lib/config'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type SavedView = {
  id: string
  owner_user_id: string | null
  shared: boolean
  entity_key: string
  name: string
  config: Record<string, unknown>
  created_at: string | null
}

type Entity = { key: string; label: string; label_plural: string; route_slug: string }

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; items: Array<SavedView & { route_slug: string; entity_label: string }> }
  | { kind: 'error'; message: string }

export default function SavedViewsView({
  token,
  onOpenEntity,
}: {
  token: string
  onOpenEntity?: (slug: string) => void
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  async function load() {
    setState({ kind: 'loading' })
    try {
      const entities: Entity[] = await getEntities(token)
      // Fan out one request per entity. Each can independently 403/404 — we keep
      // only successful responses. This is a real fetch on each entity; nothing
      // is faked.
      const results = await Promise.all(
        entities.map(async (e) => {
          try {
            const r = await fetch(
              `${BASE}/api/views?entity=${encodeURIComponent(e.key)}`,
              { headers: authH(token) },
            )
            if (!r.ok) return [] as SavedView[]
            const data = await r.json()
            return Array.isArray(data) ? (data as SavedView[]) : []
          } catch {
            return []
          }
        }),
      )
      const flat = results.flatMap((rows, idx) =>
        rows.map((v) => ({
          ...v,
          route_slug: entities[idx].route_slug,
          entity_label: entities[idx].label_plural,
        })),
      )
      // Sort: shared first, then by created_at desc.
      flat.sort((a, b) => {
        if (a.shared !== b.shared) return a.shared ? -1 : 1
        return (b.created_at ?? '').localeCompare(a.created_at ?? '')
      })
      setState({ kind: 'ok', items: flat })
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message })
    }
  }

  useEffect(() => { load() }, [token])

  const items = state.kind === 'ok' ? state.items : []
  const subtitle = state.kind === 'ok' ? `${items.length} saved` : undefined

  return (
    <div className="view">
      <div className="view-inner section-page fade">
        <div className="crumbs">
          <span>Workspace</span>
          <span className="sep">/</span>
          <span style={{ color: 'var(--gx-text-1)' }}>Saved Views</span>
        </div>

        <ViewHead
          icon={<BookmarkIcon size={18} />}
          title="Saved Views"
          sub={subtitle ?? 'Filters and column sets saved from list pages'}
        />

        {state.kind === 'error' ? (
          <ErrorBanner message={state.message} onRetry={load} />
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            {state.kind === 'loading' ? (
              <div style={{ padding: 14 }}>
                <SkeletonRows rows={5} />
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                icon={<InboxIcon size={40} />}
                title="No saved views yet"
                message="Save a filter / column set from any list page and it will appear here."
              />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Entity</th>
                      <th>Scope</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((v) => {
                      const clickable = !!onOpenEntity && !!v.route_slug
                      return (
                        <tr
                          key={v.id}
                          onClick={clickable ? () => onOpenEntity!(v.route_slug) : undefined}
                          style={{ cursor: clickable ? 'pointer' : 'default' }}
                          title={clickable ? `Open ${v.entity_label}` : undefined}
                        >
                          <td style={{ fontWeight: 500 }}>{v.name}</td>
                          <td style={{ color: 'var(--gx-text-2)' }}>{v.entity_label}</td>
                          <td>
                            {v.shared
                              ? <span className="pill pill-info">Shared</span>
                              : <span className="pill pill-neutral">Personal</span>}
                          </td>
                          <td className="mono tnum" style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>
                            {v.created_at ? new Date(v.created_at).toLocaleDateString() : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
