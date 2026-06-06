// Card — surface primitive.
//
// Token-backed wrapper that pairs with Stack/Grid for the common
// "panel of related data" pattern. Replaces hand-rolled `<section style={{
// padding: 'var(--gx-space-6)', background: var(--gx-surface), border: ... }}>` calls.
//
//   <Card pad="md" tone="default">
//     <SectionHeading title="Recent invoices" />
//     <Stack gap="sm">{rows}</Stack>
//   </Card>
//
// pad maps to --card-p-{sm|md|lg} (12 / --card-pad / 32) and tone toggles
// surface + border via data attributes:
//   default  → --surface, --border (standard glass card)
//   emphasis → --surface (brighter mix) + brand border
//   subtle   → --surface-2 (darker nested surface)
import type { ReactNode } from 'react'

export type CardPad = 'sm' | 'md' | 'lg'
export type CardTone = 'default' | 'emphasis' | 'subtle'

export interface CardProps {
  pad?: CardPad
  tone?: CardTone
  className?: string
  children: ReactNode
}

export function Card({
  pad = 'md',
  tone = 'default',
  className,
  children,
}: CardProps) {
  const cls = `card-primitive card-primitive--pad-${pad} card-primitive--${tone}${className ? ` ${className}` : ''}`
  return <section className={cls}>{children}</section>
}
