// gx-QueueWidget — the priority lead queue.
// EN: A boxed workspace widget listing leads by priority. Each row is avatar (initials) · name ·
//     source chip (REUSED GxStatusBadge primitive) · next-action · score. When onSelect is given the
//     whole row becomes a keyboard-operable button (Enter/Space, visible focus); otherwise it is a
//     plain row (never a dead button — §7). Empty list defers to GxWidget's empty state. Tokens-only.
// HY: Boxed workspace widget, որ թվարկում է lead-երը ըստ առաջնահերթության։ Ամեն row՝ avatar (initials) ·
//     անուն · source chip (ՎԵՐՕԳՏԱԳՈՐԾՎԱԾ GxStatusBadge primitive) · հաջորդ քայլ · միավոր։ Երբ onSelect
//     կա՝ ամբողջ row-ը դառնում է ստեղնաշարով կառավարվող button (Enter/Space, տեսանելի focus); հակառակ
//     դեպքում՝ պարզ row (երբեք մեռած button — §7)։ Դատարկ list-ը հանձնվում է GxWidget-ի empty state-ին։
import { ListChecks } from 'lucide-react'
import { GxWidget } from '../Widget/gx-Widget'
import { GxStatusBadge } from '../../primitives'
import { initials } from '../../lib/humanize'
import { t } from '../../lib/i18n'
import type { WsQueueItem } from '../../lib/workspace/contract'

export interface GxQueueWidgetProps {
  /** EN: Priority-ordered lead rows (typed from the workspace contract).
   *  HY: Առաջնահերթությամբ դասավորված lead row-երը (workspace contract-ից typed)։ */
  items: WsQueueItem[]
  /** EN: Optional row handler — when present, each row is a keyboard-operable button.
   *  HY: Ընտրովի row handler — երբ կա, ամեն row ստեղնաշարով կառավարվող button է։ */
  onSelect?: (id: string) => void
}

// EN: One row of the queue. The avatar/name/source/next-action/score layout is identical whether the
//     row is interactive or static; only the wrapping element (button vs div) and a11y attrs differ.
// HY: Queue-ի մեկ row։ avatar/name/source/next-action/score դասավորությունը նույնն է՝ interactive թե
//     static; տարբերվում է միայն փաթաթող element-ը (button vs div) ու a11y atribut-ները։
function QueueRowBody({ item }: { item: WsQueueItem }) {
  return (
    <>
      <span className="gx-queue-avatar" aria-hidden="true">
        {initials(item.name)}
      </span>
      <span className="gx-queue-name">{item.name}</span>
      <GxStatusBadge variant={item.sourceTone} label={item.source} size="sm" />
      <span className="gx-queue-next">{item.nextAction}</span>
      <span className="gx-queue-score gx-numeric">{item.score}</span>
    </>
  )
}

export function GxQueueWidget({ items, onSelect }: GxQueueWidgetProps) {
  return (
    <GxWidget
      title={t('ws.queue.title', 'Priority Queue')}
      icon={<ListChecks size={16} />}
      count={items.length}
      state={items.length === 0 ? 'empty' : 'ok'}
      emptyMessage={t('ws.queue.empty', 'No leads in the priority queue.')}
    >
      <ul className="gx-queue-list">
        {items.map((item) =>
          onSelect ? (
            <li key={item.id}>
              {/* EN: Real <button> — Enter/Space activate it natively; aria-label names the lead + score.
                  HY: Իրական <button> — Enter/Space-ը բնականաբար ակտիվացնում են; aria-label-ը անվանում է lead-ը + միավորը։ */}
              <button
                type="button"
                className="gx-queue-row gx-queue-row-btn"
                onClick={() => onSelect(item.id)}
                aria-label={t('ws.queue.selectLead', 'Open lead {name}, score {score}')
                  .replace('{name}', item.name)
                  .replace('{score}', String(item.score))}
              >
                <QueueRowBody item={item} />
              </button>
            </li>
          ) : (
            <li key={item.id} className="gx-queue-row">
              <QueueRowBody item={item} />
            </li>
          ),
        )}
      </ul>
    </GxWidget>
  )
}
