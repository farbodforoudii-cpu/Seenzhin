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

// Compact: 28,000,000 -> «۲۸ میلیون»; 1,250,000 -> «۱٫۳ میلیون»; 850,000 -> «۸۵۰ هزار». Number isolated from the unit.
export function short(n) {
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  const t = x => (x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));
  if (a >= 1e9) return iso(sign + faDigits(t(a / 1e9)).replace('.', '٫')) + ' میلیارد';
  if (a >= 1e6) return iso(sign + faDigits(t(a / 1e6)).replace('.', '٫')) + ' میلیون';
  if (a >= 1e3) return iso(sign + faDigits(Math.round(a / 1e3))) + ' هزار';
  return iso(sign + faDigits(Math.round(a)));
}
// Split for ring centres and hero numbers: { num: '۲٫۳', unit: 'میلیون' }
export function shortParts(n) {
  const a = Math.abs(n), t = x => faDigits(x >= 100 ? Math.round(x) : Math.round(x * 10) / 10).replace('.', '٫');
  if (a >= 1e9) return { num: t(n / 1e9), unit: 'میلیارد تومان' };
  if (a >= 1e6) return { num: t(n / 1e6), unit: 'میلیون تومان' };
  if (a >= 1e3) return { num: faDigits(Math.round(n / 1e3)), unit: 'هزار تومان' };
  return { num: faDigits(Math.round(n)), unit: 'تومان' };
}
