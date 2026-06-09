// OrgView coordinator — renders one of 13 switchable layouts. Layout logic lives in
// views/org/layouts/; shared types/utils/context in views/org/.
import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { Button } from '../primitives'
import { PageShell } from '../page-shell'
import {
  ChartIcon, PackageIcon, LayersIcon, RowsIcon, MapIcon, ActivityIcon, GlobeIcon,
  SunIcon, ServerIcon, PlusIcon, UsersIcon, CalendarIcon, ShieldIcon, BuildingIcon, GearIcon,
} from '../components/icons'
import { OrgEditContext } from './org/context'
import { buildTree, loadLayout, STORAGE_KEY } from './org/utils'
import type { OrgNode, OrgLayout, OrgEdit, EditState } from './org/types'
import { OutlineLayout } from './org/layouts/OutlineLayout'
import { CardsLayout } from './org/layouts/CardsLayout'
import { HierarchyLayout } from './org/layouts/HierarchyLayout'
import { ListLayout } from './org/layouts/ListLayout'
import { GroupedLayout } from './org/layouts/GroupedLayout'
import { SpansLayout } from './org/layouts/SpansLayout'
import { MapLayout } from './org/layouts/MapLayout'
import { SunburstLayout } from './org/layouts/SunburstLayout'
import { TreemapLayout } from './org/layouts/TreemapLayout'
import { NetworkLayout } from './org/layouts/NetworkLayout'
import { HeatmapLayout } from './org/layouts/HeatmapLayout'
import { TimelineLayout } from './org/layouts/TimelineLayout'
import { RaciLayout } from './org/layouts/RaciLayout'
import { AddNodeModal, RenameNodeModal, MoveNodeModal, DeleteNodeModal } from './org/modals'

export type { OrgNode } from './org/types'

const SWITCHER: { id: OrgLayout; label: string; Icon: typeof LayersIcon }[] = [
  { id: 'hierarchy', label: 'Hierarchy', Icon: ChartIcon },
  { id: 'cards', label: 'Cards', Icon: PackageIcon },
  { id: 'outline', label: 'Outline', Icon: LayersIcon },
  { id: 'list', label: 'List', Icon: RowsIcon },
  { id: 'grouped', label: 'Grouped', Icon: MapIcon },
  { id: 'spans', label: 'Spans', Icon: ActivityIcon },
  { id: 'map', label: 'Map', Icon: GlobeIcon },
  { id: 'sunburst', label: 'Sunburst', Icon: SunIcon },
  { id: 'treemap', label: 'Treemap', Icon: ServerIcon },
  { id: 'network', label: 'Network', Icon: UsersIcon },
  { id: 'heatmap', label: 'Heatmap', Icon: BuildingIcon },
  { id: 'timeline', label: 'Timeline', Icon: CalendarIcon },
  { id: 'raci', label: 'RACI', Icon: ShieldIcon },
]

export default function OrgView({ nodes, configVersion, canConfigure = false, onRefresh, onConfigure }: {
  nodes: OrgNode[]
  configVersion: number
  canConfigure?: boolean
  onRefresh?: () => Promise<void>
  onConfigure?: () => void
}) {
  const { token } = useAuth()
  const cfg = usePageConfig(token!, 'org', configVersion)
  const [layout, setLayout] = useState<OrgLayout>(loadLayout)
  const roots = useMemo(() => buildTree(nodes), [nodes])

  const allNodeIds = useMemo(() => nodes.map((n) => n.id), [nodes])
  const cf = useCustomFields('org', cfg.customFields, allNodeIds)
  const defs = cfg.customFields

  const [editState, setEditState] = useState<EditState>(null)
  const editing = canConfigure && !!onRefresh
  const edit = useMemo<OrgEdit | null>(() => {
    if (!editing) return null
    return {
      rename: (node) => setEditState({ kind: 'rename', node }),
      addChild: (node) => setEditState({ kind: 'add', parent: node }),
      move: (node) => setEditState({ kind: 'move', node }),
      remove: (node) => setEditState({ kind: 'delete', node }),
    }
  }, [editing])
  const refresh = async () => { if (onRefresh) await onRefresh() }

  const choose = (next: OrgLayout) => {
    setLayout(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
  }

  return (
    <OrgEditContext.Provider value={edit}>
      <PageShell
        type="CONFIGURATION"
        breadcrumb={['Admin Panel', 'Organisation']}
        icon={<BuildingIcon size={18} />}
        title="Organisation"
        subtitle="Org node hierarchy"
        primaryAction={editing ? {
          label: 'Add node',
          onClick: () => setEditState({ kind: 'add', parent: null }),
          icon: <PlusIcon size={14} />,
        } : undefined}
        secondaryActions={canConfigure && onConfigure ? [
          { label: 'Configure', onClick: onConfigure, icon: <GearIcon size={13} /> },
        ] : undefined}
      >
        <div className="org-switcher-row">
          <div className="org-switcher" role="tablist" aria-label="Org view layout">
            {SWITCHER.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={layout === id}
                className={`org-switcher-btn${layout === id ? ' on' : ''}`}
                onClick={() => choose(id)}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {roots.length === 0 ? (
          <div className="card">
            <div className="org-empty muted">
              No organization nodes yet.
              {editing && (
                <>
                  {' '}
                  <Button variant="ghost" size="sm"
                    type="button" onClick={() => setEditState({ kind: 'add', parent: null })}>
                    <PlusIcon size={14} /> Add the first node
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="card">
            {layout === 'hierarchy' ? (
              <HierarchyLayout roots={roots} defs={defs} cf={cf} />
            ) : layout === 'cards' ? (
              <CardsLayout roots={roots} defs={defs} cf={cf} />
            ) : layout === 'outline' ? (
              <OutlineLayout roots={roots} defs={defs} cf={cf} />
            ) : layout === 'list' ? (
              <ListLayout nodes={nodes} cf={cf} />
            ) : layout === 'spans' ? (
              <SpansLayout roots={roots} />
            ) : layout === 'map' ? (
              <MapLayout nodes={nodes} defs={defs} cf={cf} />
            ) : layout === 'sunburst' ? (
              <SunburstLayout roots={roots} />
            ) : layout === 'treemap' ? (
              <TreemapLayout roots={roots} cf={cf} />
            ) : layout === 'network' ? (
              <NetworkLayout roots={roots} />
            ) : layout === 'heatmap' ? (
              <HeatmapLayout roots={roots} defs={defs} cf={cf} />
            ) : layout === 'timeline' ? (
              <TimelineLayout roots={roots} />
            ) : layout === 'raci' ? (
              <RaciLayout roots={roots} defs={defs} cf={cf} />
            ) : (
              <GroupedLayout roots={roots} defs={defs} cf={cf} />
            )}
          </div>
        )}

        {editState?.kind === 'add' && (
          <AddNodeModal parent={editState.parent} onClose={() => setEditState(null)} onDone={refresh} />
        )}
        {editState?.kind === 'rename' && (
          <RenameNodeModal node={editState.node} onClose={() => setEditState(null)} onDone={refresh} />
        )}
        {editState?.kind === 'move' && (
          <MoveNodeModal node={editState.node} nodes={nodes} onClose={() => setEditState(null)} onDone={refresh} />
        )}
        {editState?.kind === 'delete' && (
          <DeleteNodeModal node={editState.node} onClose={() => setEditState(null)} onDone={refresh} />
        )}
      </PageShell>
    </OrgEditContext.Provider>
  )
}
