import { Input } from './Input'

// SearchBox — the presentational search field primitive. It is JUST the input
// (glass surface + search glyph + Enter submit). The scoped, cross-entity search
// BEHAVIOUR (scope chips, match-reason, /search wiring) lands in Phase 5; this
// primitive is what that behaviour will mount into.

interface SearchBoxProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Fired on Enter. Presentational hook only — Phase 5 wires the real search. */
  onSubmit?: (value: string) => void
  autoFocus?: boolean
  className?: string
  'aria-label'?: string
}

export function SearchBox({
  value,
  onChange,
  placeholder = 'Search…',
  onSubmit,
  autoFocus,
  className,
  'aria-label': ariaLabel,
}: SearchBoxProps) {
  return (
    <Input
      type="search"
      variant="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit?.(value)
      }}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={['gx-searchbox', className].filter(Boolean).join(' ')}
      aria-label={ariaLabel ?? placeholder}
    />
  )
}
