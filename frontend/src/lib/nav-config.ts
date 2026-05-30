// GAAex Super Admin / Platform Owner navigation — 9 top-level sections per Gev's spec (2026-05-30).
// Studio is first-class — NOT hidden under System / Settings / Administration. Studio is the OS builder.
// Visibility cascade (later, via Studio Permission Builder):
//   Role → Domains → Modules → Pages → Actions → Fields → Widgets → Data
// items with viewType render the matching view; items without show a module stub.
// Global Header items (search, notifications, quick actions, AI assistant, help, profile) are NOT in left nav.
import type { ComponentType } from 'react'
import {
  HomeIcon, ChartIcon, UsersIcon, ArchiveIcon, InboxIcon, ReceiptIcon,
  ServerIcon, TruckIcon, PackageIcon, BriefcaseIcon,
  SparkleIcon, MessageIcon, FolderIcon, LayersIcon, ShieldIcon,
  GearIcon, ActivityIcon, BuildingIcon, CalendarIcon,
  ClockIcon, RowsIcon, EditIcon, BookmarkIcon, MailIcon,
  CreditCardIcon, ArrowRightIcon, CheckIcon,
} from '../components/icons'

export type NavItemDef = {
  id: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  viewType?: string
  viewArgs?: Record<string, string>
}

export type NavSectionDef = {
  id: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  items: NavItemDef[]
  adminOnly?: boolean
  defaultOpen?: boolean
}

const i = (id: string, label: string, icon: NavItemDef['icon'], viewType?: string, viewArgs?: NavItemDef['viewArgs']): NavItemDef =>
  ({ id, label, icon, ...(viewType ? { viewType, ...(viewArgs ? { viewArgs } : {}) } : {}) })

const s = (id: string, label: string, icon: NavSectionDef['icon'], items: NavItemDef[], opts?: Partial<NavSectionDef>): NavSectionDef =>
  ({ id, label, icon, items, ...opts })

