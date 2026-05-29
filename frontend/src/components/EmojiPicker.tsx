import { useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { EMOJI_PACK, parseEmoji } from '../lib/emoji-pack'
import { SearchIcon, CloseIcon } from './icons'

const PICKER_W = 320
const PICKER_H = 340

// EmojiPicker — category-tabbed + name-searchable grid sourced from emoji-pack.ts. Clicking a cell
// calls onPick(char) (kept open so several can be added). This is the ONE place emoji appear, as
// user-authored content; the picker's own chrome (search, tabs, close) stays SVG/text per BRAND §4.
// Portals to <body> and positions off the trigger so it's never clipped by a scroll/overflow parent.
export default function EmojiPicker({ anchor, onPick, onClose }: {
  anchor: HTMLElement | null
  onPick: (char: string) => void
  onClose: () => void
}) {
  const [cat, setCat] = useState(0)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const needle = q.trim().toLowerCase()

  useLayoutEffect(() => {
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PICKER_W - 8))
    let top = r.top - PICKER_H - 8                       // prefer opening above the trigger
    if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - PICKER_H - 8)
    setPos({ left, top })
  }, [anchor])

  const results = useMemo(() => {
    if (!needle) return null
    const out: { char: string; name: string }[] = []
    for (const c of EMOJI_PACK) for (const e of c.items) {
      const p = parseEmoji(e)
      if (p.name.includes(needle)) out.push(p)
    }
    return out
  }, [needle])

  const shortName = (n: string) => n.split(' & ')[0].split(' ')[0]

  return createPortal(
    <>
      <div className="emoji-backdrop" onClick={onClose} />
      <div className="emoji-pop" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label="Emoji picker">
        <div className="emoji-search">
          <div className="search search-sm">
            <SearchIcon className="search-icon" size={14} />
            <input className="search-input" placeholder="Search emoji…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            {q && <button className="search-clear" aria-label="Clear search" onClick={() => setQ('')}><CloseIcon size={12} /></button>}
          </div>
        </div>

        {!needle && (
          <div className="emoji-tabs">
            {EMOJI_PACK.map((c, i) => (
              <button key={c.name} className={'emoji-tab' + (i === cat ? ' on' : '')} title={c.name} onClick={() => setCat(i)}>
                {shortName(c.name)}
              </button>
            ))}
          </div>
        )}

        <div className="emoji-grid">
          {needle
            ? (results!.length === 0
                ? <p className="emoji-empty muted">No emoji match “{q}”.</p>
                : results!.map((p, i) => (
                    <button key={i} className="emoji-cell" title={p.name} onClick={() => onPick(p.char)}>{p.char}</button>
                  )))
            : EMOJI_PACK[cat].items.map((e, i) => {
                const p = parseEmoji(e)
                return <button key={i} className="emoji-cell" title={p.name} onClick={() => onPick(p.char)}>{p.char}</button>
              })}
        </div>
      </div>
    </>,
    document.body,
  )
}
