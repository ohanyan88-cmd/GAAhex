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
  ru: {
    // Shell
    'shell.dashboard': 'Панель',
    'shell.bills': 'Счета',
    'shell.service': 'Услуги',
    'shell.support': 'Поддержка',
    'shell.signout': 'Выход',
    'shell.theme': 'Тема',
    'shell.lang': 'Язык',
    // Login
    'login.title': 'Личный кабинет клиента',
    'login.email': 'Эл. почта',
    'login.password': 'Пароль',
    'login.submit': 'Войти',
    'login.signing': 'Вход…',
    'login.error': 'Не удалось войти',
    // Dashboard
    'dash.openInvoices': 'Открытые счета',
    'dash.openTickets': 'Открытые обращения',
    'dash.activeServices': 'Активные услуги',
    'dash.balanceDue': 'К оплате',
    'dash.greeting': 'Здравствуйте, ',
    // Bills
    'bills.title': 'Счета и платежи',
    'bills.subtitle': 'Счета и история платежей',
    'bills.invoices': 'Счета',
    'bills.payments': 'Платежи',
    'bills.number': 'Номер',
    'bills.status': 'Статус',
    'bills.period': 'Период',
    'bills.due': 'Срок',
    'bills.total': 'Итого',
    'bills.balance': 'Остаток',
    'bills.pay': 'Оплатить',
    'bills.processing': 'Обработка…',
    'bills.outstandingMsg': 'остаток — оплатите, чтобы избежать отключения услуги',
    'bills.emptyHint': 'Ваши счета появятся здесь после выставления.',
    'bills.paymentsEmptyHint': 'Совершённые платежи появятся здесь.',
    'bills.viewPdf': 'Открыть PDF',
    'bills.receipt': 'Квитанция',
    'bills.method': 'Способ',
    'bills.amount': 'Сумма',
    'bills.paidAt': 'Оплачено',
    'bills.empty': 'Счетов пока нет.',
    'bills.paymentsEmpty': 'Платежей пока нет.',
    'bills.statusPaid': 'Оплачено',
    'bills.statusIssued': 'Выставлен',
    'bills.statusOverdue': 'Просрочен',
    'bills.statusDraft': 'Черновик',
    'bills.statusVoid': 'Аннулирован',
    // Service
    'svc.title': 'Мои услуги',
    'svc.subtitle': 'Активные услуги и подписки',
    'svc.services': 'Активные услуги',
    'svc.subscriptions': 'Подписки',
    'svc.usage': 'Последнее потребление',
    'svc.metric': 'Метрика',
    'svc.quantity': 'Количество',
    'svc.units': 'ед.',
    'svc.name': 'Название',
    'svc.type': 'Тип',
    'svc.activatedAt': 'С',
    'svc.plan': 'Тариф',
    'svc.cycle': 'цикл',
    'svc.request': 'Запрос на изменение',
    'svc.empty': 'Услуг пока нет.',
    'svc.emptyHint': 'Свяжитесь со службой поддержки, чтобы подключить новые услуги.',
    'svc.subsEmpty': 'Подписок пока нет.',
    'svc.subsEmptyHint': 'Активные подписки появятся здесь.',
    'svc.usageEmpty': 'Данных о потреблении нет.',
    'svc.usageEmptyHint': 'Данные о потреблении появятся по мере использования услуг.',
    'svc.statusActive': 'Активна',
    'svc.statusPending': 'Ожидает',
    'svc.statusSuspended': 'Приостановлена',
    'svc.statusTerminated': 'Прекращена',
    'svc.statusCancelled': 'Отменена',
    'svc.requestPlaceholder': 'Опишите нужное изменение…',
    'svc.sending': 'Отправка…',
    'svc.sendRequest': 'Отправить запрос',
    'svc.requestDone': 'Запрос отправлен',
    'svc.requestDoneMsg': 'Наша команда свяжется с вами в ближайшее время.',
    // Support
    'sup.title': 'Поддержка',
    'sup.subtitle': 'Ваши обращения в поддержку',
    'sup.newTicket': 'Новое обращение',
    'sup.opened': 'Открыто',
    'sup.subject': 'Тема',
    'sup.body': 'Описание',
    'sup.priority': 'Приоритет',
    'sup.send': 'Отправить',
    'sup.sending': 'Отправка…',
    'sup.submit': 'Отправить обращение',
    'sup.submitting': 'Отправка…',
    'sup.reply': 'Отправить ответ',
    'sup.replyPlaceholder': 'Напишите ответ…',
    'sup.empty': 'Обращений нет.',
    'sup.emptyHint': 'Создайте обращение — мы скоро ответим.',
    'sup.noReplies': 'Ответов пока нет.',
    'sup.you': 'Вы',
    'sup.support': 'Поддержка',
    'sup.statusOpen': 'Открыто',
    'sup.statusInProgress': 'В работе',
    'sup.statusResolved': 'Решено',
    'sup.statusClosed': 'Закрыто',
    'sup.priorityLow': 'Низкий',
    'sup.priorityNormal': 'Обычный',
    'sup.priorityHigh': 'Высокий',
    'sup.priorityUrgent': 'Срочный',
    // Common
    'common.loading': 'Загрузка…',
    'common.cancel': 'Отмена',
    'common.save': 'Сохранить',
    'common.error': 'Ошибка',
    'common.back': 'Назад',
  },
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
