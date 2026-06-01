// MasterLayoutDemoView — reference implementation of the 4-Zone Master Layout API
// plus the LeftNav. Proves the contract end-to-end:
//
//   - LeftNav owns the left column (240px / 56px rail, Zone-0 toggle drives state)
//   - Zone 0 owns the global top bar (toggle + search + bell + profile)
//   - Zone 1 / Zone 2 / Zone 3 are slot-driven from the page
//
// Use this as the copy-paste template for every real page from now on.
import { useState } from 'react'
import {
  MasterLayout,
  PageHeaderSlot,
  TabsSlot,
  MainSlot,
  SidecarSlot,
  type NavConfig,
} from '../layout'
import {
  HomeIcon, CheckIcon, UsersIcon, MessageIcon, CalendarIcon,
  InboxIcon, ArrowRightIcon, MailIcon,
} from '../components/icons'
import { Plus, Save } from 'lucide-react'

export interface MasterLayoutDemoViewProps {
  tenantInitials: string
  tenantName:     string
  userInitials:   string
  userName:       string
  userRole:       string
  onExit?: () => void
}

export default function MasterLayoutDemoView(props: MasterLayoutDemoViewProps) {
  const [tab, setTab] = useState<'overview' | 'activity' | 'audit'>('overview')
  const [activeNav, setActiveNav] = useState<string>('ws-home')

  // Hard-coded WORKSPACE + CRM per Gev's spec (2026-06-01). Items match nav-config exactly.
  const nav: NavConfig = {
    brand: { initials: props.tenantInitials, name: props.tenantName },
    activeId: activeNav,
    onItemClick: (id) => setActiveNav(id),
    sections: [
      {
        id: 'workspace', label: 'WORKSPACE',
        items: [
          { id: 'ws-home',           label: 'Home',           icon: HomeIcon },
          { id: 'ws-my-work',        label: 'My Work',        icon: CheckIcon, badge: 4 },
          { id: 'ws-team',           label: 'Team Workspace', icon: UsersIcon },
          { id: 'ws-communications', label: 'Communications', icon: MessageIcon },
          { id: 'ws-calendar',       label: 'Calendar',       icon: CalendarIcon },
        ],
      },
      {
        id: 'crm', label: 'CRM',
        items: [
          { id: 'crm-leads',     label: 'Leads',     icon: InboxIcon, badge: 12 },
          { id: 'crm-pipeline',  label: 'Pipeline',  icon: ArrowRightIcon },
          { id: 'crm-customers', label: 'Customers', icon: UsersIcon },
          { id: 'crm-campaigns', label: 'Campaigns', icon: MailIcon },
        ],
      },
    ],
  }

  return (
    <MasterLayout
      nav={nav}
      zone0={{
        tenantInitials:    props.tenantInitials,
        tenantName:        props.tenantName,
        userInitials:      props.userInitials,
        userName:          props.userName,
        userRole:          props.userRole,
        notificationCount: 3,
      }}
    >
      <PageHeaderSlot
        title="Master Layout Demo"
        identityTag="DEMO-001"
        statusBadge={{ label: 'Live', variant: 'success' }}
        back={props.onExit}
        actions={[
          { label: 'Save',    onClick: () => {}, variant: 'secondary', icon: <Save size={14} /> },
          { label: 'Create',  onClick: () => {}, variant: 'primary',   icon: <Plus size={14} /> },
        ]}
      />

      <TabsSlot
        activeKey={tab}
        onChange={(k) => setTab(k as typeof tab)}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'activity', label: 'Activity', badge: 4 },
          { key: 'audit',    label: 'Audit Trail' },
        ]}
      />

      <MainSlot>
        <DemoMainPanel tab={tab} activeNav={activeNav} />
      </MainSlot>

      <SidecarSlot>
        <DemoSidecarPanel />
      </SidecarSlot>
    </MasterLayout>
  )
}

function DemoMainPanel({ tab, activeNav }: { tab: 'overview' | 'activity' | 'audit'; activeNav: string }) {
  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: 10,
      padding: 20,
      boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.06em', marginBottom: 12 }}>
        Zone 3 — Main · nav: {activeNav} · tab: {tab}
      </div>

      {tab === 'overview' && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px', color: '#0f172a' }}>
            Try the controls.
          </h2>
          <ul style={{ fontSize: 13, lineHeight: 1.7, color: '#475569', margin: 0, paddingLeft: 18 }}>
            <li>Hamburger in Zone 0 toggles the LeftNav between 240px and 56px rail.</li>
            <li>Zones 1/2/3 reflow automatically — no horizontal cut-off.</li>
            <li>Click items in the LeftNav: active state highlights, page header tracks the selection.</li>
            <li>Switch tabs above — the sidecar on the right stays mounted across tab changes.</li>
          </ul>
        </>
      )}

      {tab === 'activity' && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: '#0f172a' }}>Recent activity</h2>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {[
              { who: 'System',     what: 'Provisioned the demo workspace', when: 'just now' },
              { who: 'Demo Admin', what: 'Opened the layout sample page',  when: '2 min ago' },
              { who: 'Demo Admin', what: 'Toggled the LeftNav rail',       when: 'a moment ago' },
            ].map((row, i) => (
              <li key={i} style={{ padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid #f1f5f9', fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>{row.who}</span>
                <span style={{ color: '#475569' }}> {row.what}</span>
                <span style={{ color: '#94a3b8', float: 'right' }}>{row.when}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'audit' && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: '#0f172a' }}>Audit trail (demo)</h2>
          <pre style={{
            margin: 0,
            background: '#0f172a',
            color: '#cbd5e1',
            padding: 14,
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.55,
            fontFamily: 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Menlo, Consolas, monospace',
            overflowX: 'auto',
          }}>
{`2026-06-01T08:00:00Z  page.opened     actor=demo-admin
2026-06-01T08:00:04Z  nav.toggled     state=rail
2026-06-01T08:00:09Z  nav.itemClick   id=${activeNav}`}
          </pre>
        </>
      )}
    </div>
  )
}

function DemoSidecarPanel() {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.06em', marginBottom: 12 }}>
        Zone 3 — Sidecar (persistent)
      </div>

      <div style={{
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: 14,
        marginBottom: 14,
      }}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Entity</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>Demo Record</div>
        <div style={{ fontSize: 12, color: '#475569', marginTop: 4, fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace' }}>
          DEMO-001
        </div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8 }}>Quick facts</div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 13, color: '#0f172a' }}>
        {[
          ['Status',        'Live'],
          ['Created',       '2026-06-01'],
          ['Owner',         'Demo Admin'],
          ['Last activity', 'just now'],
        ].map(([k, v]) => (
          <li key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #f1f5f9' }}>
            <span style={{ color: '#64748b' }}>{k}</span>
            <span style={{ fontWeight: 500 }}>{v}</span>
          </li>
        ))}
      </ul>

      <p style={{ marginTop: 16, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
        Try switching tabs in Zone 2 — this panel does NOT remount. Scroll position
        and any open inputs survive the tab change. That's the persistence contract.
      </p>
    </div>
  )
}
