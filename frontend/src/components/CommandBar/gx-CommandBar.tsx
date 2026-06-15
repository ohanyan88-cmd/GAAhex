// gx-CommandBar — Zone C composable action row.
// EN: Owns view chips + all page actions. Two modes:
//     Standard: [views] ── spacer ── [secondary] ── [primary]
//     Bulk (selectionCount > 0): [N selected] ── [bulk actions] ── [clear]
//     Permission gating is the CALLER's responsibility — every action passed
//     here is rendered. Hidden = not passed. Never a dead/disabled button for
//     a permission gap.
// HY: Տиrum é view chips + bolor page actions: Erku mode:
//     Standard: [views] ── spacer ── [secondary] ── [primary]
//     Bulk (selectionCount > 0): [N əntrvac] ── [bulk actions] ── [clear]
//     Permission gating-ը CALLER-i patasxanatvutyunn é — apes ancd'vac
//     action-ը rendervum é: Թ'unc — chi anc'num: Еrbeq mer button chunak'vac permission-i hamar:
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../primitives'
import { t } from '../../lib/i18n'
import type {
  PrimaryAction,
  SecondaryAction,
  ViewSwitcher,
  ViewKind,
  BulkAction,
} from '../../page-shell/types'

// EN: English fallback labels per view kind — t() wraps each at the callsite so
//     the map acts as the fallback only; translations come from the i18n dict.
// HY: English fallback labels — t()-ə wrap é amеn callsite-um; translations-ə i18n dict-ic:
const VIEW_LABEL: Record<ViewKind, string> = {
  table: 'Table',
  board: 'Board',
  calendar: 'Calendar',
  map: 'Map',
  timeline: 'Timeline',
  gallery: 'Gallery',
}

export interface GxCommandBarProps {
  /** EN: View switcher chips — leftmost group in standard mode.
   *  HY: View switcher chips — amеnagetab group standard mode-um: */
  views?: ViewSwitcher
  /** EN: Primary CTA — rightmost button, one per page (standard mode only).
   *  HY: Primary CTA — aspetakanotvorjin button, mek xmbi hamar (miain standard mode-um): */
  primary?: PrimaryAction
  /** EN: Secondary action buttons — rendered to the left of primary (standard mode only).
   *  HY: Secondary action buttons — render vum en primary-i dzaxin (miain standard mode-um): */
  secondary?: SecondaryAction[]
  /** EN: Bulk actions — shown only when selectionCount > 0.
   *  HY: Bulk actions — erệum en miain erb selectionCount > 0: */
  bulkActions?: BulkAction[]
  /** EN: Number of selected rows — activates bulk mode when greater than zero.
   *  HY: Əntrvac tariqneri kanakutyun — bulk mode-ə gorcakir'um é, erb zerovit mec é: */
  selectionCount?: number
  /** EN: Clears the current row selection (renders a Clear button in bulk mode).
   *  HY: Marum é arajik sharnəntrutyunə (bulk mode-um rendervum é Clear button): */
  onClearSelection?: () => void
}

export function GxCommandBar({
  views,
  primary,
  secondary,
  bulkActions,
  selectionCount = 0,
  onClearSelection,
}: GxCommandBarProps) {
  const isBulk = selectionCount > 0

  // EN: Dropdown menu open state for secondary actions that include a menu array.
  //     Hooks must be declared unconditionally (Rules of Hooks).
  // HY: Dropdown menu open state secondary actions-i hamar, vor@ menu array unen:
  //     Hook-ery petk é ancpaymanoren hrayararvven (Rules of Hooks):
  const [openMenu, setOpenMenu] = useState<number | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (openMenu === null) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [openMenu])

  const hasContent = !!views || !!primary || (secondary && secondary.length > 0) || isBulk
  if (!hasContent) return null

  return (
    <div className="ps-actions">
      {isBulk ? (
        <>
          {/* EN: Bulk mode — selection badge + bulk action buttons + clear.
              HY: Bulk mode — əntrutyuni badge + bulk action buttons + clear: */}
          <span className="ps-actions-selection">
            {t('shell.cb.selected', `${selectionCount} selected`)}
          </span>
          {bulkActions && bulkActions.length > 0 && (
            <div className="ps-actions-secondaries">
              {bulkActions.map((a, i) => (
                <Button
                  key={`${a.label}-${i}`}
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={a.onClick}
                  disabled={a.disabled}
                >
                  {a.icon}
                  {a.label}
                </Button>
              ))}
            </div>
          )}
          {onClearSelection && (
            <Button variant="secondary" size="sm" type="button" onClick={onClearSelection}>
              {t('shell.cb.clear', 'Clear')}
            </Button>
          )}
        </>
      ) : (
        <>
          {/* EN: View switcher chips — leftmost group.
              HY: View switcher chips — amenagetab group: */}
          {views && views.options.length > 0 && (
            <div className="ps-views" role="tablist" aria-label="View">
              {views.options.map((v) => (
                <button
                  key={v}
                  type="button"
                  className="ps-view-chip"
                  aria-pressed={views.current === v}
                  onClick={() => views.onChange?.(v)}
                >
                  {t(`shell.view.${v}`, VIEW_LABEL[v])}
                </button>
              ))}
            </div>
          )}

          <div className="ps-actions-spacer" />

          {/* EN: Secondary actions — may include dropdown menus (same pattern as PageHeader).
              HY: Secondary actions — kara unenain dropdown menus (nuynak pattern PageHeader-ic): */}
          {secondary && secondary.length > 0 && (
            <div className="ps-actions-secondaries">
              {secondary.map((a, i) =>
                a.menu ? (
                  <div
                    className="ps-header-menu-wrap"
                    key={`${a.label}-${i}`}
                    ref={openMenu === i ? menuRef : undefined}
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={() => setOpenMenu(openMenu === i ? null : i)}
                      disabled={a.disabled}
                      aria-haspopup="menu"
                      aria-expanded={openMenu === i}
                    >
                      {a.icon}
                      {a.label}
                    </Button>
                    {openMenu === i && (
                      <div className="ps-header-menu" role="menu">
                        {a.menu.map((mi, mj) => (
                          <button
                            key={`${mi.label}-${mj}`}
                            type="button"
                            role="menuitem"
                            className="ps-header-menu-item"
                            onClick={() => {
                              setOpenMenu(null)
                              mi.onClick()
                            }}
                          >
                            {mi.icon}
                            {mi.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <Button
                    key={`${a.label}-${i}`}
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={a.onClick}
                    disabled={a.disabled}
                  >
                    {a.icon}
                    {a.label}
                  </Button>
                ),
              )}
            </div>
          )}

          {/* EN: Primary CTA — rightmost, one per page.
              HY: Primary CTA — aspetakanotvorjin, mek xmbi hamar: */}
          {primary && (
            <Button
              variant="primary"
              size="sm"
              type="button"
              onClick={primary.onClick}
              disabled={primary.disabled || primary.loading}
            >
              {primary.icon}
              {primary.label}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
