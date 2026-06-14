import type { ReactNode } from 'react'

// DefinitionList — the element for "a few key-value pairs" (standard §5: a definition
// list, NOT a table and NOT a stack of cards). Semantic <dl>/<dt>/<dd> for a11y.

export interface DefinitionItem {
  label: ReactNode
  value: ReactNode
}

interface DefinitionListProps {
  items: DefinitionItem[]
  /** Column count on wide screens; collapses to 1 on mobile. */
  columns?: 1 | 2 | 3
}

export function DefinitionList({ items, columns = 2 }: DefinitionListProps) {
  return (
    <dl className="gx-dl" data-cols={columns}>
      {items.map((it, i) => (
        <div className="gx-dl-item" key={i}>
          <dt className="gx-dl-k">{it.label}</dt>
          <dd className="gx-dl-v">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}
