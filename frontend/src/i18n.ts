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
    'nav.records': 'Գրառումներ', 'nav.admin': 'Կառավարում', 'nav.studio': 'Ստուդիա', 'nav.analytics': 'Անալիտիկա',
    'analytics.mrr': 'MRR', 'analytics.activeSubs': 'Ակտիվ բաժ.', 'analytics.arOutstanding': 'AR մնացորդ',
    'analytics.overdue': 'Ժամկ. անցած', 'analytics.collected': 'Հավաքագրված (ամիս)', 'analytics.newLeads': 'Նոր լիդեր (30օր)',
    'analytics.revenueTrend': 'Եկամտի դինամիկա', 'analytics.subscriptionMix': 'Բաժանորդ. կազմ', 'analytics.arAging': 'AR հնացում',
    'analytics.invoiced': 'Դուրս գրված', 'analytics.vsPrev': 'նախորդի դիմաց',
    'ai.title': 'AI օգնական', 'ai.thinking': 'Մտածում է…', 'ai.unavailable': 'AI օգնականը դեռ հասանելի չէ',
    'common.noData': 'Տվյալներ չկան',
    'nav.outbound': 'Ելքային', 'nav.webhooks': 'Վեբհուկեր', 'nav.resourcePools': 'Ռեսուրսների ֆոնդեր',
    'common.search': 'Որոնել', 'common.signout': 'Դուրս գալ', 'common.new': 'Նոր', 'common.close': 'Փակել',
    'common.create': 'Ստեղծել', 'common.save': 'Պահպանել', 'common.edit': 'Խմբագրել', 'common.delete': 'Ջնջել',
    'common.open': 'Բացել', 'common.loading': 'Բեռնվում է…', 'common.status': 'Կարգավիճակ', 'common.name': 'Անուն',
    'common.pick': '— ընտրել —', 'common.yet': 'դեռ', 'common.noneYet': 'Չկա', 'common.createFirst': 'Ստեղծեք առաջինը՝ սկսելու համար։',
    'auth.signin': 'Մուտք', 'auth.email': 'էլ. փոստ', 'auth.password': 'գաղտնաբառ',
    'accounts.new': '+ Նոր հաշիվ', 'accounts.holder': 'Կրող կողմ', 'accounts.type': 'Տեսակ',
    'accounts.currency': 'Արժույթ', 'accounts.cycle': 'Ցիկլ', 'accounts.empty': 'Հաշիվներ չկան',
    'parties.new': '+ Նոր կողմ', 'parties.type': 'Տեսակ', 'parties.parent': 'Ծնող', 'parties.empty': 'Կողմեր չկան',
    // B19 — onboarding wizard + settings
    'nav.settings': 'Կարգավորումներ',
    'common.next': 'Հաջորդ', 'common.back': 'Հետ', 'common.done': 'Պատրաստ է', 'common.saving': 'Պահպանվում է…',
    'wizard.title': 'Ստեղծել նոր ISP', 'wizard.cta': 'Ստեղծել նոր ISP',
    'wizard.stepCompany': 'Ընկերություն', 'wizard.stepAdmin': 'Ադմին', 'wizard.stepReview': 'Վերանայում',
    'wizard.companyName': 'Ընկերության անուն', 'wizard.currency': 'Արժույթ', 'wizard.locale': 'Լեզու',
    'wizard.adminName': 'Ադմինի անուն', 'wizard.adminEmail': 'Ադմինի էլ. փոստ', 'wizard.password': 'Գաղտնաբառ',
    'wizard.confirm': 'Հաստատել գաղտնաբառը', 'wizard.create': 'Ստեղծել ISP', 'wizard.creating': 'Ստեղծվում է…',
    'wizard.createdTitle': 'ISP-ն ստեղծվեց', 'wizard.success': 'ISP-ն ստեղծվեց — մուտք գործեք որպես {email}',
    'wizard.errCompany': 'Ընկերության անունը պարտադիր է', 'wizard.errStep2': 'Ուղղեք նշված դաշտերը՝ շարունակելու համար',
    'wizard.errEmail': 'Մուտքագրեք վավեր էլ. փոստ', 'wizard.errPwLen': 'Առնվազն 8 նիշ',
    'wizard.errPwMatch': 'Գաղտնաբառերը չեն համընկնում', 'wizard.errUnavailable': 'ISP-ի կարգավորումը դեռ հասանելի չէ',
    'wizard.errFailed': 'Չհաջողվեց ստեղծել ISP-ն',
    'settings.saved': 'Կարգավորումները պահպանվեցին', 'settings.loadError': 'Չհաջողվեց բեռնել կարգավորումները',
    'settings.denied': 'Դուք իրավունք չունեք կառավարելու կարգավորումները',
    'settings.unavailable': 'Կարգավորումները դեռ հասանելի չեն', 'settings.unavailableMsg': 'Թենանտի կարգավորումները կհայտնվեն այստեղ՝ միանալուց հետո։',
    'settings.logoText': 'Լոգոյի տեքստ',
    'onboard.nudge': 'Ավարտեք ձեր ISP-ի կարգավորումը։', 'onboard.finish': 'Ավարտել կարգավորումը',
    // B20 — customer workspace + convert + run-cycle
    'common.cancel': 'Չեղարկել', 'common.stay': 'Մնալ', 'common.optional': 'ընտրովի',
    'cust.title': 'Հաճախորդ', 'cust.what': 'հաճախորդ',
    'cust.loadError': 'Չհաջողվեց բեռնել հաճախորդը', 'cust.denied': 'Դուք իրավունք չունեք դիտելու այս հաճախորդին',
    'cust.notFoundMsg': 'Հաճախորդը հնարավոր է տեղափոխվել, վերանվանվել կամ ջնջվել է։',
    'cust.outstanding': 'Մնացորդ', 'cust.billed': 'Հաշվարկված', 'cust.paid': 'Վճարված', 'cust.overdue': 'Ժամկ. անցած ապրանքագրեր',
    'cust.services': 'Ծառայություններ', 'cust.noServices': 'Ծառայություններ դեռ չկան։', 'cust.service': 'Ծառայություն',
    'cust.type': 'Տեսակ', 'cust.activated': 'Ակտիվացված',
    'cust.noSubs': 'Բաժանորդագրումներ դեռ չկան։', 'cust.noInvoices': 'Ապրանքագրեր դեռ չկան։',
    'cust.related': 'Կապված', 'cust.noRelated': 'Կապված գրառումներ չկան։',
    'cust.issue': 'Թողարկել', 'cust.issued': 'Ապրանքագիրը թողարկվեց',
    'cust.recordPayment': 'Գրանցել վճարում', 'cust.record': 'Գրանցել', 'cust.paymentRecorded': 'Վճարումը գրանցվեց',
    'cust.amount': 'Գումար (֏)', 'cust.method': 'Եղանակ', 'cust.methodCard': 'Քարտ', 'cust.methodTransfer': 'Փոխանցում',
    'cust.methodCash': 'Կանխիկ', 'cust.note': 'Նշում', 'cust.openWorkspace': 'Բացել աշխատատարածք',
    'subs.plan': 'Փաթեթ', 'subs.amount': 'Գումար',
    'invoices.number': 'Ապրանքագիր', 'invoices.total': 'Ընդամենը', 'invoices.due': 'Վերջնաժ.',
    'leads.convert': 'Դարձնել հաճախորդ', 'leads.converting': 'Փոխակերպվում է…', 'leads.convertOk': 'Լիդը դարձավ հաճախորդ',
    'leads.alreadyCustomer': 'Այս լիդն արդեն հաճախորդ է', 'leads.convertedTitle': 'Հաճախորդը ստեղծվեց',
    'leads.openCustomerQ': 'Բացե՞լ նոր հաճախորդի աշխատատարածքը', 'leads.convertNA': 'Լիդի փոխակերպումը դեռ հասանելի չէ',
    'leads.convertError': 'Չհաջողվեց փոխակերպել լիդը',
    'billing.runCycle': 'Գործարկել վճարման ցիկլը', 'billing.running': 'Գործարկվում է…',
    'billing.cycleResult': 'Վճարման ցիկլ՝ {generated} ստեղծված, {skipped} բաց թողնված',
    'billing.cycleNA': 'Վճարման ցիկլը դեռ հասանելի չէ',
    // B23 — webhooks module toast messages + i18n keys
    'webhooks.created': 'Վեբհուկը ստեղծվեց',
    'webhooks.updated': 'Վեբհուկը թարմացվեց',
    'webhooks.deleted': 'Վեբհուկը ջնջվեց',
    'webhooks.testSent': 'Թեստ-իրադարձությունը ուղարկվեց',
    'webhooks.loadError': 'Չհաջողվեց բեռնել վեբհուկները',
    'webhooks.unavailable': 'Վեբհուկները դեռ հասանելի չեն',
    'webhooks.unavailableMsg': 'Վեբհուկի առաքումը կհայտնվի այստեղ՝ ինտեգրման ծառայությունը միանալուց հետո։',
    'webhooks.denied': 'Վեբհուկները հասանելի են միայն ադմիններին։',
    'webhooks.deliveriesLoadError': 'Չհաջողվեց բեռնել առաքումները',
    // B23 — resource pools module toast messages + i18n keys
    'pools.created': 'Ֆոնդը ստեղծվեց',
    'pools.valueAllocated': 'Արժեքը բաժանվեց',
    'pools.valueReleased': 'Արժեքն ազատ արձակվեց',
    'pools.loadError': 'Չհաջողվեց բեռնել ռեսուրսների ֆոնդերը',
    'pools.poolLoadError': 'Չհաջողվեց բեռնել ֆոնդը',
    'pools.poolNotFound': 'Ֆոնդը չի գտնվել',
    'pools.unavailable': 'Ռեսուրսների ֆոնդերը դեռ հասանելի չեն',
    'pools.unavailableMsg': 'IPAM ֆոնդերը կհայտնվեն այստեղ՝ գույքագրման ծառայությունը միանալուց հետո։',
    'pools.denied': 'Ռեսուրսների ֆոնդերը հասանելի են միայն ադմիններին։',
    // B23 — usage module toast messages + i18n keys
    'usage.recorded': 'Օգտագործումը գրանցվեց',
    'usage.loadError': 'Չհաջողվեց բեռնել օգտագործման տվյալները',
    'usage.unavailable': 'Օգտագործումը դեռ հասանելի չէ',
    'usage.unavailableMsg': 'Չափված օգտագործումը կհայտնվի այստեղ՝ գնահատման ծառայությունը միանալուց հետո։',
    'usage.denied': 'Դուք իրավունք չունեք դիտելու օգտագործման տվյալները',
    // B23 — report builder module toast messages + i18n keys
    'reports.saved': 'Հաշվետվությունը պահպանվեց',
    'reports.deleted': 'Հաշվետվությունը ջնջվեց',
    'reports.loadError': 'Չհաջողվեց բեռնել հաշվետվությունները',
    'reports.runError': 'Չհաջողվեց գործարկել հաշվետվությունը',
    'reports.unavailable': 'Հաշվ. կառուցիչը դեռ հասանելի չէ',
    'reports.unavailableMsg': 'Պահված հաշվետվությունները կհայտնվեն այստեղ՝ ծրագիրը միանալուց հետո։',
    // B24 — schedule-a-report + export format buttons
    'sched.title': 'Ժամանակացույց',
    'sched.new': '+ Ժամանակացույց',
    'sched.report': 'Հաշվետվություն',
    'sched.cadence': 'Հաճախականություն',
    'sched.cadenceDaily': 'Ամենօրյա',
    'sched.cadenceWeekly': 'Շաբաթական',
    'sched.cadenceMonthly': 'Ամսական',
    'sched.channel': 'Ուղի',
    'sched.channelEmail': 'Էլ. փոստ',
    'sched.channelSlack': 'Slack',
    'sched.channelWebhook': 'Webhook',
    'sched.recipients': 'Ստացողներ',
    'sched.recipientsHint': 'Ստոր-ստոր բաժանված էլ. հասցեներ / ID-ներ',
    'sched.save': 'Պահպանել ժամանակացույցը',
    'sched.created': 'Ժամանակացույցը ստեղծվեց',
    'sched.paused': 'Ժամանակացույցը դադարեցվեց',
    'sched.resumed': 'Ժամանակացույցը վերսկսվեց',
    'sched.deleted': 'Ժամանակացույցը ջնջվեց',
    'sched.loadError': 'Չհաջողվեց բեռնել ժամանակացույցները',
    'sched.saveError': 'Չհաջողվեց պահպանել ժամանակացույցը',
    'sched.unavailable': 'Ժամանակացույցը դեռ հասանելի չէ',
    'sched.unavailableMsg': 'Ամրագրված հաշվետվությունները կհայտնվեն այստեղ՝ ծառայությունը միանալուց հետո։',
    'sched.nextRun': 'Հաջ. գործ.',
    'sched.status': 'Կարգ.',
    'sched.active': 'Ակտիվ',
    'sched.paused_label': 'Դադ.',
    'sched.pause': 'Դադ.',
    'sched.resume': 'Վերսկ.',
    'sched.delete': 'Ջնջ.',
    'sched.noSchedules': 'Ժամ. դեռ չկան',
    'sched.noSchedulesMsg': 'Ամրագրեք հաշվ. ստանալ ամենօրյա/շաբաթ./ամսական։',
    'export.label': 'Արտահանել',
    'export.csv': 'CSV',
    'export.xlsx': 'XLSX',
    'export.pdf': 'PDF',
    'export.error': 'Արտ. ձախողվեց',
    // B23 — interactions module toast messages + i18n keys
    'interactions.logged': 'Փոխգործակցումը գրանցվեց',
    'interactions.loadError': 'Չհաջողվեց բեռնել փոխգործակցումները',
    'interactions.unavailable': 'Փոխգործակցումները դեռ հասանելի չեն',
    'interactions.unavailableMsg': 'Գրանցված կոնտակտները կհայտնվեն այստեղ՝ կոնտակտ-կենտրոնի ծառայությունը միանալուց հետո։',
    'interactions.denied': 'Դուք իրավունք չունեք դիտելու փոխգործակցումները',
    // B22 — pagination + system status + entity states
    'pager.prev': 'Հետ', 'pager.next': 'Առաջ',
    'pager.info': '{from}–{to} / {total}',
    'pager.ariaLabel': 'Էջային նավիգացիա',
    'status.operational': 'Գործում է', 'status.issue': 'Խնդիր',
    'status.checking': 'Ստուգվում…', 'status.label': 'Համակարգի կարգավիճակ',
    'entity.noMatch': 'Որոնմանը համապատասխան գրառումներ չկան',
    'entity.loadError': 'Չհաջողվեց բեռնել այս կազմաձևը',
    'entity.permDenied': 'Դուք թույլտվություն չունեք դիտելու այս գրառումները',
    // B21 — no-access screen + read-only mode
    'noaccess.title': 'Դուք մուտք չունեք',
    'noaccess.msg': 'Դուք թույլտվություն չունեք դիտելու այս ռեսուրսը։ Կապվեք ձեր ադմինի հետ, եթե անհրաժեշտ է մուտք։',
    'noaccess.msgSpecific': 'Դուք թույլտվություն չունեք դիտելու {what}։',
    'noaccess.back': 'Վերադառնալ վահանակ',
    'noaccess.ariaLabel': 'Մուտք արգելված',
    'noaccess.backAriaLabel': 'Վերադառնալ վահանակ',
    'readonly.hint': 'Կարդալու ռեժիմ — կարող եք դիտել, բայց ոչ փոփոխել գրառումները։',
    'readonly.ariaLabel': 'Կարդալու ռեժիմ',
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
