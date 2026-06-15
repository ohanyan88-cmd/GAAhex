// gx-Standings — full-width team standings strip, ranked.
// EN: One leaf widget for the workspace "Team Standings" zone. A ranked strip of rows sorted by
//     rank ascending, with longest-wins aligned numeric columns (conversion % · revenue) and a
//     horizontal performance bar. Rank 1 wears the ONE gold accent per view (§ gold spent once):
//     gold rank badge + gold bar fill; everyone else is muted slate. Chrome (header · states) is
//     owned by GxWidget; this file is purely presentational and data-driven via props (§ one-source).
// HY: «Թիմի վարկանիշ» zone-ի մեկ leaf widget։ Վարկանիշով դասավորված շերտ՝ ըստ rank-ի աճման, longest-wins
//     հավասարեցված թվային սյունակներով (conversion % · revenue) և հորիզոնական performance bar-ով։
//     #1 տեղը կրում է view-ի միակ ոսկե շեշտը (ոսկին ծախսվում է մեկ անգամ)՝ ոսկե badge + ոսկե fill;
//     մնացածը՝ մարված slate։ Chrome-ը (header · states) պատկանում է GxWidget-ին; այս ֆայլը զուտ
//     presentational է ու data-driven props-ով (մեկ source)։
import type { WsStanding } from '../../lib/workspace/contract'
import { GxWidget } from '../Widget/gx-Widget'
import { Trophy } from 'lucide-react'
import { t } from '../../lib/i18n'

export interface GxStandingsProps {
  /** EN: Ranked team rows (contract type). HY: Վարկանիշով թիմի տողերը (contract type)։ */
  team: WsStanding[]
  /** EN: Row click/keyboard select — renders rows as buttons only when provided.
   *  HY: Տողի սեղմում/keyboard ընտրություն — տողերը button են դառնում միայն երբ տրված է։ */
  onSelect?: (name: string) => void
}

// EN: Initials for the avatar — first letters of up to two name words, uppercased.
// HY: Avatar-ի սկզբնատառերը — մինչև երկու բառի առաջին տառերը, մեծատառ։
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function GxStandings({ team, onSelect }: GxStandingsProps) {
  // EN: Sort by rank ascending without mutating the caller's array (§ pure/presentational).
  // HY: Դասավորում են ըստ rank-ի աճման՝ caller-ի array-ն չփոխելով (զուտ presentational)։
  const rows = [...team].sort((a, b) => a.rank - b.rank)
  const empty = rows.length === 0

  return (
    <GxWidget
      span="full"
      title={t('ws.team.title', 'Team Standings')}
      icon={<Trophy size={16} aria-hidden="true" />}
      count={empty ? undefined : rows.length}
      state={empty ? 'empty' : 'ok'}
      emptyMessage={t('ws.team.empty', 'No standings to show yet.')}
    >
      <ol className="gx-stand-list">
        {rows.map((row) => {
          const peak = row.rank === 1
          const label = t(
            'ws.team.rowAria',
            '{name}: rank {rank}, {conv}% conversion, revenue {rev}',
          )
            .replace('{name}', row.name)
            .replace('{rank}', String(row.rank))
            .replace('{conv}', String(row.conversion))
            .replace('{rev}', String(row.revenue))
          const pct = Math.max(0, Math.min(100, row.barPct))

          // EN: Inner row content is identical whether interactive or static — share it.
          // HY: Տողի ներքին բովանդակությունը նույնն է interactive թե static — կիսում ենք։
          const content = (
            <>
              <span
                className={`gx-stand-rank${peak ? ' gx-stand-rank-peak' : ''}`}
                aria-hidden="true"
              >
                {row.rank}
              </span>
              <span className="gx-stand-avatar" aria-hidden="true">
                {initials(row.name)}
              </span>
              <span className="gx-stand-name">{row.name}</span>
              <span className="gx-stand-metric gx-stand-conv gx-numeric">
                {t('ws.team.convFmt', '{v}%').replace('{v}', String(row.conversion))}
              </span>
              <span className="gx-stand-metric gx-stand-rev gx-numeric">
                {row.revenue.toLocaleString()}
              </span>
              <span className="gx-stand-bar" aria-hidden="true">
                <span
                  className={`gx-stand-bar-fill${peak ? ' gx-stand-bar-fill-peak' : ''}`}
                  style={{ width: `${pct}%` }}
                />
              </span>
            </>
          )

          return (
            <li key={`${row.rank}-${row.name}`} className="gx-stand-row-wrap">
              {onSelect ? (
                <button
                  type="button"
                  className={`gx-stand-row gx-stand-row-interactive${peak ? ' gx-stand-row-peak' : ''}`}
                  onClick={() => onSelect(row.name)}
                  aria-label={label}
                >
                  {content}
                </button>
              ) : (
                <div className={`gx-stand-row${peak ? ' gx-stand-row-peak' : ''}`}>{content}</div>
              )}
            </li>
          )
        })}
      </ol>
    </GxWidget>
  )
}
