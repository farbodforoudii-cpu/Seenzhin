import { db, requestPersistence } from './db.js';
import {
  FORMULAS, CATEGORIES, LEVELS, MATERIALS, STATUSES, ROUNDING,
  defaultSettings, catOf, formulaOf, matOf, levelOf, supplierOf, price, drifted, setupSteps,
} from './model.js';
import { fmt, fmtDec, iso, parseNum, esc, faDigits, short, shortParts } from './format.js';
import { insights, suggestInvoice, marketGap, shownPrice } from './analysis.js';
import { totals, nextNumber, noFa, STATUS_NAME, renderInvoice } from './invoice.js';

// Design rules shared with hesab-man / Life-os: logic → numbers → trend; one big number with one sentence;
// short numbers («۷٫۹ میلیون»); details only on request; every percentage says what it divides.
const S = { settings: null, products: [], invoices: [], tab: 'home', filter: 'all', market: null, ed: null, inv: null, logo: null };
const urls = new Map();
const $ = (sel, el = document) => el.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const REDUCED = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Digits in generated sentences → Persian, isolated so a unit can never land between them.
const say = s => esc(faDigits(String(s))).replace(/([۰-۹])\.([۰-۹])/g, '$1٫$2').replace(/[۰-۹][۰-۹٫٬]*٪?/g, m => iso(m));
const plain = n => short(n).replace(/[⁦⁩]/g, '');
const MARKET_NAME = { silver: 'نقرهٔ ۹۹۹', gold: 'طلای ۱۸ عیار' };
const ICON = {
  home: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  analysis: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chev: '<path d="M15 6l-6 6 6 6"/>',
  sales: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
};
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

