import type { ReactNode } from 'react'

export default function ViewHead({
  icon,
  title,
  sub,
  actions,
}: {
  icon: ReactNode
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="view-head">
      <div className="view-icon">{icon}</div>
      <div className="view-title-wrap">
        <h2>{title}</h2>
        {sub != null && <span className="view-sub">{sub}</span>}
      </div>
      {actions != null && <div className="view-head-actions">{actions}</div>}
    </div>
  )
}
