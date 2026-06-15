// gx-CallsTimeline — today's scheduled calls as a vertical timeline.
// EN: A boxed workspace widget (wrapped in GxWidget) that renders today's touchpoints as a
//     vertical timeline: time (mono, left) · a connector dot riding a vertical line · the contact
//     name · a kind icon (call/meeting/follow-up). Done rows get a success check + a muted,
//     struck-through name. Rows become real <button>s only when onSelect is provided (no dead
//     affordances), keyboard-operable (Enter/Space), with a visible focus ring. Empty → GxWidget
//     empty state. Token-only values; bilingual per §0/L0. Mirrors ActivityTimeline's visual grammar.
// HY: Boxed workspace widget (փաթաթված GxWidget-ով), որ ցույց է տալիս այսօրվա touchpoint-երը՝
//     ուղղահայաց timeline-ով՝ ժամ (mono, ձախ) · connector կետ ուղղահայաց գծի վրա · կոնտակտի
//     անունը · kind icon (call/meeting/follow-up)։ Done տողերը ստանում են success ✓ + խամրած,
//     վրագծված անուն։ Տողերը դառնում են իրական <button> միայն երբ onSelect-ը տրված է (ոչ մի մեռած
//     կոճակ), keyboard-ով գործող (Enter/Space)՝ տեսանելի focus ring-ով։ Դատարկ → GxWidget empty
//     state։ Միայն token-ային արժեքներ; երկլեզու ըստ §0/L0։ Կրկնում է ActivityTimeline-ի քերականությունը։
import { Phone, Users, CornerUpRight, Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { GxWidget } from '../Widget/gx-Widget'
import { t, localeTag } from '../../lib/i18n'
import type { WsCall } from '../../lib/workspace/contract'

export interface GxCallsTimelineProps {
  /** EN: Today's scheduled touchpoints (typed from the workspace contract).
   *  HY: Այսօրվա պլանավորված touchpoint-երը (typed՝ workspace contract-ից): */
  calls: WsCall[]
  /** EN: Optional row handler — passing it turns each row into a keyboard-operable button.
   *      Omit it and rows render as static list items (no dead affordance).
   *  HY: Ընտրովի row handler — տալով՝ ամեն տող դառնում է keyboard-ով գործող button:
   *      Բաց թողնելիս՝ տողերը static list item են (ոչ մի մեռած կոճակ): */
  onSelect?: (id: string) => void
}

// EN: Kind → lucide icon. call=Phone, meeting=Users, followup=CornerUpRight (per the contract enum).
// HY: Kind → lucide icon: call=Phone, meeting=Users, followup=CornerUpRight (ըստ contract enum-ի):
const KIND_ICON: Record<WsCall['kind'], typeof Phone> = {
  call: Phone,
  meeting: Users,
  followup: CornerUpRight,
}

// EN: Kind → bilingual aria label key + English fallback (read by screen readers on the icon).
// HY: Kind → երկլեզու aria label-ի key + անգլերեն fallback (կարդացվում է screen reader-ի կողմից):
const KIND_LABEL: Record<WsCall['kind'], { key: string; en: string }> = {
  call: { key: 'ws.calls.kind.call', en: 'Call' },
  meeting: { key: 'ws.calls.kind.meeting', en: 'Meeting' },
  followup: { key: 'ws.calls.kind.followup', en: 'Follow-up' },
}

// EN: Format an ISO datetime to a short local time (HH:MM); guard malformed input gracefully.
// HY: Ձևակերպել ISO datetime-ը կարճ լոկալ ժամի (HH:MM); սխալ input-ը մշակել անվտանգ:
function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' })
}

export function GxCallsTimeline({ calls, onSelect }: GxCallsTimelineProps) {
  const isEmpty = calls.length === 0

  return (
    <GxWidget
      title={t('ws.calls.title', 'Today’s Calls')}
      icon={<Phone size={14} />}
      count={calls.length}
      state={isEmpty ? 'empty' : 'ok'}
      emptyMessage={t('ws.calls.empty', 'No calls scheduled today.')}
    >
      <ol className="gx-calls-list">
        {calls.map((call) => {
          const Icon = KIND_ICON[call.kind]
          const kindLabel = t(KIND_LABEL[call.kind].key, KIND_LABEL[call.kind].en)
          const done = call.done === true
          const time = formatTime(call.at)

          // EN: Inner content is shared by the button and the static variants (one render path).
          // HY: Ներքին բովանդակությունը կիսում են button-ն ու static տարբերակը (մեկ render ուղի):
          const inner: ReactNode = (
            <>
              <time className="gx-calls-time mono" dateTime={call.at}>
                {time}
              </time>
              <span className="gx-calls-rail" aria-hidden="true">
                <span className={'gx-calls-dot' + (done ? ' is-done' : '')} />
              </span>
              <span className={'gx-calls-name' + (done ? ' is-done' : '')}>{call.name}</span>
              <span className="gx-calls-kind" aria-hidden="true">
                <Icon size={14} />
              </span>
              {done && (
                <span className="gx-calls-check" aria-hidden="true">
                  <Check size={14} />
                </span>
              )}
            </>
          )

          // EN: kind + done state spoken once, so the icon/check stay aria-hidden (no double-read).
          // HY: kind + done state-ը խոսվում է մեկ անգամ, որ icon/check մնան aria-hidden (ոչ կրկնակի):
          const rowLabel = done
            ? t('ws.calls.row.done', '{name}, {kind} at {time}, done')
                .replace('{name}', call.name)
                .replace('{kind}', kindLabel)
                .replace('{time}', time)
            : t('ws.calls.row', '{name}, {kind} at {time}')
                .replace('{name}', call.name)
                .replace('{kind}', kindLabel)
                .replace('{time}', time)

          if (onSelect) {
            return (
              <li key={call.id} className="gx-calls-row">
                <button
                  type="button"
                  className="gx-calls-btn"
                  onClick={() => onSelect(call.id)}
                  aria-label={rowLabel}
                >
                  {inner}
                </button>
              </li>
            )
          }

          return (
            <li key={call.id} className="gx-calls-row gx-calls-row-static" aria-label={rowLabel}>
              {inner}
            </li>
          )
        })}
      </ol>
    </GxWidget>
  )
}
