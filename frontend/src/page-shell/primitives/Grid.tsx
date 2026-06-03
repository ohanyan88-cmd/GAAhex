// Grid — column-grid layout primitive.
//
// Two modes:
//   1. Fixed columns: `<Grid cols={3}>` → repeat(3, minmax(0, 1fr))
//   2. Responsive auto-fit: `<Grid minColWidth="240px">` → repeat(auto-fit,
//      minmax(240px, 1fr)). When `minColWidth` is set it WINS over `cols`.
//
// gap is token-backed via primitives.css:
//   sm = --sp-3 (12px)   md = --card-gap (16px)   lg = --sp-6 (24px)
//
// Style note: when `minColWidth` is passed we inject a CSS custom property
// (--gd-min) rather than an inline grid-template-columns string, so the CSS
// rule stays in primitives.css and there is zero hardcoded length in the JSX.
import type { ReactNode, CSSProperties } from 'react'

export type GridCols = 1 | 2 | 3 | 4 | 5 | 6
export type GridGap = 'sm' | 'md' | 'lg'

export interface GridProps {
  cols?: GridCols
  gap?: GridGap
  minColWidth?: string
  className?: string
  children: ReactNode
}

export function Grid({
  cols = 3,
  gap = 'md',
  minColWidth,
  className,
  children,
}: GridProps) {
  const auto = minColWidth ? ' gd--auto' : ''
  const cls = `gd gd--cols-${cols} gd--gap-${gap}${auto}${className ? ` ${className}` : ''}`
  const style = minColWidth
    ? ({ ['--gd-min' as string]: minColWidth } as CSSProperties)
    : undefined
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  )
}
