import React from 'react'
import type { LucideIcon } from 'lucide-react'

// T-P2-10 — `tertiary` is the standards' third-tier action (after primary/
// secondary): subdued text-button styling for low-emphasis actions like
// "Clear", "Skip", "Cancel" rendered inline next to a primary. Visually less
// loud than ghost (no hover lift); semantically the inverse of `danger`.
type Variant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger' | 'link' | 'gold'
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

export function Button({ variant = 'primary', size = 'md', leftIcon: LeftIcon, rightIcon: RightIcon, loading, disabled, children, onClick, type = 'button', className = '' }: ButtonProps) {
  const isDisabled = disabled || loading
  const iconSize = size === 'sm' ? 10 : 12

  const cls = [
    'btn',
    `btn-${variant}`,
    size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      className={cls}
    >
      {loading ? <Spinner /> : LeftIcon ? <LeftIcon size={iconSize} /> : null}
      {children}
      {RightIcon && !loading ? <RightIcon size={iconSize} /> : null}
    </button>
  )
}
