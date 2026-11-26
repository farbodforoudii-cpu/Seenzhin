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

// ---------- image ----------
const W = 1080, PAD = 72, IN = 28, R = W - PAD, L = PAD, TR = R - IN, TL = L + IN; // TR/TL: the one text column edge for every row
const C = { bg: '#faf8f4', ink: '#1d1c1a', sec: '#7a746c', line: '#e6e1d8', acc: '#a5814f', soft: '#f1ede6', ok: '#5f7f66', warn: '#b07a2c' };

function wrap(ctx, text, maxW) {
  const words = String(text).split(' '), lines = [];
  let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

// inv: invoice; brand: { name, instagram, phone, thanks }; logo: HTMLImageElement|null; photo(id): HTMLImageElement|null
export async function renderInvoice(inv, brand, logo, photo) {
  try { await Promise.all([document.fonts.load('400 30px Vazirmatn'), document.fonts.load('800 30px Vazirmatn')]); } catch { /* fallback font */ }
  const T = totals(inv);
  const items = inv.items || [];
  const rowH = 150;
  const H = 520 + items.length * rowH + 440 + (inv.note ? 80 : 0);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.direction = 'rtl';
  const font = (w, s) => { ctx.font = `${w} ${s}px Vazirmatn, sans-serif`; };
  const txt = (s, x, y, align = 'right', color = C.ink) => { ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y); };
  const money = v => `${fmt(v)} تومان`;
  const ltr = (s, x, y, align, color) => { ctx.direction = 'ltr'; txt(s, x, y, align, color); ctx.direction = 'rtl'; };
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.acc; ctx.fillRect(0, 0, W, 10);

  // brand, centred
  let y = 70;
  if (logo) {
    const h = 130, w = Math.min(420, logo.naturalWidth * h / logo.naturalHeight);
    ctx.drawImage(logo, (W - w) / 2, y, w, h); y += h + 30;
  } else {
    font(800, 54); ctx.letterSpacing = '14px'; ctx.direction = 'ltr'; txt('SEENZHIN', W / 2 + 7, y + 60, 'center'); ctx.letterSpacing = '0px'; ctx.direction = 'rtl';
    font(400, 30); txt(brand.name || 'سینژین', W / 2, y + 110, 'center', C.sec); y += 150;
  }
  // title row
  y += 40;
  font(800, 44); txt('فاکتور فروش', TR, y);
  font(400, 28); ltr(faDigits(inv.no), TL, y - 14, 'left', C.sec); txt(dateFa(inv.date), TL, y + 26, 'left', C.sec);
  y += 50; ctx.fillStyle = C.line; ctx.fillRect(L, y, R - L, 2);

  // customer
  y += 62;
  font(400, 28); txt('خریدار', TR, y, 'right', C.sec);
  font(700, 32); txt((inv.customer && inv.customer.name) || '—', TR - 110, y);
  if (inv.customer && inv.customer.phone) { font(400, 28); ltr(faDigits(inv.customer.phone), TL, y, 'left', C.sec); }
  y += 46;

  // items
  for (const it of items) {
    rr(ctx, L, y, R - L, rowH - 18, 24); ctx.fillStyle = '#ffffff'; ctx.fill();
    const img = it.photo ? photo(it.photo) : null, th = rowH - 50, tx = R - 16 - th, ty = y + 16;
    if (img) {
      ctx.save(); rr(ctx, tx, ty, th, th, 18); ctx.clip();
      const s = Math.max(th / img.naturalWidth, th / img.naturalHeight), w = img.naturalWidth * s, h = img.naturalHeight * s;
      ctx.drawImage(img, tx + (th - w) / 2, ty + (th - h) / 2, w, h); ctx.restore();
    } else { rr(ctx, tx, ty, th, th, 18); ctx.fillStyle = C.soft; ctx.fill(); }
    const nx = tx - 24;
    font(700, 32); txt(wrap(ctx, it.title || 'محصول', 430)[0], nx, y + 58);
    font(400, 24); txt(it.detail || '', nx, y + 98, 'right', C.sec);
    font(700, 32); txt(money(it.price), TL, y + 76, 'left');
    y += rowH;
  }

  // totals, aligned in two columns: label on the right, amount on the left
  y += 20;
  const row = (label, v, opt = {}) => { font(opt.bold ? 800 : 400, opt.bold ? 38 : 28); txt(label, TR, y, 'right', opt.color || (opt.bold ? C.ink : C.sec)); txt(v, TL, y, 'left', opt.color || C.ink); y += opt.bold ? 64 : 48; };
  row('جمع اقلام', money(T.subtotal));
  if (inv.shipping) row('ارسال', money(inv.shipping));
  if (inv.discount) row('تخفیف', '− ' + money(inv.discount));
  ctx.fillStyle = C.line; ctx.fillRect(L, y - 24, R - L, 2); y += 22;
  row('مبلغ کل', money(T.total), { bold: true });
  if (T.paid) row('دریافت‌شده', money(T.paid));
  if (T.remaining && T.paid) row('مانده', money(T.remaining), { color: C.warn });

  // status stamp
  const st = STATUS_NAME[T.status], sc = T.status === 'paid' ? C.ok : C.warn;
  font(700, 28); const sw = ctx.measureText(st).width + 56;
  rr(ctx, TR - sw, y, sw, 56, 28); ctx.strokeStyle = sc; ctx.lineWidth = 3; ctx.stroke(); txt(st, TR - sw / 2, y + 38, 'center', sc);
  y += 100;
  if (inv.note) { font(400, 26); txt(wrap(ctx, inv.note, TR - TL)[0], TR, y, 'right', C.sec); y += 60; }

  // footer
  ctx.fillStyle = C.line; ctx.fillRect(L, H - 150, R - L, 2);
  font(400, 28); txt(brand.thanks || 'از انتخاب شما سپاسگزاریم', W / 2, H - 98, 'center');
  // Latin handle and phone are drawn left-to-right as one line, separated by a thin bar (never «·»).
  const contact = [brand.instagram ? '@' + brand.instagram.replace(/^@/, '') : '', brand.phone ? faDigits(brand.phone) : ''].filter(Boolean).join('    |    ');
  if (contact) { font(400, 26); ltr(contact, W / 2, H - 52, 'center', C.sec); }
  return cv;
}
