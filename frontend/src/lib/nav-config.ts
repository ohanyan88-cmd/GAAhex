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
  placement?: 'O' | 'V'
}

export type NavSectionDef = {
  id: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  items: NavItemDef[]
  adminOnly?: boolean
  defaultOpen?: boolean
}

const i = (
  id: string,
  label: string,
  icon: NavItemDef['icon'],
  viewType?: string,
  viewArgs?: NavItemDef['viewArgs'],
  placement?: 'O' | 'V',
): NavItemDef =>
  ({ id, label, icon, placement, ...(viewType ? { viewType, ...(viewArgs ? { viewArgs } : {}) } : {}) })

const s = (id: string, label: string, icon: NavSectionDef['icon'], items: NavItemDef[], opts?: Partial<NavSectionDef>): NavSectionDef =>
  ({ id, label, icon, items, ...opts })

export const NAV_SECTIONS: NavSectionDef[] = [

  s('workspace', 'Workspace', HomeIcon, [
    i('ws-home',           'Home',             HomeIcon,       'dashboards',                       undefined, 'V'),
    i('ws-my-work',        'My Work',          CheckIcon,      'mytasks',                          undefined, 'V'),
    i('ws-communications', 'Communications',   MessageIcon,    'messages',                         undefined, 'O'),
    i('ws-calendar',       'Calendar',         CalendarIcon,   'calendar',                         undefined, 'O'),
    i('ws-global-search',  'Global Search',    InboxIcon,      'global-search',                    undefined, 'V'),
    i('ws-kb',             'Knowledge Base',   BookmarkIcon,   'entity', { slug: 'kb-articles' },  'O'),
    i('ws-activity',       'Activity Feed',    ActivityIcon,   'activity-feed',                    undefined, 'V'),
    i('ws-saved',          'Saved Views',      BookmarkIcon,   'saved-views',                      undefined, 'V'),
    i('ws-recent',         'Recent Items',     ClockIcon,      'recent-items',                     undefined, 'V'),
    i('ws-team',           'Team Workspace',   UsersIcon,      'team-workspace',                   undefined, 'V'),
    i('ws-announcements',  'Announcements',    MailIcon,       'entity', { slug: 'announcements' }, 'O'),
  ], { defaultOpen: true }),

  s('work_management', 'Work Management', CheckIcon, [
    i('wm-tasks',    'Tasks',    CheckIcon,      'mytasks',                            undefined, 'O'),
    i('wm-tickets',  'Tickets',  InboxIcon,      'helpdesk',                           undefined, 'O'),
    i('wm-projects', 'Projects', LayersIcon,     'entity', { slug: 'projects' },       'O'),
  ]),

  s('crm', 'CRM & Commercial', UsersIcon, [
    i('crm-pipeline',        'Pipeline',         ArrowRightIcon, 'lead-pipeline',                       undefined, 'O'),
    i('crm-contracts',       'Contracts',        FolderIcon,     'entity', { slug: 'contracts' },       'O'),
    i('crm-customers',       'Customers',        UsersIcon,      'entity', { slug: 'customers' },       'O'),
    i('crm-campaigns',       'Campaigns',        MailIcon,       'entity', { slug: 'campaigns' },       'O'),
    i('crm-sales-channels',  'Sales Channels',   BuildingIcon,   'entity', { slug: 'sales-channels' }, 'O'),
    i('crm-product-catalog', 'Product Catalog',  ArchiveIcon,    'products',                            undefined, 'O'),
  ]),

  s('billing_revenue', 'Billing & Revenue', ReceiptIcon, [
    i('br-tariff-plans',       'Tariff Plans',          BookmarkIcon,   'entity', { slug: 'tariff-plans' },          'O'),
    i('br-billing-accounts',   'Billing Accounts',      BuildingIcon,   'accounts',                                undefined, 'O'),
    i('br-orders-validation',  'Orders & Validation',   ArchiveIcon,    'orders',                                  undefined, 'O'),
    i('br-invoices',           'Invoices',              ReceiptIcon,    'invoices',                                undefined, 'O'),
    i('br-payments',           'Payments',              CreditCardIcon, 'payments',                                undefined, 'O'),
    i('br-collections',        'Collections',           InboxIcon,      'entity', { slug: 'collections' },          'O'),
    i('br-revenue-assurance',  'Revenue Assurance',     ShieldIcon,     'revenue-assurance',                       undefined, 'V'),
  ]),

  s('network_operations', 'Network & Operations', ServerIcon, [
    i('net-noc-dashboard',     'NOC Dashboard',          ChartIcon,      'dashboards',                          undefined, 'V'),
    i('net-monitoring',        'Network Monitoring',     ActivityIcon,   'entity', { slug: 'alarms' },          'O'),
    i('net-incidents',         'Incidents & Outages',    InboxIcon,      'entity', { slug: 'incidents' },       'O'),
    i('net-coverage',          'Coverage & GIS',         ServerIcon,     'coverage-gis',                        undefined, 'O'),
    i('net-topology',          'Network Topology',       ServerIcon,     'network-topology',                    undefined, 'V'),
    i('net-provisioning',      'Provisioning',           GearIcon,       'provisioning',                        undefined, 'V'),
    i('net-service-inventory', 'Service Inventory',      ServerIcon,     'services',                            undefined, 'O'),
    i('net-resource-inv',      'Resource Inventory',     PackageIcon,    'resource-pools',                      undefined, 'O'),
    i('net-asset-mgmt',        'Asset Management',       PackageIcon,    'entity', { slug: 'assets' },          'O'),
    i('net-scheduling',        'Scheduling',             CalendarIcon,   'scheduling',                          undefined, 'V'),
    i('net-dispatch',          'Dispatch Board',         TruckIcon,      'dispatch-board',                      undefined, 'V'),
    i('net-work-orders',       'Work Orders',            RowsIcon,       'entity', { slug: 'work-orders' },     'O'),
    i('net-stock-inventory',   'Stock Inventory',        ArchiveIcon,    'entity', { slug: 'stock-items' },        'O'),
    i('net-warehouses',        'Warehouses',             BuildingIcon,   'entity', { slug: 'warehouses' },      'V'),
  ]),

  s('analytics_ai', 'Analytics & AI', ChartIcon, [
    i('aa-dashboards',         'Dashboards',          ChartIcon,    'dashboards',                  undefined, 'V'),
    i('aa-reports',            'Reports',             BookmarkIcon, 'reports',                     undefined, 'O'),
    i('aa-executive-dashboard','Executive Dashboard', ChartIcon,    'dashboards',                  undefined, 'V'),
    i('aa-ai-insights',        'AI Insights',         SparkleIcon,  'ask',                         undefined, 'O'),
  ]),

  s('enterprise', 'Enterprise', BriefcaseIcon, [
    i('ent-finance',     'Finance',     ChartIcon,    'entity', { slug: 'expenses' },               'V'),
    i('ent-accounting',  'Accounting',  ReceiptIcon,  'invoices',                                 undefined, 'O'),
    i('ent-hr',          'HR',          UsersIcon,    'entity', { slug: 'employees' },           'O'),
    i('ent-procurement', 'Procurement', PackageIcon,  'entity', { slug: 'purchase-orders' },       'O'),
    i('ent-legal',       'Legal',       ShieldIcon,   'entity', { slug: 'contracts' },             'V'),
    i('ent-audit-logs',  'Audit Logs',  ShieldIcon,   'studio',                                  undefined, 'O'),
  ]),

  s('system', 'System', GearIcon, [
    i('sys-users',                 'Users',                 UsersIcon,      'entity', { slug: 'users' }),
    i('sys-roles-permissions',     'Roles & Permissions',   ShieldIcon,     'entity', { slug: 'roles' }),
    i('sys-settings',              'Settings',              GearIcon,       'settings'),
    i('sys-integrations',          'Integrations',          LayersIcon,     'webhooks'),
    i('sys-notifications-config',  'Notifications Config',  MailIcon,       'entity', { slug: 'notification-rules' }),
  ], { adminOnly: true }),

  s('studio', 'Studio', SparkleIcon, [
    i('std-experience',     'Experience',       SparkleIcon, 'studio'),
    i('std-data',           'Data',             LayersIcon,  'studio'),
    i('std-logic',          'Logic',            EditIcon,    'studio'),
    i('std-security',       'Security',         ShieldIcon,  'studio'),
    i('std-intelligence',   'Intelligence',     SparkleIcon, 'studio'),
    i('std-quality',        'Quality',          CheckIcon,   'studio'),
    i('std-release',        'Release',          PackageIcon, 'studio'),
    i('std-governance',     'Governance',       ShieldIcon,  'studio'),
    i('std-system-control', 'System Control',   GearIcon,    'studio'),
    i('std-marketplace',    'Marketplace',      ArchiveIcon, 'studio'),
    i('std-developer',      'Developer',        EditIcon,    'studio'),
    i('std-notifications',  'Notifications',    MailIcon,    'studio'),
    i('std-search',         'Search',           InboxIcon,   'studio'),
    i('std-import-export',  'Import / Export',  ArrowRightIcon, 'studio'),
    i('std-documentation',  'Documentation',    FolderIcon,  'studio'),
  ], { adminOnly: true }),
]
