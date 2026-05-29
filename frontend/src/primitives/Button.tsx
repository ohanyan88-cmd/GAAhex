import React from 'react'
import type { LucideIcon } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps {
  variant?: Variant
  size?: Size
  leftIcon?: LucideIcon
  rightIcon?: LucideIcon
  loading?: boolean
  disabled?: boolean
  children: React.ReactNode
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  type?: 'button' | 'submit' | 'reset'
  className?: string
}

function Spinner() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden className="animate-spin" style={{ flexShrink: 0 }}>
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5"/>
      <path d="M10.5 6a4.5 4.5 0 0 0-4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

const variantStyles: Record<Variant, React.CSSProperties> = {
  primary:   { backgroundColor: 'var(--primary)',   color: '#fff', border: 'none' },
  secondary: { backgroundColor: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)' },
  ghost:     { backgroundColor: 'transparent',      color: 'var(--text-2)', border: 'none' },
  danger:    { backgroundColor: 'var(--danger)',     color: '#fff', border: 'none' },
  link:      { backgroundColor: 'transparent',      color: 'var(--primary)', border: 'none', padding: 0 },
}

const sizeStyles: Record<Size, React.CSSProperties> = {
  sm: { height: 'var(--gx-btn-height-sm)', paddingLeft: 'var(--gx-btn-px-sm)', paddingRight: 'var(--gx-btn-px-sm)', fontSize: 'var(--gx-text-10)', fontFamily: 'var(--font-mono, ui-monospace)' },
  md: { height: 'var(--gx-btn-height-md)', paddingLeft: 'var(--gx-btn-px-md)', paddingRight: 'var(--gx-btn-px-md)', fontSize: 'var(--gx-text-11)' },
  lg: { height: 'var(--gx-btn-height-lg)', paddingLeft: 'var(--gx-btn-px-lg)', paddingRight: 'var(--gx-btn-px-lg)', fontSize: 'var(--gx-text-12)' },
}

export function Button({ variant = 'primary', size = 'md', leftIcon: LeftIcon, rightIcon: RightIcon, loading, disabled, children, onClick, type = 'button', className = '' }: ButtonProps) {
  const isDisabled = disabled || loading
  const iconSize = size === 'sm' ? 10 : 12

  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      style={{
        ...variantStyles[variant],
        ...sizeStyles[size],
        borderRadius: 'var(--gx-radius-lg)',
        display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-2)',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.5 : 1,
        transition: `background var(--gx-duration-fast), opacity var(--gx-duration-fast)`,
        fontWeight: 500, userSelect: 'none', whiteSpace: 'nowrap',
        textDecoration: 'none', outline: 'none',
      }}
      onFocus={e => { e.currentTarget.style.boxShadow = 'var(--gx-shadow-focus)' }}
      onBlur={e => { e.currentTarget.style.boxShadow = 'none' }}
      className={className}
    >
      {loading ? <Spinner /> : LeftIcon ? <LeftIcon size={iconSize} /> : null}
      {children}
      {RightIcon && !loading ? <RightIcon size={iconSize} /> : null}
    </button>
  )
}
