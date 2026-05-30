// GAAex Super Admin / Platform Owner navigation — 9 top-level sections per Gev's spec (2026-05-30).
// Studio is first-class — NOT hidden under System / Settings / Administration. Studio is the OS builder.
// Visibility cascade (later, via Studio Permission Builder):
//   Role → Domains → Modules → Pages → Actions → Fields → Widgets → Data
// items with viewType render the matching view; items without show a module stub.
// Global Header items (search, notifications, quick actions, AI assistant, help, profile) are NOT in left nav.
import type { ComponentType } from 'react'
import {
  HomeIcon, ChartIcon, UsersIcon, ArchiveIcon, InboxIcon, ReceiptIcon,
  ServerIcon, TruckIcon, PackageIcon, DollarIcon, BriefcaseIcon,
  SparkleIcon, MessageIcon, FolderIcon, LayersIcon, ShieldIcon,
  GearIcon, MapIcon, ActivityIcon, BuildingIcon, CalendarIcon,
  ClockIcon, RowsIcon, EditIcon, BookmarkIcon, MailIcon,
  CreditCardIcon, LockIcon, PhoneIcon, ArrowRightIcon, CheckIcon,
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
  s('care', 'Customer Care', InboxIcon, [
    i('care-console',     'Agent Console',          PhoneIcon),
    i('care-cust360',     'Customer 360',           UsersIcon),
    i('care-interactions','Interactions',           ClockIcon,    'entity', { slug: 'interactions' }),
    i('care-omni',        'Omnichannel Inbox',      MessageIcon),
    i('care-callcenter',  'Call Center',            PhoneIcon),
    i('care-livechat',    'Live Chat',              MessageIcon),
    i('care-tickets',     'Tickets',                ArchiveIcon,  'entity', { slug: 'tickets' }),
    i('care-helpdesk',    'Helpdesk',               InboxIcon,    'helpdesk'),
    i('care-tech',        'Technical Support',      ServerIcon),
    i('care-complaints',  'Complaints',             EditIcon),
    i('care-escalations', 'Escalations',            ArrowRightIcon),
    i('care-sla',         'SLA Management',         ClockIcon),
    i('care-retention',   'Retention Desk',         UsersIcon),
    i('care-kb',          'Knowledge Base',         BookmarkIcon),
    i('care-comms',       'Service Communications', MessageIcon,  'messages'),
    i('care-outbound',    'Outbound',               MailIcon,     'outbound'),
  ]),

  // 5. Network & Operations — network, provisioning, field, inventory
  s('netops', 'Network & Operations', ServerIcon, [
    i('net-noc',          'NOC Dashboard',          ActivityIcon),
    i('net-monitoring',   'Monitoring',             ActivityIcon),
    i('net-alarms',       'Alarms',                 InboxIcon),
    i('net-incidents',    'Incidents & Outages',    InboxIcon),
    i('net-coverage',     'Coverage & GIS',         MapIcon),
    i('net-topology',     'Network Topology',       MapIcon),
    i('net-sites',        'Sites',                  ServerIcon),
    i('net-devices',      'Devices',                ServerIcon),
    i('net-provisioning', 'Provisioning',           ArrowRightIcon),
    i('net-svc-inv',      'Service Inventory',      ServerIcon,   'services'),
    i('net-res-inv',      'Resource Inventory',     PackageIcon,  'resource-pools'),
    i('net-inventory',    'Inventory',              PackageIcon),
    i('net-warehouses',   'Warehouses',             BuildingIcon),
    i('net-fleet',        'Fleet',                  TruckIcon),
    i('net-ipam',         'IP Management',          LayersIcon),
    i('net-field',        'Field Operations',       TruckIcon),
    i('net-dispatch',     'Dispatch Board',         UsersIcon),
    i('net-scheduling',   'Scheduling',             CalendarIcon),
    i('net-routes',       'Routes',                 MapIcon),
    i('net-mobile',       'Mobile Workforce',       UsersIcon),
    i('net-workorders',   'Work Orders',            RowsIcon),
    i('net-maintenance',  'Maintenance',            GearIcon),
    i('net-capacity',     'Capacity Planning',      ChartIcon),
    i('net-assetmgmt',    'Asset Management',       PackageIcon),
  ]),

  // 6. Analytics & AI — reporting, intelligence, automation
  s('analytics', 'Analytics & AI', ChartIcon, [
    i('ana-exec',        'Executive Dashboard',         ChartIcon,    'dashboards'),
    i('ana-kpi',         'KPI Center',                  ChartIcon),
    i('ana-reports',     'Reports',                     BookmarkIcon, 'reports'),
    i('ana-builder',     'Report Builder',              EditIcon,     'report-builder'),
    i('ana-forecast',    'Forecasting',                 ChartIcon),
    i('ana-copilot',     'AI Copilot',                  SparkleIcon,  'ask'),
    i('ana-agents',      'AI Agents',                   SparkleIcon),
    i('ana-automations', 'AI Automations',              SparkleIcon),
    i('ana-insights',    'AI Insights',                 SparkleIcon),
    i('ana-governance',  'AI Governance',               ShieldIcon),
    i('ana-churn',       'Churn Prediction',            ChartIcon),
    i('ana-fraud',       'Fraud Detection',             ShieldIcon),
    i('ana-anomaly',     'Network Anomaly Detection',   ServerIcon),
    i('ana-predictive',  'Predictive Maintenance',      GearIcon),
    i('ana-export',      'Export Center',               FolderIcon),
  ]),

  // 7. Enterprise — internal company operations
  s('enterprise', 'Enterprise', BriefcaseIcon, [
    i('ent-finance',     'Finance',              DollarIcon),
    i('ent-accounting',  'Accounting',           ReceiptIcon),
    i('ent-procurement', 'Procurement',          ArchiveIcon),
    i('ent-hr',          'HR',                   BriefcaseIcon),
    i('ent-employees',   'Employees',            UsersIcon),
    i('ent-departments', 'Departments',          BuildingIcon),
    i('ent-attendance',  'Attendance',           ClockIcon),
    i('ent-leave',       'Leave Management',     CalendarIcon),
    i('ent-recruitment', 'Recruitment',          UsersIcon),
    i('ent-onboarding',  'Onboarding',           ArrowRightIcon),
    i('ent-performance', 'Performance',          ChartIcon),
    i('ent-time',        'Time Tracking',        ClockIcon),
    i('ent-projects',    'Projects',             LayersIcon),
    i('ent-assets',      'Assets',               PackageIcon),
    i('ent-legal',       'Legal & Compliance',   ShieldIcon),
    i('ent-docs',        'Document Management',  FolderIcon),
    i('ent-esign',       'E-Signatures',         EditIcon),
  ]),

  // 8. System — platform management and configuration (admin-only)
  s('system', 'System', GearIcon, [
    i('sys-org',         'Organization',         BuildingIcon,   'org'),
    i('sys-tenants',     'Tenants',              BuildingIcon),
    i('sys-users',       'Users',                UsersIcon,      'entity', { slug: 'users' }),
    i('sys-roles',       'Roles & Permissions',  LockIcon),
    i('sys-teams',       'Teams',                UsersIcon),
    i('sys-workflows',   'Workflows',            ArrowRightIcon),
    i('sys-integrations','Integrations',         LayersIcon),
    i('sys-api',         'API Management',       ServerIcon),
    i('sys-webhooks',    'Webhooks',             ArrowRightIcon, 'webhooks'),
    i('sys-notif',       'Notifications',        InboxIcon),
    i('sys-comm-center', 'Communication Center', MessageIcon),
    i('sys-monitoring',  'Monitoring',           ActivityIcon),
    i('sys-eventbus',    'Event Bus',            ArrowRightIcon),
    i('sys-queues',      'Queue Monitoring',     RowsIcon),
    i('sys-logs',        'Runtime Logs',         EditIcon),
    i('sys-metrics',     'Metrics',              ChartIcon),
    i('sys-traces',      'Traces',               ActivityIcon),
    i('sys-adapters',    'Adapter Health',       ServerIcon),
    i('sys-deploy',      'Deployments',          ArrowRightIcon),
    i('sys-regions',     'Regions',              MapIcon),
    i('sys-flags',       'Feature Flags',        SparkleIcon),
    i('sys-secrets',     'Secrets Vault',        LockIcon),
    i('sys-audit',       'Audit Logs',           ClockIcon),
    i('sys-security',    'Security',             ShieldIcon),
    i('sys-backup',      'Backup & Recovery',    ArchiveIcon),
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
  'ent-performance': 'performance-reviews', 'ent-assets': 'assets',
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