export const NAV_SECTIONS: NavSectionDef[] = [

  // 1. Workspace — personal work center.
  // Wave A scaffold: dead items (Recent Items, Team Workspace, Announcements)
  // removed — no backend. Backed items (My Approvals, Activity Feed, Saved
  // Views) wired to their dedicated views.
  s('workspace', 'Workspace', HomeIcon, [
    i('ws-home',          'Home',             HomeIcon,       'dashboards'),
    i('ws-my-tasks',      'My Tasks',         CheckIcon,      'mytasks'),
    i('ws-approvals',     'My Approvals',     CheckIcon,      'my-approvals'),
    i('ws-calendar',      'Calendar',         CalendarIcon,   'calendar'),
    i('ws-activity',      'Activity Feed',    ActivityIcon,   'activity-feed'),
    i('ws-saved',         'Saved Views',      BookmarkIcon,   'saved-views'),
  ], { defaultOpen: true }),

  // 2. CRM & Commercial — sales and customer acquisition
  s('crm', 'CRM & Commercial', UsersIcon, [
    i('crm-leads',       'Leads',           ArrowRightIcon, 'lead-pipeline'),
    i('crm-opps',        'Opportunities',   ArrowRightIcon),
    i('crm-customers',   'Customers',       UsersIcon,      'entity', { slug: 'customers' }),
    i('crm-accounts',    'Accounts',        BuildingIcon,   'accounts'),
    i('crm-contacts',    'Contacts',        UsersIcon,      'entity', { slug: 'contacts' }),
    i('crm-quotes',      'Quotes',          EditIcon),
    i('crm-contracts',   'Contracts',       FolderIcon),
    i('crm-catalog',     'Product Catalog', ArchiveIcon,    'products'),
    i('crm-promotions',  'Promotions',      SparkleIcon),
    i('crm-segments',    'Segments',        LayersIcon),
    i('crm-loyalty',     'Loyalty',         BookmarkIcon),
    i('crm-campaigns',   'Campaigns',       MailIcon),
    i('crm-partners',    'Partners',        BuildingIcon),
  ]),

  // 3. Orders & Revenue — qualification to cash collection
  // Wave A pruning (2026-05-30): 14 dead items removed (no backend or redundant).
  // Survivors are all wired to live /api routes or seeded entity views.
  s('revenue', 'Orders & Revenue', ArchiveIcon, [
    i('rev-orders',      'Orders',            ArchiveIcon,    'orders'),
    i('rev-subs',        'Subscriptions',     ArchiveIcon,    'subscriptions'),
    i('rev-invoices',    'Invoices',          ReceiptIcon,    'invoices'),
    i('rev-payments',    'Payments',          CreditCardIcon, 'payments'),
    i('rev-assurance',   'Revenue Assurance', ShieldIcon,     'revenue-assurance'),
  ]),

  // 4. Customer Care — support and service operations
  // Wave A pruning (2026-05-30): 7 dead items removed (no backend, or reachable via row click):
  // care-console, care-cust360 (drilldown from customer rows), care-omni, care-callcenter,
  // care-livechat, care-tech, care-retention.
  s('care', 'Customer Care', InboxIcon, [
    i('care-interactions','Interactions',           ClockIcon,    'entity', { slug: 'interactions' }),
    i('care-tickets',     'Tickets',                ArchiveIcon,  'entity', { slug: 'tickets' }),
    i('care-helpdesk',    'Helpdesk',               InboxIcon,    'helpdesk'),
    i('care-complaints',  'Complaints',             EditIcon),
    i('care-escalations', 'Escalations',            ArrowRightIcon),
    i('care-sla',         'SLA Management',         ClockIcon),
    i('care-kb',          'Knowledge Base',         BookmarkIcon),
    i('care-comms',       'Service Communications', MessageIcon,  'messages'),
    i('care-outbound',    'Outbound',               MailIcon,     'outbound'),
  ]),

  // 5. Network & Operations — network, provisioning, field, inventory
  // Wave A pruning (2026-05-30): 12 dead items removed (no backend, or redundant with
  // Resource Pools / warehouses / suppliers): net-noc, net-monitoring, net-coverage,
  // net-topology, net-provisioning, net-field, net-dispatch, net-routes, net-mobile,
  // net-capacity, net-inventory, net-ipam. Survivors wired to live /api routes or
  // seeded entity views (net-alarms → alarms, net-assetmgmt → assets).
  s('netops', 'Network & Operations', ServerIcon, [
    i('net-alarms',       'Alarms',                 InboxIcon,    'entity', { slug: 'alarms' }),
    i('net-incidents',    'Incidents & Outages',    InboxIcon),
    i('net-sites',        'Sites',                  ServerIcon),
    i('net-devices',      'Devices',                ServerIcon),
    i('net-svc-inv',      'Service Inventory',      ServerIcon,   'services'),
    i('net-res-inv',      'Resource Inventory',     PackageIcon,  'resource-pools'),
    i('net-warehouses',   'Warehouses',             BuildingIcon),
    i('net-fleet',        'Fleet',                  TruckIcon),
    i('net-scheduling',   'Scheduling',             CalendarIcon),
    i('net-workorders',   'Work Orders',            RowsIcon),
    i('net-maintenance',  'Maintenance',            GearIcon),
    i('net-assetmgmt',    'Asset Management',       PackageIcon,  'entity', { slug: 'assets' }),
  ]),

  // 6. Analytics & AI — reporting, intelligence, automation
  // Wave A pruning (2026-05-30): 11 dead items removed (no backend): ana-kpi,
  // ana-forecast, ana-agents, ana-automations, ana-insights, ana-governance,
  // ana-churn, ana-fraud, ana-anomaly, ana-predictive, ana-export.
  s('analytics', 'Analytics & AI', ChartIcon, [
    i('ana-exec',        'Executive Dashboard',         ChartIcon,    'dashboards'),
    i('ana-reports',     'Reports',                     BookmarkIcon, 'reports'),
    i('ana-builder',     'Report Builder',              EditIcon,     'report-builder'),
    i('ana-copilot',     'AI Copilot',                  SparkleIcon,  'ask'),
  ]),

  // 7. Enterprise — internal company operations
  // Wave A pruning (2026-05-30): 10 dead items removed — 9 with no backend
  // (ent-finance, ent-accounting, ent-procurement, ent-hr, ent-attendance,
  // ent-onboarding, ent-time, ent-legal, ent-esign) plus ent-assets which
  // duplicated net-assetmgmt (both routed to /api/assets).
  s('enterprise', 'Enterprise', BriefcaseIcon, [
    i('ent-employees',   'Employees',            UsersIcon),
    i('ent-departments', 'Departments',          BuildingIcon),
    i('ent-leave',       'Leave Management',     CalendarIcon),
    i('ent-recruitment', 'Recruitment',          UsersIcon),
    i('ent-performance', 'Performance',          ChartIcon),
    i('ent-projects',    'Projects',             LayersIcon),
    i('ent-docs',        'Document Management',  FolderIcon),
  ]),

  // 8. System — platform management and configuration (admin-only)
  // Wave A pruning (2026-05-30): 21 dead items removed per CLAUDE_CODE_ALL_PAGES_PROMPTS doctrine
  // rule #4. Tenants omitted (single-tenant install). Items with no backend dropped:
  // sys-teams, sys-workflows, sys-api, sys-comm-center, sys-monitoring, sys-eventbus, sys-queues,
  // sys-logs, sys-traces, sys-adapters, sys-deploy, sys-regions, sys-flags, sys-secrets,
  // sys-audit, sys-security, sys-backup. Items with backend but no view yet: sys-roles,
  // sys-notif, sys-metrics. Survivors are all wired to live /api routes or entity views.
  s('system', 'System', GearIcon, [
    i('sys-org',         'Organization',         BuildingIcon,   'org'),
    i('sys-users',       'Users',                UsersIcon,      'entity', { slug: 'users' }),
    i('sys-integrations','Integrations',         LayersIcon),
    i('sys-webhooks',    'Webhooks',             ArrowRightIcon, 'webhooks'),
    i('sys-settings',    'System Settings',      GearIcon,       'settings'),
  ], { adminOnly: true }),

  // 9. Studio — the operating system builder (FIRST-CLASS, not hidden under System).
  // Single entry: the new Studio shell owns its own 15-group tree internally (frontend/src/studio/
  // tree.ts, P2), so we collapse the old 21 sub-items down to a single jump-into-Studio link.
  s('studio', 'Studio', SparkleIcon, [
    i('std-overview',    'Studio',                   SparkleIcon,    'studio'),
  ], { adminOnly: true }),
]

