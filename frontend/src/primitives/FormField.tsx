import React from 'react'
import { AlertCircle } from 'lucide-react'

interface FormFieldProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  htmlFor?: string
  children: React.ReactNode
}

export function FormField({ label, hint, error, required, htmlFor, children }: FormFieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)' }}>
      <label htmlFor={htmlFor} style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-2)', fontSize: 'var(--gx-text-9)', fontFamily: 'var(--font-mono, ui-monospace)', textTransform: 'uppercase', letterSpacing: 'var(--gx-tracking-wider)', color: 'var(--text-2)', fontWeight: 600 }}>
        {label}
        {required && <span style={{ color: 'var(--danger)' }}>*</span>}
        {hint && <span style={{ marginLeft: 'var(--gx-space-2)', textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--text-3)' }}>{hint}</span>}
      </label>
      {children}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-1)', fontSize: 'var(--gx-text-10)', color: 'var(--danger)' }}>
          <AlertCircle size={10} />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
