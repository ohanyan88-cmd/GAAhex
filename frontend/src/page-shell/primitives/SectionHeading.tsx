// SectionHeading — the "title row" primitive.
//
// Stamped at the top of every Card / panel section. Replaces the hand-rolled
// `<header style={{ display: 'flex', justifyContent: 'space-between' }}>`
// blocks that every view currently hand-rolls.
//
//   <SectionHeading
//     icon={<Inbox size={16} />}
//     title="Open tickets"
//     subtitle="Across all departments"
//     action={<button className="btn">New</button>}
//   />
//
// Internally composes <Inline> + a left-side cluster (icon + title-stack) and
// a right-side action slot. Subtitle is optional and renders one line beneath
// the title using the secondary text color.
import type { ReactNode } from 'react'
import { Inline } from './Inline'

export interface SectionHeadingProps {
  icon?: ReactNode
  title: string
  subtitle?: string
  action?: ReactNode
  className?: string
}

export function SectionHeading({
  icon,
  title,
  subtitle,
  action,
  className,
}: SectionHeadingProps) {
  const cls = `sh${className ? ` ${className}` : ''}`
  return (
    <Inline gap="sm" align="center" justify="between" className={cls}>
      <Inline gap="sm" align="center" className="sh__left">
        {icon && <span className="sh__icon">{icon}</span>}
        <span className="sh__titles">
          <span className="sh__title">{title}</span>
          {subtitle && <span className="sh__subtitle">{subtitle}</span>}
        </span>
      </Inline>
      {action && <span className="sh__action">{action}</span>}
    </Inline>
  )
}
