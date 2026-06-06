// GAAhex Studio — shared helpers used by the rich panes.
// Extracted from StudioRichPanes.tsx during the per-pane split.

import React from 'react'

// ── shared section header helper ──────────────────────────────────────────────

export interface SecProps {
  icon: React.ReactNode
  title: string
  hint?: string
  right?: React.ReactNode
}

export function Sec({ icon, title, hint, right }: SecProps) {
  return (
    <div className="section-head" style={{ marginTop: 0 }}>
      <span className="section-icon" style={{ display: 'inline-flex' }}>{icon}</span>
      {title}
      {hint && (
        <span className="hint" style={{ fontWeight: 400, marginLeft: 'var(--gx-space-3)' }}>· {hint}</span>
      )}
      {right && (
        <>
          <span style={{ flex: 1 }} />
          {right}
        </>
      )}
    </div>
  )
}

// ── shared device type (Layout Builder + Preview Mode) ───────────────────────

export type Device = 'desktop' | 'tablet' | 'mobile'

// ── shared studio-page types (VersionHistory + PublishSettings) ──────────────

export type StudioPage = { id: string; key: string; label: string; created_at: string }
export type StudioVersion = {
  id: string
  version_no: number
  status: string       // 'draft' | 'published'
  snapshot: any
  created_at: string
  author_user_id: string | null
}
export type StudioPageDetail = { page: StudioPage; version: StudioVersion | null }
export type StudioDiff = { added: string[]; changed: string[]; removed: string[] }
