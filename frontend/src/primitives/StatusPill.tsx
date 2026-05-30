type Variant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
type Size = 'sm' | 'md'

interface StatusPillProps { variant: Variant; label?: string; size?: Size }

const variantMap: Record<Variant, { kit: string; label: string }> = {
  active:   { kit: 'pill-success', label: 'Active' },
  degraded: { kit: 'pill-warning', label: 'Degraded' },
  critical: { kit: 'pill-danger',  label: 'Critical' },
  neutral:  { kit: 'pill-neutral', label: 'Neutral' },
  info:     { kit: 'pill-info',    label: 'Info' },
}

export function StatusPill({ variant, label, size = 'md' }: StatusPillProps) {
  const v = variantMap[variant]
  const cls = ['pill', v.kit, size === 'sm' ? 'pill-sm' : ''].filter(Boolean).join(' ')
  return (
    <span className={cls}>
      <span className="d" style={{ background: 'currentColor' }} />
      {label ?? v.label}
    </span>
  )
}
