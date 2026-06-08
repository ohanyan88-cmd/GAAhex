import type { useCustomFields } from '../../components/CustomCells'

export type CFApi = ReturnType<typeof useCustomFields>

export type OrgNode = {
  id: string
  type: string
  name: string
  path: string
  code?: string
  parent_id?: string | null
}

export type OrgLayout =
  | 'hierarchy' | 'cards' | 'outline' | 'list' | 'grouped' | 'spans' | 'map' | 'sunburst' | 'treemap'
  | 'network' | 'heatmap' | 'timeline' | 'raci'

export type OrgTreeNode = OrgNode & { children: OrgTreeNode[] }

export type OrgEditAction = (node: OrgNode) => void
export type OrgEdit = {
  rename: OrgEditAction
  addChild: OrgEditAction
  move: OrgEditAction
  remove: OrgEditAction
}

export type EditState =
  | { kind: 'add'; parent: OrgNode | null }
  | { kind: 'rename'; node: OrgNode }
  | { kind: 'move'; node: OrgNode }
  | { kind: 'delete'; node: OrgNode }
  | null
