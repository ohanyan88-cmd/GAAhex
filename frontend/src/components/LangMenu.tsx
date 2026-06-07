import { useEffect, useRef, useState } from 'react'
import { Globe } from 'lucide-react'
import { useI18n, type Lang } from '../lib/i18n'

// Topbar language chooser — a single globe icon (like the other topbar icons) that
// opens a small popover with the three languages. Outside-click + Escape close.
const NAMES: Record<Lang, string> = { en: 'English', hy: 'Հայերեն', ru: 'Русский' }

export default function LangMenu() {
  const { t, lang, setLang } = useI18n()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="tb-lang" ref={wrapRef}>
      <button
        className={'tb-icon' + (open ? ' on' : '')}
        aria-label={t('common.language', 'Language')}
        title={t('common.language', 'Language')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Globe size={18} />
      </button>
      {open && (
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
      )}
    </div>
  )
}
