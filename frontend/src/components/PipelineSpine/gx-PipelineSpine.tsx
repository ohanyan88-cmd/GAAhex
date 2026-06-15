// gx-PipelineSpine — the signature 13-stage Lead→Customer distribution spine.
// EN: One horizontal row of equal-width vertical bars (§4 longest-wins: every stage slot is the
//     same width, no matter the label). Bar height is proportional to count/max against a shared
//     track. Tone drives colour: 'default' slate (90% of bars), 'active' AZURE (the Deal stage,
//     the drilled/selected series), 'peak' GOLD (the Activation stage — the one look-here datum,
//     gold spent once per view). Count sits above each bar in tabular figures; the stage label sits
//     below, truncated with ellipsis so it never wrap-breaks the row. When onStageClick is given each
//     bar becomes a real keyboard-operable <button>; otherwise the spine is purely presentational.
//     Empty stages array → GxWidget's empty state. Tokens only, no raw hex/px (§ pure repo).
// HY: Մեկ հորիզոնական շարք՝ հավասար լայնքի ուղղահայաց սյուներ (§4 longest-wins՝ ամեն stage slot նույն
//     լայնքն ունի՝ անկախ label-ից)։ Սյան բարձրությունը համեմատական է count/max-ին՝ ընդհանուր track-ի
//     նկատմամբ։ Tone-ը որոշում է գույնը՝ 'default' slate (սյուների 90%-ը), 'active' AZURE (Deal stage-ը՝
//     ընտրված/drill արված շարքը), 'peak' GOLD (Activation stage-ը՝ միակ look-here datum-ը, gold-ը
//     ծախսվում է մեկ անգամ)։ Count-ը սյան վերևում՝ tabular figures-ով, stage label-ը՝ ներքևում,
//     truncate ellipsis-ով՝ որ երբեք շարքը չկոտրի։ Երբ onStageClick կա՝ ամեն սյուն դառնում է իրական
//     ստեղնաշարով կառավարվող <button>, հակառակ դեպքում spine-ը զուտ presentational է։
//     Դատարկ stages → GxWidget-ի empty state։ Միայն token, ոչ մի raw hex/px (§ pure repo)։
import type { CSSProperties } from 'react'
import { GitBranch } from 'lucide-react'
import type { WsPipelineStage } from '../../lib/workspace/contract'
import { GxWidget } from '../Widget/gx-Widget'
import { t } from '../../lib/i18n'

export interface GxPipelineSpineProps {
  /** EN: The 13-stage pipeline distribution (contract-typed).
   *  HY: 13-stage pipeline distribution-ը (contract-ից typed): */
  stages: WsPipelineStage[]
  /** EN: Optional drill handler — when present every bar is a keyboard-operable button.
   *  HY: Ընտրովի drill handler — երբ կա, ամեն սյուն ստեղնաշարով կառավարվող button է: */
  onStageClick?: (key: string) => void
}

// EN: Tone → bar colour CSS class. One map — no per-bar inline colour logic (§ tokens only).
// HY: Tone → սյան գույնի CSS class: Մեկ map — ոչ մի per-bar inline color logic (§ միայն token):
const TONE_CLASS: Record<WsPipelineStage['tone'], string> = {
  default: 'gx-pipe-bar-default',
  active: 'gx-pipe-bar-active',
  peak: 'gx-pipe-bar-peak',
}

export function GxPipelineSpine({ stages, onStageClick }: GxPipelineSpineProps) {
  // EN: Empty → hand GxWidget the empty state; never render an axis with no data.
  // HY: Դատարկ → GxWidget-ին տալ empty state, երբեք չցուցադրել առանց data առանցք:
  const isEmpty = stages.length === 0

  // EN: Longest-wins height: every bar is a fraction of the tallest stage (guard divide-by-zero).
  // HY: Longest-wins բարձրություն՝ ամեն սյուն ամենաբարձր stage-ի մասն է (պաշտպանված 0-ի բաժանումից):
  const max = stages.reduce((m, s) => (s.count > m ? s.count : m), 0)

  const interactive = typeof onStageClick === 'function'

  return (
    <GxWidget
      span="full"
      title={t('ws.pipeline.title', 'Pipeline')}
      icon={<GitBranch size={14} />}
      count={isEmpty ? undefined : stages.length}
      state={isEmpty ? 'empty' : 'ok'}
      emptyMessage={t('ws.pipeline.empty', 'No pipeline stages to show yet.')}
    >
      <div
        className="gx-pipe"
        role="group"
        aria-label={t('ws.pipeline.aria', 'Pipeline distribution by stage')}
      >
        {stages.map((stage) => {
          // EN: Bar fill 0–100% of the track; max==0 keeps a visible floor so empty stages still read.
          // HY: Սյան լցում track-ի 0–100%-ը; max==0-ի դեպքում տեսանելի floor, որ դատարկ stage-ը կարդացվի:
          const pct = max > 0 ? Math.round((stage.count / max) * 100) : 0
          const fill = { '--gx-pipe-fill': `${pct}%` } as CSSProperties
          const label = t(stage.i18nKey, stage.label)
          const toneClass = TONE_CLASS[stage.tone]

          // EN: Below-bar label and above-bar count are shared by both button/static branches.
          // HY: Սյան ներքևի label-ը ու վերևի count-ը կիսում են button/static երկու ճյուղերը:
          const inner = (
            <>
              <span className="gx-pipe-count gx-numeric">{stage.count}</span>
              <span className="gx-pipe-track" aria-hidden="true">
                <span className={`gx-pipe-bar ${toneClass}`} style={fill} />
              </span>
              <span className="gx-pipe-label" title={label}>
                {label}
              </span>
            </>
          )

          if (interactive) {
            return (
              <button
                key={stage.key}
                type="button"
                className="gx-pipe-stage gx-pipe-stage-btn"
                onClick={() => onStageClick(stage.key)}
                aria-label={t('ws.pipeline.stageAria', '{label}: {count}')
                  .replace('{label}', label)
                  .replace('{count}', String(stage.count))}
              >
                {inner}
              </button>
            )
          }

          return (
            <div key={stage.key} className="gx-pipe-stage">
              {inner}
            </div>
          )
        })}
      </div>
    </GxWidget>
  )
}