// Stub items promoted to real config-driven entities (seeded by backend app/seed_catalog.py).
// Mutates NAV_SECTIONS once at module load so these items route to their entity page, not a stub.
const ENTITY_SLUGS: Record<string, string> = {
  // CRM & Commercial
  'crm-opps': 'opportunities', 'crm-quotes': 'quotes', 'crm-contracts': 'contracts',
  'crm-promotions': 'promotions', 'crm-segments': 'segments', 'crm-loyalty': 'loyalty-members',
  'crm-campaigns': 'campaigns', 'crm-partners': 'partnerships',
  // Customer Care
  'care-complaints': 'complaints', 'care-escalations': 'escalations',
  'care-sla': 'sla-policies', 'care-kb': 'kb-articles',
  // Network & Operations
  'net-sites': 'sites', 'net-devices': 'devices', 'net-incidents': 'incidents',
  'net-workorders': 'work-orders', 'net-maintenance': 'maintenance-jobs',
  'net-warehouses': 'warehouses', 'net-fleet': 'vehicles',
  // Enterprise
  'ent-projects': 'projects', 'ent-employees': 'employees', 'ent-departments': 'departments',
  'ent-leave': 'leave-requests', 'ent-recruitment': 'candidates',
  'ent-performance': 'performance-reviews',
  'ent-docs': 'documents',
  // System
  'sys-integrations': 'integrations',
}

for (const sec of NAV_SECTIONS) {
  for (const it of sec.items) {
    if (!it.viewType && ENTITY_SLUGS[it.id]) {
      it.viewType = 'entity'
      it.viewArgs = { slug: ENTITY_SLUGS[it.id] }
    }
  }
}
