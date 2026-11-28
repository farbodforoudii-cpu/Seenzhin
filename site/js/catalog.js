// Pure logic of the Seenzhin website: no DOM here, so every rule is tested in Node (tests/site-core.test.mjs).
// The site only ever sees the public catalog the app publishes (`siteCatalog` in ../../js/site.js, decision 20):
// name, short text, photos, category and type, metal, weight, approved price, available / made to order.
// It never sees costs, factors, workshop numbers or customers. Self-contained on purpose: the site is deployed
// on its own (Iranian host, decision 21), so it imports nothing from the app.

const FA = '۰۱۲۳۴۵۶۷۸۹';
export const faDigits = s => String(s).replace(/\d/g, d => FA[d]);
export const fmt = n => faDigits(String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '٬'));
export const fmtDec = n => faDigits(String(Math.round(n * 100) / 100).replace('.', '٫'));
// Number wrapped in Unicode isolates so a unit word can never land between its digits (Safari bug).
export const iso = s => '⁦' + s + '⁩';
export const toman = n => `${iso(fmt(n))} تومان`;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Short price for cards: ۱۲٫۵ میلیون تومان. Exact price stays on the product page.
export function shortPrice(n) {
  if (!(n > 0)) return '';
  if (n >= 1e9) return `${iso(fmtDec(n / 1e9))} میلیارد تومان`;
  if (n >= 1e6) return `${iso(fmtDec(Math.round(n / 1e5) / 10))} میلیون تومان`;
  return toman(n);
}

// Typed text (Persian, Arabic or Latin digits, separators) -> digits only.
export const latinDigits = s => String(s ?? '').replace(/[۰-۹]/g, d => FA.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

export const AVAIL = {
  available: { name: 'موجود', hint: 'تک‌نسخه؛ آمادهٔ ارسال' },
  'made-to-order': { name: 'سفارشی', hint: 'پس از سفارش ساخته می‌شود' },
};

// Category names the app uses (model.js CATEGORIES) -> short URL slugs. Unknown names still work (slug = name).
export const CATS = [
  { slug: 'jewelry', name: 'جواهرات' },
  { slug: 'panel', name: 'تابلوی نقره' },
  { slug: 'statue', name: 'تندیس و مجسمه' },
  { slug: 'craft', name: 'دست‌سازها' },
];
export const catSlug = name => (CATS.find(c => c.name === name) || {}).slug || name;
export const catName = slug => (CATS.find(c => c.slug === slug) || {}).name || slug;

// Accepts the raw JSON the app publishes and returns a clean list. Anything malformed is dropped, never shown half.
export function normalize(raw) {
  const items = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);
  const seen = new Set();
  return items.filter(p => p && p.id != null && String(p.title || '').trim() && !seen.has(String(p.id)) && seen.add(String(p.id)))
    .map((p, i) => ({
      id: String(p.id),
      title: String(p.title).trim(),
      desc: String(p.desc || '').trim(),
      category: String(p.category || '').trim(),
      type: String(p.type || '').trim(),
      material: String(p.material || '').trim(),
      weight: Number(p.weight) > 0 ? Number(p.weight) : null,
      price: Number(p.price) > 0 ? Math.round(Number(p.price)) : null,
      availability: p.availability === 'available' ? 'available' : 'made-to-order',
      photos: (Array.isArray(p.photos) ? p.photos : []).filter(u => typeof u === 'string' && u),
      order: i,
    }));
}

// Filters from the shop page. q: free text; cat: category slug; avail: 'available' | ''; sort: 'new' | 'cheap' | 'dear'.
export function filterItems(items, { q = '', cat = '', avail = '', sort = 'new' } = {}) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  let out = items.filter(p => (!cat || catSlug(p.category) === cat) && (!avail || p.availability === avail)
    && words.every(w => norm([p.title, p.desc, p.category, p.type, p.material].join(' ')).includes(w)));
  const byPrice = dir => (a, b) => (a.price == null) - (b.price == null) || dir * ((a.price || 0) - (b.price || 0));
  if (sort === 'cheap') out = [...out].sort(byPrice(1));
  else if (sort === 'dear') out = [...out].sort(byPrice(-1));
  else out = [...out].sort((a, b) => a.order - b.order);
  return out;
}
// Persian search forgiveness: Arabic ي/ك, zero-width non-joiner, case.
const norm = s => String(s).toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ');

// Categories that actually have items, in the app's order, with counts.
export function categoriesOf(items) {
  const names = [...new Set(items.map(p => p.category).filter(Boolean))];
  const known = CATS.filter(c => names.includes(c.name)).map(c => c.name);
  return [...known, ...names.filter(n => !known.includes(n))]
    .map(name => ({ name, slug: catSlug(name), count: items.filter(p => p.category === name).length }));
}

