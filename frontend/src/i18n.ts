import { useEffect, useState } from 'react'

// Tiny i18n layer. A module-singleton store (so t() works anywhere) + a useI18n() hook that
// re-renders subscribers on language change. Strings load once per language from E16
// `GET /api/i18n/{lang}`; if that 404s (older build) the dict stays empty and t() falls back to the
// English text passed as the second arg. Choice persisted in localStorage('gaaex-lang'), like theme.
const BASE = 'http://127.0.0.1:8099'

export type Lang = 'en' | 'hy'

let lang: Lang = (localStorage.getItem('gaaex-lang') as Lang) || 'en'
let dict: Record<string, string> = {}
let token: string | null = null
let listeners: Array<() => void> = []

function notify() { listeners.forEach((l) => l()) }

// Translate a key, falling back to the provided English text (or the key itself).
export function t(key: string, fallback?: string): string {
  return dict[key] ?? fallback ?? key
}

export function getLang(): Lang { return lang }

async function loadDict() {
  try {
    const r = await fetch(`${BASE}/api/i18n/${lang}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
    if (!r.ok) { dict = {}; return }
    const data = await r.json()
    // accept {key:value} or {strings:{…}} / {translations:{…}}
    dict = (data && typeof data === 'object') ? (data.strings ?? data.translations ?? data) : {}
  } catch {
    dict = {}
  }
}

// Load (or reload) strings for the current language; call once after auth and on token change.
export async function initI18n(tk: string | null) {
  token = tk
  await loadDict()
  notify()
}

export async function setLang(next: Lang) {
  lang = next
  localStorage.setItem('gaaex-lang', next)
  await loadDict()
  notify()
}

// Hook: subscribes the component so it re-renders when the language/dict changes.
export function useI18n() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((x) => x + 1)
    listeners.push(l)
    return () => { listeners = listeners.filter((z) => z !== l) }
  }, [])
  return { t, lang, setLang }
}
