// GAAex Studio — full platform tree (the SuperAdmin spec).
//
// TypeScript port of STUDIO_TREE from design-system/ui_kits/portal/studio-tree.jsx (lines 11-48).
// 15 top-level groups. 9 are part of the relational 9-layer architecture (P3 Overview);
// the remaining 6 are "Platform capabilities" support groups.
//
// IDs: kebab-case slug of the label, joined with '.' for the path. e.g.
//   experience.pages.page-registry
//   security.roles
//   import-export.data-import
// These IDs are what the URL surfaces under /studio/<group>/<module>/<leaf>.
//
// Icon: a string slug — see iconMap.ts for the actual lucide-react component.
// Keep this file PURE DATA (no React imports) so it can be consumed by archetype
// detectors, deep-link parsers, etc. without dragging in the icon bundle.

export type LeafDef = { id: string; label: string }
export type ModuleDef = { id: string; label: string; icon: string; leaves: LeafDef[] }
export type GroupDef = {
  id: string
  label: string
  icon: string
  /** Either modules → leaves (Experience/Data/Logic/Intelligence) OR flat leaves. */
  modules?: ModuleDef[]
  leaves?: LeafDef[]
}

// ── helpers ─────────────────────────────────────────────────────────────────
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const L = (label: string): LeafDef => ({ id: slug(label), label })
const M = (label: string, icon: string, leaves: string[]): ModuleDef => ({
  id: slug(label),
  label,
  icon,
  leaves: leaves.map(L),
})
const G = (label: string, icon: string, modules: ModuleDef[]): GroupDef => ({
  id: slug(label),
  label,
  icon,
  modules,
})
const GF = (label: string, icon: string, leaves: string[]): GroupDef => ({
  id: slug(label),
  label,
  icon,
  leaves: leaves.map(L),
})

// ── the spec — verbatim from studio-tree.jsx STUDIO_TREE ─────────────────────
export const STUDIO_TREE: GroupDef[] = [
  G('Experience', 'monitor', [
    M('Pages', 'files', [
      'Page Registry', 'Page Builder', 'Routing', 'Navigation', 'Breadcrumbs',
      'Meta Tags', 'SEO', 'Redirects', 'Dynamic Pages', 'Page States',
      'Access Mapping', 'Visibility Rules', 'Page Versioning', 'Page Analytics',
    ]),
    M('Components', 'blocks', [
      'Component Registry', 'Component Builder', 'Component Categories',
      'Variants', 'Slots', 'Properties', 'Events', 'Behaviors', 'State Management',
      'Component Permissions', 'Component Versioning', 'Component Marketplace',
    ]),
    M('Layouts', 'layout-template', [
      'Grid System', 'Containers', 'Sections', 'Responsive Rules', 'Breakpoints',
      'Layout Templates', 'Layout Library', 'Layout Conditions', 'Layout Inheritance',
    ]),
    M('Templates', 'store', [
      'CRM', 'ERP', 'HRM', 'LMS', 'E-Commerce', 'Portals', 'Dashboards',
      'Landing Pages', 'Websites', 'Custom Templates',
    ]),
    M('Themes', 'palette', [
      'Brand Identity', 'Logos', 'Colors', 'Typography', 'Icons', 'Shadows',
      'Border Radius', 'Spacing Scale', 'Animations', 'Light Mode', 'Dark Mode',
      'Design Tokens', 'Theme Inheritance',
    ]),
  ]),
  G('Data', 'database', [
    M('Models', 'boxes', [
      'Entities', 'Fields', 'Relationships', 'Constraints', 'Validation',
      'Enumerations', 'Calculated Fields', 'Virtual Fields', 'Audit Fields',
      'Schema Versioning',
    ]),
    M('Data Sources', 'server', [
      'PostgreSQL', 'MySQL', 'MongoDB', 'SQL Server', 'Oracle', 'Firebase',
      'External APIs', 'CSV', 'Excel', 'Data Warehouses',
    ]),
    M('APIs', 'code', [
      'REST', 'GraphQL', 'gRPC', 'Webhooks', 'API Gateway', 'API Policies',
      'API Security', 'Rate Limits', 'API Monitoring', 'API Documentation',
    ]),
    M('Integrations', 'blocks', [
      'Payments', 'Messaging', 'Email', 'AI Providers', 'CRM Systems',
      'ERP Systems', 'Identity Providers', 'Cloud Services', 'Analytics Tools',
      'Custom Connectors',
    ]),
    M('Assets', 'image', [
      'Images', 'Videos', 'Documents', 'Fonts', 'Icons', 'Audio',
      'Media Optimization', 'CDN', 'Asset Versioning',
    ]),
  ]),
  G('Logic', 'zap', [
    M('Workflows', 'git-branch', [
      'Workflow Designer', 'Process Maps', 'Approval Chains', 'State Machines',
      'Workflow Variables', 'Workflow Templates', 'Workflow Versions',
      'Workflow Logs', 'Workflow Metrics',
    ]),
    M('Automations', 'bolt', [
      'Triggers', 'Conditions', 'Actions', 'Schedules', 'Jobs', 'Queues',
      'Retries', 'Notifications', 'Automation History',
    ]),
    M('Rules Engine', 'scale', [
      'Business Rules', 'Validation Rules', 'Decision Trees', 'Formula Builder',
      'Rule Testing', 'Rule Versions', 'Rule Audit',
    ]),
    M('Events', 'radio', [
      'Event Registry', 'Event Bus', 'Event Consumers', 'Event Producers',
      'Event Replay', 'Event Logs', 'Event Monitoring', 'Dead Letter Queue',
    ]),
  ]),
  GF('Security', 'shield', [
    'Roles', 'Permissions', 'Policies', 'Authentication', 'Authorization',
    'MFA', 'SSO', 'OAuth', 'Session Policies', 'Password Policies',
    'Secrets Vault', 'Encryption', 'Certificates', 'IP Restrictions',
    'Geo Restrictions', 'Device Trust', 'Threat Detection',
  ]),
  G('Intelligence', 'sparkles', [
    M('AI', 'sparkles', [
      'Models', 'Providers', 'Agents', 'Prompts', 'Knowledge Bases', 'RAG',
      'Embeddings', 'Tool Registry', 'AI Workflows', 'Usage Tracking',
      'Cost Monitoring',
    ]),
    M('Analytics', 'bar-chart-3', [
      'Dashboards', 'Reports', 'KPIs', 'Funnels', 'Cohorts', 'Usage Metrics',
      'Revenue Metrics', 'Custom Metrics',
    ]),
    M('Monitoring', 'activity', [
      'Health Checks', 'Logs', 'Errors', 'Traces', 'Performance', 'Alerts',
      'Incidents', 'SLA Tracking',
    ]),
  ]),
  GF('Quality', 'check-check', [
    'Testing', 'Accessibility', 'Preview', 'Versioning', 'QA Pipelines',
    'Test Data', 'Regression Testing', 'Load Testing', 'Security Testing',
    'Release Validation',
  ]),
  GF('Release', 'rocket', [
    'Deployment', 'Environments', 'Feature Flags', 'Release Channels',
    'Blue-Green Deployment', 'Canary Deployment', 'Rollbacks',
    'Deployment Pipelines', 'Release Approvals',
  ]),
  GF('Governance', 'gavel', [
    'Audit Logs', 'Activity History', 'Compliance', 'Policies', 'Data Retention',
    'Legal Documents', 'Change Management', 'Risk Management',
    'Data Classification', 'Governance Reports',
  ]),
  GF('System Control', 'settings', [
    'Platform Settings', 'Global Configuration', 'Tenant Management',
    'Multi-Tenancy', 'Subscription Plans', 'Billing Engine', 'Usage Limits',
    'Quotas', 'Backup Center', 'Disaster Recovery', 'Infrastructure', 'Services',
    'Storage', 'Cache', 'Queues', 'Cron Jobs', 'Environment Variables',
    'License Management', 'Maintenance Mode', 'System Health',
    'Emergency Controls', 'Danger Zone',
  ]),
  GF('Marketplace', 'store', [
    'Plugins', 'Extensions', 'App Templates', 'Connector Store',
  ]),
  GF('Developer', 'code', [
    'Custom Code', 'SDK', 'CLI', 'Webhooks', 'API Docs',
  ]),
  GF('Notifications', 'bell', [
    'Email Templates', 'SMS Templates', 'Push Notifications',
    'In-App Notifications', 'Notification Rules',
  ]),
  GF('Search', 'search', [
    'Global Search', 'Search Indexes', 'Search Ranking', 'Search Permissions',
  ]),
  GF('Import / Export', 'arrow-left-right', [
    'Data Import', 'Data Export', 'Template Export', 'Migration Tools',
  ]),
  GF('Documentation', 'book-open', [
    'System Docs', 'User Guides', 'API Docs', 'Changelog',
  ]),
]

