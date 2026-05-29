type Variant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
type Size = 'sm' | 'md'

interface StatusPillProps { variant: Variant; label?: string; size?: Size }

const variantMap: Record<Variant, { bg: string; fg: string; label: string }> = {
  active:   { bg: 'var(--success-soft)', fg: 'var(--success)', label: 'Active' },
  degraded: { bg: 'var(--warning-soft)', fg: 'var(--warning)', label: 'Degraded' },
  critical: { bg: 'var(--danger-soft)',  fg: 'var(--danger)',  label: 'Critical' },
  neutral:  { bg: 'var(--surface-2)',    fg: 'var(--text-2)',  label: 'Neutral' },
  info:     { bg: 'var(--primary-soft)', fg: 'var(--primary)', label: 'Info' },
}

export function StatusPill({ variant, label, size = 'md' }: StatusPillProps) {
  const v = variantMap[variant]
  const px = size === 'sm' ? 'var(--gx-space-2)' : 'var(--gx-space-3)'
  const py = 'var(--gx-space-1)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-2)',
      paddingLeft: px, paddingRight: px, paddingTop: py, paddingBottom: py,
      fontSize: 'var(--gx-text-9)', fontFamily: 'var(--font-mono, ui-monospace)',
      fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--gx-tracking-wider)',
      borderRadius: 'var(--gx-radius-sm)',
      backgroundColor: v.bg, color: v.fg,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: v.fg, flexShrink: 0 }} />
      {label ?? v.label}
    </span>
  )
}
