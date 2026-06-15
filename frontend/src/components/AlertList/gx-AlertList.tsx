// gx-AlertList — workspace alerts list (semantic dot · text · relative time).
// EN: Leaf widget for the working zone. Each row is a severity dot
//     (info/warning/danger → the matching semantic token), the alert text
//     (single-line ellipsis), and a right-aligned relative time computed from
//     the ISO `at`. A `critical` alert opts its dot into the shared .gx-pulse
//     animation (defined once in _workspace.css — never redefined here). Rows
//     are keyboard-operable real <button>s ONLY when onSelect is provided
//     (§7 no dead affordances); otherwise they render as static rows. Empty →
//     GxWidget's own empty state. Token-only colours/sizes (§1).
// HY: Working zone-ի leaf widget։ Ամեն row՝ severity կետ (info/warning/danger →
//     համապատասխան semantic token), alert-ի տեքստ (մեկ տող ellipsis), և աջ
//     հավասարեցված հարաբերական ժամանակ՝ հաշված ISO `at`-ից։ `critical` alert-ի
//     կետը միանում է ընդհանուր .gx-pulse անիմացիային (սահմանված մեկ անգամ
//     _workspace.css-ում — այստեղ չվերասահմանվող)։ Row-երը keyboard-ով գործող
//     իրական <button> են ՄԻԱՅՆ երբ onSelect-ը տրված է (§7), այլապես՝ ստատիկ։
//     Դատարկ → GxWidget-ի empty state։ Միայն token գույներ/չափեր (§1)։
import type { CSSProperties } from 'react'
import { AlertTriangle } from 'lucide-react'
import { t, localeTag } from '../../lib/i18n'
import { GxWidget } from '../Widget/gx-Widget'
import type { WsAlert } from '../../lib/workspace/contract'

export interface GxAlertListProps {
  /** EN: Workspace alerts (typed from the WorkspaceData contract).
   *  HY: Workspace alert-ները (typed WorkspaceData contract-ից): */
  alerts: WsAlert[]
  /** EN: Optional row handler — when present rows become keyboard-operable buttons.
   *  HY: Ընտրովի row handler — երբ կա, row-երը դառնում են keyboard-ով գործող button: */
  onSelect?: (id: string) => void
}

// EN: severity → semantic colour token. One map, no per-row colour logic (§1).
// HY: severity → semantic գույնի token։ Մեկ map, ոչ մի per-row գույնի logic (§1):
const SEVERITY_VAR: Record<WsAlert['severity'], string> = {
  info: 'var(--gx-info)',
  warning: 'var(--gx-warning)',
  danger: 'var(--gx-danger)',
}

// EN: severity → spoken label for the dot's screen-reader text.
// HY: severity → խոսված պիտակ՝ կետի screen-reader տեքստի համար:
const SEVERITY_LABEL: Record<WsAlert['severity'], { key: string; en: string }> = {
  info: { key: 'ws.alerts.sev.info', en: 'Info' },
  warning: { key: 'ws.alerts.sev.warning', en: 'Warning' },
  danger: { key: 'ws.alerts.sev.danger', en: 'Danger' },
}

// EN: Compute a compact relative time from an ISO datetime against now.
//     Returns a localized i18n string ("now", "5m", "3h", "2d", "4w").
// HY: Հաշվում է կոմպակտ հարաբերական ժամանակ ISO datetime-ից ընթացիկ պահի դեմ։
//     Վերադարձնում է localized i18n տող ("now", "5m", "3h", "2d", "4w"):
function relativeTime(at: string): string {
  const then = new Date(at).getTime()
  if (Number.isNaN(then)) return ''
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (diffSec < 60) return t('ws.alerts.time.now', 'now')
  const min = Math.floor(diffSec / 60)
  if (min < 60) return t('ws.alerts.time.minutes', '{n}m').replace('{n}', String(min))
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('ws.alerts.time.hours', '{n}h').replace('{n}', String(hr))
  const day = Math.floor(hr / 24)
  if (day < 7) return t('ws.alerts.time.days', '{n}d').replace('{n}', String(day))
  const wk = Math.floor(day / 7)
  return t('ws.alerts.time.weeks', '{n}w').replace('{n}', String(wk))
}

// EN: Absolute timestamp for the title/aria — full localized datetime tooltip.
// HY: Բացարձակ timestamp title/aria-ի համար — լրիվ localized datetime tooltip:
function absoluteTime(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(localeTag())
}

export function GxAlertList({ alerts, onSelect }: GxAlertListProps) {
  const interactive = Boolean(onSelect)
  return (
    <GxWidget
      title={t('ws.alerts.title', 'Alerts')}
      icon={<AlertTriangle size={14} />}
      count={alerts.length}
      state={alerts.length === 0 ? 'empty' : 'ok'}
      emptyMessage={t('ws.alerts.empty', 'No alerts right now.')}
    >
      <ul className="gx-alert-list">
        {alerts.map((alert) => {
          const sev = SEVERITY_LABEL[alert.severity]
          // EN: dot carries severity colour via the token map; critical adds .gx-pulse.
          // HY: կետը կրում է severity գույնը token map-ով, critical-ը ավելացնում է .gx-pulse:
          const dotCls = ['gx-alert-dot', alert.critical ? 'gx-pulse' : '']
            .filter(Boolean)
            .join(' ')
          const dot = (
            <span
              className={dotCls}
              style={{ '--gx-alert-dot-color': SEVERITY_VAR[alert.severity] } as CSSProperties}
              aria-hidden="true"
            />
          )
          const sevLabel = t(sev.key, sev.en)
          const rel = relativeTime(alert.at)
          const time = (
            <time className="gx-alert-time" dateTime={alert.at} title={absoluteTime(alert.at)}>
              {rel}
            </time>
          )

          if (interactive) {
            return (
              <li key={alert.id} className="gx-alert-row-li">
                <button
                  type="button"
                  className="gx-alert-row gx-alert-row-btn"
                  onClick={() => onSelect?.(alert.id)}
                  aria-label={`${sevLabel}: ${alert.text}`}
                >
                  {dot}
                  <span className="gx-alert-text">{alert.text}</span>
                  {time}
                </button>
              </li>
            )
          }

          return (
            <li key={alert.id} className="gx-alert-row">
              {dot}
              <span className="gx-alert-text">{alert.text}</span>
              {time}
            </li>
          )
        })}
      </ul>
    </GxWidget>
  )
}
