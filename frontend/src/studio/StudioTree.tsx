// Studio left-nav tree — collapsible groups → modules → leaves with search + gold active rail.
//
// Routing: clicks call onPick({group, module?, leaf?}) which the shell turns into setView +
// pushState. "Overview" click clears the route so P3's StudioOverview renders.
//
// Search: when the input has a value we replace the tree with a flat results list (matching kit
// behavior, studio-tree.jsx lines 313-327). Match against leaf + group + module label so typing
// "audit" surfaces "Audit Logs" under Governance, "Rule Audit" under Logic > Rules Engine, etc.
//
// Keyboard: tree-leaf buttons get arrow-key focus traversal — ArrowDown/Up jumps to the next/prev
// rendered leaf button in DOM order. Polish kept simple per the prompt.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, LayoutGrid, Search as SearchIcon, X } from 'lucide-react'
import { STUDIO_TREE, STUDIO_LEAVES, type FlatLeaf } from './tree'
import { iconFor } from './iconMap'

export type StudioPick = { group?: string; module?: string; leaf?: string }

export default function StudioTree({
  activeId,                    // groupId[.moduleId].leafId for highlight, or 'overview'
  initialOpenGroup,            // groupId to auto-open on mount (defaults to active group)
  onPick,
}: {
  activeId: string             // 'overview' or a leaf id (groupId[.moduleId].leafId)
  initialOpenGroup?: string
  onPick: (p: StudioPick) => void
}) {
  // Per-group open/closed state. The active group opens automatically.
  const activeGroupId = activeId === 'overview' ? undefined : activeId.split('.')[0]
  const activeModuleId = activeId === 'overview' ? undefined : activeId.split('.')[1]

  const [openG, setOpenG] = useState<Record<string, boolean>>(() => ({
    [initialOpenGroup ?? activeGroupId ?? 'experience']: true,
  }))
  const [openM, setOpenM] = useState<Record<string, boolean>>(() => ({
    ...(activeGroupId && activeModuleId ? { [`${activeGroupId}.${activeModuleId}`]: true } : {}),
  }))
  const [q, setQ] = useState('')

  // Keep the active group's panel open whenever the active leaf changes externally
  // (e.g. via popstate or an Overview-card click landing on a different group).
  useEffect(() => {
    if (activeGroupId) setOpenG((s) => ({ ...s, [activeGroupId]: true }))
    if (activeGroupId && activeModuleId) {
      setOpenM((s) => ({ ...s, [`${activeGroupId}.${activeModuleId}`]: true }))
    }
  }, [activeGroupId, activeModuleId])

  const hits = useMemo<FlatLeaf[]>(() => {
    if (!q.trim()) return []
    const needle = q.toLowerCase()
    return STUDIO_LEAVES.filter((l) => {
      const hay = `${l.leafLabel} ${l.groupLabel} ${l.moduleLabel ?? ''}`.toLowerCase()
      return hay.includes(needle)
    }).slice(0, 60)
  }, [q])

  // ── arrow-key focus traversal across rendered .tree-leaf buttons ──────────
  const navRef = useRef<HTMLElement | null>(null)
  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const leaves = Array.from(
      (navRef.current?.querySelectorAll('button.tree-leaf') ?? []) as NodeListOf<HTMLButtonElement>,
    )
    if (leaves.length === 0) return
    const i = leaves.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown'
      ? leaves[(i + 1) % leaves.length]
      : leaves[(i - 1 + leaves.length) % leaves.length]
    next?.focus()
    e.preventDefault()
  }

  return (
    <aside className="studio-nav tree" ref={navRef} onKeyDown={onKeyDown}>
      <div className="tree-search">
        <SearchIcon size={13} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search Studio"
          aria-label="Search Studio"
        />
        {q && (
          <button onClick={() => setQ('')} aria-label="Clear search" type="button">
            <X size={12} />
          </button>
        )}
      </div>

      {q.trim() ? (
        <>
          {hits.map((l) => (
            <button
              key={l.id}
              className={'tree-leaf' + (activeId === l.id ? ' on' : '')}
              style={{ paddingLeft: 'var(--gx-space-6)' }}
              onClick={() => onPick({ group: l.groupId, module: l.moduleId, leaf: l.leafId })}
              type="button"
            >
              <span>{l.leafLabel}</span>
              <span className="tree-leaf-ctx">{l.moduleLabel ?? l.groupLabel}</span>
            </button>
          ))}
          {hits.length === 0 && (
            <div className="hint" style={{ padding: '20px 12px', textAlign: 'center' }}>
              No matches.
            </div>
          )}
        </>
      ) : (
        <>
          {/* Pinned Overview row (kit studio-tree.jsx line 331). */}
          <button
            className={'tree-overview' + (activeId === 'overview' ? ' on' : '')}
            onClick={() => onPick({})}
            type="button"
          >
            <LayoutGrid size={14} />
            <span>Overview</span>
          </button>

          {STUDIO_TREE.map((g) => {
            const gOpen = !!openG[g.id]
            const GIcon = iconFor(g.icon)
            return (
              <div key={g.id} className="tree-group">
                <button
                  className={'tree-g' + (gOpen ? ' open' : '')}
                  onClick={() => setOpenG((s) => ({ ...s, [g.id]: !s[g.id] }))}
                  type="button"
                  aria-expanded={gOpen}
                >
                  <GIcon size={15} />
                  <span>{g.label}</span>
                  <ChevronRight size={13} className="chev" />
                </button>

                {gOpen && g.leaves && g.leaves.map((l) => {
                  const id = `${g.id}.${l.id}`
                  return (
                    <button
                      key={id}
                      className={'tree-leaf' + (activeId === id ? ' on' : '')}
                      style={{ paddingLeft: 30 }}
                      onClick={() => onPick({ group: g.id, leaf: l.id })}
                      type="button"
                    >
                      {l.label}
                    </button>
                  )
                })}

                {gOpen && g.modules && g.modules.map((m) => {
                  const mk = `${g.id}.${m.id}`
                  const mOpen = !!openM[mk]
                  const MIcon = iconFor(m.icon)
                  return (
                    <div key={mk}>
                      <button
                        className={'tree-m' + (mOpen ? ' open' : '')}
                        onClick={() => setOpenM((s) => ({ ...s, [mk]: !s[mk] }))}
                        type="button"
                        aria-expanded={mOpen}
                      >
                        <MIcon size={13} />
                        <span>{m.label}</span>
                        <ChevronRight size={12} className="chev" />
                      </button>
                      {mOpen && m.leaves.map((l) => {
                        const id = `${g.id}.${m.id}.${l.id}`
                        return (
                          <button
                            key={id}
                            className={'tree-leaf' + (activeId === id ? ' on' : '')}
                            style={{ paddingLeft: 42 }}
                            onClick={() => onPick({ group: g.id, module: m.id, leaf: l.id })}
                            type="button"
                          >
                            {l.label}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </>
      )}
    </aside>
  )
}