// ── flattened views (computed once at module load) ──────────────────────────
export type FlatLeaf = {
  id: string                // groupId[.moduleId].leafId
  groupId: string
  groupLabel: string
  groupIcon: string
  moduleId?: string
  moduleLabel?: string
  moduleIcon?: string
  leafId: string
  leafLabel: string
}

export const STUDIO_LEAVES: FlatLeaf[] = (() => {
  const out: FlatLeaf[] = []
  for (const g of STUDIO_TREE) {
    if (g.modules) {
      for (const m of g.modules) {
        for (const l of m.leaves) {
          out.push({
            id: `${g.id}.${m.id}.${l.id}`,
            groupId: g.id, groupLabel: g.label, groupIcon: g.icon,
            moduleId: m.id, moduleLabel: m.label, moduleIcon: m.icon,
            leafId: l.id, leafLabel: l.label,
          })
        }
      }
    } else if (g.leaves) {
      for (const l of g.leaves) {
        out.push({
          id: `${g.id}.${l.id}`,
          groupId: g.id, groupLabel: g.label, groupIcon: g.icon,
          leafId: l.id, leafLabel: l.label,
        })
      }
    }
  }
  return out
})()

export const LEAF_BY_ID: Record<string, FlatLeaf> = Object.fromEntries(
  STUDIO_LEAVES.map((l) => [l.id, l]),
)

export const GROUP_BY_ID: Record<string, GroupDef> = Object.fromEntries(
  STUDIO_TREE.map((g) => [g.id, g]),
)

/** First leaf of a group — used by P3 layer cards + support cards to deep-link. */
export function firstLeafOfGroup(groupId: string): FlatLeaf | undefined {
  return STUDIO_LEAVES.find((l) => l.groupId === groupId)
}

/** Count leaves under a group (used by P3 Overview's "N modules"/"N leaves" stat). */
export function leafCountOfGroup(groupId: string): number {
  return STUDIO_LEAVES.filter((l) => l.groupId === groupId).length
}

/** Count modules under a group; 0 if flat. */
export function moduleCountOfGroup(groupId: string): number {
  const g = GROUP_BY_ID[groupId]
  return g?.modules?.length ?? 0
}
