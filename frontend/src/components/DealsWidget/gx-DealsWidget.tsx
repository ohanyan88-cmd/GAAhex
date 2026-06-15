// gx-DealsWidget — deals waiting, rendered as action cards (the inner card is the "deal card").
// EN: A boxed workspace widget that lists the deals waiting on action. Chrome is owned by gx-Widget
//     (header · count · the four data states); each row is a self-contained "deal card": name
//     (semibold) · value (tabular figures, right-aligned, longest-wins column) · stage chip (REUSED
//     GxStatusBadge) · "waiting for: …" line (muted) · human age. The primary "Open" button is
//     rendered ONLY when onOpen is supplied — permission is the caller's responsibility, never a
//     dead button (§7). Presentational only: data arrives typed from the workspace contract.
// HY: Boxed workspace widget, որ ցուցակում է գործողության սպասող deal-երը։ Chrome-ը պատկանում է
//     gx-Widget-ին (header · count · չորս data state)։ Ամեն row ինքնաբավ "deal card" է՝ անունը
//     (semibold) · արժեքը (tabular թվեր, աջ հավասարեցված, longest-wins սյունակ) · stage chip
//     (ՎԵՐՕԳՏԱԳՈՐԾՎԱԾ GxStatusBadge) · "waiting for: …" տողը (muted) · մարդկային age։ Primary "Open"
//     կոճակը render-վում է ՄԻԱՅՆ երբ onOpen-ը տրված է — թույլտվությունը caller-ի պատասխանատվությունն է,
//     երբեք dead button (§7)։ Միայն presentational. data-ն գալիս է typed workspace contract-ից։
import { Handshake } from 'lucide-react'
import type { WsDeal } from '../../lib/workspace/contract'
import { GxWidget } from '../Widget/gx-Widget'
import { GxStatusBadge } from '../../primitives'
import { number } from '../../lib/format'
import { t } from '../../lib/i18n'

export interface GxDealsWidgetProps {
  /** EN: Deals waiting on action (typed from the workspace contract).
   *  HY: Գործողության սպասող deal-երը (typed workspace contract-ից)։ */
  deals: WsDeal[]
  /** EN: Optional open handler — when present, each card shows a primary "Open" button (azure).
   *      Omit to render read-only cards (no dead button) (§7).
   *  HY: Ընտրովի open handler — երբ կա, ամեն card-ը ցույց է տալիս primary "Open" կոճակ (azure)։
   *      Բացակայության դեպքում card-երը read-only են (ոչ մի dead button) (§7)։ */
  onOpen?: (id: string) => void
}

/**
 * EN: GxDealsWidget — the "Deals Waiting" workspace card.
 * HY: GxDealsWidget — "Deals Waiting" workspace card-ը։
 */
export function GxDealsWidget({ deals, onOpen }: GxDealsWidgetProps) {
  return (
    <GxWidget
      title={t('ws.deals.title', 'Deals Waiting')}
      count={deals.length}
      icon={<Handshake size={14} aria-hidden="true" />}
      state={deals.length === 0 ? 'empty' : 'ok'}
      emptyMessage={t('ws.deals.empty', 'No deals waiting.')}
    >
      <ul className="gx-deal-list">
        {deals.map((deal) => (
          <li key={deal.id} className="gx-deal-card">
            <div className="gx-deal-row">
              <span className="gx-deal-name">{deal.name}</span>
              <span className="gx-deal-value">
                {number(deal.value)} {t('ws.deals.currency', '֏')}
              </span>
            </div>
            <div className="gx-deal-meta">
              <GxStatusBadge variant="info" label={deal.stage} size="sm" />
              <span className="gx-deal-waiting">
                {t('ws.deals.waitingFor', 'waiting for:')}{' '}
                <span className="gx-deal-waiting-val">{deal.waitingFor}</span>
              </span>
              <span className="gx-deal-spacer" />
              <span className="gx-deal-age">{deal.age}</span>
              {onOpen && (
                <button
                  type="button"
                  className="gx-deal-open"
                  onClick={() => onOpen(deal.id)}
                  aria-label={t('ws.deals.openAria', 'Open deal {name}').replace(
                    '{name}',
                    deal.name,
                  )}
                >
                  {t('ws.deals.open', 'Open')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </GxWidget>
  )
}
