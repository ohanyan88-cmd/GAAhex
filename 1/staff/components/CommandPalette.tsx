import { useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent } from 'react'
import Overlay from './Overlay'
import { SearchIcon, CloseIcon, BookmarkIcon, ClockIcon, PinIcon } from './icons'
import { useI18n } from '../lib/i18n'
import {
  crossSearch,
  searchSuggest,
  getSavedSearches,
  getRecentSearches,
  saveSearch,
  type SearchGroup,
  type SearchFacets,
  type SavedSearch,
  type RecentSearch,
  type HighlightSpan,
} from '../lib/api'

type Entity = { key: string; label: string; label_plural: string; route_slug: string }
export type PaletteRoute = 'org' | 'dashboards' | 'reports' | 'messages' | 'studio'
type Item = { id: string; group: string; label: string; sub?: string; run: () => void }

// ---------------------------------------------------------------------------
// Safe highlight rendering — no dangerouslySetInnerHTML of server text.
// The server may return either:
//   a) highlight_spans: Array<{start,end,highlight}> — character-offset map
//   b) a snippet string with <mark>…</mark> tags — we parse tags into spans
// We strip all markup and then re-build the text using React children,
// wrapping matched ranges in <mark> elements. Server text is NEVER injected as HTML.
// ---------------------------------------------------------------------------

/** Parse <mark>…</mark> segments from a snippet into HighlightSpan[]. */
function parseMarkSpans(snippet: string): HighlightSpan[] {
  const spans: HighlightSpan[] = []
  const tagRe = /<\/?mark>/gi
  let clean = ''
  let lastRaw = 0
  let cleanOff = 0
  let openAt: number | null = null
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(snippet)) !== null) {
    const before = snippet.slice(lastRaw, m.index)
    clean += before
    if (m[0].toLowerCase() === '<mark>') {
      if (cleanOff < clean.length) {
        spans.push({ start: cleanOff, end: clean.length, highlight: false })
        cleanOff = clean.length
      }
      openAt = clean.length
    } else {
      // </mark>
      if (openAt !== null) {
        spans.push({ start: openAt, end: clean.length, highlight: true })
        cleanOff = clean.length
        openAt = null
      }
    }
    lastRaw = m.index + m[0].length
  }
  const tail = snippet.slice(lastRaw)
  clean += tail
  if (cleanOff < clean.length) {
    spans.push({ start: cleanOff, end: clean.length, highlight: false })
  }
  return spans
}

/** Build a safe React node array from a plain text string + highlight spans. */
function buildHighlightNodes(text: string, spans: HighlightSpan[]): ReactNode[] {
  if (!spans.length) return [text]
  const nodes: ReactNode[] = []
  for (let i = 0; i < spans.length; i++) {
    const { start, end, highlight } = spans[i]
    const chunk = text.slice(start, end)
    if (!chunk) continue
    if (highlight) {
      nodes.push(<mark key={i} className="cmdk-mark">{chunk}</mark>)
    } else {
      nodes.push(chunk)
    }
  }
  return nodes
}

