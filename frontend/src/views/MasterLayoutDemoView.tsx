// MasterLayoutDemoView — reference implementation of the 4-Zone Master Layout API.
//
// This page exists ONLY to prove the contract:
//   - Zone 0 is owned by MasterLayout (page passes props for tenant + user identity)
//   - Zone 1 is published via <PageHeaderSlot />
//   - Zone 2 is published via <TabsSlot />
//   - Zone 3 Left is published via <MainSlot>
//   - Zone 3 Right is published via <SidecarSlot>
//
// Use this as the copy-paste template for every real page from this point forward.
// If a page needs something the zones don't expose, the right answer is to extend
// the slot API — never to bypass the layout.
import { useState } from 'react'
import {
  MasterLayout,
  PageHeaderSlot,
  TabsSlot,
  MainSlot,
  SidecarSlot,
} from '../layout'
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

  return (
    <MasterLayout
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
        <DemoMainPanel tab={tab} />
      </MainSlot>

      <SidecarSlot>
        <DemoSidecarPanel />
      </SidecarSlot>
    </MasterLayout>
  )
}

function DemoMainPanel({ tab }: { tab: 'overview' | 'activity' | 'audit' }) {
  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: 10,
      padding: 20,
      boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.06em', marginBottom: 12 }}>
        Zone 3 — Main · tab: {tab}
      </div>

      {tab === 'overview' && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px', color: '#0f172a' }}>
            This is the main workspace panel.
          </h2>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: '#475569', margin: 0 }}>
            It re-renders when you click a different tab above. The sidecar on the right
            stays mounted across tab switches — that's the persistence contract.
          </p>
        </>
      )}

      {tab === 'activity' && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: '#0f172a' }}>Recent activity</h2>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {[
              { who: 'System',    what: 'Provisioned the demo workspace', when: 'just now' },
              { who: 'Demo Admin', what: 'Opened the layout sample page',  when: '2 min ago' },
              { who: 'Demo Admin', what: 'Switched to tab "Activity"',     when: 'a moment ago' },
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
{`2026-06-01T08:00:00Z  page.opened          actor=demo-admin
2026-06-01T08:00:04Z  tab.switched         from=overview to=activity
2026-06-01T08:00:09Z  tab.switched         from=activity to=audit`}
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
