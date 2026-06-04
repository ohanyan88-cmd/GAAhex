// DF-7 — canonical AMD formatter for the customer portal.
//
// Portal uses the Armenian (hy-AM) locale so grouping marks match the
// customer's expectation in Armenia; admin SPA uses en-US (see
// frontend/src/lib/money.ts). The two locales render integers identically
// but diverge on decimal separator. Backend stores amounts as integer luma
// (minor units; 100 = 1 ֏).

export function fmt(luma: number): string {
  return (luma / 100).toLocaleString('hy-AM', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' ֏'
}
