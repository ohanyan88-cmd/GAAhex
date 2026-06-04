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
  // T-P3-8 — standard HTML input passthrough props. Needed so raw inline-
  // class input call sites with onKeyDown/onBlur/onFocus/style/etc can
  // migrate to <Input> without losing behavior.
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void
  name?: string
  autoFocus?: boolean
  autoComplete?: string
  required?: boolean
  style?: React.CSSProperties
  'aria-label'?: string
}

export function Input({
  type = 'text',
  size = 'md',
  variant = 'default',
  value,
  onChange,
  placeholder,
  disabled,
  error,
  readOnly,
  leftIcon,
  rightIcon,
  id,
  className = '',
  onKeyDown,
  onFocus,
  onBlur,
  name,
  autoFocus,
  autoComplete,
  required,
  style,
  'aria-label': ariaLabel,
}: InputProps) {
  const [showPwd, setShowPwd] = useState(false)
  const isPassword = type === 'password'
  const actualType = isPassword ? (showPwd ? 'text' : 'password') : type
  const isMono = type === 'password' || type === 'number' || variant === 'numeric' || variant === 'search'
  const hasLeft = variant === 'search' || !!leftIcon
  const hasRight = isPassword || !!rightIcon

  const cls = [
    'inp',
    size === 'sm' ? 'inp-sm' : size === 'lg' ? 'inp-lg' : '',
    error ? 'inp-error' : '',
    isMono ? 'mono' : '',
    variant === 'numeric' ? 'tnum' : '',
  ].filter(Boolean).join(' ')

  // Conditional padding to make room for left/right icon slots — structural,
  // not stylistic, so we keep it as inline style rather than helper classes.
  const padStyle: React.CSSProperties = {
    ...(hasLeft ? { paddingLeft: 30 } : null),
    ...(hasRight ? { paddingRight: 30 } : null),
    ...(variant === 'numeric' ? { textAlign: 'right' as const } : null),
    ...(disabled || readOnly ? { opacity: 0.5, cursor: disabled ? 'not-allowed' : 'text' } : null),
    ...(type === 'number' ? { appearance: 'textfield' as const } : null),
  }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', ...style }} className={className}>
      {hasLeft && (
        <span style={{ position: 'absolute', left: 11, display: 'flex', alignItems: 'center', color: 'var(--gx-text-3)', pointerEvents: 'none' }}>
          {leftIcon ?? <Search size={12} />}
        </span>
      )}
      <input
        id={id}
        type={actualType}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        name={name}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        required={required}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        className={cls}
        style={padStyle}
      />
      {isPassword && (
        <button type="button" onClick={() => setShowPwd(v => !v)} style={{ position: 'absolute', right: 11, display: 'flex', alignItems: 'center', color: 'var(--gx-text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {showPwd ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      )}
      {!isPassword && rightIcon && (
        <span style={{ position: 'absolute', right: 11, display: 'flex', alignItems: 'center', color: 'var(--gx-text-3)', pointerEvents: 'none' }}>{rightIcon}</span>
      )}
    </div>
  )
}