// ---------- boot ----------
async function boot() {
  S.settings = Object.assign(defaultSettings(), (await db.get('settings')) || {});
  S.products = (await db.all('products')).sort((a, b) => b.createdAt - a.createdAt);
  for (const ph of await db.all('photos')) urls.set(ph.id, URL.createObjectURL(ph.blob));
  S.invoices = (await db.all('invoices')).sort((a, b) => b.date - a.date);
  const lg = await db.get('logo');
  if (lg) S.logo = URL.createObjectURL(lg);
  requestPersistence();
  bind();
  render();
  loadMarket();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
const saveSettings = () => db.set('settings', S.settings);

// Today's silver (999) and 18k gold per gram in toman, from hesab-man's tgju feed on the same GitHub Pages site.
async function loadMarket() {
  try {
    const r = await fetch('/hesab-man/data/prices.json', { cache: 'no-store' });
    if (!r.ok) return;
    const M = await r.json();
    if (!M.now || !M.now.silver) return;
    S.market = { silver: M.now.silver, gold: M.now.gold, at: M.at };
    if (!$('#sheet').classList.contains('open')) render();
  } catch { /* offline: the app works without it */ }
}

// ---------- shell ----------
const TABS = [['home', 'ویترین'], ['sales', 'فروش'], ['analysis', 'تحلیل'], ['settings', 'تنظیمات']];
function render() {
  $('#tabs').innerHTML = `<div class="inner">${TABS.map(([id, n]) => `<button class="${S.tab === id ? 'on' : ''}" data-tab="${id}">${svg(id)}<span>${n}</span></button>`).join('')}</div>`;
  const v = $('#view');
  v.innerHTML = S.tab === 'home' ? viewHome() : S.tab === 'sales' ? viewSales() : S.tab === 'analysis' ? viewAnalysis() : viewSettings();
  v.querySelectorAll('.enter').forEach((el, i) => el.style.setProperty('--i', Math.min(i, 10)));
  v.querySelectorAll('[data-count]').forEach(countUp);
}

const head = (title, sub, extra = '') => `<header class="phead"><div><span class="psub">${sub}</span><h1>${title}</h1></div>${extra}</header>`;

// Rolling hero number: counts up from 0 (straight to the value with reduced motion).
function countUp(el) {
  const to = Number(el.dataset.count), num = v => shortParts(v).num;
  if (REDUCED() || !to) { el.textContent = num(to); return; }
  const t0 = performance.now(), D = 900;
  const step = t => { const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3); el.textContent = num(to * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function island(text) {
  const el = $('#island');
  el.innerHTML = say(text);
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(island.t); island.t = setTimeout(() => el.classList.remove('show'), 2000);
}

// One row of a to-do / headline list.
function line(x) {
  const tag = x.act ? `button data-act="${x.act}"` : 'div';
  return `<${tag} class="cell todo ${x.tone}"><i class="dot"></i><span class="c-main"><b>${say(x.t)}</b><small>${say(x.d)}</small></span>${x.btn ? `<span class="pill">${x.btn}</span>` : x.act ? svg('chev') : ''}</${x.act ? 'button' : 'div'}>`;
}

// ---------- home: the shop window ----------
function todo() {
  // What needs Servin now, most urgent first; at most three lines.
  const L = [];
  const next = setupSteps(S.settings, S.products).find(s => !s.done);
  if (next) L.push({ tone: 'o', t: next.text, d: 'قدم بعدی برای راه‌اندازی', act: next.id === 'first' ? 'new' : 'settings' });
  for (const g of marketGap(S.settings, S.market)) L.push({ tone: 'o', t: `${MARKET_NAME[g.id]} ${Math.abs(Math.round(g.pct * 100))}٪ ${g.pct > 0 ? 'گران‌تر' : 'ارزان‌تر'} شده است`, d: `بازار ${plain(g.market)}، ثبت‌شده ${plain(g.saved)} تومان هر گرم`, act: 'market:' + g.id, btn: 'به‌روز کن' });
  const dr = drifted(S.products, S.settings);
  if (dr.length) L.push({ tone: 'o', t: `${dr.length} قیمت تازه منتظر تأیید است`, d: 'برای دیدن قیمت قبلی و تازه بزنید', act: 'drift' });
  const inc = S.products.filter(p => p.status !== 'sold' && !price(p, S.settings).complete);
  if (inc.length) L.push({ tone: 'r', t: `${inc.length} محصول هنوز قیمت ندارد`, d: price(inc[0], S.settings).missing[0].text, act: 'edit:' + inc[0].id });
  return L.slice(0, 3);
}

function viewHome() {
  const stock = S.products.filter(p => p.status !== 'sold');
  const value = stock.reduce((a, p) => a + (shownPrice(p, S.settings) || 0), 0);
  const avail = stock.filter(p => p.status === 'available').length, res = stock.length - avail;
  const list = S.products.filter(p => S.filter === 'all' || p.cat === S.filter);
  const T = todo();
  const sp = shortParts(value);
  let h = `<div class="brand-top"><img class="brand-logo" src="brand/logo-sun.png" alt="سینژین"></div>` + head('ویترین', 'سینژین', `<button class="add-pill" data-new>${svg('plus')}<span>محصول</span></button>`);
  h += `<section class="hero enter"><span class="hero-k">ارزش ویترین</span>
    <div class="hero-n"><b data-count="${value}">${sp.num}</b><small>${sp.unit}</small></div>
    <span class="hero-s">${say(stock.length ? `جمع قیمت فروش ${avail} محصول موجود${res ? ` و ${res} رزرو` : ''}` : 'هنوز محصولی ثبت نشده است')}</span></section>`;
  if (T.length) h += `<div class="stitle">کارهای امروز</div><div class="group enter">${T.map(line).join('')}</div>`;
  if (S.products.length) {
    const cats = [{ id: 'all', name: 'همه' }, ...CATEGORIES.filter(c => S.products.some(p => p.cat === c.id))];
    if (cats.length > 2) h += `<div class="chips scroll">${cats.map(c => `<button class="chip ${S.filter === c.id ? 'on' : ''}" data-filter="${c.id}">${c.name}</button>`).join('')}</div>`;
    else h += `<div class="stitle">محصولات</div>`;
    h += `<div class="grid">${list.map(card).join('')}</div>`;
  } else {
    h += `<div class="empty enter"><p>اولین محصول را ثبت کنید؛ قیمتش همان لحظه حساب می‌شود.</p><button class="btn" data-new>ثبت اولین محصول</button></div>`;
  }
  return h;
}

function card(p) {
  const v = shownPrice(p, S.settings);
  const ph = p.photos && p.photos[0] && urls.get(p.photos[0]);
  const name = p.title || [p.sub, levelOf(p.level) && levelOf(p.level).name].filter(Boolean).join('، ') || 'بی‌نام';
  return `<button class="pcard enter" data-edit="${p.id}">
    <div class="thumb">${ph ? `<img src="${ph}" alt="" loading="lazy">` : `<span class="noimg">${esc(p.sub || (catOf(p.cat) || {}).name || '')}</span>`}
      ${p.status !== 'available' ? `<span class="badge s-${p.status}">${STATUSES.find(s => s.id === p.status).name}</span>` : ''}</div>
    <div class="pmeta"><span class="pname">${esc(name)}</span><span class="pprice ${v == null ? 'none' : ''}">${v == null ? 'بدون قیمت' : short(v) + ' <small>تومان</small>'}</span></div></button>`;
}

// ---------- analysis ----------
function ring(label, p, num, unit, sub, tone = '') {
  const R = 34, k = Math.max(0, Math.min(1, p || 0));
  return `<div class="ring ${tone}"><div class="ring-box"><svg viewBox="0 0 80 80"><circle class="ring-track" cx="40" cy="40" r="${R}"/>
    ${k > 0 ? `<circle class="ring-arc" cx="40" cy="40" r="${R}" pathLength="100" style="--p:${(k * 100).toFixed(1)}"/>` : ''}</svg>
    <b class="ring-num">${iso(num)}<small>${unit}</small></b></div><span class="ring-t">${label}</span><small class="ring-c">${say(sub)}</small></div>`;
}

function viewAnalysis() {
  let h = head('تحلیل', 'سینژین در یک نگاه');
  if (!S.products.length) return h + `<div class="empty enter"><p>تحلیل بعد از ثبت چند محصول ساخته می‌شود.</p><button class="btn" data-new>ثبت محصول</button></div>`;
  const { A, items } = insights(S.products, S.settings, S.market);
  const all = S.products.length, soldAll = S.products.filter(p => p.status === 'sold').length;
  // One sentence first (logic), then the numbers (rings), then the details.
  const verdict = A.margin == null ? `ویترین ${A.stockCount} محصول دارد؛ برای دیدن سود، قیمت‌ها را کامل کنید.`
    : `ویترین ${plain(A.value)} تومان می‌ارزد و ${Math.round(A.margin * 100)}٪ آن سود است.`;
  h += `<section class="hero enter"><span class="hero-k">خلاصه</span><p class="hero-say">${say(verdict)}</p>
    <span class="hero-s">${say('سود = (قیمت فروش − هزینه) ÷ قیمت فروش. هزینه = فلز با قیمت امروز + سنگ + فاکتور کارگاه.')}</span></section>`;
  h += `<div class="rings group enter">
    ${ring('سود', A.margin, faDigits(Math.round((A.margin || 0) * 100)) + '٪', 'از قیمت', 'سهم سود از قیمت فروش', 'acc')}
    ${ring('قیمت‌دار', A.stockCount ? A.priced / A.stockCount : 0, faDigits(A.priced), `از ${faDigits(A.stockCount)}`, 'محصول با قیمت کامل', A.priced < A.stockCount ? 'warn' : 'ok')}
    ${ring('فروش', all ? A.sold30 / all : 0, faDigits(A.sold30), 'در ۳۰ روز', A.sold30 ? `${plain(A.revenue30)} تومان` : 'هنوز فروشی نیست', 'ok')}
  </div>`;
  if (items.length) h += `<div class="stitle">خبرها</div><div class="group enter">${items.map(x => line({ ...x, act: x.act ? (x.act.kind === 'market' ? 'market:' + x.act.id : x.act.kind === 'edit' ? 'edit:' + x.act.id : x.act.kind) : '' })).join('')}</div>`;
  const cats = A.cats.filter(c => c.stock || c.sold30);
  if (cats.length) {
    const mx = Math.max(1, ...cats.map(c => c.stock));
    h += `<div class="stitle">دسته‌ها</div><div class="group enter">${cats.map(c => `<div class="cell col"><div class="crow"><b>${c.name}</b><span class="sec">${say(`${c.stock} موجود${c.sold30 ? `، ${c.sold30} فروش` : ''}`)}</span></div>
      <i class="bar"><em style="width:${Math.round(c.stock / mx * 100)}%"></em></i></div>`).join('')}</div>
      <p class="foot">${say(`طول نوار = تعداد محصول موجود هر دسته. تا امروز ${soldAll} محصول فروخته شده است.`)}</p>`;
  }
  return h;
}

// ---------- sales: invoices ----------
const DAY = 864e5;
function viewSales() {
  let h = head('فروش', 'فاکتورها', `<button class="add-pill" data-inew>${svg('plus')}<span>فاکتور</span></button>`);
  const recent = S.invoices.filter(i => Date.now() - i.date <= 30 * DAY);
  const sum = recent.reduce((a, i) => a + totals(i).total, 0);
  const owed = S.invoices.map(i => ({ i, t: totals(i) })).filter(x => x.t.remaining > 0 && x.t.paid > 0);
  const owedSum = owed.reduce((a, x) => a + x.t.remaining, 0);
  const sp = shortParts(sum);
  h += `<section class="hero enter"><span class="hero-k">فروش ۳۰ روز اخیر</span>
    <div class="hero-n"><b data-count="${sum}">${sp.num}</b><small>${sp.unit}</small></div>
    <span class="hero-s">${say(recent.length ? `${recent.length} فاکتور${owedSum ? `؛ ${plain(owedSum)} تومان مانده از بیعانه‌ها` : ''}` : 'هنوز فاکتوری صادر نشده است')}</span></section>`;
  if (!S.invoices.length) return h + `<div class="empty enter"><p>از روی یک محصول یا همین‌جا فاکتور بسازید؛ قیمت، عکس و جمع‌ها خودکار پر می‌شوند.</p><button class="btn" data-inew>اولین فاکتور</button></div>`;
  const cell = i => { const t = totals(i); return `<button class="cell" data-iview="${i.id}"><span class="c-main"><b>${esc((i.customer && i.customer.name) || 'بی‌نام')}</b><small>${noFa(i.no)}، ${say(`${i.items.length} قلم`)}</small></span>
    <span class="amt">${short(t.total)}</span><span class="st st-${t.status}">${STATUS_NAME[t.status]}</span></button>`; };
  if (owed.length) h += `<div class="stitle">مانده از مشتری‌ها</div><div class="group enter">${owed.map(x => cell(x.i)).join('')}</div>`;
  h += `<div class="stitle">همهٔ فاکتورها</div><div class="group enter">${S.invoices.map(cell).join('')}</div>`;
  return h;
}

const itemOf = p => ({
  productId: p.id, photo: p.photos && p.photos[0] || null, price: shownPrice(p, S.settings),
  title: p.title || p.sub || 'محصول',
  detail: [p.sub, matOf(p.material) && p.material !== 'none' ? matOf(p.material).name : '', supplierOf(S.settings, p.material) === 'self' && p.weight ? `${faDigits(p.weight)} گرم` : ''].filter(Boolean).join('، '),
});
function openInvoice(inv, productId) {
  const base = inv ? JSON.parse(JSON.stringify(inv)) : { id: uid(), no: nextNumber(S.invoices), date: Date.now(), customer: { name: '', phone: '' }, items: [], shipping: null, discount: null, paid: null, note: '' };
  if (productId) { const p = S.products.find(x => x.id === productId); if (p) base.items.push(itemOf(p)); }
  S.inv = { d: base, edit: !!inv };
  openSheet('');
  drawInvoice();
}
function invSum(d) {
  const t = totals(d);
  return `<span class="c-main"><small>مبلغ کل</small><b>${iso(fmt(t.total))} تومان</b></span>${t.paid && t.remaining ? `<span class="sec">${say(`مانده ${plain(t.remaining)}`)}</span>` : t.total && t.paid >= t.total ? '<span class="st st-paid">تسویه</span>' : ''}`;
}
// Pick products; the app already knows each one's price, metal and weight. Servin types only shipping,
// discount and the amount received. Buyer and note are optional and folded away.
function drawInvoice() {
  const d = S.inv.d, panel = $('#sheet .panel');
  const chosen = new Set(d.items.map(i => i.productId).filter(Boolean));
  const sellable = S.products.filter(p => (p.status !== 'sold' || chosen.has(p.id)) && shownPrice(p, S.settings) != null);
  const names = [...new Set(S.invoices.map(i => i.customer && i.customer.name).filter(Boolean))];
  const t = totals(d);
  const nf = (key, label, val, ph) => `<label class="cell"><span>${label}</span><input class="bare" data-inum="${key}" inputmode="numeric" placeholder="${ph}" value="${val == null ? '' : fmt(val)}"><em class="u">تومان</em></label>`;
  let h = `<div class="ed-top"><button class="x" data-close aria-label="بستن">×</button><span class="sec">${noFa(d.no)}</span></div>
    <h2 class="q">فاکتور فروش</h2>
    <p class="qn"><span class="n">۱</span>محصول را انتخاب کنید</p>`;
  if (sellable.length) {
    h += `<div class="sel">${sellable.map(p => { const on = chosen.has(p.id), ph = p.photos && p.photos[0] && urls.get(p.photos[0]);
      return `<button class="sel-i ${on ? 'on' : ''}" data-itog="${p.id}">${ph ? `<img src="${ph}" alt="">` : `<i class="noph">${esc(p.sub || '')}</i>`}<span class="tick">✓</span>
        <b>${esc(p.title || p.sub || 'محصول')}</b><small>${short(shownPrice(p, S.settings))}</small></button>`; }).join('')}</div>`;
  } else {
    h += `<div class="group"><div class="cell col"><b>هنوز محصول قیمت‌داری در ویترین نیست.</b><span class="sec">اول محصول را در ویترین ثبت کنید؛ بعد اینجا با یک لمس انتخابش می‌کنید.</span></div></div>`;
  }
  // What the app worked out by itself, so Servin can see it before typing anything.
  if (d.items.length) {
    h += `<div class="group calcbox">${d.items.map(it => `<div class="cell"><span class="c-main"><b>${esc(it.title)}</b><small>${esc(it.detail || '')}</small></span><span class="amt">${short(it.price)}</span></div>`).join('')}
      <div class="cell"><span class="sec">جمع محصولات</span><b class="amt">${iso(fmt(t.subtotal))}</b></div></div>`;
  }
  h += `<p class="qn"><span class="n">۲</span>ارسال، تخفیف و دریافتی</p>
    <div class="group">${nf('shipping', 'هزینهٔ ارسال', d.shipping, 'ندارد')}${nf('discount', 'تخفیف', d.discount, 'ندارد')}${nf('paid', 'دریافت‌شده', d.paid, 'هنوز هیچ')}</div>
    ${t.total ? `<div class="chips quick"><button class="chip" data-ifull>همهٔ مبلغ را گرفتم</button></div>` : ''}
    <details class="explain more" ${d.customer.name || d.customer.phone || d.note ? 'open' : ''}><summary>نام مشتری و یادداشت (اختیاری)</summary>
      <div class="group">
        <label class="cell"><span>نام</span><input class="bare txt" data-itext="customer.name" list="custs" placeholder="نام مشتری" value="${esc(d.customer.name)}"></label>
        <label class="cell"><span>تلفن</span><input class="bare txt" data-itext="customer.phone" inputmode="tel" placeholder="اختیاری" value="${esc(d.customer.phone)}"></label>
        <label class="cell"><span>یادداشت</span><input class="bare txt" data-itext="note" placeholder="مثلاً زمان تحویل" value="${esc(d.note)}"></label></div>
      <datalist id="custs">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist></details>
    <div class="ed-foot inv-foot"><div class="inv-sum">${invSum(d)}</div>${S.inv.edit ? `<button class="btn ghost danger" data-idel>حذف</button>` : ''}<button class="btn" data-isave>ساخت فاکتور</button></div>`;
  panel.innerHTML = h;
}
const loadImg = src => new Promise(res => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
async function invoiceImage(inv) {
  const logo = await loadImg(S.logo || 'brand/logo-sun.png');
  const ph = {};
  for (const it of inv.items) if (it.photo) ph[it.photo] = await loadImg(urls.get(it.photo));
  return renderInvoice(inv, { ...(S.settings.brand || {}), name: 'سینژین' }, logo, id => ph[id] || null);
}
async function showInvoice(id) {
  const inv = S.invoices.find(i => i.id === id);
  if (!inv) return;
  S.inv = null;
  openSheet(`<div class="ed-top"><button class="x" data-close aria-label="بستن">×</button><span class="sec">${noFa(inv.no)}</span></div><div class="inv-wait">در حال ساخت فاکتور…</div>`);
  const cv = await invoiceImage(inv);
  S.preview = { inv, cv };
  $('#sheet .panel').innerHTML = `<div class="ed-top"><button class="x" data-close aria-label="بستن">×</button><span class="sec">${noFa(inv.no)}</span></div>
    <img class="inv-img" src="${cv.toDataURL('image/png')}" alt="فاکتور">
    <div class="ed-foot"><button class="btn ghost" data-iedit="${inv.id}">ویرایش</button><button class="btn ghost" data-iprint>چاپ یا PDF</button><button class="btn" data-ishare>ارسال تصویر</button></div>`;
}
async function saveInvoice() {
  const d = S.inv.d, now = Date.now();
  // Say exactly what is missing, one thing at a time.
  if (!d.items.length) return island('یک محصول را از بالا انتخاب کنید');
  const t = totals(d);
  await db.put('invoices', d);
  const i = S.invoices.findIndex(x => x.id === d.id);
  if (i >= 0) S.invoices[i] = d; else S.invoices.unshift(d);
  // Products follow the invoice: paid in full → sold at the invoice price; deposit or unpaid → reserved.
  const changed = [];
  for (const it of d.items) {
    const p = S.products.find(x => x.id === it.productId);
    if (!p) continue;
    if (t.status === 'paid') { if (p.status !== 'sold') p.soldAt = d.date; p.status = 'sold'; p.approved = { price: it.price, at: now }; }
    else if (p.status !== 'sold') p.status = 'reserved';
    changed.push(p);
  }
  if (changed.length) await db.putMany('products', changed);
  island(t.status === 'paid' ? 'فاکتور ساخته شد؛ محصولات فروخته‌شده ثبت شدند' : 'فاکتور ساخته شد؛ محصولات رزرو شدند');
  S.tab = 'sales'; render();
  await showInvoice(d.id);
}

// ---------- settings: grouped like iOS settings ----------
function numCell(key, label, unit, val, dec = false) {
  const shown = val == null ? '' : dec ? fmtDec(val) : fmt(val);
  return `<label class="cell"><span>${label}</span><input class="bare" data-num="${key}" ${dec ? 'data-dec="1"' : ''} inputmode="decimal" placeholder="وارد نشده" value="${shown}"><em class="u">${unit}</em></label>`;
}
function viewSettings() {
  const st = S.settings;
  const metals = MATERIALS.filter(x => x.id !== 'none');
  let h = head('تنظیمات', 'عددهای پایهٔ قیمت');
  h += `<div class="stitle">قیمت فلز، هر گرم</div><div class="group enter">`;
  for (const m of metals) {
    if ((st.suppliers[m.id] || m.supplier) !== 'self') continue;
    h += numCell('price:' + m.id, m.name, 'تومان', st.prices[m.id] ?? null);
    if (S.market && S.market[m.id]) h += `<div class="cell sub"><span class="sec">${say(`بازار امروز ${plain(S.market[m.id].p)} تومان`)}</span><button class="pill" data-act="market:${m.id}">استفاده</button></div>`;
  }
  h += `</div><div class="stitle">فلز را چه کسی می‌دهد؟</div><div class="group enter">${metals.map(m => {
    const sup = st.suppliers[m.id] || m.supplier;
    return `<div class="cell"><span>${m.name}</span><div class="seg"><button class="${sup === 'self' ? 'on' : ''}" data-sup="${m.id}" data-val="self">خودمان</button><button class="${sup === 'workshop' ? 'on' : ''}" data-sup="${m.id}" data-val="workshop">کارگاه</button></div></div>`;
  }).join('')}</div><p class="foot">«کارگاه» یعنی هزینهٔ فلز داخل فاکتور کارگاه است.</p>`;
  h += `<div class="stitle">ضریب‌ها</div><div class="group enter">${numCell('markup', 'ضریب متریال', '×', st.markup, true)}
    <div class="cell col"><span class="sec">ضریب سطح</span><div class="ftable"><span></span>${LEVELS.map(l => `<span class="fh">${l.name}</span>`).join('')}
    ${Object.entries(FORMULAS).map(([fid, f]) => `<span class="fl">${f.name}</span>${LEVELS.map(l => {
      const v = st.factors[fid][l.id];
      return `<input data-num="factor:${fid}:${l.id}" data-dec="1" inputmode="decimal" placeholder="—" value="${v == null ? '' : fmtDec(v)}" aria-label="ضریب ${l.name} ${f.name}">`;
    }).join('')}`).join('')}</div></div></div>
    <details class="explain"><summary>قیمت چطور حساب می‌شود؟</summary>
      <p class="formula">قیمت = (فلز + سنگ) × ضریب متریال + فاکتور کارگاه × ضریب سطح</p>
      <p>${say('ضریب متریال کوچک است (جواهرسازان مستقل معمولاً ۱.۲ تا ۱.۵)، چون فلز گران است. ارزش طراحی سروین و سود در ضریب سطح است و روی کار کارگاه می‌آید. هر سطح باید ضریب بزرگ‌تری از سطح پایین‌تر داشته باشد.')}</p></details>`;
  h += `<div class="stitle">گرد کردن قیمت به بالا</div><div class="group enter"><div class="cell"><div class="seg wide">${ROUNDING.map(r => `<button class="${st.rounding === r ? 'on' : ''}" data-round="${r}">${r ? short(r) : 'هیچ'}</button>`).join('')}</div></div></div>`;
  const B = st.brand || {};
  h += `<div class="stitle">روی فاکتور</div><div class="group enter">
    <label class="cell"><span>لوگو</span>${S.logo ? `<img class="logo-mini" src="${S.logo}" alt="">` : '<span class="sec">انتخاب تصویر</span>'}${svg('chev')}<input type="file" accept="image/*" data-logo hidden></label>
    ${['instagram:اینستاگرام:seenzhin', 'phone:تلفن:۰۹۱۲…', 'thanks:پیام پایانی:از انتخاب شما سپاسگزاریم'].map(x => { const [k, l, ph] = x.split(':'); return `<label class="cell"><span>${l}</span><input class="bare txt" data-brand="${k}" placeholder="${ph}" value="${esc(B[k] || '')}"></label>`; }).join('')}
  </div><p class="foot">این‌ها فقط روی همین دستگاه می‌مانند و روی هر فاکتور چاپ می‌شوند.</p>`;
  h += `<div class="stitle">پشتیبان</div><div class="group enter"><button class="cell" data-export><span>گرفتن فایل پشتیبان</span>${svg('chev')}</button>
    <label class="cell"><span>بازگردانی از فایل</span>${svg('chev')}<input type="file" accept="application/json" data-import hidden></label></div>
    <p class="foot">داده‌ها فقط روی همین دستگاه است؛ هر چند وقت یک پشتیبان بگیرید.</p>`;
  return h;
}

// ---------- product editor: one question per screen ----------
const STEPS = ['چه محصولی؟', 'سطح کار', 'هزینه‌ها', 'عکس و نام'];
const blank = () => ({ cat: null, sub: null, level: null, title: '', material: null, weight: null, stone: null, invoice: null, w: null, h: null, status: 'available', note: '', photos: [], _added: [] });

function openSheet(html) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="scrim" data-close></div><div class="panel" role="dialog" aria-modal="true">${html}</div>`;
  sh.classList.add('open'); document.body.classList.add('locked');
}
function closeSheet() {
  $('#sheet').classList.remove('open'); document.body.classList.remove('locked');
  setTimeout(() => { if (!$('#sheet').classList.contains('open')) $('#sheet').innerHTML = ''; }, 320);
}
function openEditor(p, step) {
  const d = p ? Object.assign(blank(), JSON.parse(JSON.stringify(p)), { _added: [] }) : blank();
  S.ed = { d, step: step ?? (p ? 4 : 0), edit: !!p };
  openSheet('');
  drawEditor();
}
async function closeEditor() {
  if (S.ed) for (const id of S.ed.d._added) { await db.del('photos', id); urls.delete(id); }
  S.ed = null;
  closeSheet();
  render();
}

function chips(field, items, cur, big = false) {
  return `<div class="chips wrap ${big ? 'big' : ''}">${items.map(it => `<button class="chip ${cur === it.id ? 'on' : ''}" data-set="${field}" data-val="${esc(it.id)}"><span>${esc(it.name)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</button>`).join('')}</div>`;
}
function field(key, label, unit, val, help = '', dec = false) {
  const shown = val == null ? '' : dec ? fmtDec(val) : fmt(val);
  return `<label class="field"><span class="lab">${label}</span><span class="inp"><input data-num="${key}" ${dec ? 'data-dec="1"' : ''} inputmode="decimal" placeholder="—" value="${shown}"><em>${unit}</em></span>${help ? `<span class="help">${help}</span>` : ''}</label>`;
}
const priceTag = r => (r.complete ? `${short(r.final)} <small>تومان</small>` : 'هنوز کامل نیست');

function drawEditor() {
  const { d, step } = S.ed;
  const r = price(d, S.settings);
  const panel = $('#sheet .panel');
  let h = `<div class="ed-top"><button class="x" data-close aria-label="بستن">×</button>
    ${step < 4 ? `<div class="ed-price ${r.complete ? 'ok' : ''}"><span>قیمت فروش</span><b>${priceTag(r)}</b></div>` : ''}</div>`;
  if (step < 4) h += `<div class="dots">${STEPS.map((_, i) => `<i class="${i === step ? 'on' : i < step ? 'done' : ''}"></i>`).join('')}</div><h2 class="q">${STEPS[step]}</h2>`;
  if (step === 0) {
    h += chips('cat', CATEGORIES, d.cat, true);
    const cat = catOf(d.cat);
    if (cat) h += `<p class="lab2">کدام؟</p>${chips('sub', cat.subs.map(s => ({ id: s, name: s })), d.sub)}`;
  } else if (step === 1) {
    h += chips('level', LEVELS, d.level, true) + `<p class="help">هر سطح ضریب خودش را دارد؛ سطح بالاتر یعنی ارزش طراحی بیشتر.</p>`;
  } else if (step === 2) {
    const sup = supplierOf(S.settings, d.material);
    h += `<p class="lab2">فلز</p>${chips('material', MATERIALS, d.material)}`;
    if (sup === 'self') h += field('weight', `وزن ${matOf(d.material).name}`, 'گرم', d.weight, 'فلزی که خودتان به کارگاه می‌دهید.', true);
    if (sup === 'workshop') h += `<p class="help">${matOf(d.material).name} را کارگاه می‌دهد؛ هزینه‌اش داخل فاکتور است.</p>`;
    const sg = d.invoice == null ? suggestInvoice(S.products, d) : null;
    h += field('invoice', 'فاکتور کارگاه', 'تومان', d.invoice, sg ? `${say(`محصولات مشابه معمولاً ${plain(sg.value)} تومان`)} <button class="link" data-usesug="${sg.value}">همین</button>` : 'مبلغ کامل فاکتور ساخت.');
    h += field('stone', 'سنگ', 'تومان', d.stone, 'اگر سنگ ندارد، خالی بگذارید.');
    if (formulaOf(d) === 'panel') h += `<div class="two">${field('w', 'عرض', 'سانتی‌متر', d.w, '', true)}${field('h', 'ارتفاع', 'سانتی‌متر', d.h, '', true)}</div>`;
  } else if (step === 3) {
    h += `<div class="photos">${d.photos.map(id => `<div class="ph"><img src="${urls.get(id) || ''}" alt=""><button class="rm" data-rmphoto="${id}" aria-label="حذف عکس">×</button></div>`).join('')}
      <label class="addph"><input type="file" accept="image/*" multiple data-photo hidden>${svg('plus')}<small>عکس</small></label></div>
      <label class="field"><span class="lab">نام محصول</span><span class="inp"><input data-text="title" placeholder="مثلاً انگشتر موج" value="${esc(d.title)}"></span></label>`;
  } else {
    h += summary(d, r);
  }
  if (step < 4) {
    const can = [d.cat, d.level, d.material, true][step];
    h += `<div class="ed-foot">${step ? `<button class="btn ghost" data-step="${step - 1}">قبلی</button>` : ''}<button class="btn" data-step="${step + 1}" ${can ? '' : 'disabled'}>${step === 3 ? 'مرور و ذخیره' : 'بعدی'}</button></div>`;
  }
  panel.innerHTML = h;
}

function summary(d, r) {
  const cat = catOf(d.cat), lv = levelOf(d.level), mt = matOf(d.material);
  const ph = d.photos[0] && urls.get(d.photos[0]);
  const self = supplierOf(S.settings, d.material) === 'self';
  const rows = [
    [0, 'محصول', [cat && cat.name, d.sub].filter(Boolean).join('، ') || '—'],
    [1, 'سطح کار', lv ? lv.name : '—'],
    [2, 'هزینه‌ها', [mt && mt.name, self && d.weight != null ? `${d.weight} گرم` : '', d.invoice != null ? `کارگاه ${plain(d.invoice)}` : 'فاکتور وارد نشده'].filter(Boolean).join('، ')],
    [3, 'نام و عکس', `${d.title || 'بدون نام'}، ${d.photos.length} عکس`],
  ];
  let h = `<div class="sum-head">${ph ? `<img src="${ph}" alt="">` : ''}<div><h2>${esc(d.title || d.sub || 'محصول تازه')}</h2>
    <div class="big">${r.complete ? `${iso(fmt(r.final))} <small>تومان</small>` : '<span class="none">هنوز کامل نیست</span>'}</div></div></div>`;
  if (r.missing.length) h += `<div class="group"><div class="cell col miss"><b>برای قیمت کامل:</b>${r.missing.map(m => `<span>${say(m.text)}</span>`).join('')}</div></div>`;
  if (r.complete) {
    h += `<details class="explain"><summary>چطور حساب شد؟</summary><div class="calc">
      ${r.material ? `<div class="cl"><span>متریال<small>${say(`(فلز ${plain(r.material - (d.stone || 0))} + سنگ ${plain(d.stone || 0)}) × ${r.markup}`)}</small></span><b>${short(r.materialPart)}</b></div>` : ''}
      <div class="cl"><span>کار و طراحی<small>${say(`فاکتور ${plain(r.invoice)} × ضریب ${lv.name} ${r.factor}`)}</small></span><b>${short(r.workPart)}</b></div>
      ${r.step ? `<div class="cl"><span>گرد به بالا<small>${say(`تا مضرب ${plain(r.step)}`)}</small></span><b>${short(r.final)}</b></div>` : ''}</div></details>`;
  }
  h += `<div class="group">${rows.map(([s, k, v]) => `<button class="cell" data-step="${s}"><span>${k}</span><span class="sec val">${say(v)}</span>${svg('chev')}</button>`).join('')}</div>`;
  h += `<p class="lab2">وضعیت</p>${chips('status', STATUSES, d.status)}`;
  h += `<div class="ed-foot">${S.ed.edit ? `<button class="btn ghost danger" data-del>حذف</button><button class="btn ghost" data-dup>مشابه</button>${d.status !== 'sold' && r.complete ? `<button class="btn ghost" data-sell="${d.id}">فاکتور</button>` : ''}` : ''}<button class="btn" data-save>${S.ed.edit ? 'ذخیره' : 'ذخیره در ویترین'}</button></div>`;
  return h;
}

// ---------- drift: approve today's prices ----------
function openDrift() {
  const list = drifted(S.products, S.settings);
  if (!list.length) return;
  openSheet(`<div class="ed-top"><button class="x" data-close aria-label="بستن">×</button></div><h2 class="q">قیمت‌های تازه</h2>
    <div class="group">${list.map(x => {
      const pct = x.from ? Math.round((x.to - x.from) / x.from * 100) : null;
      return `<div class="cell"><span>${esc(x.p.title || x.p.sub || 'بی‌نام')}</span><span class="dv">${x.from != null ? `<s>${short(x.from)}</s>` : ''}<b>${short(x.to)}</b>${pct != null ? `<small class="${pct >= 0 ? 'up' : 'down'}">${iso(faDigits((pct > 0 ? '+' : '') + pct) + '٪')}</small>` : ''}</span></div>`;
    }).join('')}</div><p class="foot">درصد = (قیمت تازه − قیمت قبلی) ÷ قیمت قبلی.</p>
    <div class="ed-foot"><button class="btn ghost" data-close>بعداً</button><button class="btn" data-approve>تأیید همه</button></div>`);
}

// ---------- photos ----------
async function compress(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
}

// ---------- save ----------
async function save() {
  const d = S.ed.d, r = price(d, S.settings), now = Date.now();
  const prev = S.ed.edit ? S.products.find(x => x.id === d.id) : null;
  const { _added, ...clean } = d;
  const p = Object.assign(clean, { id: d.id || uid(), createdAt: d.createdAt || now, updatedAt: now, approved: r.complete ? { price: r.final, at: now } : null });
  if (prev && prev.status === 'sold' && p.status === 'sold' && prev.approved) p.approved = prev.approved; // sold price stays
  if (p.status === 'sold' && !(prev && prev.status === 'sold')) p.soldAt = now;
  if (p.status !== 'sold') delete p.soldAt;
  if (prev) for (const id of prev.photos || []) if (!p.photos.includes(id)) { await db.del('photos', id); urls.delete(id); }
  await db.put('products', p);
  const i = S.products.findIndex(x => x.id === p.id);
  if (i >= 0) S.products[i] = p; else S.products.unshift(p);
  S.ed.d._added = [];
  await closeEditor();
  island(r.complete ? `ذخیره شد، ${plain(r.final)} تومان` : 'ذخیره شد؛ قیمت هنوز کامل نیست');
}

// ---------- backup ----------
async function exportAll() {
  const photos = [];
  for (const ph of await db.all('photos')) photos.push({ id: ph.id, data: await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(ph.blob); }) });
  const blob = new Blob([JSON.stringify({ app: 'seenzhin', v: 1, at: Date.now(), settings: S.settings, products: S.products, photos })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `seenzhin-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importAll(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'seenzhin') throw 0;
    if (!confirm('داده‌های این دستگاه با فایل پشتیبان جایگزین شود؟')) return;
    await db.clear('products'); await db.clear('photos');
    for (const ph of data.photos || []) await db.put('photos', { id: ph.id, blob: await (await fetch(ph.data)).blob() });
    await db.putMany('products', data.products || []);
    await db.set('settings', data.settings);
    location.reload();
  } catch { island('این فایل پشتیبان سینژین نیست'); }
}

// ---------- events ----------
async function doAct(a) {
  if (a === 'new') return openEditor(null);
  if (a === 'settings') { S.tab = 'settings'; render(); return scrollTo(0, 0); }
  if (a === 'drift') return openDrift();
  if (a.startsWith('edit:')) return openEditor(S.products.find(p => p.id === a.slice(5)));
  if (a.startsWith('market:')) {
    const m = a.slice(7);
    if (!S.market || !S.market[m]) return;
    S.settings.prices[m] = S.market[m].p; S.settings.pricesAt[m] = Date.now();
    await saveSettings(); render();
    const n = drifted(S.products, S.settings).length;
    island(n ? `قیمت به‌روز شد؛ ${n} محصول قیمت تازه دارد` : 'قیمت به‌روز شد');
  }
}

function bind() {
  document.addEventListener('click', async e => {
    const t = e.target.closest('button, [data-close]');
    if (!t || t.disabled) return;
    const ds = t.dataset;
    if (ds.tab) { S.tab = ds.tab; render(); return scrollTo(0, 0); }
    if ('close' in ds) { S.inv = null; S.preview = null; return S.ed ? closeEditor() : closeSheet(); }
    if ('new' in ds) return openEditor(null);
    if (ds.act) return doAct(ds.act);
    if (ds.filter) { S.filter = ds.filter; return render(); }
    if (ds.edit) return openEditor(S.products.find(p => p.id === ds.edit));
    if ('approve' in ds) {
      const list = drifted(S.products, S.settings), now = Date.now();
      for (const x of list) x.p.approved = { price: x.to, at: now };
      await db.putMany('products', list.map(x => x.p));
      closeSheet(); render(); return island(`${list.length} قیمت تأیید شد`);
    }
    if (ds.sup) { S.settings.suppliers[ds.sup] = ds.val; await saveSettings(); return render(); }
    if (ds.round != null) { S.settings.rounding = Number(ds.round); await saveSettings(); render(); return island('ذخیره شد'); }
    if ('export' in ds) return exportAll();
    if ('inew' in ds) return openInvoice(null);
    if (ds.sell) { const id = ds.sell; await closeEditor(); return openInvoice(null, id); }
    if (ds.iview) return showInvoice(ds.iview);
    if (ds.iedit) { const inv = S.invoices.find(i => i.id === ds.iedit); return openInvoice(inv); }
    if ('ishare' in ds && S.preview) {
      const blob = await new Promise(r => S.preview.cv.toBlob(r, 'image/png'));
      const file = new File([blob], `seenzhin-${S.preview.inv.no}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch { /* cancelled */ } return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); return;
    }
    if ('iprint' in ds && S.preview) { $('#print').innerHTML = `<img src="${S.preview.cv.toDataURL('image/png')}" alt="">`; setTimeout(() => window.print(), 100); return; }
    if (S.inv) {
      const d = S.inv.d;
      if (ds.itog) {
        const i = d.items.findIndex(x => x.productId === ds.itog);
        if (i >= 0) d.items.splice(i, 1); else { const p = S.products.find(x => x.id === ds.itog); if (p) d.items.push(itemOf(p)); }
        return drawInvoice();
      }
      if ('ifull' in ds) { d.paid = totals({ ...d, paid: 0 }).total; return drawInvoice(); }
      if ('isave' in ds) return saveInvoice();
      if ('idel' in ds) {
        if (!confirm('این فاکتور حذف شود؟ وضعیت محصولات تغییر نمی‌کند.')) return;
        await db.del('invoices', d.id); S.invoices = S.invoices.filter(i => i.id !== d.id);
        S.inv = null; closeSheet(); render(); return island('فاکتور حذف شد');
      }
    }
    if (!S.ed) return;
    const d = S.ed.d;
    if (ds.set) {
      const f = ds.set;
      d[f] = ds.val;
      if (f === 'cat') d.sub = null;
      drawEditor();
      // One question per screen: a choice that completes the step moves on by itself.
      if ((f === 'sub' || f === 'level') && S.ed.step < 4) setTimeout(() => { if (S.ed && S.ed.step < 4) { S.ed.step++; drawEditor(); } }, 280);
      return;
    }
    if (ds.step != null) { S.ed.step = Number(ds.step); drawEditor(); $('#sheet .panel').scrollTop = 0; return; }
    if (ds.usesug) { d.invoice = Number(ds.usesug); return drawEditor(); }
    if (ds.rmphoto) {
      const id = ds.rmphoto; d.photos = d.photos.filter(x => x !== id);
      if (d._added.includes(id)) { d._added = d._added.filter(x => x !== id); await db.del('photos', id); urls.delete(id); }
      return drawEditor();
    }
    if ('save' in ds) return save();
    if ('del' in ds) {
      if (!confirm('این محصول حذف شود؟')) return;
      for (const ph of d.photos) { await db.del('photos', ph); urls.delete(ph); }
      await db.del('products', d.id);
      S.products = S.products.filter(x => x.id !== d.id);
      S.ed.d._added = []; await closeEditor(); return island('حذف شد');
    }
    if ('dup' in ds) {
      const src = d;
      await closeEditor();
      openEditor(null, 2);
      Object.assign(S.ed.d, { cat: src.cat, sub: src.sub, level: src.level, material: src.material, weight: src.weight, stone: src.stone, invoice: src.invoice, w: src.w, h: src.h });
      drawEditor(); return island('کپی شد؛ عددها را بررسی کنید');
    }
  });

  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.brand) { (S.settings.brand ||= {})[el.dataset.brand] = el.value; clearTimeout(pendingSetting.b); pendingSetting.b = setTimeout(saveSettings, 600); return; }
    if (S.inv && (el.dataset.itext || el.dataset.inum)) {
      const d = S.inv.d, key = el.dataset.itext || el.dataset.inum;
      let v = el.value;
      if (el.dataset.inum) { v = parseNum(el.value); if (v != null) el.value = fmt(v); }
      const parts = key.split(':');
      if (parts[0] === 'item') d.items[+parts[1]][parts[2]] = v;
      else if (key.includes('.')) { const [a, b] = key.split('.'); d[a][b] = v; }
      else d[key] = v;
      const sum = $('.inv-sum'); if (sum) sum.innerHTML = invSum(d);
      return;
    }
    if (el.dataset.text && S.ed) { S.ed.d[el.dataset.text] = el.value; return; }
    if (!el.dataset.num) return;
    const key = el.dataset.num, v = parseNum(el.value);
    if (!el.dataset.dec && v != null) el.value = fmt(v);
    else if (el.dataset.dec) el.value = faDigits(el.value).replace('.', '٫');
    if (key.startsWith('price:') || key.startsWith('factor:') || key === 'markup') return pendingSetting(key, v);
    if (!S.ed) return;
    S.ed.d[key] = v;
    const r = price(S.ed.d, S.settings), box = $('.ed-price');
    if (box) { box.classList.toggle('ok', r.complete); box.querySelector('b').innerHTML = priceTag(r); }
  });

  document.addEventListener('change', async e => {
    const el = e.target;
    if ('photo' in el.dataset && el.files.length && S.ed) {
      for (const f of el.files) {
        try { const blob = await compress(f), id = uid(); await db.put('photos', { id, blob }); urls.set(id, URL.createObjectURL(blob)); S.ed.d.photos.push(id); S.ed.d._added.push(id); }
        catch { island('این عکس خوانده نشد'); }
      }
      return drawEditor();
    }
    if ('logo' in el.dataset && el.files[0]) { await db.set('logo', el.files[0]); S.logo = URL.createObjectURL(el.files[0]); render(); return island('لوگو ذخیره شد'); }
        if ('import' in el.dataset && el.files[0]) importAll(el.files[0]);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#sheet').classList.contains('open')) (S.ed ? closeEditor() : closeSheet()); });
}

// Settings numbers are saved shortly after typing stops.
function pendingSetting(key, v) {
  const [kind, a, b] = key.split(':');
  if (kind === 'markup') S.settings.markup = v;
  else if (kind === 'price') { S.settings.prices[a] = v; S.settings.pricesAt[a] = v == null ? null : Date.now(); }
  else S.settings.factors[a][b] = v;
  clearTimeout(pendingSetting.t);
  pendingSetting.t = setTimeout(async () => {
    await saveSettings();
    const n = drifted(S.products, S.settings).length;
    island(n ? `ذخیره شد؛ ${n} محصول قیمت تازه می‌گیرد` : 'ذخیره شد');
  }, 700);
}

boot();
