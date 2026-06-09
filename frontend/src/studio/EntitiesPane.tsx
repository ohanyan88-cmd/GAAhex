import { useCallback, useEffect, useState } from 'react'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { Button } from '../primitives'
import { EditIcon, PlusIcon, RowsIcon } from '../components/icons'
import type { EntitySummary } from './entities/types'
import { FetchError } from './entities/types'
import { apiFetch } from './entities/api'
import { CreateEntityModal } from './entities/CreateEntityModal'
import { DetailDrawer } from './entities/DetailDrawer'
import { useAuth } from '../context/AuthContext'

export default function EntitiesPane() {
  const { token } = useAuth()
  const [entities, setEntities] = useState<EntitySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    let alive = true
    setLoading(true); setError(''); setDenied(false)
    apiFetch(token!, '/meta/entities')
      .then((d: EntitySummary[]) => {
        if (!alive) return
        setEntities(Array.isArray(d) ? d : [])
      })
      .catch((ex) => {
        if (!alive) return
        if (ex instanceof FetchError && ex.status === 403) setDenied(true)
        else setError((ex as Error).message)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  useEffect(() => load(), [load])

  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to manage entities." />
  if (error) return <ErrorBanner message={error} onRetry={load} />

  const filtered = search.trim()
    ? entities.filter((e) =>
        e.label.toLowerCase().includes(search.toLowerCase()) ||
        e.route_slug.toLowerCase().includes(search.toLowerCase()) ||
        e.key.toLowerCase().includes(search.toLowerCase()),
      )
    : entities

  return (
    <div>
      <div className="row" style={{ marginBottom: 'var(--gx-space-5)', alignItems: 'flex-end' }}>
        <div>
          <h3 style={{ margin: '0 0 var(--gx-space-2)' }}>Entities</h3>
          <p className="hint" style={{ margin: 0 }}>
            Entities are the system's living configuration — fields and statuses applied to every record.
            Stand up a new entity here and it appears in the sidebar instantly.
          </p>
        </div>
        <span className="spacer" />
        <Button variant="primary" size="md" type="button" onClick={() => setShowCreate(true)}>
          <PlusIcon size={13} /> New entity
        </Button>
      </div>

      <div style={{ marginBottom: 'var(--gx-space-4)', maxWidth: 320 }}>
        <input
          className="inp inp-md"
          placeholder="Filter by label, key, or slug…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<RowsIcon size={40} />}
          title={search ? 'No entities match the filter.' : 'No entities yet.'}
          message={search ? 'Try a different query.' : 'Create the first entity using "New entity" above.'}
        />
      ) : (
        <div className="grid-wrap">
          <table className="grid studio">
            <thead>
              <tr>
                <th scope="col">Label</th>
                <th scope="col">Key</th>
                <th scope="col">Route</th>
                <th scope="col">Icon</th>
                <th scope="col">Status</th>
                <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr
                  key={e.route_slug}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setOpenSlug(e.route_slug)}
                >
                  <td>{e.label}</td>
                  <td><code className="mono">{e.key}</code></td>
                  <td><code className="mono">{e.route_slug}</code></td>
                  <td><span className="hint">{e.icon ?? '—'}</span></td>
                  <td><span className="hint">{e.status}</span></td>
                  <td className="actions-col">
                    <Button variant="ghost" size="sm" type="button"
                      onClick={(ev) => { ev.stopPropagation(); setOpenSlug(e.route_slug) }}
                      aria-label={`Open ${e.label}`}
                    >
                      <EditIcon size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateEntityModal
          onClose={() => setShowCreate(false)}
          onCreated={(slug) => { setShowCreate(false); load(); setOpenSlug(slug) }}
        />
      )}

      {openSlug && (
        <DetailDrawer
          slug={openSlug}
          onClose={() => setOpenSlug(null)}
          onChanged={() => load()}
          onDeleted={() => { setOpenSlug(null); load() }}
        />
      )}
    </div>
  )
}
