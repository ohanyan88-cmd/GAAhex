// gx-StatusBadge — canonical status display component.
// EN: Single source of truth for ALL status rendering across GAAhex.
//     Muted · UPPERCASE · letter-spaced per §2 (applied via .pill-upper).
//     Token-only colors — no hardcoded hex anywhere.
//     Variant set covers semantic (success/warning/danger/info/neutral),
//     legacy aliases (active/degraded/critical), and ISP states
//     (online/provisioned/maintenance).
//     Uniform sizing per §4 — .pill-uniform + optional minWidth override.
//
// HY: Amеn status display-i miakayn skalbnabyan: §2 per UPPERCASE + letter-spacing
//     (.pill-upper-ov): Token-only grner — hardcoded hex oc mek teghy: Variant
//     set-ə perum é semantic, legacy aliases, ISP states:
import type { CSSProperties } from 'react'
import { humanizeStatus } from '../../lib/humanize'

// EN: Full variant set — semantic core + legacy aliases + ISP states.
//     Import GxStatusBadgeVariant from this file as the authoritative type.
// HY: Lіov variant set — semantic, legacy aliases, ISP states: Import el aysteghic:
export type GxStatusBadgeVariant =
  // Semantic core (preferred for new callsites)
  | 'success' // green  — positive/active/healthy
  | 'warning' // amber  — at-risk/degraded/maintenance
  | 'danger' // red    — critical/failed/error
  | 'info' // gold   — in-flight/pending/informational
  | 'neutral' // muted  — inactive/archived/disabled
  // Legacy aliases (backward-compat — same rendering as semantic)
  | 'active' // → success
  | 'degraded' // → warning
  | 'critical' // → danger
  // ISP / network provisioning states
  | 'online' // → success (device/service is live)
  | 'provisioned' // → info    (provisioning in-flight)
  | 'maintenance' // → warning (scheduled maintenance window)

// EN: Variant → CSS kit class. Single map — no per-callsite color logic.
// HY: Variant → CSS kit class: Mek map — oc mek callsite-i skizb color logic:
const VARIANT_KIT: Record<GxStatusBadgeVariant, string> = {
  // Semantic core
  success: 'pill-success',
  warning: 'pill-warning',
  danger: 'pill-danger',
  info: 'pill-info',
  neutral: 'pill-neutral',
  // Legacy aliases
  active: 'pill-success',
  degraded: 'pill-warning',
  critical: 'pill-danger',
  // ISP / network states
  online: 'pill-success',
  provisioned: 'pill-info',
  maintenance: 'pill-warning',
}

// EN: Default label for each variant (shown when caller passes no label prop).
// HY: Default label amеn variant-i hamar (erệum é, erb caller label prop chi anckanim):
const VARIANT_LABEL: Record<GxStatusBadgeVariant, string> = {
  success: 'Active',
  warning: 'Warning',
  danger: 'Critical',
  info: 'Info',
  neutral: 'Neutral',
  active: 'Active',
  degraded: 'Degraded',
  critical: 'Critical',
  online: 'Online',
  provisioned: 'Provisioned',
  maintenance: 'Maintenance',
}

export interface GxStatusBadgeProps {
  /** EN: Semantic variant — drives color token selection.
   *  HY: Semantic variant — color token əntrkin é: */
  variant: GxStatusBadgeVariant
  /** EN: Display text. Raw enum keys (e.g. "in_progress") are humanized automatically.
   *      Defaults to the variant's built-in label when omitted.
   *  HY: Erewnali text: Raw enum key-ery (orinakʿ "in_progress") avtomatt humanize vum en:
   *      Batsatrvum é variant-i label-ov, erb batsatrvum é: */
  label?: string
  /** EN: Size — sm for table cells, md (default) for cards and headers.
   *  HY: Chap — sm tablic@ bjakneri hamar, md (default) cards ev headers-i hamar: */
  size?: 'sm' | 'md'
  /** EN: Optional fixed min-width in px — columns pad to the longest label (§4 longest-wins).
   *  HY: Ըndlayinakan min-width px-ov — stsakakнери amenaerkar label-ov uzhanavayrum (§4): */
  minWidth?: number
}

/**
 * EN: GxStatusBadge — the GAAhex canonical status display primitive.
 *     Import as StatusPill from `@/primitives` for backward compat, or
 *     as GxStatusBadge from this file for new callsites.
 *
 * HY: GxStatusBadge — GAAhex-i canonical status display primitive-ə:
 *     Import e StatusPill-ov `@/primitives`-ic backward compat-i hamar,
 *     kam GxStatusBadge-ov aysteghi cor callsite-neri hamar:
 */
export function GxStatusBadge({ variant, label, size = 'md', minWidth }: GxStatusBadgeProps) {
  const kit = VARIANT_KIT[variant]
  // EN: pill-upper applies text-transform:uppercase + letter-spacing (§2).
  //     pill-uniform pads every pill to --gx-pill-min-w for column alignment (§4).
  // HY: pill-upper-ə gorcadrk'um é text-transform:uppercase + letter-spacing (§2):
  //     pill-uniform-ə amеn pill-ə uzhanavayrum é --gx-pill-min-w hamarjin (§4):
  const cls = ['pill', kit, size === 'sm' ? 'pill-sm' : '', 'pill-uniform', 'pill-upper']
    .filter(Boolean)
    .join(' ')
  const style = minWidth ? ({ '--gx-pill-min': `${minWidth}px` } as CSSProperties) : undefined
  return (
    <span className={cls} style={style}>
      <span className="pill-dot" />
      {label != null ? humanizeStatus(label) : VARIANT_LABEL[variant]}
    </span>
  )
}
