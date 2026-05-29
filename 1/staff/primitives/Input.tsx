import React, { useState } from 'react'
import { Search, Eye, EyeOff } from 'lucide-react'

type InputType = 'text' | 'password' | 'number' | 'email' | 'search'
type Size = 'sm' | 'md' | 'lg'
type InputVariant = 'default' | 'search' | 'numeric'

interface InputProps {
  type?: InputType
  size?: Size
  variant?: InputVariant
  value?: string | number
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  disabled?: boolean
  error?: string
  readOnly?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  id?: string
  className?: string
}

const heights: Record<Size, string> = {
  sm: 'var(--gx-input-height-sm)',
  md: 'var(--gx-input-height-md)',
  lg: 'var(--gx-input-height-lg)',
}

export function Input({ type = 'text', size = 'md', variant = 'default', value, onChange, placeholder, disabled, error, readOnly, leftIcon, rightIcon, id, className = '' }: InputProps) {
  const [showPwd, setShowPwd] = useState(false)
  const isPassword = type === 'password'
  const actualType = isPassword ? (showPwd ? 'text' : 'password') : type
  const isMono = type === 'password' || type === 'number' || variant === 'numeric' || variant === 'search'
  const hasLeft = variant === 'search' || !!leftIcon
  const hasRight = isPassword || !!rightIcon

  const baseStyle: React.CSSProperties = {
    width: '100%', height: heights[size],
    paddingLeft: hasLeft ? 'calc(var(--gx-space-8) + var(--gx-space-5))' : 'var(--gx-space-4)',
    paddingRight: hasRight ? 'calc(var(--gx-space-8) + var(--gx-space-5))' : 'var(--gx-space-4)',
    backgroundColor: error ? 'color-mix(in srgb, var(--danger-soft) 30%, var(--surface-2))' : 'var(--surface-2)',
    border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
    borderRadius: 'var(--gx-radius-lg)',
    color: 'var(--text)',
    fontSize: 'var(--gx-text-11)',
    fontFamily: isMono ? 'var(--font-mono, ui-monospace)' : 'inherit',
    textAlign: variant === 'numeric' ? 'right' : 'left',
    outline: 'none',
    opacity: disabled || readOnly ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'text',
    transition: `border-color var(--gx-duration-fast), box-shadow var(--gx-duration-fast)`,
    appearance: type === 'number' ? 'textfield' as const : undefined,
  }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }} className={className}>
      {hasLeft && (
        <span style={{ position: 'absolute', left: 'var(--gx-space-4)', display: 'flex', alignItems: 'center', color: 'var(--text-3)', pointerEvents: 'none' }}>
          {leftIcon ?? <Search size={12} />}
        </span>
      )}
      <input
        id={id}
        type={actualType}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        style={baseStyle}
        onFocus={e => { if (!disabled && !readOnly) { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = 'var(--gx-shadow-focus)' } }}
        onBlur={e => { e.target.style.borderColor = error ? 'var(--danger)' : 'var(--border)'; e.target.style.boxShadow = 'none' }}
      />
      {isPassword && (
        <button type="button" onClick={() => setShowPwd(v => !v)} style={{ position: 'absolute', right: 'var(--gx-space-4)', display: 'flex', alignItems: 'center', color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {showPwd ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      )}
      {!isPassword && rightIcon && (
        <span style={{ position: 'absolute', right: 'var(--gx-space-4)', display: 'flex', alignItems: 'center', color: 'var(--text-3)', pointerEvents: 'none' }}>{rightIcon}</span>
      )}
    </div>
  )
}
