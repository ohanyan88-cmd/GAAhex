import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { ChevronDownIcon, CheckIcon, CloseIcon, SearchIcon } from './icons'

const SEARCH_THRESHOLD = 8   // show the in-popover search once options get long

function useFiltered(options: string[], q: string) {
  return useMemo(() => {
    const n = q.trim().toLowerCase()
    return n ? options.filter((o) => o.toLowerCase().includes(n)) : options
  }, [options, q])
}

// The dropdown popup is positioned `fixed` (anchored to the control's rect) so it escapes
// any scrolling/overflow ancestor — e.g. a modal body — instead of being clipped by it.
function anchorRect(el: HTMLElement | null): CSSProperties | undefined {
  if (!el) return undefined
  const r = el.getBoundingClientRect()
  return { position: 'fixed', top: r.bottom + 4, left: r.left, width: r.width }
}

// Single Select — a themed dropdown (styled with the .inp look) replacing the bare <select>.
export function Select({ value, options, onChange, placeholder = 'Select…', allowCustom = false }: {
  value: string
  options: string[]
  onChange: (v: string) => void
  placeholder?: string
  /** Let the user keep a typed value that isn't in the list (free-text fallback). */
  allowCustom?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<CSSProperties | undefined>(undefined)
  const ctrlRef = useRef<HTMLDivElement>(null)
  const searchable = options.length > SEARCH_THRESHOLD || allowCustom
  const filtered = useFiltered(options, q)
  const qx = q.trim()
  const showCustom = allowCustom && qx.length > 0 && !options.some((o) => o.toLowerCase() === qx.toLowerCase())

  // Open on the NEXT tick so the triggering click fully settles before the popup (and its
  // option buttons) mount — otherwise the same click can land on a freshly-rendered option.
  function toggle() {
    if (open) { close(); return }
    setPos(anchorRect(ctrlRef.current))
    setTimeout(() => setOpen(true), 0)
  }
  function close() { setOpen(false); setQ('') }
  function pick(o: string) { onChange(o); close() }

  return (
    <div className="sel">
      <div
        ref={ctrlRef}
        className="inp inp-md sel-control"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
      >
        <span className={value ? '' : 'sel-ph'}>{value || placeholder}</span>
        <ChevronDownIcon size={15} className="sel-caret" />
      </div>
      {open && (
        <>
          <button type="button" className="sel-backdrop" aria-label="Close" onClick={close} />
          <div className="sel-pop" style={pos}>
            {searchable && (
              <div className="sel-search">
                <div className="search search-sm">
                  <SearchIcon className="search-icon" size={14} />
                  <input className="search-input" autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
              </div>
            )}
            <div className="sel-list">
              {value && <button type="button" className="sel-opt" onClick={() => pick('')}><span className="muted">Clear</span></button>}
              {filtered.map((o) => (
                <button key={o} type="button" className={'sel-opt' + (o === value ? ' on' : '')} onClick={() => pick(o)}>
                  <span>{o}</span>{o === value && <CheckIcon size={14} />}
                </button>
              ))}
              {showCustom && (
                <button type="button" className="sel-opt" onClick={() => pick(qx)}>
                  <span className="muted">Use “{qx}”</span>
                </button>
              )}
              {filtered.length === 0 && !showCustom && <p className="sel-empty muted">No match.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// MultiSelect — chips + a checkbox dropdown; value is a string[]. Searchable when long.
export function MultiSelect({ value, options, onChange, placeholder = 'Select…' }: {
  value: any
  options: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const arr: string[] = Array.isArray(value) ? value : (value ? [value] : [])
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<CSSProperties | undefined>(undefined)
  const ctrlRef = useRef<HTMLDivElement>(null)
  const searchable = options.length > SEARCH_THRESHOLD
  const filtered = useFiltered(options, q)

  // Defer open to the next tick — see Select above (keeps the opening click off the options).
  function openToggle() {
    if (open) { setOpen(false); setQ(''); return }
    setPos(anchorRect(ctrlRef.current))
    setTimeout(() => setOpen(true), 0)
  }
  function toggle(o: string) { onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]) }
  function remove(o: string) { onChange(arr.filter((x) => x !== o)) }

  return (
    <div className="sel">
      <div
        ref={ctrlRef}
        className="inp inp-md sel-control sel-multi"
        role="button"
        tabIndex={0}
        onClick={openToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openToggle() } }}
      >
        {arr.length === 0
          ? <span className="sel-ph">{placeholder}</span>
          : (
            <span className="ms-chips">
              {arr.map((o) => (
                <span key={o} className="ms-chip">
                  {o}
                  <span className="ms-x" role="button" aria-label={`Remove ${o}`} onClick={(e) => { e.stopPropagation(); remove(o) }}>
                    <CloseIcon size={10} />
                  </span>
                </span>
              ))}
            </span>
          )}
        <ChevronDownIcon size={15} className="sel-caret" />
      </div>
      {open && (
        <>
          <button type="button" className="sel-backdrop" aria-label="Close" onClick={() => { setOpen(false); setQ('') }} />
          <div className="sel-pop" style={pos}>
            {searchable && (
              <div className="sel-search">
                <div className="search search-sm">
                  <SearchIcon className="search-icon" size={14} />
                  <input className="search-input" autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
              </div>
            )}
            <div className="sel-list">
              {filtered.map((o) => {
                const on = arr.includes(o)
                return (
                  <button key={o} type="button" className={'sel-opt' + (on ? ' on' : '')} onClick={() => toggle(o)}>
                    <span className={'ms-check' + (on ? ' on' : '')}>{on && <CheckIcon size={12} />}</span>
                    <span>{o}</span>
                  </button>
                )
              })}
              {filtered.length === 0 && <p className="sel-empty muted">No match.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
