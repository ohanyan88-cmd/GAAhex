// Pipeline page — split into THREE views per the ISP workflow model:
//
//   1. Sales Pipeline       — sales-owned acquisition (LEAD → CONTRACT SIGNED)
//   2. Customer Lifecycle   — full end-to-end journey (14 stages, cross-department)
//   3. Service Delivery     — post-contract delivery (ORDER → MONITORING, with owner per stage)
//
// Tab 1 wraps the existing kanban (LeadPipelineView) — live data, no behavior change.
// Tabs 2 & 3 are read-only visualization of stages + owners + control gates. They
// do NOT invent fake data; they show stage structure + meta only, with placeholder
// counts/cards that the real workflow engine will fill once it ships.
import { useState } from 'react'
import { type Capabilities, FULL_ACCESS } from '../lib/capabilities'
import LeadPipelineView from './LeadPipelineView'
import {
  LIFECYCLE_STAGES, SALES_PIPELINE_STAGES, SERVICE_DELIVERY_STAGES,
  CONTROL_GATE_DEFINITIONS, type LifecycleStage,
} from '../lib/lifecycle'
import { ArrowRightIcon, UsersIcon, LayersIcon, TruckIcon } from '../components/icons'
import { PageShell } from '../page-shell'
import { DetailTab } from '../primitives'  // TB-1 — canonical detail-tab primitive

type PipelineTab = 'sales' | 'lifecycle' | 'delivery'

interface PipelineViewProps {
  token:        string
  onOpenCustomer?: (id: string) => void
  canConfigure?: boolean
  onConfigure?: () => void
  capabilities?: Capabilities
}

export default function PipelineView(props: PipelineViewProps) {
  const [tab, setTab] = useState<PipelineTab>('sales')

  return (
    <PageShell
      type="PIPELINE"
      breadcrumb={['CRM', 'Pipeline']}
      icon={<ArrowRightIcon size={18} />}
      title="Pipeline"
      subtitle="Sales Pipeline · Customer Lifecycle · Service Delivery"
    >
      {/* Three-pipeline tab bar */}
      <div
        role="tablist"
        aria-label="Pipeline views"
        style={{
          display: 'flex',
          gap: 'var(--gx-space-2)',
          borderBottom: '1px solid var(--gx-border)',
          marginBottom: 'var(--gx-space-5)',
          paddingBottom: 0,
        }}
      >
        <TabButton active={tab === 'sales'}     onClick={() => setTab('sales')}
          icon={<ArrowRightIcon size={14} />} label="Sales Pipeline"
          sub="LEAD → CONTRACT SIGNED · Sales-owned" />
        <TabButton active={tab === 'lifecycle'} onClick={() => setTab('lifecycle')}
          icon={<LayersIcon size={14} />} label="Customer Lifecycle"
          sub="LEAD → MONITORING · Cross Department" />
        <TabButton active={tab === 'delivery'}  onClick={() => setTab('delivery')}
          icon={<TruckIcon size={14} />} label="Service Delivery Pipeline"
          sub="ORDER CREATED → MONITORING · Post-contract" />
      </div>

      {tab === 'sales' && (
        <LeadPipelineView {...props} embedded />
      )}

      {tab === 'lifecycle' && (
        <StageBoard
          title="Customer Lifecycle"
          owner="Cross Department"
          description="Full end-to-end customer/service lifecycle. For management — shows the complete journey from initial lead through active service monitoring."
          stages={LIFECYCLE_STAGES}
        />
      )}

      {tab === 'delivery' && (
        <StageBoard
          title="Service Delivery Pipeline"
          owner="Cross Department"
          description="Post-contract delivery and activation pipeline. Each stage names the owning department; cards will surface assigned user + SLA + blocked-reason metadata once the workflow engine ships."
          stages={SERVICE_DELIVERY_STAGES}
        />
      )}
    </PageShell>
  )
}

// TB-1 — local TabButton delegates to the canonical `DetailTab` primitive.
function TabButton(props: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; sub: string }) {
  return (
    <DetailTab active={props.active} onSelect={props.onClick} icon={props.icon} subtitle={props.sub}>
      {props.label}
    </DetailTab>
  )
}

