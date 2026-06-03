// Inline — horizontal layout primitive.
//
// Sibling of Stack; renders a wrapping flex row with token-backed gap. Used for
// icon + label clusters, button toolbars, badge rows, KPI strips inside cards,
// and anywhere a SectionHeading needs an action lined up on the right.
//
//   <Inline gap="sm" align="center" justify="between">
//     <Inline gap="xs" align="center"><Icon/><span>Subscribers</span></Inline>
//     <button>Add</button>
//   </Inline>
//
// align + justify map to data-* attributes (kept off the className so the rule
// surface stays small). gap shares the --stk-gap-* token family with Stack.
import type { ReactNode, JSX } from 'react'
import type { StackGap } from './Stack'

export type InlineAlign = 'start' | 'center' | 'end' | 'baseline'
export type InlineJustify = 'start' | 'center' | 'end' | 'between'

export interface InlineProps {
  gap?: StackGap
  align?: InlineAlign
  justify?: InlineJustify
  as?: keyof JSX.IntrinsicElements
  className?: string
  children: ReactNode
}

export function Inline({
  gap = 'md',
  align = 'center',
  justify = 'start',
  as: Tag = 'div',
  className,
  children,
}: InlineProps) {
  const cls = `inl inl--${gap}${className ? ` ${className}` : ''}`
  const Component = Tag as 'div'
  return (
    <Component className={cls} data-align={align} data-justify={justify}>
      {children}
    </Component>
  )
}
