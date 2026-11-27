// Sales invoices: totals, numbering and a clean image of the invoice (to share in Instagram DMs or print as PDF).
import { fmt, faDigits } from './format.js';

const n = v => (typeof v === 'number' && isFinite(v) ? v : 0);

// subtotal − discount + shipping = total; total − paid = remaining (never below zero).
export function totals(inv) {
  const subtotal = (inv.items || []).reduce((a, it) => a + n(it.price) * (it.qty || 1), 0);
  const total = Math.max(0, subtotal - n(inv.discount) + n(inv.shipping));
  const paid = n(inv.paid);
  const remaining = Math.max(0, total - paid);
  const status = total > 0 && paid >= total ? 'paid' : paid > 0 ? 'deposit' : 'unpaid';
  return { subtotal, total, paid, remaining, status };
}
export const STATUS_NAME = { paid: 'تسویه شد', deposit: 'بیعانه', unpaid: 'پرداخت نشده' };

export const jYear = d => parseInt(new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric' }).format(d), 10);
// Invoice number per Jalali year: 1405-001, 1405-002, …
export function nextNumber(invoices, now = new Date()) {
  const y = jYear(now);
  const seq = invoices.filter(i => i.no && i.no.startsWith(y + '-')).map(i => parseInt(i.no.split('-')[1], 10) || 0);
  return `${y}-${String((seq.length ? Math.max(...seq) : 0) + 1).padStart(3, '0')}`;
}
// Shown left-to-right as one piece so RTL text can never flip it into «۰۰۱-۱۴۰۵».
// In the app: «شمارهٔ ۱» (the year is on the invoice image, drawn left-to-right there).
export const noFa = no => 'شمارهٔ ' + faDigits(parseInt(String(no).split('-')[1], 10) || 0);
const dateFa = ts => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(ts));

// Amount in words for the invoice: 19000000 → «نوزده میلیون»
const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد'];
function three(n) {
  const out = [], h = Math.floor(n / 100), r = n % 100;
  if (h) out.push(HUNDREDS[h]);
  if (r >= 10 && r < 20) out.push(TEENS[r - 10]);
  else { if (Math.floor(r / 10)) out.push(TENS[Math.floor(r / 10)]); if (r % 10) out.push(ONES[r % 10]); }
  return out.join(' و ');
}
export function words(n) {
  n = Math.round(Math.abs(n));
  if (!n) return 'صفر';
  const g = []; let i = 0;
  while (n > 0 && i < SCALES.length) { const x = n % 1000; if (x) g.unshift(three(x) + (SCALES[i] ? ' ' + SCALES[i] : '')); n = Math.floor(n / 1000); i++; }
  return g.join(' و ');
}

// ---------- image: a formal, minimal invoice on the brand mint ----------
const W = 1080, M = 72, R = W - M, L = M;
const C = { bg: '#d4e1d8', paper: '#fbfaf7', ink: '#33382f', sec: '#626a62', faint: '#8d958d', line: '#bccbc0', gold: '#a8883e', ok: '#56735f', warn: '#8f6f30' };
const LEVEL = { simple: 'ساده', designed: 'طراحی اختصاصی', special: 'کار خاص و تک' };
const METAL = { silver: 'نقره', gold: 'طلا', bronze: 'برنز' };

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function fit(ctx, text, maxW) { let t = String(text); while (ctx.measureText(t).width > maxW && t.length > 2) t = t.slice(0, -2); return t === String(text) ? t : t + '…'; }
function wrap(ctx, text, maxW) {
  const out = []; let cur = '';
  for (const w of String(text).split(' ')) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur); return out;
}
// One line under each item: what it is, its metal and weight, and the level of work.
function spec(it) {
  if (it.material || it.weight || it.level) {
    return [it.sub, it.material ? (it.material === 'silver' ? 'نقرهٔ ۹۲۵' : METAL[it.material]) : '', it.weight ? `${faDigits(it.weight)} گرم` : '', LEVEL[it.level] || ''].filter(Boolean).join('، ');
  }
  return it.detail || '';
}