function StageBoard({ title, owner, description, stages }: { title: string; owner: string; description: string; stages: LifecycleStage[] }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--gx-space-5)', marginBottom: 'var(--gx-space-3)' }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 'var(--gx-text-xl)', fontWeight: 600 }}>{title}</h2>
          <div style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>
            <UsersIcon size={12} /> Owner: <strong style={{ color: 'var(--gx-text-2)' }}>{owner}</strong>
          </div>
        </div>
      </div>
      <p style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-3)', maxWidth: 720, marginTop: 0, marginBottom: 'var(--gx-space-18)' }}>
        {description}
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(stages.length, 5)}, minmax(180px, 1fr))`,
          gap: 'var(--gx-space-4)',
          marginBottom: 'var(--gx-space-7)',
          overflowX: 'auto',
        }}
      >
        {stages.map((s, i) => (
          <StageCard key={s.key} stage={s} index={i} />
        ))}
      </div>

      <div style={{
        background: 'var(--gx-bg-subtle)',
        border: '1px solid var(--gx-border)',
        borderRadius: 'var(--gx-radius-lg, 12px)',
        padding: 'var(--gx-space-5)',
      }}>
        <div style={{ fontSize: 'var(--gx-text-sm)', fontWeight: 600, textTransform: 'uppercase', color: 'var(--gx-text-3)', letterSpacing: '0.06em', marginBottom: 'var(--gx-space-5)' }}>
          Control gates referenced in this pipeline
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--gx-space-6)' }}>
          {uniqueGates(stages).map((gate) => (
            <div key={gate} style={{
              background: 'var(--gx-surface)',
              border: '1px solid var(--gx-border)',
              borderRadius: 'var(--gx-radius-md)', padding: 'var(--gx-space-4)',
            }}>
              <div style={{ fontSize: 'var(--gx-text-13)', fontWeight: 600, color: 'var(--gx-text-1)', marginBottom: 'var(--gx-space-2)' }}>{gate}</div>
              <div style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)', lineHeight: 1.5 }}>
                {CONTROL_GATE_DEFINITIONS[gate]}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StageCard({ stage, index }: { stage: LifecycleStage; index: number }) {
  return (
    <div
      style={{
        background: 'var(--gx-surface)',
        border: '1px solid var(--gx-border)',
        borderRadius: 10,
        padding: 'var(--gx-space-4)',
        minHeight: 140,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--gx-space-3)',
      }}
    >
      <div style={{
        position: 'absolute', top: 'var(--gx-space-4)', right: 'var(--gx-space-5)',
        fontSize: 'var(--gx-text-10)', fontWeight: 700,
        color: 'var(--gx-text-3)',
        fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
      }}>
        #{index + 1}
      </div>
      <div style={{ fontSize: 'var(--gx-text-13)', fontWeight: 600, color: 'var(--gx-text-1)', paddingRight: 'var(--gx-space-12)' }}>
        {stage.label}
      </div>
      <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>
        Owner: <strong style={{ color: 'var(--gx-text-2)' }}>{stage.owner}</strong>
      </div>
      {stage.supporting.length > 0 && (
        <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>
          Supporting: <span style={{ color: 'var(--gx-text-2)' }}>{stage.supporting.join(', ')}</span>
        </div>
      )}
      {stage.gate && (
        <div style={{ marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-2)' }}>
          <span style={{
            display: 'inline-block',
            padding: '2px 7px',
            background: 'var(--gx-bg-subtle)',
            color: 'var(--gx-text-2)',
            border: '1px solid var(--gx-border)',
            borderRadius: 999,
            fontSize: 'var(--gx-text-10)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            {stage.gate}
          </span>
        </div>
      )}
      <div style={{ marginTop: stage.gate ? 6 : 'auto', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', fontStyle: 'italic' }}>
        No assignments yet
      </div>
    </div>
  )
}

function uniqueGates(stages: LifecycleStage[]) {
  const seen: string[] = []
  for (const s of stages) {
    if (s.gate && !seen.includes(s.gate)) seen.push(s.gate)
  }
  return seen as (keyof typeof CONTROL_GATE_DEFINITIONS)[]
}
