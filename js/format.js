const FA = '۰۱۲۳۴۵۶۷۸۹';
export const faDigits = s => String(s).replace(/\d/g, d => FA[d]);

// Whole number with thousand separators in Persian digits: 28000000 -> ۲۸٬۰۰۰٬۰۰۰
export function fmt(n) {
  const v = Math.round(n), neg = v < 0;
  return faDigits((neg ? '-' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '٬'));
}

// Decimal (weights, factors): 2.5 -> ۲٫۵
export const fmtDec = n => faDigits(String(Math.round(n * 100) / 100).replace('.', '٫'));

// Number wrapped in Unicode isolates so a unit word can never land between its digits (Safari bug).
export const iso = s => '⁦' + s + '⁩';
export const toman = n => `${iso(fmt(n))} تومان`;

// Typed text (Persian or Latin digits, separators, decimal mark) -> number, or null when empty/invalid.
export function parseNum(s) {
  const t = String(s ?? '')
    .replace(/[۰-۹]/g, d => FA.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[٬,\s]/g, '').replace(/[٫/]/g, '.');
  if (!t) return null;
  const v = Number(t);
  return isFinite(v) ? v : null;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function faDate(ts) {
  try { return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(ts)); }
  catch { return ''; }
}