/** Safely render a snippet, honouring server-provided spans or parsing <mark> tags. */
function SnippetText({ snippet, spans }: { snippet: string; spans?: HighlightSpan[] }) {
  // If the server sends character-offset spans, use them directly on the raw snippet.
  if (spans && spans.length > 0) {
    return <>{buildHighlightNodes(snippet, spans)}</>
  }
  // If the snippet contains <mark> tags, parse them safely.
  if (snippet.includes('<mark>')) {
    const parsed = parseMarkSpans(snippet)
    // Reconstruct plain text by stripping tags
    const plain = snippet.replace(/<\/?mark>/gi, '')
    return <>{buildHighlightNodes(plain, parsed)}</>
  }
  // Plain snippet — no highlights.
  return <>{snippet}</>
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CommandPalette({ token, entities, canConfigure, onEntity, onRoute, onClose }: {
  token: string
  entities: Entity[]
  canConfigure: boolean
  onEntity: (slug: string) => void
  onRoute: (r: PaletteRoute) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [groups, setGroups] = useState<SearchGroup[]>([])
  const [facets, setFacets] = useState<SearchFacets | null>(null)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [facetEntity, setFacetEntity] = useState<string>('')
  const [facetStatus, setFacetStatus] = useState<string>('')

  // E27 sub-features (each degrades to null = unavailable, [] = no data)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [savedSearches, setSavedSearches] = useState<SavedSearch[] | null>(undefined as unknown as null)
  const [recentSearches, setRecentSearches] = useState<RecentSearch[] | null>(undefined as unknown as null)
  const [savedAvailable, setSavedAvailable] = useState(true)
  const [recentAvailable, setRecentAvailable] = useState(true)
  const [suggestAvailable, setSuggestAvailable] = useState(true)

  // Save search UI
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveNameDraft, setSaveNameDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const listRef = useRef<HTMLDivElement>(null)
  const saveInputRef = useRef<HTMLInputElement>(null)

  // Load saved + recent on mount
  useEffect(() => {
    getSavedSearches(token).then((r) => {
      if (r === null) { setSavedAvailable(false); setSavedSearches([]) }
      else setSavedSearches(r)
    }).catch(() => setSavedSearches([]))

    getRecentSearches(token).then((r) => {
      if (r === null) { setRecentAvailable(false); setRecentSearches([]) }
      else setRecentSearches(r)
    }).catch(() => setRecentSearches([]))
  }, [token])

  // Debounced search + suggest
  useEffect(() => {
    const needle = q.trim()
    if (!needle) {
      setGroups([])
      setFacets(null)
      setSuggestions([])
      setLoading(false)
      return
    }
    setLoading(true)
    const id = setTimeout(async () => {
      try {
        const [searchResult] = await Promise.all([
          crossSearch(token, needle, facetEntity || undefined, facetStatus || undefined),
        ])
        setGroups(searchResult.groups)
        setFacets(searchResult.facets)
      } catch {
        setGroups([])
        setFacets(null)
      } finally {
        setLoading(false)
      }

      // Suggest (separate, best-effort)
      if (suggestAvailable) {
        searchSuggest(token, needle).then((s) => {
          if (s === null) setSuggestAvailable(false)
          else setSuggestions(s)
        }).catch(() => setSuggestions([]))
      }
    }, 200)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, token, facetEntity, facetStatus])

  // Nav items (filtered by q)
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
    return sel.map((b, i) => ({
      id: `nav-${i}`,
      group: t('search.goTo', 'Go to'),
      label: b.label,
      run: () => { b.run(); onClose() },
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, entities, canConfigure])

  // Search result items (filtered by active facets)
  const resultItems: Item[] = useMemo(() => {
    const out: Item[] = []
    for (const g of groups) {
      for (const m of g.matches) {
        out.push({
          id: `${g.entity_key}-${m.id}`,
          group: g.label_plural,
          label: m.label,
          sub: m.snippet,
          run: () => { onEntity(g.route_slug); onClose() },
        })
      }
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

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.run() }
  }

  // Run a saved or recent search query
  function runQuery(query: string) { setQ(query); setFacetEntity(''); setFacetStatus('') }

  // Save the current search
  async function handleSave() {
    const name = saveNameDraft.trim() || q.trim()
    if (!name) return
    setSaving(true)
    setSaveMsg('')
    try {
      const result = await saveSearch(token, name, q.trim())
      if (result === null) { setSaveMsg(t('search.unavailable', 'Search not available')); return }
      setSaveMsg(t('search.saved', 'Search saved'))
      // Refresh saved list
      getSavedSearches(token).then((r) => { if (r !== null) setSavedSearches(r) }).catch(() => {})
      setTimeout(() => { setShowSaveModal(false); setSaveMsg(''); setSaveNameDraft('') }, 900)
    } catch {
      setSaveMsg(t('search.saveError', 'Could not save search'))
    } finally {
      setSaving(false)
    }
  }

  // Build the rendered group layout with a single running keyboard index
  let running = -1
  const rendered: { group: string; items: { item: Item; index: number; hit?: { snippet: string; spans?: HighlightSpan[] } }[] }[] = []
  for (let gi = 0; gi < items.length; gi++) {
    const it = items[gi]
    let g = rendered.find((x) => x.group === it.group)
    if (!g) { g = { group: it.group, items: [] }; rendered.push(g) }
    running++
    // find the matching hit for highlight data
    let hit: { snippet: string; spans?: HighlightSpan[] } | undefined
    outer: for (const grp of groups) {
      for (const m of grp.matches) {
        if (`${grp.entity_key}-${m.id}` === it.id) {
          hit = { snippet: m.snippet, spans: m.highlight_spans }
          break outer
        }
      }
    }
    g.items.push({ item: it, index: running, hit })
  }

  // Compute facet options from results
  const entityFacets = facets?.entity ?? []
  const statusFacets = facets?.status ?? []
  const showFacets = (entityFacets.length > 0 || statusFacets.length > 0) && q.trim()

  // Pinned = saved with pinned:true
  const pinned = (savedSearches ?? []).filter((s) => s.pinned)
  const nonPinned = (savedSearches ?? []).filter((s) => !s.pinned)

  return (
    <Overlay onClose={onClose} className="cmdk" role="dialog">
      {/* Search input row */}
      <div className="cmdk-search">
        <SearchIcon className="cmdk-icon" size={18} />
        <input
          className="cmdk-input"
          autoFocus
          aria-label={t('search.placeholder', 'Search records or jump to a view')}
          placeholder={t('search.placeholder', 'Search records, or jump to…')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        {q && (
          <button
            className="cmdk-clear iconbtn"
            aria-label={t('common.close', 'Clear')}
            onClick={() => { setQ(''); setFacetEntity(''); setFacetStatus('') }}
          >
            <CloseIcon size={14} />
          </button>
        )}
        <kbd className="search-kbd">Esc</kbd>
      </div>

      {/* Suggestions strip (E27) — only when typing and results available */}
      {suggestAvailable && suggestions.length > 0 && q.trim() && (
        <div className="cmdk-suggest" role="listbox" aria-label={t('search.suggestions', 'Suggestions')}>
          {suggestions.slice(0, 6).map((s) => (
            <button
              key={s}
              className="cmdk-suggest-item"
              role="option"
              aria-selected={false}
              onClick={() => setQ(s)}
            >
              <SearchIcon size={12} />
              <span>{s}</span>
            </button>
          ))}
        </div>
      )}

      {/* Facet panel (A27) — only when there are results with facets */}
      {showFacets && (
        <div className="cmdk-facets" role="group" aria-label={t('search.facets', 'Filters')}>
          {entityFacets.length > 0 && (
            <div className="cmdk-facet-group">
              <span className="cmdk-facet-label">{t('search.facetEntity', 'Type')}</span>
              <button
                className={'cmdk-facet-chip' + (!facetEntity ? ' on' : '')}
                onClick={() => setFacetEntity('')}
              >
                {t('search.allTypes', 'All')}
              </button>
              {entityFacets.map((f) => (
                <button
                  key={f.key}
                  className={'cmdk-facet-chip' + (facetEntity === f.key ? ' on' : '')}
                  onClick={() => setFacetEntity(facetEntity === f.key ? '' : f.key)}
                  title={`${f.label}: ${f.count}`}
                >
                  {f.label}
                  <span className="cmdk-facet-count">{f.count}</span>
                </button>
              ))}
            </div>
          )}
          {statusFacets.length > 0 && (
            <div className="cmdk-facet-group">
              <span className="cmdk-facet-label">{t('search.facetStatus', 'Status')}</span>
              <button
                className={'cmdk-facet-chip' + (!facetStatus ? ' on' : '')}
                onClick={() => setFacetStatus('')}
              >
                {t('search.allStatuses', 'All')}
              </button>
              {statusFacets.map((f) => (
                <button
                  key={f.key}
                  className={'cmdk-facet-chip' + (facetStatus === f.key ? ' on' : '')}
                  onClick={() => setFacetStatus(facetStatus === f.key ? '' : f.key)}
                  title={`${f.label}: ${f.count}`}
                >
                  {f.label}
                  <span className="cmdk-facet-count">{f.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results list */}
      <div className="cmdk-list" ref={listRef}>
        {loading && <p className="muted cmdk-empty">{t('search.searching', 'Searching…')}</p>}
        {!loading && items.length === 0 && !q.trim() && (
          <>
            {/* Pinned searches (E27) */}
            {savedAvailable && pinned.length > 0 && (
              <div className="cmdk-group">
                <div className="cmdk-group-label">
                  <PinIcon size={11} />
                  {t('search.pinnedSearches', 'Pinned')}
                </div>
                {pinned.map((s) => (
                  <button
                    key={s.id}
                    className="cmdk-item"
                    onClick={() => runQuery(s.query)}
                    aria-label={s.name}
                  >
                    <span className="cmdk-item-label">{s.name}</span>
                    <span className="cmdk-item-sub">{s.query}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Saved searches (E27) */}
            {savedAvailable && nonPinned.length > 0 && (
              <div className="cmdk-group">
                <div className="cmdk-group-label">
                  <BookmarkIcon size={11} />
                  {t('search.savedSearches', 'Saved searches')}
                </div>
                {nonPinned.map((s) => (
                  <button
                    key={s.id}
                    className="cmdk-item"
                    onClick={() => runQuery(s.query)}
                    aria-label={s.name}
                  >
                    <span className="cmdk-item-label">{s.name}</span>
                    <span className="cmdk-item-sub">{s.query}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Recent searches (E27) */}
            {recentAvailable && recentSearches && recentSearches.length > 0 && (
              <div className="cmdk-group">
                <div className="cmdk-group-label">
                  <ClockIcon size={11} />
                  {t('search.recentSearches', 'Recent searches')}
                </div>
                {recentSearches.slice(0, 8).map((r, i) => (
                  <button
                    key={r.id ?? i}
                    className="cmdk-item"
                    onClick={() => runQuery(r.query)}
                    aria-label={r.query}
                  >
                    <span className="cmdk-item-label">{r.query}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Empty idle prompt */}
            {(!savedAvailable || (pinned.length === 0 && nonPinned.length === 0)) &&
             (!recentAvailable || !recentSearches || recentSearches.length === 0) && (
              <p className="muted cmdk-empty">{t('search.typeToSearch', 'Type to search records, or jump to a view.')}</p>
            )}
          </>
        )}

        {!loading && items.length === 0 && q.trim() && (
          <p className="muted cmdk-empty">{t('search.noMatches', 'No matches.')}</p>
        )}

        {rendered.map((g) => (
          <div key={g.group} className="cmdk-group">
            <div className="cmdk-group-label">{g.group}</div>
            {g.items.map(({ item, index, hit }) => (
              <button
                key={item.id}
                data-idx={index}
                className={'cmdk-item' + (index === active ? ' on' : '')}
                onClick={item.run}
                onMouseEnter={() => setActive(index)}
              >
                <span className="cmdk-item-label">{item.label}</span>
                {hit && hit.snippet && (
                  <span className="cmdk-item-sub">
                    <SnippetText snippet={hit.snippet} spans={hit.spans} />
                  </span>
                )}
                {!hit && item.sub && (
                  <span className="cmdk-item-sub">{item.sub}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Footer: "Save this search" action — only when there's a non-empty query */}
      {savedAvailable && q.trim() && !showSaveModal && (
        <div className="cmdk-footer">
          <button className="cmdk-save-btn" onClick={() => { setSaveNameDraft(q.trim()); setShowSaveModal(true) }}>
            <BookmarkIcon size={13} />
            {t('search.saveSearch', 'Save this search')}
          </button>
        </div>
      )}

      {/* Save search inline form */}
      {showSaveModal && (
        <div className="cmdk-footer cmdk-save-form" role="form" aria-label={t('search.saveSearch', 'Save this search')}>
          <BookmarkIcon size={13} />
          <input
            ref={saveInputRef}
            className="cmdk-save-input inp inp-sm"
            value={saveNameDraft}
            onChange={(e) => setSaveNameDraft(e.target.value)}
            placeholder={t('search.saveSearch', 'Name this search')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void handleSave() }
              if (e.key === 'Escape') { e.stopPropagation(); setShowSaveModal(false) }
            }}
            autoFocus
            aria-label={t('search.saveSearch', 'Search name')}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowSaveModal(false)}
          >
            {t('common.cancel', 'Cancel')}
          </button>
          {saveMsg && <span className="cmdk-save-msg">{saveMsg}</span>}
        </div>
      )}
    </Overlay>
  )
}
