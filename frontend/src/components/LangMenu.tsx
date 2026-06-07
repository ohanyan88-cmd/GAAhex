import { useState } from 'react'
import { Globe } from 'lucide-react'
import { useI18n, type Lang } from '../lib/i18n'

// Topbar language chooser — a single globe icon (like the other topbar icons) that
// opens a small popover with the three languages. Reads/writes the i18n store directly.
const NAMES: Record<Lang, string> = { en: 'English', hy: 'Հայերեն', ru: 'Русский' }

export default function LangMenu() {
  const { t, lang, setLang } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <div className="tb-lang">
      <button
        className="tb-icon"
        aria-label={t('common.language', 'Language')}
        title={t('common.language', 'Language')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Globe size={18} />
      </button>
      {open && (
        <>
          <button type="button" className="tb-lang-backdrop" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="tb-lang-pop" role="menu">
            {(['en', 'hy', 'ru'] as Lang[]).map((l) => (
              <button
                key={l}
                role="menuitemradio"
                aria-checked={lang === l}
                className={'tb-lang-opt' + (lang === l ? ' on' : '')}
                onClick={() => { setLang(l); setOpen(false) }}
              >
                {NAMES[l]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
