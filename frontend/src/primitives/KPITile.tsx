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

export function KPITile({ label, value, unit, delta, deltaPositive, icon: Icon, accessory, size = 'md', loading, error }: KPITileProps) {
  const tileCls = ['kpi-tile', error ? 'error' : ''].filter(Boolean).join(' ')
  const valueCls = ['kpi-tile-value', size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : ''].filter(Boolean).join(' ')
  return (
    <div className={tileCls}>
      <div className="kpi-tile-label">
        <Icon size={11} />
        <span>{label}</span>
      </div>
      {loading ? (
        <>
          <div className="kpi-tile-skeleton" style={{ height: 28, width: '60%' }} />
          <div className="kpi-tile-skeleton" style={{ height: 12, width: '35%' }} />
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className={valueCls}>{value}</span>
            {unit && <span className="kpi-tile-label" style={{ letterSpacing: 0, textTransform: 'none' }}>{unit}</span>}
          </div>
          <div className="kpi-tile-foot">
            {delta && (
              <div className={['kpi-tile-delta', deltaPositive ? 'up' : 'down'].join(' ')}>
                {deltaPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                <span>{delta}</span>
                <span style={{ color: 'var(--gx-text-3)' }}>vs 7d</span>
              </div>
            )}
            {accessory}
          </div>
        </>
      )}
    </div>
  )
}
