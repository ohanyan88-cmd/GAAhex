// Icon-slug → component map for the Studio tree.
//
// The tree config (tree.ts) carries icon names as strings (e.g. 'monitor', 'database',
// 'check-check') so the spec stays serializable and free of React. This file resolves them to
// lucide-react components. If a slug isn't in lucide we fall back to a sensible neighbor —
// noted inline; no inline SVGs needed at this stage since lucide covers every slug the kit
// uses.

import type { ComponentType, SVGProps } from 'react'
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Bell,
  Blocks,
  BookOpen,
  Boxes,
  CheckCheck,
  Code,
  Database,
  FileText,
  Gavel,
  GitBranch,
  Image as ImageIcon,
  LayoutTemplate,
  Monitor,
  Package,
  Palette,
  Radio,
  Rocket,
  Scale,
  Search,
  Server,
  Settings,
  Shield,
  Sparkles,
  Store,
  Zap,
} from 'lucide-react'

// Loose props shape that accepts both our local IconProps and lucide's LucideProps.
type IconCmp = ComponentType<
  SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }
>

/** Every slug used in tree.ts has a row here. Adding a new slug to the tree REQUIRES
 *  a row here — see the keys for the canonical list. */
export const ICON_MAP: Record<string, IconCmp> = {
  // group icons (15)
  monitor: Monitor,
  database: Database,
  zap: Zap,
  shield: Shield,
  sparkles: Sparkles,
  'check-check': CheckCheck,
  rocket: Rocket,
  gavel: Gavel,
  settings: Settings,
  store: Store,
  code: Code,
  bell: Bell,
  search: Search,
  'arrow-left-right': ArrowLeftRight,
  'book-open': BookOpen,

  // module icons (the kit uses some that overlap with group icons too)
  files: FileText,                  // kit 'files' → lucide FileText (closest sibling; 'Files' is plural)
  blocks: Blocks,
  'layout-template': LayoutTemplate,
  palette: Palette,
  boxes: Boxes,
  server: Server,
  image: ImageIcon,
  'git-branch': GitBranch,
  bolt: Zap,                        // kit 'bolt' → lucide Zap (lucide has no Bolt component)
  scale: Scale,
  radio: Radio,
  'bar-chart-3': BarChart3,
  activity: Activity,

  // misc fallbacks (referenced but not in the canonical group/module list above)
  package: Package,
}

/** Resolve an icon slug to a component. Returns Settings as a soft fallback so the UI
 *  never crashes on a missing key. */
export function iconFor(slug: string): IconCmp {
  return ICON_MAP[slug] ?? Settings
}
