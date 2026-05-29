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
  const py = density === 'sm' ? 'var(--gx-space-2)' : 'var(--gx-space-3)'
  return (
    <tr
      onClick={onClick}
      style={{
        backgroundColor: selected ? 'var(--primary-soft)' : 'transparent',
        borderBottom: '1px solid var(--border)',
        cursor: onClick ? 'pointer' : 'default',
        transition: `background var(--gx-duration-fast)`,
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--surface-2)' }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
    >
      {onSelectToggle && (
        <td style={{ padding: `${py} var(--gx-space-4)`, width: 20 }}>
          <div
            onClick={e => { e.stopPropagation(); onSelectToggle() }}
            style={{
              width: 12, height: 12, borderRadius: 'var(--gx-radius-sm)', cursor: 'pointer',
              border: `1px solid ${selected ? 'var(--primary)' : 'var(--border-strong, var(--border))'}`,
              backgroundColor: selected ? 'var(--primary)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
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