// inv: invoice; brand: { instagram, phone, thanks, care }; logo: HTMLImageElement|null; photo(id): HTMLImageElement|null
export async function renderInvoice(inv, brand, logo, photo) {
  try { await Promise.all([document.fonts.load('400 30px Vazirmatn'), document.fonts.load('800 30px Vazirmatn')]); } catch { /* fallback font */ }
  const T = totals(inv), items = inv.items || [];
  const ROW = 168, hasNote = !!(inv.note && inv.note.trim());
  // Drawn on a tall sheet, then cut to the real height of the content (so nothing can ever overlap).
  let H = 4000;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'); ctx.direction = 'rtl';
  const font = (w, sz, fam = 'Vazirmatn, sans-serif') => { ctx.font = `${w} ${sz}px ${fam}`; };
  const txt = (s, x, y, align = 'right', color = C.ink) => { ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y); };
  const ltr = (s, x, y, align, color) => { ctx.direction = 'ltr'; txt(s, x, y, align, color); ctx.direction = 'rtl'; };
  const hair = (y, x1 = L, x2 = R, color = C.line, w = 1.5) => { ctx.fillStyle = color; ctx.fillRect(x1, y, x2 - x1, w); };
  const money = v => fmt(v);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

  // header: logo and the brand line, centred
  let y = 56;
  if (logo) { const h = 170, w = Math.min(560, logo.naturalWidth * h / logo.naturalHeight); ctx.drawImage(logo, (W - w) / 2, y, w, h); y += h + 26; }
  font(400, 19, 'Georgia, "Times New Roman", serif'); ctx.letterSpacing = '6px';
  ltr('HANDCRAFTED FOR SELF & SPACE', W / 2 + 3, y, 'center', C.gold); ctx.letterSpacing = '0px';
  y += 46; hair(y, W / 2 - 60, W / 2 + 60, C.gold, 2);

  // title and the invoice facts
  y += 84;
  font(800, 48); txt('فاکتور فروش', R, y);
  font(400, 24); txt('شمارهٔ فاکتور', L + 230, y - 30, 'right', C.faint); txt('تاریخ', L + 230, y + 12, 'right', C.faint);
  font(700, 26); ltr(faDigits(inv.no), L, y - 30, 'left', C.ink);
  txt(new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(inv.date)), L, y + 12, 'left');

  // seller and buyer
  y += 56;
  const boxW = (R - L - 24) / 2, boxH = 150;
  const party = (x, label, lines) => {
    rr(ctx, x, y, boxW, boxH, 22); ctx.fillStyle = C.paper; ctx.fill();
    font(400, 22); txt(label, x + boxW - 26, y + 44, 'right', C.faint);
    lines.forEach((l, k) => { font(k ? 400 : 700, k ? 24 : 30); (l.ltr ? ltr : txt)(fit(ctx, l.t, boxW - 52), l.ltr ? x + 26 : x + boxW - 26, y + 90 + k * 38, l.ltr ? 'left' : 'right', k ? C.sec : C.ink); });
  };
  party(R - boxW, 'فروشنده', [{ t: 'سینژین' }, ...(brand.instagram ? [{ t: '@' + brand.instagram.replace(/^@/, ''), ltr: true }] : [])]);
  const cn = inv.customer && inv.customer.name, cp = inv.customer && inv.customer.phone;
  party(L, 'خریدار', [{ t: cn || 'مشتری گرامی' }, ...(cp ? [{ t: faDigits(cp), ltr: true }] : [])]);
  y += boxH + 52;

  // items table
  font(400, 22); txt('شرح کالا', R - 24, y, 'right', C.faint); txt('مبلغ (تومان)', L + 24, y, 'left', C.faint);
  y += 18; hair(y);
  items.forEach((it, k) => {
    const top = y + 18, th = ROW - 36;
    font(400, 22); txt(faDigits(k + 1), R - 8, top + th / 2 + 8, 'right', C.faint);
    const img = it.photo ? photo(it.photo) : null, tx = R - 44 - th;
    ctx.save(); rr(ctx, tx, top, th, th, 18); ctx.clip();
    if (img) { const sc = Math.max(th / img.naturalWidth, th / img.naturalHeight), w = img.naturalWidth * sc, h = img.naturalHeight * sc; ctx.drawImage(img, tx + (th - w) / 2, top + (th - h) / 2, w, h); }
    else { ctx.fillStyle = C.paper; ctx.fillRect(tx, top, th, th); }
    ctx.restore();
    const nx = tx - 26;
    font(700, 32); txt(fit(ctx, it.title || 'محصول', 470), nx, top + 46);
    font(400, 23); txt(fit(ctx, spec(it), 470), nx, top + 92, 'right', C.sec);
    font(700, 32); txt(money(it.price), L + 24, top + th / 2 + 12, 'left');
    y += ROW; hair(y);
  });

  // totals, in a paper card aligned to the left like an amount column
  y += 40;
  const rows = [['جمع اقلام', money(T.subtotal)]];
  if (inv.discount) rows.push(['تخفیف', '− ' + money(inv.discount)]);
  if (inv.shipping) rows.push(['هزینهٔ ارسال', money(inv.shipping)]);
  const cardW = 560, cardX = L, cardH = 72 + rows.length * 52 + 120 + (T.paid ? 104 : 0);
  rr(ctx, cardX, y, cardW, cardH, 26); ctx.fillStyle = C.paper; ctx.fill();
  let ty = y + 58;
  for (const [k, v] of rows) { font(400, 25); txt(k, cardX + cardW - 30, ty, 'right', C.sec); txt(v, cardX + 30, ty, 'left'); ty += 52; }
  hair(ty - 22, cardX + 30, cardX + cardW - 30);
  ty += 22; font(800, 30); txt('مبلغ قابل پرداخت', cardX + cardW - 30, ty); font(800, 38); txt(money(T.total), cardX + 30, ty + 2, 'left');
  ty += 46; font(400, 21); txt(fit(ctx, `به حروف: ${words(T.total)} تومان`, cardW - 60), cardX + cardW - 30, ty, 'right', C.faint);
  if (T.paid) {
    ty += 56; font(400, 25); txt('پرداخت‌شده', cardX + cardW - 30, ty, 'right', C.sec); txt(money(T.paid), cardX + 30, ty, 'left');
    ty += 48; txt('مانده', cardX + cardW - 30, ty, 'right', T.remaining ? C.warn : C.sec); txt(money(T.remaining), cardX + 30, ty, 'left', T.remaining ? C.warn : C.ink);
  }
  // status, next to the totals
  const st = STATUS_NAME[T.status], sc = T.status === 'paid' ? C.ok : C.warn;
  font(700, 26); const sw = ctx.measureText(st).width + 60;
  rr(ctx, R - sw, y + 20, sw, 58, 29); ctx.strokeStyle = sc; ctx.lineWidth = 2.5; ctx.stroke(); txt(st, R - sw / 2, y + 59, 'center', sc);
  y += cardH + 50;

  if (hasNote) { font(400, 22); txt('توضیحات', R, y, 'right', C.faint); font(400, 25); txt(fit(ctx, inv.note, R - L), R, y + 42, 'right', C.sec); y += 110; }

  // footer: care, thanks, contact, the brand line, right under the content
  y += 20; H = y + 290;
  hair(H - 250);
  font(400, 22);
  wrap(ctx, brand.care || 'نگهداری: جواهر نقره را دور از رطوبت، عطر و مواد شیمیایی و در کیسهٔ خودش نگه دارید.', R - L).slice(0, 2).forEach((l, k) => txt(l, W / 2, H - 200 + k * 34, 'center', C.sec));
  font(700, 26); (/[a-z]/i.test(brand.thanks || '') ? ltr : txt)(brand.thanks || 'از انتخاب شما سپاسگزاریم', W / 2, H - 118, 'center', C.ink);
  const contact = [brand.instagram ? '@' + brand.instagram.replace(/^@/, '') : '', brand.phone ? faDigits(brand.phone) : ''].filter(Boolean).join('    |    ');
  if (contact) { font(400, 22); ltr(contact, W / 2, H - 76, 'center', C.sec); }
  font(400, 18, 'Georgia, "Times New Roman", serif'); ctx.letterSpacing = '4px'; ltr('seen for vision, zhin for life', W / 2 + 2, H - 36, 'center', C.gold); ctx.letterSpacing = '0px';
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  out.getContext('2d').drawImage(cv, 0, 0);
  return out;
}