// Up to n others: same category first, available before made to order.
export function related(items, p, n = 4) {
  const score = o => (o.category === p.category ? 2 : 0) + (o.type === p.type ? 1 : 0) + (o.availability === 'available' ? 0.5 : 0);
  return items.filter(o => o.id !== p.id).sort((a, b) => score(b) - score(a) || a.order - b.order).slice(0, n);
}

// Spec lines for the product page; only what is known.
export function specs(p) {
  return [
    p.category && ['دسته', p.type ? `${p.category}، ${p.type}` : p.category],
    p.material && ['فلز', p.material === 'نقره' ? 'نقرهٔ ۹۲۵' : p.material],
    p.weight && ['وزن تقریبی', `${iso(fmtDec(p.weight))} گرم`],
    ['وضعیت', `${AVAIL[p.availability].name}؛ ${AVAIL[p.availability].hint}`],
  ].filter(Boolean);
}

// Message the customer sends (WhatsApp prefill, or copied for Instagram Direct). Product code lets Servin find it.
export function orderMessage(p, url) {
  return [
    'سلام، وقت بخیر.',
    `برای «${p.title}» پیام می‌دهم${p.availability === 'made-to-order' ? ' و سفارش ساخت آن را می‌خواهم' : ''}.`,
    p.price ? `قیمت روی سایت: ${fmt(p.price)} تومان` : '',
    `کد محصول: ${p.id}`,
    url || '',
  ].filter(Boolean).join('\n');
}

// Custom order form. Returns { ok, errors: {field: text}, message }.
export const CUSTOM_KINDS = ['جواهر', 'تابلوی نقره', 'تندیس یا مجسمه', 'شیء دست‌ساز'];
export const CUSTOM_METALS = ['نقره', 'طلا', 'برنز', 'هنوز نمی‌دانم'];
export const CUSTOM_BUDGETS = ['تا ۲۰ میلیون', '۲۰ تا ۵۰ میلیون', '۵۰ تا ۱۵۰ میلیون', 'بیش از ۱۵۰ میلیون', 'نیاز به راهنمایی دارم'];
export function customRequest(f) {
  const errors = {};
  const phone = latinDigits(f.phone).replace(/[\s\-()]/g, '');
  if (!String(f.name || '').trim()) errors.name = 'نام خود را بنویسید.';
  if (!CUSTOM_KINDS.includes(f.kind)) errors.kind = 'نوع کار را انتخاب کنید.';
  if (String(f.idea || '').trim().length < 10) errors.idea = 'چند کلمه دربارهٔ طرحی که در ذهن دارید بنویسید.';
  if (phone && !/^(\+|00)?\d{8,15}$/.test(phone)) errors.phone = 'شماره درست به نظر نمی‌رسد.';
  if (!phone && !String(f.insta || '').trim()) errors.phone = 'یک راه تماس (شماره یا اینستاگرام) لازم است.';
  const ok = !Object.keys(errors).length;
  const message = ok ? [
    'سلام، درخواست سفارش اختصاصی دارم.',
    `نوع: ${f.kind}`,
    f.metal ? `فلز: ${f.metal}` : '',
    f.budget ? `بودجه: ${f.budget}` : '',
    f.when ? `زمان: ${String(f.when).trim()}` : '',
    `طرح: ${String(f.idea).trim()}`,
    `نام: ${String(f.name).trim()}`,
    phone ? `تماس: ${phone}` : '',
    f.insta ? `اینستاگرام: @${String(f.insta).trim().replace(/^@/, '')}` : '',
  ].filter(Boolean).join('\n') : '';
  return { ok, errors, message };
}

// Contact links from site.json. WhatsApp takes an Iranian mobile (09…) or an international number.
export function waLink(number, text) {
  let n = latinDigits(number).replace(/\D/g, '');
  if (!n) return '';
  if (n.startsWith('00')) n = n.slice(2); else if (n.startsWith('0')) n = '98' + n.slice(1);
  return `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}`;
}
export const igLink = h => (h = String(h || '').trim().replace(/^@/, '')) ? `https://instagram.com/${encodeURIComponent(h)}` : '';
export const tgLink = h => (h = String(h || '').trim().replace(/^@/, '')) ? `https://t.me/${encodeURIComponent(h)}` : '';

// Routes (hash based: works on any static host, no server rewrite rules needed).
// #/  #/shop?cat=&avail=&sort=&q=  #/p/<id>  #/custom  #/saved  #/about  #/care  #/contact
export function parseRoute(hash) {
  const h = String(hash || '').replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  const query = Object.fromEntries(new URLSearchParams(qs));
  const page = parts[0] || 'home';
  if (page === 'p' && parts[1]) return { page: 'product', id: parts[1], query };
  if (['home', 'shop', 'custom', 'saved', 'about', 'care', 'contact'].includes(page)) return { page, query };
  return { page: 'notfound', query };
}
export function shopHash(q) {
  const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v && !(v === 'new'))).toString();
  return '#/shop' + (s ? '?' + s : '');
}
