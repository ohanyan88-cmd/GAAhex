import { useEffect, useState } from 'react'

// Tiny i18n layer. A module-singleton store (so t() works anywhere) + a useI18n() hook that
// re-renders subscribers on language change. Strings load once per language from E16
// `GET /api/i18n/{lang}`; if that 404s (older build) the dict stays empty and t() falls back to the
// English text passed as the second arg. Choice persisted in localStorage('gaaex-lang'), like theme.
const BASE = 'http://127.0.0.1:8099'

export type Lang = 'en' | 'hy'

// Best-effort local fallback bundle (chrome + new screens). The backend dict, when present,
// overrides these. EN keys aren't bundled — t()'s inline English default covers them.
const BUNDLED: Record<Lang, Record<string, string>> = {
  en: {},
  hy: {
    'nav.workspace': 'Աշխատանք', 'nav.org': 'Կազմ. ծառ', 'nav.dashboards': 'Վահանակներ',
    'nav.reports': 'Հաշվետվություններ', 'nav.messages': 'Հաղորդագրություններ', 'nav.activity': 'Ակտիվություն',
    'nav.reportBuilder': 'Հաշվ. կառուցիչ', 'nav.customers': 'Հաճախորդներ', 'nav.accounts': 'Հաշիվներ',
    'nav.parties': 'Կողմեր', 'nav.billing': 'Վճարումներ', 'nav.invoices': 'Ապրանքագրեր',
    'nav.subscriptions': 'Բաժանորդագրումներ', 'nav.products': 'Ապրանքներ', 'nav.usage': 'Օգտագործում',
    'nav.service': 'Ծառայություն', 'nav.services': 'Ծառայություններ', 'nav.interactions': 'Փոխգործակցումներ',
    'nav.records': 'Գրառումներ', 'nav.admin': 'Կառավարում', 'nav.studio': 'Ստուդիա',
    'nav.outbound': 'Ելքային', 'nav.webhooks': 'Վեբհուկեր', 'nav.resourcePools': 'Ռեսուրսների ֆոնդեր',
    'common.search': 'Որոնել', 'common.signout': 'Դուրս գալ', 'common.new': 'Նոր', 'common.close': 'Փակել',
    'common.create': 'Ստեղծել', 'common.save': 'Պահպանել', 'common.edit': 'Խմբագրել', 'common.delete': 'Ջնջել',
    'common.open': 'Բացել', 'common.loading': 'Բեռնվում է…', 'common.status': 'Կարգավիճակ', 'common.name': 'Անուն',
    'common.pick': '— ընտրել —', 'common.yet': 'դեռ', 'common.noneYet': 'Չկա', 'common.createFirst': 'Ստեղծեք առաջինը՝ սկսելու համար։',
    'auth.signin': 'Մուտք', 'auth.email': 'էլ. փոստ', 'auth.password': 'գաղտնաբառ',
    'accounts.new': '+ Նոր հաշիվ', 'accounts.holder': 'Կրող կողմ', 'accounts.type': 'Տեսակ',
    'accounts.currency': 'Արժույթ', 'accounts.cycle': 'Ցիկլ', 'accounts.empty': 'Հաշիվներ չկան',
    'parties.new': '+ Նոր կողմ', 'parties.type': 'Տեսակ', 'parties.parent': 'Ծնող', 'parties.empty': 'Կողմեր չկան',
  },
}

let lang: Lang = (localStorage.getItem('gaaex-lang') as Lang) || 'en'
let dict: Record<string, string> = { ...BUNDLED[lang] }
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
    if (!r.ok) { dict = { ...BUNDLED[lang] }; return }
    const data = await r.json()
    // accept {key:value} or {strings:{…}} / {translations:{…}}; server overrides the local bundle
    const server = (data && typeof data === 'object') ? (data.strings ?? data.translations ?? data) : {}
    dict = { ...BUNDLED[lang], ...server }
  } catch {
    dict = { ...BUNDLED[lang] }
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
