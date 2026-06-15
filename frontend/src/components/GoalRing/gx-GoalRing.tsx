// gx-GoalRing — weekly-goal SVG progress ring (workspace widget).
// EN: One boxed widget: an accessible circular progress ring inside a GxWidget card. The track is the
//     neutral --gx-chart-track; the arc is AZURE (--gx-chart-active) until the goal is met, then flips
//     to GOLD (--gx-chart-peak) at 100%+ — the single "look-here" accent (§ gold spent once). The arc
//     length is driven by stroke-dasharray on a viewBox'd circle so it scales to any container. The
//     centre shows the big pct (tabular figures) over a "current / target" sub-line. Reduced-motion is
//     respected: the sweep only animates under (prefers-reduced-motion: no-preference). Presentational —
//     all data arrives via the typed WsGoal prop (§7).
// HY: Մեկ boxed widget՝ հասանելի շրջանաձև progress ring GxWidget card-ի մեջ։ Track-ը չեզոք
//     --gx-chart-track-ն է, աղեղը AZURE է (--gx-chart-active), մինչև նպատակը կատարվի, հետո դառնում է
//     GOLD (--gx-chart-peak) 100%+-ի դեպքում՝ միակ "նայիր-այստեղ" առոգանությունը։ Աղեղի երկարությունը
//     կառավարվում է viewBox circle-ի stroke-dasharray-ով, որ scale լինի ցանկացած container-ի։ Կենտրոնը
//     ցույց է տալիս մեծ pct (tabular թվեր)՝ "current / target" ենթատողի վրա։ Reduced-motion-ը հարգվում
//     է՝ sweep-ը animate է միայն (prefers-reduced-motion: no-preference)-ի տակ։ Presentational — ամբողջ
//     տվյալը գալիս է typed WsGoal prop-ով (§7)։
import { Target } from 'lucide-react'
import type { CSSProperties } from 'react'
import { t } from '../../lib/i18n'
import { GxWidget } from '../Widget/gx-Widget'
import type { WsGoal } from '../../lib/workspace/contract'

// EN: Geometry constants live in the viewBox coordinate space (unitless), so the SVG scales fluidly
//     via the parent box — no raw px paint here. The circle radius leaves room for the stroke width.
// HY: Geometry հաստատունները ապրում են viewBox կոորդինատային տարածքում (առանց միավորի), որ SVG-ն
//     սահուն scale լինի parent box-ով — ոչ մի raw px paint այստեղ։ Շառավիղը տեղ է թողնում stroke-ի համար։
const VB = 100 // viewBox is 0 0 100 100
const STROKE = 10 // arc thickness in viewBox units
const R = (VB - STROKE) / 2 // radius keeps the full stroke inside the box
const C = VB / 2 // centre
const CIRCUM = 2 * Math.PI * R // full circumference (the dasharray base)

export interface GxGoalRingProps {
  /** EN: The weekly goal (label · i18nKey · current · target · pct). HY: Շաբաթական նպատակը։ */
  goal: WsGoal
  /** EN: Optional refresh affordance — rendered only when a handler is provided (§7 no dead buttons).
   *  HY: Ընտրովի refresh — render-վում է միայն երբ handler կա (§7՝ ոչ մի մեռած կոճակ)։ */
  onRefresh?: () => void
}

/**
 * EN: GxGoalRing — the GAAhex weekly-goal progress ring. Self-contained and presentational; the
 *     caller passes a typed WsGoal. Empty/invalid target (target <= 0) renders GxWidget's empty state.
 * HY: GxGoalRing — GAAhex շաբաթական-նպատակի progress ring-ը։ Ինքնաբավ ու presentational. Caller-ը
 *     փոխանցում է typed WsGoal։ Դատարկ/անվավեր target-ը (target <= 0) render-ում է empty state-ը։
 */
