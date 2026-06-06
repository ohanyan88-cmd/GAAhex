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
    <div className="field">
      <span>
        <label htmlFor={htmlFor}>{label}</label>
        {required && <span style={{ color: 'var(--gx-danger)' }}> *</span>}
        {hint && <span className="field-hint" style={{ marginLeft: 'var(--gx-space-3)', marginTop: 0, display: 'inline' }}>{hint}</span>}
      </span>
      {children}
      {error && (
        <div className="field-error">
          <AlertCircle size={10} />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
