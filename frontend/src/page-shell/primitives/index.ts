// Layout primitives — public barrel.
//
// Pages should not import individual primitive files; they import from the
// page-shell barrel one level up:
//
//   import { Stack, Inline, Grid, Card, SectionHeading } from '@/page-shell'
//
// The CSS side-effect import below is the only place primitives.css is loaded;
// re-exporting through page-shell/index.ts means any page that pulls a single
// primitive automatically gets the stylesheet.
import './primitives.css'

export { Stack } from './Stack'
export { Inline } from './Inline'
export { Grid } from './Grid'
export { Card } from './Card'
export { SectionHeading } from './SectionHeading'

export type { StackProps, StackGap } from './Stack'
export type { InlineProps, InlineAlign, InlineJustify } from './Inline'
export type { GridProps, GridCols, GridGap } from './Grid'
export type { CardProps, CardPad, CardTone } from './Card'
export type { SectionHeadingProps } from './SectionHeading'