export function GxGoalRing({ goal, onRefresh }: GxGoalRingProps) {
  const title = t('ws.goal.title', 'Weekly Goal')

  // EN: Empty/unconfigured goal — no positive target means nothing to chart; defer to the card state.
  // HY: Դատարկ/չկարգավորված նպատակ — դրական target չկա, ուրեմն գծելու բան չկա. թողնում ենք card state-ին։
  if (!goal || goal.target <= 0) {
    return (
      <GxWidget
        title={title}
        icon={<Target size={14} />}
        state="empty"
        emptyMessage={t('ws.goal.empty', 'No goal set for this week yet.')}
        onRefresh={onRefresh}
      >
        {null}
      </GxWidget>
    )
  }

  // EN: Clamp the visual fill to 0–100 for the arc; keep the raw pct for the displayed number so an
  //     over-target week still reads e.g. "112%". `met` flips the accent from azure to the gold peak.
  // HY: Սահմանափակում ենք տեսանելի լցումը 0–100՝ աղեղի համար. պահում ենք raw pct-ը ցուցադրվող թվի համար,
  //     որ over-target շաբաթը կարդացվի օր. "112%"։ `met`-ը accent-ը azure-ից փոխում է gold peak-ի։
  const fill = Math.max(0, Math.min(100, goal.pct))
  const met = goal.pct >= 100
  const dash = (fill / 100) * CIRCUM

  const label = t(goal.i18nKey, goal.label)
  const ratio = `${goal.current} / ${goal.target}`
  // EN: One spoken sentence for SR users — the goal, where it stands, and whether it's met.
  // HY: Մեկ արտասանվող նախադասություն SR օգտատերերի համար՝ նպատակը, ընթացքը և կատարվա՞ծ է։
  const aria = met
    ? t('ws.goal.ariaMet', '{label}: goal met — {current} of {target} ({pct}%).')
    : t('ws.goal.aria', '{label}: {current} of {target} ({pct}%) toward the weekly goal.')
  const ariaLabel = aria
    .replace('{label}', label)
    .replace('{current}', String(goal.current))
    .replace('{target}', String(goal.target))
    .replace('{pct}', String(Math.round(goal.pct)))

  // EN: Pass the arc length + dash to CSS via custom props so the keyframe sweep (motion-gated in CSS)
  //     and the static fallback both read the same numbers — no inline color/size literals.
  // HY: Փոխանցում ենք աղեղի երկարությունն ու dash-ը CSS-ին custom prop-երով, որ keyframe sweep-ը
  //     (CSS-ում motion-gated) և ստատիկ fallback-ը կարդան նույն թվերը — ոչ մի inline color/size literal։
  const ringStyle = {
    '--gx-ring-dash': `${dash}`,
    '--gx-ring-circ': `${CIRCUM}`,
  } as CSSProperties

  return (
    <GxWidget title={title} icon={<Target size={14} />} onRefresh={onRefresh}>
      <div className={`gx-ring${met ? ' gx-ring-met' : ''}`}>
        <div className="gx-ring-figure" role="img" aria-label={ariaLabel} style={ringStyle}>
          <svg className="gx-ring-svg" viewBox={`0 0 ${VB} ${VB}`} aria-hidden="true">
            {/* EN: Background track. HY: Ֆոնի track։ */}
            <circle
              className="gx-ring-track"
              cx={C}
              cy={C}
              r={R}
              fill="none"
              strokeWidth={STROKE}
            />
            {/* EN: Progress arc — azure, or gold once met. HY: Progress աղեղ — azure, կամ gold երբ met։ */}
            <circle
              className="gx-ring-arc"
              cx={C}
              cy={C}
              r={R}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${CIRCUM - dash}`}
            />
          </svg>
          <div className="gx-ring-center">
            <span className="gx-ring-pct">{Math.round(goal.pct)}%</span>
            <span className="gx-ring-sub">{ratio}</span>
          </div>
        </div>
        <p className="gx-ring-label">{label}</p>
      </div>
    </GxWidget>
  )
}

export default GxGoalRing
