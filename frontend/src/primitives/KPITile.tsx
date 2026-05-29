import React from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'

type Size = 'sm' | 'md' | 'lg'

interface KPITileProps {
  label: string
  value: string | number
  unit?: string
  delta?: string
  deltaPositive?: boolean
  icon: LucideIcon
  accessory?: React.ReactNode
  size?: Size
  loading?: boolean
  error?: string
}

const valueFontSize: Record<Size, string> = {
  sm: 'var(--gx-text-18)',
  md: 'var(--gx-text-22)',
  lg: 'var(--gx-text-28)',
}

export function KPITile({ label, value, unit, delta, deltaPositive, icon: Icon, accessory, size = 'md', loading, error }: KPITileProps) {
  return (
    <div style={{
      backgroundColor: 'var(--surface)', border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
      borderRadius: 'var(--gx-radius-lg)', padding: 'var(--gx-space-6)',
      display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-2)' }}>
          <Icon size={11} style={{ color: 'var(--text-2)' }} />
          <span style={{ fontSize: 'var(--gx-text-9)', fontFamily: 'var(--font-mono, ui-monospace)', textTransform: 'uppercase', letterSpacing: 'var(--gx-tracking-wider)', color: 'var(--text-2)' }}>{label}</span>
        </div>
      </div>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)' }}>
          <div style={{ height: 'var(--gx-space-7)', width: '60%', borderRadius: 'var(--gx-radius-md)', backgroundColor: 'var(--surface-2)', animation: 'pulse 1.5s ease-in-out infinite' }} />
          <div style={{ height: 'var(--gx-space-4)', width: '35%', borderRadius: 'var(--gx-radius-md)', backgroundColor: 'var(--surface-2)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--gx-space-2)' }}>
            <span style={{ fontSize: valueFontSize[size], fontFamily: 'var(--font-mono, ui-monospace)', fontWeight: 600, lineHeight: 1, color: error ? 'var(--danger)' : 'var(--text)' }}>{value}</span>
            {unit && <span style={{ fontSize: 'var(--gx-text-10)', fontFamily: 'var(--font-mono, ui-monospace)', color: 'var(--text-2)' }}>{unit}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
            {delta && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-1)', fontSize: 'var(--gx-text-10)', fontFamily: 'var(--font-mono, ui-monospace)' }}>
                {deltaPositive
                  ? <ArrowUpRight size={10} style={{ color: 'var(--success)' }} />
                  : <ArrowDownRight size={10} style={{ color: 'var(--danger)' }} />}
                <span style={{ color: deltaPositive ? 'var(--success)' : 'var(--danger)' }}>{delta}</span>
                <span style={{ color: 'var(--text-3)' }}>vs 7d</span>
              </div>
            )}
            {accessory}
          </div>
        </>
      )}
    </div>
  )
}
