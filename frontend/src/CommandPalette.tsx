import { useEffect, useMemo, useRef, useState } from 'react'
import Overlay from './Overlay'
import { SearchIcon } from './icons'

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Entity = { key: string; label: string; label_plural: string; route_slug: string }
type Match = { id: string; status: string | null; label: string; snippet: string }
type Group = { entity_key: string; label_plural: string; route_slug: string; matches: Match[] }
export type PaletteRoute = 'org' | 'dashboards' | 'reports' | 'messages' | 'studio'
type Item = { id: string; group: string; label: string; sub?: string; run: () => void }

// ⌘K / Ctrl-K command palette — global search (GET /api/search?q=) grouped by entity, plus
// nav/action jump items. Up/Down to move, Enter to run, Esc to close (Overlay focus-trap). Built on
// the Overlay primitive; reduced-motion aware via the overlay animation tokens.
export default function CommandPalette({ token, entities, canConfigure, onEntity, onRoute, onClose }: {
  token: string
  entities: Entity[]
  canConfigure: boolean
  onEntity: (slug: string) => void
  onRoute: (r: PaletteRoute) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // debounced cross-entity search
  useEffect(() => {
    const needle = q.trim()
    if (!needle) { setGroups([]); setLoading(false); return }
    setLoading(true)
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`${BASE}/api/search?q=${encodeURIComponent(needle)}`, { headers: authH(token) })
        setGroups(r.ok ? (await r.json()) : [])
      } catch {
        setGroups([])
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(id)
  }, [q, token])

  const navItems: Item[] = useMemo(() => {
    const base: { label: string; run: () => void }[] = [
      { label: 'Org tree', run: () => onRoute('org') },
      { label: 'Dashboards', run: () => onRoute('dashboards') },
      { label: 'Reports', run: () => onRoute('reports') },
      { label: 'Messages', run: () => onRoute('messages') },
      ...(canConfigure ? [{ label: 'Studio', run: () => onRoute('studio') }] : []),
      ...entities.map((e) => ({ label: e.label_plural, run: () => onEntity(e.route_slug) })),
    ]
    const needle = q.trim().toLowerCase()
    const sel = needle ? base.filter((b) => b.label.toLowerCase().includes(needle)) : base
    return sel.map((b, i) => ({ id: `nav-${i}`, group: 'Go to', label: b.label, run: () => { b.run(); onClose() } }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, entities, canConfigure])

  const resultItems: Item[] = useMemo(() => {
    const out: Item[] = []
    for (const g of groups) for (const m of g.matches) {
      out.push({ id: `${g.entity_key}-${m.id}`, group: g.label_plural, label: m.label, sub: m.snippet, run: () => { onEntity(g.route_slug); onClose() } })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])

  const items = useMemo(() => [...resultItems, ...navItems], [resultItems, navItems])

  useEffect(() => { setActive(0) }, [q, groups])
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.run() }
  }

  // lay items out in groups while keeping a single running index for keyboard nav
  let running = -1
  const rendered: { group: string; items: { item: Item; index: number }[] }[] = []
  for (const it of items) {
    let g = rendered.find((x) => x.group === it.group)
    if (!g) { g = { group: it.group, items: [] }; rendered.push(g) }
    running++
    g.items.push({ item: it, index: running })
  }

  return (
    <Overlay onClose={onClose} className="cmdk" role="dialog">
      <div className="cmdk-search">
        <SearchIcon className="cmdk-icon" size={18} />
        <input
          className="cmdk-input"
          autoFocus
          placeholder="Search records, or jump to…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <kbd className="search-kbd">Esc</kbd>
      </div>
      <div className="cmdk-list" ref={listRef}>
        {loading && <p className="muted cmdk-empty">Searching…</p>}
        {!loading && items.length === 0 && (
          <p className="muted cmdk-empty">{q.trim() ? 'No matches.' : 'Type to search records, or jump to a view.'}</p>
        )}
        {rendered.map((g) => (
          <div key={g.group} className="cmdk-group">
            <div className="cmdk-group-label">{g.group}</div>
            {g.items.map(({ item, index }) => (
              <button
                key={item.id}
                data-idx={index}
                className={'cmdk-item' + (index === active ? ' on' : '')}
                onClick={item.run}
                onMouseEnter={() => setActive(index)}
              >
                <span className="cmdk-item-label">{item.label}</span>
                {item.sub && <span className="cmdk-item-sub">{item.sub}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </Overlay>
  )
}
