// Stack — vertical layout primitive.
//
// Replaces inline `display: flex; flex-direction: column; gap: 16px` JSX style
// objects that views currently hand-roll. Token-backed via primitives.css; the
// component itself owns no spacing values.
//
//   <Stack gap="lg">
//     <SectionHeading title="Lines" />
//     <Card>...</Card>
//   </Stack>
//
// gap maps to --stk-gap-{size} (see primitives.css):
//   xs = --sp-1 (4px)   sm = --sp-2 (8px)   md = --sp-4 (16px)
//   lg = --sp-6 (24px)  xl = --sp-7 (32px)
import type { ReactNode, JSX } from 'react'

export type StackGap = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface StackProps {
  gap?: StackGap
  as?: keyof JSX.IntrinsicElements
  className?: string
  children: ReactNode
}

export function Stack({
  gap = 'md',
  as: Tag = 'div',
  className,
  children,
}: StackProps) {
  const cls = `stk stk--${gap}${className ? ` ${className}` : ''}`
  // Cast required because keyof JSX.IntrinsicElements is too broad for JSX
  // element-type inference without a generic createElement signature.
  const Component = Tag as 'div'
  return <Component className={cls}>{children}</Component>
}
