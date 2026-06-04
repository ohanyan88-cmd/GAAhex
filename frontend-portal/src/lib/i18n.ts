// T-P4-2 — Portal i18n foundation. Mirrors `frontend/src/lib/i18n.ts` minus
// the backend-dictionary fetch (portal SPA's labels are stable enough to ship
// fully bundled; the backend `/api/i18n/{lang}` endpoint is admin-scoped).
//
// Lang preference is persisted in `localStorage('gaahex-portal-lang')` —
// distinct from admin's `gaahex-lang` so the same browser can run both SPAs
// with different language choices.
import { useEffect, useState } from 'react'

export type Lang = 'en' | 'hy' | 'ru'

const BUNDLED: Record<Lang, Record<string, string>> = {
  en: {},
  ru: {},
  hy: {
    // Shell
    'shell.dashboard': 'Վահանակ',
    'shell.bills': 'Հաշիվներ',
    'shell.service': 'Ծառայություն',
    'shell.support': 'Աջակցություն',
    'shell.signout': 'Դուրս գալ',
    'shell.theme': 'Թեմա',
    'shell.lang': 'Լեզու',
    // Login
    'login.title': 'Հաճախորդի պորտալ',
    'login.email': 'էլ. փոստ',
    'login.password': 'գաղտնաբառ',
    'login.submit': 'Մուտք',
    'login.signing': 'Մուտք գործում…',
    'login.error': 'Մուտքը ձախողվեց',
    // Dashboard
    'dash.openInvoices': 'Բաց ապրանքագրեր',
    'dash.openTickets': 'Բաց հարցումներ',
    'dash.activeServices': 'Ակտիվ ծառայություններ',
    'dash.balanceDue': 'Վճարման ենթակա',
    'dash.greeting': 'Բարև, ',
    // Bills
    'bills.title': 'Հաշիվներ և վճարումներ',
    'bills.subtitle': 'Ապրանքագրեր և վճարման պատմություն',
    'bills.invoices': 'Ապրանքագրեր',
    'bills.payments': 'Վճարումներ',
    'bills.number': 'Համար',
    'bills.status': 'Կարգավիճակ',
    'bills.period': 'Ժամանակաշրջան',
    'bills.due': 'Վերջնաժ.',
    'bills.total': 'Ընդամենը',
    'bills.balance': 'Մնացորդ',
    'bills.pay': 'Վճարել',
    'bills.processing': 'Կատարվում է…',
    'bills.outstandingMsg': 'մնացորդ — խնդրում ենք վճարել ծառայության դադարը կանխելու համար',
    'bills.emptyHint': 'Ձեր ապրանքագրերը կհայտնվեն այստեղ՝ թողարկվելուց հետո։',
    'bills.paymentsEmptyHint': 'Կատարված վճարումները կհայտնվեն այստեղ։',
    'bills.viewPdf': 'Դիտել PDF',
    'bills.receipt': 'Անդորրագիր',
    'bills.method': 'Եղանակ',
    'bills.amount': 'Գումար',
    'bills.paidAt': 'Վճարվել է',
    'bills.empty': 'Ապրանքագրեր չկան։',
    'bills.paymentsEmpty': 'Վճարումներ դեռ չկան։',
    'bills.statusPaid': 'Վճարված',
    'bills.statusIssued': 'Թողարկված',
    'bills.statusOverdue': 'Ժամկ. անցած',
    'bills.statusDraft': 'Սևագիր',
    'bills.statusVoid': 'Չեղյալ',
    // Service
    'svc.title': 'Իմ ծառայությունները',
    'svc.subtitle': 'Ակտիվ ծառայություններ և բաժանորդագրումներ',
    'svc.services': 'Ակտիվ ծառայություններ',
    'svc.subscriptions': 'Բաժանորդագրումներ',
    'svc.usage': 'Վերջին օգտագործումը',
    'svc.metric': 'Չափիչ',
    'svc.quantity': 'Քանակ',
    'svc.units': 'միավոր',
    'svc.name': 'Անուն',
    'svc.type': 'Տեսակ',
    'svc.activatedAt': 'Սկսած՝',
    'svc.plan': 'Փաթեթ',
    'svc.cycle': 'ցիկլ',
    'svc.request': 'Փոփոխման հարցում',
    'svc.empty': 'Ծառայություններ դեռ չկան։',
    'svc.emptyHint': 'Կապվեք աջակցության հետ՝ հաշվին նոր ծառայություններ ավելացնելու համար։',
    'svc.subsEmpty': 'Բաժանորդագրումներ դեռ չկան։',
    'svc.subsEmptyHint': 'Ակտիվ փաթեթի բաժանորդագրությունները կհայտնվեն այստեղ։',
    'svc.usageEmpty': 'Օգտագործման տվյալներ չկան։',
    'svc.usageEmptyHint': 'Օգտագործման տվյալները կհայտնվեն այստեղ՝ ծառայությունների օգտագործման ընթացքում։',
    'svc.statusActive': 'Ակտիվ',
    'svc.statusPending': 'Սպասում է',
    'svc.statusSuspended': 'Կասեցված',
    'svc.statusTerminated': 'Դադարեցված',
    'svc.statusCancelled': 'Չեղյալ',
    'svc.requestPlaceholder': 'Նկարագրեք ձեր ուզած փոփոխությունը…',
    'svc.sending': 'Ուղարկվում է…',
    'svc.sendRequest': 'Ուղարկել հարցումը',
    'svc.requestDone': 'Հարցումը ուղարկված է',
    'svc.requestDoneMsg': 'Մեր թիմը շուտով կկապվի ձեզ հետ։',
    // Support
    'sup.title': 'Աջակցություն',
    'sup.subtitle': 'Ձեր աջակցության հարցումները',
    'sup.newTicket': 'Նոր հարցում',
    'sup.opened': 'Բացված',
    'sup.subject': 'Թեմա',
    'sup.body': 'Մանրամասներ',
    'sup.priority': 'Կարևորություն',
    'sup.send': 'Ուղարկել',
    'sup.sending': 'Ուղարկվում է…',
    'sup.submit': 'Ուղարկել հարցումը',
    'sup.submitting': 'Ուղարկվում է…',
    'sup.reply': 'Ուղարկել պատասխանը',
    'sup.replyPlaceholder': 'Գրեք պատասխանը…',
    'sup.empty': 'Հարցումներ չկան։',
    'sup.emptyHint': 'Բացեք աջակցության հարցում, և մենք շուտով կպատասխանենք։',
    'sup.noReplies': 'Պատասխաններ դեռ չկան։',
    'sup.you': 'Դուք',
    'sup.support': 'Աջակցություն',
    'sup.statusOpen': 'Բաց',
    'sup.statusInProgress': 'Ընթացքի մեջ',
    'sup.statusResolved': 'Լուծված',
    'sup.statusClosed': 'Փակ',
    'sup.priorityLow': 'Ցածր',
    'sup.priorityNormal': 'Նորմալ',
    'sup.priorityHigh': 'Բարձր',
    'sup.priorityUrgent': 'Շտապ',
    // Common
    'common.loading': 'Բեռնվում է…',
    'common.cancel': 'Չեղարկել',
    'common.save': 'Պահպանել',
    'common.error': 'Սխալ',
    'common.back': 'Հետ',
  },
}

let lang: Lang = ((typeof localStorage !== 'undefined' && (localStorage.getItem('gaahex-portal-lang') as Lang)) || 'en')
let dict: Record<string, string> = { ...BUNDLED[lang] }
const listeners: Array<() => void> = []

function notify() { listeners.forEach((l) => l()) }

/** Translate `key`, falling back to the supplied English `fallback` (or the key itself). */
export function t(key: string, fallback?: string): string {
  return dict[key] ?? fallback ?? key
}

export function getLang(): Lang { return lang }

export function setLang(next: Lang) {
  if (next === lang) return
  lang = next
  dict = { ...BUNDLED[next] }
  try { localStorage.setItem('gaahex-portal-lang', next) } catch {}
  notify()
}

/** React hook — re-renders on `setLang`. Returns `{ t, lang, setLang }`. */
export function useI18n() {
  const [, force] = useState(0)
  useEffect(() => {
    const tick = () => force((n) => n + 1)
    listeners.push(tick)
    return () => {
      const idx = listeners.indexOf(tick)
      if (idx >= 0) listeners.splice(idx, 1)
    }
  }, [])
  return { t, lang, setLang }
}
