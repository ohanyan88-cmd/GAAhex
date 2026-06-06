// GlobalSearchView — Workspace → Global Search.
// Real data from GET /api/search?q=... Facets from ?facets=true.
// No mock fallbacks: empty q → empty state, API errors → error banner.
import { useState, useCallback, useEffect, useRef } from 'react'
import { EmptyState, ErrorBanner, SkeletonRows } from '../components/States'
import { InboxIcon, SearchIcon } from '../components/icons'
import { BASE, authH } from '../lib/billing'
import { PageShell } from '../page-shell'


type Match = { id: string; label: string; snippet: string; highlight: string; score: number; status: string | null }
type Group = { entity_key: string; label_plural: string; route_slug: string; matches: Match[] }
type FacetResult = { query: string; total: number; hits: Array<Match & { entity_key: string; label_plural: string; route_slug: string }>; facets: { entity: Record<string, number>; status: Record<string, number> } }

export default function GlobalSearchView({ token, onNavigate }: {
  token: string
  onNavigate?: (slug: string, recordId?: string) => void
}) {
  const [q, setQ] = useState('')
  const [pending, setPending] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [facets, setFacets] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const runSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setGroups([]); setFacets({}); setTotal(0); setError(null); return }
    setLoading(true); setError(null)
    try {
      const [groupsRes, facetsRes] = await Promise.all([
        fetch(`${BASE}/api/search?q=${encodeURIComponent(query)}&limit=50`, { headers: authH(token) }),
        fetch(`${BASE}/api/search?q=${encodeURIComponent(query)}&facets=true&limit=1`, { headers: authH(token) }),
      ])
      if (!groupsRes.ok) throw new Error(`HTTP ${groupsRes.status}`)
      const groupData: Group[] = await groupsRes.json()
      setGroups(groupData)
      if (facetsRes.ok) {
        const fd: FacetResult = await facetsRes.json()
        setFacets(fd.facets?.entity ?? {})
        setTotal(fd.total ?? 0)
      }
    } catch (e) {
      setError((e as Error).message || 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [token])

  const onChange = (v: string) => {
    setPending(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setQ(v); runSearch(v) }, 300)
  }

  const totalMatches = groups.reduce((s, g) => s + g.matches.length, 0)
  const resultCount = total || totalMatches

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Workspace', 'Global Search']}
      icon={<SearchIcon size={20} />}
      title="Global Search"
      subtitle={q && !loading ? `${resultCount} result${resultCount === 1 ? '' : 's'}` : 'Search across all records'}
    >
      <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
        <input
          ref={inputRef}
          className="inp inp-md"
          style={{ width: '100%', maxWidth: 600, marginBottom: 'var(--sp-4)' }}
          placeholder="Search everything…"
          value={pending}
          onChange={e => onChange(e.target.value)}
          aria-label="Search"
        />
        {facets && Object.keys(facets).length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
            {Object.entries(facets).sort((a, b) => b[1] - a[1]).map(([key, count]) => (
              <span key={key} className="badge badge-neutral" style={{ fontSize: 'var(--gx-text-sm)' }}>
                {key.replace(/_/g, ' ')} · {count}
              </span>
            ))}
          </div>
        )}
        {loading && <SkeletonRows rows={4} />}
        {error && <ErrorBanner message={error} />}
        {!loading && !error && q && groups.length === 0 && (
          <EmptyState icon={<InboxIcon size={36} />} title="No results" message={`Nothing matched "${q}"`} />
        )}
        {!loading && !error && !q && (
          <EmptyState icon={<InboxIcon size={36} />} title="Start typing to search" message="Searches across customers, invoices, tickets, orders and all other records." />
        )}
        {!loading && groups.map(group => (
          <div key={group.entity_key} style={{ marginBottom: 'var(--sp-6)' }}>
            <div className="section-label" style={{ marginBottom: 'var(--sp-2)' }}>{group.label_plural}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)' }}>
              {group.matches.map(m => (
                <div
                  key={m.id}
                  className="card card-hover"
                  style={{ padding: 'var(--sp-3) var(--sp-4)', cursor: onNavigate ? 'pointer' : 'default' }}
                  onClick={() => onNavigate?.(group.route_slug, m.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600 }}>{m.label}</span>
                    {m.status && <span className="badge badge-neutral" style={{ fontSize: 'var(--gx-text-11)' }}>{m.status}</span>}
                  </div>
                  <div
                    className="muted"
                    style={{ fontSize: 'var(--gx-text-13)', marginTop: 'var(--gx-space-1)' }}
                    dangerouslySetInnerHTML={{ __html: m.highlight || m.snippet }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  )
}
