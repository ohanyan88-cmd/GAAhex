import React from 'react'

type Density = 'sm' | 'md'

interface DataTableRowProps {
  selected?: boolean
  onSelectToggle?: () => void
  onClick?: () => void
  density?: Density
  children: React.ReactNode
}

export function DataTableRow({ selected, onSelectToggle, onClick, density = 'md', children }: DataTableRowProps) {
  const cls = [
    'dtr',
    selected ? 'dtr-selected' : '',
    density === 'sm' ? 'dtr-sm' : '',
  ].filter(Boolean).join(' ')
  return (
    <tr className={cls} onClick={onClick} style={onClick ? undefined : { cursor: 'default' }}>
      {onSelectToggle && (
        <td className="dtr-check">
          <div
            className={['dtr-check-box', selected ? 'on' : ''].filter(Boolean).join(' ')}
            onClick={e => { e.stopPropagation(); onSelectToggle() }}
          >
            {selected && (
              <svg viewBox="0 0 12 12" width="8" height="8">
                <path d="M2 6 L5 9 L10 3" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
              </svg>
            )}
          </div>
        </td>
      )}
      {children}
    </tr>
  )
}
