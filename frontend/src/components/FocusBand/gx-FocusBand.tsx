// gx-FocusBand — the workspace AI daily-summary band.
// EN: Full-width band that renders focus.summary from the WorkspaceData contract: an azure accent
//     icon (the live-signal §2) + the AI summary line + an optional right-aligned "Ask" pill that
//     hands off to the assistant. Presentational only — data arrives via props, the action renders
//     ONLY when its handler is supplied (no dead buttons, §0.7). Wraps in the existing .gx-ws-focus
//     chrome from _workspace.css (do NOT redefine); this file adds only the inner element classes.
// HY: Ամբողջ լայնքով band, որ render-ում է focus.summary-ն WorkspaceData contract-ից՝ azure accent
//     icon (live-signal §2) + AI ամփոփ տողը + ընտրովի աջ կողմի "Ask" pill, որ փոխանցում է assistant-ին։
//     Միայն presentational՝ data-ն գալիս է props-ով, action-ը render-վում է ՄԻԱՅՆ երբ handler-ը կա
//     (ոչ մի dead button, §0.7)։ Փաթաթվում է արդեն եղած .gx-ws-focus chrome-ով (_workspace.css)՝ չվերասահմանելով։
import { Sparkles } from 'lucide-react'
import type { WorkspaceData } from '../../lib/workspace/contract'
import { t } from '../../lib/i18n'

export interface GxFocusBandProps {
  /** EN: The AI daily-summary line (focus.summary from the contract).
   *  HY: AI օրվա ամփոփ տողը (focus.summary՝ contract-ից): */
  summary: WorkspaceData['focus']['summary']
  /** EN: Optional handler — when provided, a right-aligned azure "Ask" pill renders and calls it.
   *  HY: Ընտրովի handler — երբ տրված է, render-վում է աջ azure "Ask" pill-ը ու կանչում է սա: */
  onAsk?: () => void
}

/**
 * EN: GxFocusBand — render the AI daily-summary band inside the .gx-ws-focus chrome.
 *     Handles the EMPTY case (no summary text) gracefully with a calm placeholder line.
 * HY: GxFocusBand — render-ում է AI ամփոփ band-ը .gx-ws-focus chrome-ի ներսում:
 *     EMPTY դեպքը (ամփոփ տեքստ չկա) մշակվում է հանգիստ placeholder տողով:
 */
export function GxFocusBand({ summary, onAsk }: GxFocusBandProps) {
  // EN: Empty-state guard (§0.4) — blank/whitespace summary falls back to a neutral line.
  // HY: Empty-state պաշտպանություն (§0.4)՝ դատարկ ամփոփը փոխարինվում է չեզոք տողով:
  const text = summary.trim() ? summary : t('ws.focus.empty', 'No summary yet — your day is clear.')

  return (
    <div className="gx-ws-focus" role="status" aria-live="polite">
      <span className="gx-focus-icon" aria-hidden="true">
        <Sparkles size={18} />
      </span>
      <p className="gx-focus-text">{text}</p>
      {onAsk && (
        <button
          type="button"
          className="gx-focus-ask"
          onClick={onAsk}
          aria-label={t('ws.focus.ask', 'Ask')}
        >
          {t('ws.focus.ask', 'Ask')}
        </button>
      )}
    </div>
  )
}
