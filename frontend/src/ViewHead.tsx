// Shared page header — matches the DESIGN prototype's ViewHead (shell.jsx).
// Icon badge + title + optional subtitle on the left, actions on the right.
import type { ReactNode } from 'react'

export default function ViewHead({
  icon,
  title,
  sub,
  actions,
}: {
  icon?: ReactNode
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="view-head" style={{ flexWrap: 'wrap', rowGap: 8 }}>
      {icon && <div className="view-icon">{icon}</div>}
      <div className="view-title-wrap" style={{ flex: '1 1 220px', minWidth: 0 }}>
        <h2 style={{ margin: 0, wordBreak: 'break-word' }}>{title}</h2>
        {sub && <span className="view-sub">{sub}</span>}
      </div>
      {actions && <div className="view-head-actions">{actions}</div>}
    </div>
  )
}
