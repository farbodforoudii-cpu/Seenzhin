import { db, requestPersistence } from './db.js';
import {
  FORMULAS, CATEGORIES, LEVELS, MATERIALS, STATUSES, ROUNDING,
  defaultSettings, catOf, formulaOf, matOf, levelOf, supplierOf, price, drifted, setupSteps, unitsOf,
} from './model.js';
import { fmt, fmtDec, iso, parseNum, esc, faDigits, short, shortParts } from './format.js';
import { insights, suggestInvoice, marketGap, shownPrice, jobsFor } from './analysis.js';
import { totals, nextNumber, noFa, STATUS_NAME, renderInvoice } from './invoice.js';
import { sync } from './sync.js';
import { siteMissing } from './site.js';
import { STAGES, STAGE_NAME, TERMS, isOpen, refundable, orderSettings, orderPrice, suggestDeposit, orderProfit, normPhone, customerId, findCustomer, customerStats, orderAlerts } from './orders.js';

// Design rules shared with hesab-man / Life-os: logic → numbers → trend; one big number with one sentence;
// short numbers («۷٫۹ میلیون»); details only on request; every percentage says what it divides.
const APP_VERSION = '۲۵';
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
  back: '<path d="M9 6l6 6-6 6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  sales: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
};
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

// ---------- history: who did what, when (shared with the other phone) ----------
const WHO = { servin: 'سروین', farbod: 'فربد' };
function logEvent(text) {
  const e = { id: uid(), at: Date.now(), who: S.who || '', text };
  S.log = [e, ...(S.log || [])].slice(0, 300);
  db.put('log', e);
}
const whoName = w => WHO[w] || 'یک گوشی';
// «۶ آذر، ساعت ۱۶:۲۸»: the clock is isolated left-to-right so it can never flip into «۲۸:۱۶».
const timeFa = ts => { const d = new Date(ts); return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric', month: 'long' }).format(d) + '، ساعت ' + iso(faDigits(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'))); };

// ---------- undo: every change that matters can be taken back for a few seconds ----------
// snap() copies the records an action is about to change; the returned function puts them back exactly.
async function snap({ products = [], invoices = [], photos = [], settings = false, customers = [], orders = [] }) {
  const keep = { p: [], i: [], ph: [], c: [], o: [], st: settings ? JSON.parse(JSON.stringify(S.settings)) : null };
  for (const id of customers) keep.c.push([id, await db.getOne('customers', id)]);
  for (const id of orders) keep.o.push([id, await db.getOne('orders', id)]);
  for (const id of products) keep.p.push([id, await db.getOne('products', id)]);
  for (const id of invoices) keep.i.push([id, await db.getOne('invoices', id)]);
  for (const id of photos) keep.ph.push([id, await db.getOne('photos', id)]);
  return async () => {
    for (const [id, ph] of keep.ph) if (ph) await db.put('photos', ph);
    for (const [id, v] of keep.p) v ? await db.put('products', { ...v, updatedAt: Date.now() }) : await db.del('products', id);
    for (const [id, v] of keep.i) v ? await db.put('invoices', v) : await db.del('invoices', id);
    for (const [id, v] of keep.c) v ? await db.put('customers', { ...v, updatedAt: Date.now() }) : await db.del('customers', id);
    for (const [id, v] of keep.o) v ? await db.put('orders', { ...v, updatedAt: Date.now() }) : await db.del('orders', id);
    if ((keep.o.length || keep.c.length) && $('#sheet').classList.contains('open') && (S.ord || S.cust)) { S.ord = null; S.cust = null; closeSheet(); }
    if (keep.st) { S.settings = keep.st; await saveSettings(); }
    await load(); render();
  };
}
function offerUndo(text, restore) {
  const el = $('#undo');
  el.innerHTML = `<span>${say(text)}</span><button data-undo>برگرداندن</button>`;
  el.classList.add('show');
  S.undo = restore;
  clearTimeout(offerUndo.t); offerUndo.t = setTimeout(() => { el.classList.remove('show'); S.undo = null; }, 7000);
}

// ---------- back: the arrow, a swipe from left to right (like iPhone), or Escape ----------
function goBack() {
  if ($('#sheet').classList.contains('open')) {
    if (S.ed && S.ed.step > 0 && S.ed.step < 4) { S.ed.step--; drawEditor(); $('#sheet .panel').scrollTop = 0; return; }
    S.inv = null; S.preview = null;
    if (S.ed) return closeEditor();
    const wasOrd = S.ord || S.cust; S.ord = null; S.cust = null;
    closeSheet(); if (wasOrd) render(); return;
  }
  const prev = (S.tabs || []).pop();
  if (prev) { S.tab = prev; render(); scrollTo(0, 0); }
}
function goTab(t) { if (t !== S.tab) (S.tabs ||= []).push(S.tab); S.tab = t; render(); scrollTo(0, 0); }

// ---------- refresh: other phone's changes, today's market price, and the screens ----------
async function refresh(btn) {
  if (btn) btn.classList.add('spin');
  try { if (sync.state.key) await sync.run(); await loadMarket(); await load(); render(); island(sync.state.status === 'error' ? sync.state.error : 'به‌روز شد'); }
  finally { const b = $('[data-refresh]'); if (b) b.classList.remove('spin'); }
}

// ---------- boot ----------
// Everything the screens show, read again from this device (also after the shared account brought changes).
async function load() {
  S.settings = Object.assign(defaultSettings(), (await db.get('settings')) || {});
  S.products = (await db.all('products')).sort((a, b) => b.createdAt - a.createdAt);
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  for (const ph of await db.all('photos')) if (ph.blob) urls.set(ph.id, URL.createObjectURL(ph.blob));
  S.invoices = (await db.all('invoices')).sort((a, b) => b.date - a.date);
  S.customers = (await db.all('customers')).sort((a, b) => b.createdAt - a.createdAt);
  S.orders = (await db.all('orders')).sort((a, b) => b.createdAt - a.createdAt);
  const lg = await db.get('logo');
  S.logo = lg ? URL.createObjectURL(lg) : null;
  S.log = (await db.all('log')).sort((a, b) => b.at - a.at).slice(0, 300);
  S.who = (await db.get('who')) || '';
  refreshUnits();
  S.jobs = (await db.get('jobs')) || { day: '', id: null, snooze: {}, rest: false };
}
async function boot() {
  await load();
  requestPersistence();
  bind();
  render();
  // Shared account: changes from the other phone appear by themselves; an open form is never redrawn under you.
  sync.onRemote = async () => {
    await load();
    if ($('#sheet').classList.contains('open')) { S.pendingRemote = true; return; }
    render(); island('تغییرات گوشی دیگر رسید');
  };
  sync.onChange(() => { if (S.tab === 'settings' && !$('#sheet').classList.contains('open')) render(); });
  await sync.init();
  await repairSold();
  await linkOldInvoices();
  loadMarket();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // A new version takes over → reload once, so both phones are always on the latest app without reopening.
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !boot.reloaded) { boot.reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
  }
}
const saveSettings = () => db.set('settings', S.settings);

// Ready pieces of every design, from the invoices; status follows (available / reserved / sold out).
// The stored `status` is only read for products from before counts existed; it is never rewritten.
S.units = new Map();
const paidOf = inv => totals(inv).status === 'paid';
function refreshUnits() {
  S.units = new Map(S.products.map(p => [p.id, unitsOf(p, S.invoices, paidOf)]));
}
const unitsFor = p => S.units.get(p.id) || unitsOf(p, S.invoices, paidOf);
// Products with their units, for the analysis.
const view = () => S.products.map(p => ({ ...p, ...unitsFor(p) }));

// Before v23 a paid invoice overwrote the product's library price with the sale price.
// Once per product (invoices from v23 on carry paidAt and are skipped): move that price to soldPrice and give the library its own price back (formula or manual final).
async function repairSold() {
  const now = Date.now(), fixed = [];
  for (const inv of S.invoices) {
    if (totals(inv).status !== 'paid' || inv.paidAt) continue;
    for (const it of inv.items || []) {
      const p = S.products.find(x => x.id === it.productId);
      if (!p || p.status !== 'sold' || p.soldPrice != null) continue;
      const r = price(p, S.settings);
      p.soldPrice = it.price; p.soldInvoice = inv.id; p.updatedAt = now;
      if (r.complete) p.approved = { price: r.final, at: now };
      fixed.push(p);
    }
  }
  if (fixed.length) { await db.putMany('products', fixed); refreshUnits(); render(); }
}

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

const head = (title, sub, extra = '') => `<header class="phead"><div><span class="psub">${sub}</span><h1>${title}</h1></div><div class="ph-act">${extra}<button class="icon-btn" data-refresh aria-label="به‌روزرسانی">${svg('refresh')}</button></div></header>`;

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
// One small job a day (never more): picked from jobsFor, kept for the day, «بعداً» rests it for 3 days.
function todayJob() {
  const J = S.jobs, today = new Date().toDateString(), now = Date.now();
  const list = jobsFor(view(), S.settings, now).filter(j => !(J.snooze[j.id] > now));
  if (J.day === today) {
    if (J.rest) return null;
    const still = J.id && list.find(j => j.id === J.id);
    return still ? { job: still, left: list.length } : J.id ? { done: true } : null;
  }
  if (!list.length) return null;
  Object.assign(J, { day: today, id: list[0].id, rest: false });
  db.set('jobs', J);
  return { job: list[0], left: list.length };
}
function jobCard() {
  const x = todayJob();
  if (!x) return '';
  if (x.done) return `<div class="job done enter"><b>✓ کار امروز انجام شد</b><small>فردا یک کار کوچک تازه.</small></div>`;
  const j = x.job;
  return `<section class="job enter"><span class="job-k">یک کار کوچک برای امروز</span><b>${say(j.title)}</b>${j.why ? `<small>${say(j.why)}</small>` : ''}
    <div class="job-a"><button class="btn small" data-act="${j.act}">انجامش بده</button>${j.prompt ? `<button class="btn small ghost" data-jobprompt>پرامپت برای GPT</button>` : ''}<button class="link" data-joblater>بعداً</button></div></section>`;
}

function todo() {
  // What needs Servin now, most urgent first; at most three lines.
  const L = [];
  const next = setupSteps(S.settings, S.products).find(s => !s.done);
  if (next) L.push({ tone: 'o', t: next.text, d: 'قدم بعدی برای راه‌اندازی', act: next.id === 'first' ? 'new' : 'settings' });
  for (const g of marketGap(S.settings, S.market)) L.push({ tone: 'o', t: `${MARKET_NAME[g.id]} ${Math.abs(Math.round(g.pct * 100))}٪ ${g.pct > 0 ? 'گران‌تر' : 'ارزان‌تر'} شده است`, d: `بازار ${plain(g.market)}، ثبت‌شده ${plain(g.saved)} تومان هر گرم`, act: 'market:' + g.id, btn: 'به‌روز کن' });
  for (const a of orderAlerts(S.orders).slice(0, 2)) {
    const o = a.o, who = (custOf(o.customerId) || {}).name || 'مشتری';
    L.push(a.kind === 'ready' ? { tone: 'o', t: `«${orderTitle(o)}» آماده است`, d: `به ${who} خبر دهید؛ بعد از تحویل، «تحویل و تسویه»`, act: 'order:' + o.id }
      : a.kind === 'late' ? { tone: 'r', t: `تحویل «${orderTitle(o)}» ${a.days} روز عقب افتاده`, d: `${who}؛ ${STAGE_NAME[o.stage]}`, act: 'order:' + o.id }
      : { tone: 'o', t: `تحویل «${orderTitle(o)}» ${a.days ? `${a.days} روز دیگر` : 'امروز'}`, d: `${who}؛ ${STAGE_NAME[o.stage]}`, act: 'order:' + o.id });
  }
  const dr = drifted(S.products, S.settings);
  if (dr.length) L.push({ tone: 'o', t: `${dr.length} قیمت تازه منتظر تأیید است`, d: 'برای دیدن قیمت قبلی و تازه بزنید', act: 'drift' });
  if (sync.state.key && !S.who) L.push({ tone: 'o', t: 'بگویید این گوشی مال کیست', d: 'تا در تاریخچه معلوم باشد چه کسی چه کرده', act: 'settings' });
  if (!sync.state.key) L.push({ tone: 'o', t: 'حساب مشترک را وصل کنید', d: 'تا گوشی شما و سروین همیشه یکی باشند', act: 'settings' });
  else if (sync.state.status === 'error') L.push({ tone: 'r', t: 'همگام‌سازی انجام نشد', d: sync.state.error, act: 'settings' });
  return L.slice(0, 3);
}

function viewHome() {
  const U = p => unitsFor(p);
  const stock = S.products.filter(p => U(p).status !== 'sold');
  const value = stock.reduce((a, p) => a + (shownPrice(p, S.settings) || 0) * (U(p).left + U(p).held), 0);
  const avail = stock.reduce((a, p) => a + U(p).left, 0), res = stock.reduce((a, p) => a + U(p).held, 0);
  const list = S.products.filter(p => S.filter === 'all' || (S.filter === 'site' ? p.onSite : p.cat === S.filter));
  const T = todo();
  const sp = shortParts(value);
  let h = `<div class="brand-top"><img class="brand-logo" src="brand/logo-sun.png" alt="سینژین"></div>` + head('ویترین', 'سینژین', `<button class="add-pill" data-new>${svg('plus')}<span>محصول</span></button>`);
  h += `<section class="hero enter"><span class="hero-k">ارزش ویترین</span>
    ${value ? `<div class="hero-n"><b data-count="${value}">${sp.num}</b><small>${sp.unit}</small></div>` : `<div class="hero-n empty"><b>${stock.length ? 'هنوز قیمتی ثبت نشده' : 'خالی'}</b></div>`}
    <span class="hero-s">${say(stock.length ? `جمع قیمت فروش ${avail} عدد آماده${res ? ` و ${res} رزرو` : ''}` : 'هنوز محصولی ثبت نشده است')}</span></section>`;
  h += jobCard();
  if (T.length) h += `<div class="stitle">کارهای امروز</div><div class="group enter">${T.map(line).join('')}</div>`;
  if (S.products.length) {
    const onSite = S.products.filter(p => p.onSite).length;
    const cats = [{ id: 'all', name: 'همه' }, ...CATEGORIES.filter(c => S.products.some(p => p.cat === c.id)), ...(onSite ? [{ id: 'site', name: `روی سایت ${faDigits(onSite)}` }] : [])];
    if (cats.length > 2) h += `<div class="chips scroll">${cats.map(c => `<button class="chip ${S.filter === c.id ? 'on' : ''}" data-filter="${c.id}">${c.name}</button>`).join('')}</div>`;
    else h += `<div class="stitle">محصولات</div>`;
    h += `<div class="grid">${list.map(card).join('')}</div>`;
  } else {
    h += `<div class="empty enter"><p>اولین محصول را ثبت کنید؛ قیمتش همان لحظه حساب می‌شود.</p><button class="btn" data-new>ثبت اولین محصول</button></div>`;
  }
  return h;
}

// Badge: how many are ready when more than one, reserved, or sold out.
function badge(p) {
  const u = unitsFor(p);
  if (u.left > 1) return `<span class="badge">${faDigits(u.left)} عدد</span>`;
  if (u.left === 1) return '';
  return `<span class="badge s-${u.status}">${STATUSES.find(s => s.id === u.status).name}</span>`;
}
function card(p) {
  const v = shownPrice(p, S.settings);
  const ph = p.photos && p.photos[0] && urls.get(p.photos[0]);
  const name = p.title || [p.sub, levelOf(p.level) && levelOf(p.level).name].filter(Boolean).join('، ') || 'بی‌نام';
  return `<button class="pcard enter" data-edit="${p.id}">
    <div class="thumb">${ph ? `<img src="${ph}" alt="" loading="lazy">` : `<span class="noimg">${esc(p.sub || (catOf(p.cat) || {}).name || '')}</span>`}
      ${badge(p)}</div>
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
  const { A, items } = insights(view(), S.settings, S.market);
  const all = S.products.length;
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
      <p class="foot">${say(`طول نوار = تعداد آمادهٔ هر دسته. تا امروز ${faDigits(S.products.reduce((a, p) => a + unitsFor(p).soldAll, 0))} عدد با فاکتور فروخته شده است.`)}</p>`;
  }
  return h;
}

// ---------- sales: invoices ----------
const DAY = 864e5;
const itemOf = p => ({
  listPrice: shownPrice(p, S.settings),
  sub: p.sub, material: p.material, weight: supplierOf(S.settings, p.material) === 'self' ? p.weight : null, level: p.level,
  productId: p.id, photo: p.photos && p.photos[0] || null, price: shownPrice(p, S.settings),
  title: p.title || p.sub || 'محصول',
  detail: [p.sub, matOf(p.material) && p.material !== 'none' ? matOf(p.material).name : '', supplierOf(S.settings, p.material) === 'self' && p.weight ? `${faDigits(p.weight)} گرم` : ''].filter(Boolean).join('، '),
});
function openInvoice(inv, productId, cust) {
  const base = inv ? JSON.parse(JSON.stringify(inv)) : { id: uid(), no: nextNumber(S.invoices), date: Date.now(), customer: { name: cust ? cust.name : '', phone: cust ? cust.phone || '' : '' }, customerId: cust ? cust.id : null, items: [], shipping: null, discount: null, paid: null, note: '' };
  S.cust = null; S.ord = null;
  if (productId) { const p = S.products.find(x => x.id === productId); if (p) base.items.push(itemOf(p)); }
  S.inv = { d: base, edit: !!inv };
  openSheet('');
  drawInvoice();
}
function invSum(d) {
  const t = totals(d);
  return `<span class="c-main"><small>مبلغ کل</small><b>${iso(fmt(t.total))} تومان</b></span>${t.paid && t.remaining ? `<span class="sec">${say(`مانده ${plain(t.remaining)}`)}</span>` : t.total && t.paid >= t.total ? '<span class="st st-paid">تسویه</span>' : ''}`;
}
// Under an item's sale price: how it compares with the shop-window price.
function saleNote(it) {
  const list = it.listPrice ?? it.price;
  if (it.price == null || !list || it.price === list) return say(`قیمت ویترین: ${plain(list || 0)} تومان`);
  const pct = Math.round((1 - it.price / list) * 100);
  return say(`قیمت ویترین ${plain(list)} تومان؛ ${pct > 0 ? `${pct}٪ ارزان‌تر` : `${-pct}٪ گران‌تر`} فروخته شد`);
}
// Pick products; the app already knows each one's price, metal and weight. Servin types only shipping,
// discount and the amount received. Buyer and note are optional and folded away.
function drawInvoice() {
  const d = S.inv.d, panel = $('#sheet .panel');
  const chosen = new Set(d.items.map(i => i.productId).filter(Boolean));
  const sellable = S.products.filter(p => (unitsFor(p).left > 0 || chosen.has(p.id)) && shownPrice(p, S.settings) != null);
  const names = [...new Set([...S.customers.map(c => c.name), ...S.invoices.map(i => i.customer && i.customer.name)].filter(Boolean))];
  const t = totals(d);
  const nf = (key, label, val, ph) => `<label class="cell"><span>${label}</span><input class="bare" data-inum="${key}" inputmode="numeric" placeholder="${ph}" value="${val == null ? '' : fmt(val)}"><em class="u">تومان</em></label>`;
  let h = `<div class="ed-top"><button class="x back" data-back aria-label="برگشت">${svg('back')}</button><span class="sec">${noFa(d.no)}</span></div>
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
    h += `<div class="group calcbox">${d.items.map((it, i) => {
      const list = it.listPrice ?? it.price;
      return `<div class="cell col"><div class="crow"><span class="c-main"><b>${esc(it.title)}</b><small>${esc(it.detail || '')}</small></span></div>
        <label class="sale"><span>قیمت فروش در این فاکتور</span><input class="bare amt-in" data-inum="item:${i}:price" inputmode="numeric" value="${it.price == null ? '' : fmt(it.price)}"><em class="u">تومان</em></label>
        <small class="sale-note" data-note="${i}">${saleNote(it)}</small></div>`;
    }).join('')}
      <div class="cell"><span class="sec">جمع محصولات</span><b class="amt" id="inv-sub">${iso(fmt(t.subtotal))}</b></div></div>
    <p class="foot">قیمت هر محصول از ویترین می‌آید؛ اگر ارزان‌تر یا گران‌تر فروختید، همین‌جا عوضش کنید. فقط برای همین فروش است.</p>`;
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
  // Always the official brand logo; older invoices get their item details from the product itself.
  const logo = await loadImg('brand/logo-sun.png');
  const ph = {};
  const items = inv.items.map(it => {
    const p = it.productId && S.products.find(x => x.id === it.productId);
    return p ? { sub: p.sub, material: p.material, weight: supplierOf(S.settings, p.material) === 'self' ? p.weight : null, level: p.level, ...it, photo: it.photo || (p.photos && p.photos[0]) } : it;
  });
  for (const it of items) if (it.photo) ph[it.photo] = await loadImg(urls.get(it.photo));
  return renderInvoice({ ...inv, items }, { ...(S.settings.brand || {}) }, logo, id => ph[id] || null);
}
async function showInvoice(id) {
  const inv = S.invoices.find(i => i.id === id);
  if (!inv) return;
  S.inv = null;
  openSheet(`<div class="ed-top"><button class="x back" data-back aria-label="برگشت">${svg('back')}</button><span class="sec">${noFa(inv.no)}</span></div><div class="inv-wait">در حال ساخت فاکتور…</div>`);
  const cv = await invoiceImage(inv);
  S.preview = { inv, cv };
  $('#sheet .panel').innerHTML = `<div class="ed-top"><button class="x back" data-back aria-label="برگشت">${svg('back')}</button><span class="sec">${noFa(inv.no)}</span></div>
    <img class="inv-img" src="${cv.toDataURL('image/png')}" alt="فاکتور">
    <div class="ed-foot"><button class="btn ghost" data-iedit="${inv.id}">ویرایش</button><button class="btn ghost" data-iprint>چاپ یا PDF</button><button class="btn" data-ishare>ارسال تصویر</button></div>`;
}
async function saveInvoice() {
  const d = S.inv.d, now = Date.now();
  // Say exactly what is missing, one thing at a time.
  if (!d.items.length) return island('یک محصول را از بالا انتخاب کنید');
  const t = totals(d);
  const undo = await snap({ invoices: [d.id], products: d.items.map(it => it.productId).filter(Boolean) });
  // When it was paid in full: sales and ready counts are worked out from this.
  if (t.status === 'paid') d.paidAt = d.paidAt || now; else delete d.paidAt;
  // The buyer is a customer (found by phone, then name, or made new).
  const c = await linkCustomer(d.customer.name, d.customer.phone);
  d.customerId = c ? c.id : null;
  // A custom order's invoice paid in full: the order is delivered.
  const ord = d.orderId && S.orders.find(o => o.id === d.orderId);
  const ordUndo = ord ? await snap({ orders: [ord.id] }) : null;
  if (ord && t.status === 'paid' && ord.stage !== 'cancelled' && ord.stage !== 'done') { ord.stage = 'done'; ord.doneAt = now; d.terms = null; await putOrder(ord); logEvent(`${orderNo(ord)}: تحویل و تسویه شد`); }
  await db.put('invoices', d);
  const i = S.invoices.findIndex(x => x.id === d.id);
  if (i >= 0) S.invoices[i] = d; else S.invoices.unshift(d);
  // Products follow the invoice by themselves: a paid one is a sale, a deposit or unpaid one holds a piece.
  // The sale price lives on the invoice; the library price never changes here.
  refreshUnits();
  S.tab = 'sales'; render();
  logEvent(`فاکتور ${noFa(d.no)} را ${S.inv && S.inv.edit ? 'به‌روز کرد' : 'ساخت'}${d.customer.name ? ` برای ${d.customer.name}` : ''}؛ ${plain(t.total)} تومان، ${STATUS_NAME[t.status]}`);
  await showInvoice(d.id);
  offerUndo(t.status === 'paid' ? 'فاکتور ساخته شد؛ فروش ثبت شد' : 'فاکتور ساخته شد؛ محصول رزرو شد', async () => { closeSheet(); if (ordUndo) await ordUndo(); await undo(); });
}

// ---------- customers and custom orders (CRM) ----------
// Decided 1405/09/07: customers sync between both phones; a custom order goes request → deposit → making → ready →
// delivered; deposit = max(half the estimate, the making cost); it comes back only before making starts; from the
// deposit on, the order is priced with that day's metal.
const dayFa = ts => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric', month: 'long' }).format(new Date(ts));
const custOf = id => id && S.customers.find(c => c.id === id);
const orderInv = o => o.invoiceId && S.invoices.find(i => i.id === o.invoiceId);
const orderTitle = o => (o.spec && (o.spec.title || o.spec.sub)) || 'سفارش';
const buyerName = i => (custOf(i.customerId) || {}).name || (i.customer && i.customer.name) || 'بی‌نام';
const orderNo = o => 'سفارش ' + faDigits(o.no || 0);

async function putCustomer(c) {
  c.updatedAt = Date.now(); c.createdAt ||= c.updatedAt;
  await db.put('customers', c);
  const i = S.customers.findIndex(x => x.id === c.id);
  if (i >= 0) S.customers[i] = c; else S.customers.unshift(c);
  return c;
}
async function putOrder(o) {
  o.updatedAt = Date.now(); o.createdAt ||= o.updatedAt;
  await db.put('orders', o);
  const i = S.orders.findIndex(x => x.id === o.id);
  if (i >= 0) S.orders[i] = o; else S.orders.unshift(o);
  return o;
}
async function putInvoice(inv) {
  await db.put('invoices', inv);
  const i = S.invoices.findIndex(x => x.id === inv.id);
  if (i >= 0) S.invoices[i] = inv; else S.invoices.unshift(inv);
}
// The buyer of an invoice or order becomes a customer: same phone, then same name; otherwise a new customer.
async function linkCustomer(name, phone) {
  name = String(name || '').trim(); phone = String(phone || '').trim();
  if (!name && !normPhone(phone)) return null;
  const c = findCustomer(S.customers, name, phone);
  if (c) { if (phone && !c.phone) { c.phone = phone; await putCustomer(c); } return c; }
  return putCustomer({ id: customerId(name, phone), name: name || 'بی‌نام', phone, insta: '', city: '', address: '', note: '' });
}
// Invoices from before customers existed: their buyer becomes a customer once (same id on both phones).
async function linkOldInvoices() {
  for (const inv of S.invoices) {
    if (inv.customerId || !inv.customer || !(inv.customer.name || inv.customer.phone)) continue;
    const c = await linkCustomer(inv.customer.name, inv.customer.phone);
    if (c) { inv.customerId = c.id; await db.put('invoices', inv); }
  }
}

// --- lists in the «فروش» tab ---
const SV = [['inv', 'فاکتورها'], ['ord', 'سفارش‌ها'], ['cust', 'مشتری‌ها']];
function viewSales() {
  const sv = S.sv || 'inv';
  const add = { inv: ['inew', 'فاکتور'], ord: ['onew', 'سفارش'], cust: ['cnew', 'مشتری'] }[sv];
  const openN = S.orders.filter(isOpen).length;
  let h = head('فروش', 'فاکتور، سفارش و مشتری', `<button class="add-pill" data-${add[0]}>${svg('plus')}<span>${add[1]}</span></button>`);
  h += `<div class="seg enter">${SV.map(([id, n]) => `<button class="${sv === id ? 'on' : ''}" data-sv="${id}">${n}${id === 'ord' && openN ? ` <i>${faDigits(openN)}</i>` : ''}</button>`).join('')}</div>`;
  return h + (sv === 'ord' ? ordersList() : sv === 'cust' ? customersList() : invoicesList());
}
const icell = i => { const t = totals(i); return `<button class="cell" data-iview="${i.id}"><span class="c-main"><b>${esc(buyerName(i))}</b><small>${noFa(i.no)}، ${say(`${i.items.length} قلم`)}</small></span>
  <span class="amt">${short(t.total)}</span><span class="st st-${t.status}">${STATUS_NAME[t.status]}</span></button>`; };
function invoicesList() {
  const recent = S.invoices.filter(i => Date.now() - i.date <= 30 * DAY);
  const sum = recent.reduce((a, i) => a + totals(i).total, 0);
  const owed = S.invoices.map(i => ({ i, t: totals(i) })).filter(x => x.t.remaining > 0 && x.t.paid > 0);
  const owedSum = owed.reduce((a, x) => a + x.t.remaining, 0);
  const sp = shortParts(sum);
  let h = `<section class="hero enter"><span class="hero-k">فروش ۳۰ روز اخیر</span>
    ${sum ? `<div class="hero-n"><b data-count="${sum}">${sp.num}</b><small>${sp.unit}</small></div>` : '<div class="hero-n empty"><b>هنوز فروشی نیست</b></div>'}
    <span class="hero-s">${say(recent.length ? `${recent.length} فاکتور${owedSum ? `؛ ${plain(owedSum)} تومان مانده از بیعانه‌ها` : ''}` : 'هنوز فاکتوری صادر نشده است')}</span></section>`;
  if (!S.invoices.length) return h + `<div class="empty enter"><p>از روی یک محصول یا همین‌جا فاکتور بسازید؛ قیمت، عکس و جمع‌ها خودکار پر می‌شوند.</p><button class="btn" data-inew>اولین فاکتور</button></div>`;
  if (owed.length) h += `<div class="stitle">مانده از مشتری‌ها</div><div class="group enter">${owed.map(x => icell(x.i)).join('')}</div>`;
  return h + `<div class="stitle">همهٔ فاکتورها</div><div class="group enter">${S.invoices.map(icell).join('')}</div>`;
}
function ocell(o) {
  const c = custOf(o.customerId), r = orderPrice(o, S.settings);
  const when = o.due && isOpen(o) ? `، تحویل ${dayFa(o.due)}` : '';
  return `<button class="cell" data-oview="${o.id}"><span class="c-main"><b>${esc(orderTitle(o))}</b><small>${esc(c ? c.name : 'بی‌نام')}${say(when)}</small></span>
    ${r.complete ? `<span class="amt">${short(r.final)}</span>` : ''}<span class="st st-${o.stage}">${STAGE_NAME[o.stage]}</span></button>`;
}
function ordersList() {
  const open = S.orders.filter(isOpen).sort((a, b) => STAGES.findIndex(s => s.id === b.stage) - STAGES.findIndex(s => s.id === a.stage) || (a.due || 9e15) - (b.due || 9e15));
  const past = S.orders.filter(o => !isOpen(o)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
  const held = open.reduce((a, o) => { const inv = orderInv(o); return a + (inv ? totals(inv).paid : 0); }, 0);
  let h = `<section class="hero enter"><span class="hero-k">سفارش‌های باز</span>
    <div class="hero-n ${open.length ? '' : 'empty'}"><b>${open.length ? faDigits(open.length) : 'سفارش بازی نیست'}</b>${open.length ? '<small>سفارش</small>' : ''}</div>
    <span class="hero-s">${say(held ? `${plain(held)} تومان بیعانه گرفته شده؛ قیمت فلزشان قفل است` : 'سفارش سفارشی: قیمت برآوردی، بیعانه، ساخت و تحویل')}</span></section>`;
  if (!S.orders.length) return h + `<div class="empty enter"><p>مشتری چیزی سفارش داد؟ همین‌جا ثبتش کنید؛ قیمت برآوردی و بیعانهٔ منصفانه خودکار حساب می‌شود.</p><button class="btn" data-onew>اولین سفارش</button></div>`;
  if (open.length) h += `<div class="stitle">در جریان</div><div class="group enter">${open.map(ocell).join('')}</div>`;
  if (past.length) h += `<div class="stitle">تمام‌شده</div><div class="group enter">${past.map(ocell).join('')}</div>`;
  return h;
}
function customersList() {
  if (!S.customers.length) return `<div class="empty enter"><p>هر کس فاکتور یا سفارش بگیرد، خودش اینجا می‌آید؛ یا همین‌جا اضافه کنید.</p><button class="btn" data-cnew>اولین مشتری</button></div>`;
  const rows = S.customers.map(c => ({ c, s: customerStats(c, S.invoices, S.orders) })).sort((a, b) => (b.s.last || b.c.createdAt) - (a.s.last || a.c.createdAt));
  const total = rows.reduce((a, x) => a + x.s.bought, 0);
  let h = `<section class="hero enter"><span class="hero-k">مشتری‌ها</span><div class="hero-n"><b>${faDigits(rows.length)}</b><small>نفر</small></div>
    <span class="hero-s">${say(total ? `جمع خریدها ${plain(total)} تومان` : 'هنوز خرید تسویه‌شده‌ای نیست')}</span></section>`;
  return h + `<div class="group enter">${rows.map(({ c, s }) => `<button class="cell" data-cview="${c.id}"><span class="c-main"><b>${esc(c.name)}</b>
    <small>${say([s.n ? `${s.n} خرید، ${plain(s.bought)} تومان` : 'هنوز خریدی نیست', s.open ? `${s.open} سفارش باز` : '', s.owed ? `مانده ${plain(s.owed)}` : ''].filter(Boolean).join('، '))}</small></span>${svg('chev')}</button>`).join('')}</div>`;
}

// --- one customer ---
function openCustomer(c) {
  S.cust = { d: c ? JSON.parse(JSON.stringify(c)) : { id: null, name: '', phone: '', insta: '', city: '', address: '', note: '' }, edit: !!c };
  S.ord = null; S.inv = null;
  if ($('#sheet').classList.contains('open')) drawCustomer(); else { openSheet(''); drawCustomer(); }
}
function drawCustomer() {
  const { d, edit } = S.cust;
  const tf = (k, label, ph, mode = '') => `<label class="cell"><span>${label}</span><input class="bare txt" data-ctext="${k}" ${mode} placeholder="${ph}" value="${esc(d[k] || '')}"></label>`;
  let h = `<div class="ed-top"><button class="x back" data-back aria-label="برگشت">${svg('back')}</button><span class="sec">مشتری</span></div>
    <h2 class="q">${esc(d.name || 'مشتری تازه')}</h2>`;
  if (edit) {
    const s = customerStats(d, S.invoices, S.orders), ph = normPhone(d.phone), ig = String(d.insta || '').replace(/^@/, '').trim();
    const links = [ph ? `<a class="chip" href="tel:${ph}">تماس</a>` : '', ph ? `<a class="chip" href="https://wa.me/98${ph.slice(1)}" target="_blank" rel="noopener">واتس‌اپ</a>` : '',
      ig ? `<a class="chip" href="https://instagram.com/${encodeURIComponent(ig)}" target="_blank" rel="noopener">اینستاگرام</a>` : ''].join('');
    if (links) h += `<div class="chips quick">${links}</div>`;
    h += `<div class="stats group"><div><small>جمع خرید</small><b>${s.bought ? short(s.bought) : '—'}</b><small>${say(`${s.n} خرید تسویه‌شده`)}</small></div>
      <div><small>آخرین خرید</small><b>${s.last ? say(dayFa(s.last)) : '—'}</b><small>${s.owed ? say(`مانده ${plain(s.owed)}`) : 'بدون مانده'}</small></div></div>`;
    const ords = S.orders.filter(o => o.customerId === d.id);
    if (ords.length) h += `<div class="stitle">سفارش‌ها</div><div class="group">${ords.map(ocell).join('')}</div>`;
    if (s.invoices.length) h += `<div class="stitle">فاکتورها</div><div class="group">${s.invoices.map(icell).join('')}</div>`;
    h += `<div class="chips quick"><button class="chip" data-cinv>فاکتور تازه برای او</button><button class="chip" data-cord>سفارش تازه برای او</button></div>`;
  }
  h += `<div class="stitle">اطلاعات</div><div class="group">${tf('name', 'نام', 'نام و نام خانوادگی')}${tf('phone', 'تلفن', '۰۹۱۲…', 'inputmode="tel"')}${tf('insta', 'اینستاگرام', 'آیدی، بدون @')}
    ${tf('city', 'شهر', 'اختیاری')}${tf('address', 'آدرس', 'برای ارسال')}${tf('note', 'یادداشت', 'سایز انگشت، سلیقه، مناسبت…')}</div>
    <p class="foot">روی هر دو گوشی دیده می‌شود؛ فقط در حساب سینژین.</p>
    <div class="ed-foot">${edit && !S.invoices.some(i => i.customerId === d.id) && !S.orders.some(o => o.customerId === d.id) ? '<button class="btn ghost danger" data-cdel>حذف</button>' : ''}<button class="btn" data-csave>ذخیره</button></div>`;
  $('#sheet .panel').innerHTML = h;
}
async function saveCustomer() {
  const d = S.cust.d;
  if (!d.name.trim()) return island('نام مشتری را بنویسید');
  if (!S.cust.edit) {
    const dup = findCustomer(S.customers, d.name, d.phone);
    if (dup) { island('این مشتری از قبل هست'); return openCustomer(dup); }
    d.id = customerId(d.name, d.phone);
  }
  const prev = S.cust.edit ? S.customers.find(c => c.id === d.id) : null;
  const undo = await snap({ customers: [d.id] });
  await putCustomer({ ...(prev || {}), ...d, name: d.name.trim() });
  logEvent(`${prev ? 'اطلاعات مشتری' : 'مشتری تازه'} «${d.name.trim()}» را ${prev ? 'به‌روز کرد' : 'ثبت کرد'}`);
  S.cust = null; closeSheet(); S.tab = 'sales'; S.sv = 'cust'; render();
  offerUndo('مشتری ذخیره شد', undo);
}

// --- one custom order ---
const DUE = [[7, 'یک هفته'], [14, 'دو هفته'], [21, 'سه هفته'], [30, 'یک ماه']];
function openOrder(o, cust) {
  const c = o ? custOf(o.customerId) : cust;
  const d = o ? JSON.parse(JSON.stringify(o)) : { id: uid(), no: Math.max(0, ...S.orders.map(x => x.no || 0)) + 1, stage: 'request', customerId: c ? c.id : null, spec: null, due: null, note: '' };
  S.ord = { d, edit: !!o, cname: c ? c.name : '', cphone: c ? c.phone || '' : '' };
  S.cust = null; S.inv = null;
  if ($('#sheet').classList.contains('open')) drawOrder(); else { openSheet(''); drawOrder(); }
}
function drawOrder() {
  const { d } = S.ord, sp = d.spec, r = orderPrice(d, S.settings), inv = orderInv(d), t = inv ? totals(inv) : null;
  const dep = suggestDeposit(r, S.settings.rounding || 100000);
  const si = STAGES.findIndex(s => s.id === d.stage);
  const names = S.customers.map(c => c.name);
  let h = `<div class="ed-top"><button class="x back" data-back aria-label="برگشت">${svg('back')}</button><span class="sec">${orderNo(d)}</span></div>
    <h2 class="q">${esc(sp ? orderTitle(d) : 'سفارش تازه')}</h2>`;
  h += d.stage === 'cancelled' ? `<div class="track"><span class="st st-cancelled">لغو شد</span></div>`
    : `<div class="track">${STAGES.map((s, i) => `<span class="tk ${i < si ? 'done' : i === si ? 'on' : ''}"><i></i>${s.name}</span>`).join('')}</div>`;
  // who
  h += `<p class="qn"><span class="n">۱</span>برای چه کسی</p><div class="group">
    <label class="cell"><span>نام</span><input class="bare txt" data-otext="cname" list="custs" placeholder="نام مشتری" value="${esc(S.ord.cname)}"></label>
    <label class="cell"><span>تلفن</span><input class="bare txt" data-otext="cphone" inputmode="tel" placeholder="اختیاری" value="${esc(S.ord.cphone)}"></label></div>
    <datalist id="custs">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
  // what
  const desc = sp ? [catOf(sp.cat) && sp.sub, matOf(sp.material) && sp.material !== 'none' ? matOf(sp.material).name : '', sp.weight ? `${sp.weight} گرم` : '', levelOf(sp.level) ? levelOf(sp.level).name : ''].filter(Boolean).join('، ') : '';
  h += `<p class="qn"><span class="n">۲</span>چه چیزی و چه قیمتی</p><div class="group">
    <button class="cell" data-ospec><span class="c-main"><b>${sp ? 'مشخصات و قیمت برآوردی' : 'مشخصات را وارد کنید'}</b><small>${sp ? say(desc) : 'نوع، فلز، وزن تقریبی، سطح کار؛ مثل ثبت محصول'}</small></span>${r.complete ? `<span class="amt">${short(r.final)}</span>` : ''}${svg('chev')}</button></div>`;
  if (d.metal) h += `<p class="foot">${say(`قیمت فلز از روز بیعانه قفل است${d.metal.silver ? `: نقره هر گرم ${plain(d.metal.silver)} تومان` : ''}. ${d.stage === 'making' ? 'وقتی آماده شد، وزن واقعی را ثبت کنید.' : ''}`)}</p>`;
  // when
  if (isOpen(d)) {
    h += `<p class="qn"><span class="n">۳</span>زمان تحویل</p><div class="chips wrap">${DUE.map(([n, l]) => `<button class="chip ${S.ord.dueN === n ? 'on' : ''}" data-odue="${n}">${l}</button>`).join('')}${d.due ? '<button class="chip" data-odue="0">بدون تاریخ</button>' : ''}</div>
      ${d.due ? `<p class="foot">${say(`تحویل: ${dayFa(d.due)}`)}</p>` : ''}`;
  }
  h += `<div class="group"><label class="cell"><span>یادداشت</span><input class="bare txt" data-otext="note" placeholder="سایز، حکاکی، رنگ سنگ…" value="${esc(d.note || '')}"></label></div>`;
  // money: estimate, a fair deposit with its reason, what came in
  if (r.complete) {
    h += `<div class="stitle">پول</div><div class="group">
      <div class="cell"><span>${d.stage === 'ready' || d.stage === 'done' ? 'قیمت نهایی (وزن واقعی)' : 'قیمت برآوردی'}</span><b class="amt">${iso(fmt(r.final))}</b></div>`;
    if (!inv && d.stage === 'request' && dep) {
      h += `<label class="cell"><span>بیعانه</span><input class="bare" data-onum="deposit" inputmode="numeric" placeholder="${fmt(dep.value)}" value="${d.deposit ? fmt(d.deposit) : ''}"><em class="u">تومان</em></label></div>
        <p class="foot">${say(`پیشنهاد ${plain(dep.value)} تومان: بیشترِ نصف قیمت (${plain(dep.half)}) و هزینهٔ ساخت (${plain(dep.cost)})، تا اگر مشتری بعد از شروع ساخت انصراف داد، سینژین ضرر نکند.`)}</p>`;
    } else if (t) {
      h += `<div class="cell"><span>دریافت‌شده</span><b class="amt">${iso(fmt(t.paid))}</b></div>${t.remaining ? `<div class="cell"><span>مانده</span><b class="amt">${iso(fmt(Math.max(0, r.final - t.paid)))}</b></div>` : ''}</div>`;
    } else h += `</div>`;
    if (isOpen(d)) h += `<p class="foot">${esc(TERMS)}</p>`;
  }
  if (d.stage === 'done' || d.stage === 'cancelled') {
    const pr = orderProfit(d, S.settings, inv);
    if (pr) h += `<div class="stitle">سود و زیان این سفارش</div><div class="group"><div class="cell"><span>فروش</span><b class="amt">${iso(fmt(pr.sale))}</b></div>
      ${pr.cost != null ? `<div class="cell"><span>هزینهٔ ساخت</span><b class="amt">${iso(fmt(pr.cost))}</b></div><div class="cell"><span>${pr.profit >= 0 ? 'سود' : 'زیان'}</span><b class="amt ${pr.profit >= 0 ? 'ok' : 'warn'}">${iso(fmt(Math.abs(pr.profit)))}</b></div>` : ''}</div>
      <p class="foot">${say('فروش = قیمت اقلام فاکتور منهای تخفیف (بدون ارسال). هزینهٔ ساخت = فلز با قیمت روز بیعانه + سنگ + هزینهٔ ساخت.')}</p>`;
    if (d.stage === 'cancelled') h += `<p class="foot">${say(d.refunded ? `لغو پیش از شروع ساخت؛ ${plain(d.refunded)} تومان بیعانه برگشت.` : 'لغو بعد از شروع ساخت؛ بیعانه طبق شرایط نگه داشته شد.')}</p>`;
  }
  // what to do next, one main button
  const next = { request: ['odeposit', 'بیعانه گرفتم'], deposit: ['ostart', 'ساخت شروع شد'], making: ['oready', 'آماده شد'], ready: ['odeliver', 'تحویل و تسویه'] }[d.stage];
  const side = [inv ? `<button class="btn ghost" data-iview="${inv.id}">فاکتور</button>` : '', isOpen(d) && S.ord.edit ? '<button class="btn ghost danger" data-ocancel>لغو</button>' : '',
    !S.ord.edit || d.stage === 'request' ? '<button class="btn ghost" data-osave>ذخیره</button>' : ''].join('');
  h += `<div class="ed-foot">${side}${next ? `<button class="btn" data-${next[0]}>${next[1]}</button>` : ''}</div>`;
  $('#sheet .panel').innerHTML = h;
}
// The order's details and price are filled in with the product form; it comes back here.
function openSpec(then) {
  const d = S.ord.d, sp = d.spec ? JSON.parse(JSON.stringify(d.spec)) : blank();
  Object.assign(sp, { _added: [], _ready: 0, photos: sp.photos || [] });
  S.ed = { d: sp, step: then === 'ready' ? 2 : d.spec ? 4 : 0, edit: false, order: true, then, st: orderSettings(S.settings, d) };
  drawEditor();
  if (then === 'ready') island('وزن واقعی را وارد کنید؛ قیمت نهایی با قیمت فلز روز بیعانه حساب می‌شود');
}
async function saveSpec() {
  const { _added, _ready, ...spec } = S.ed.d, then = S.ed.then;
  S.ord.d.spec = spec; S.ed = null;
  if (then === 'ready') return stageTo('ready');
  if (S.ord.edit) await commitOrder('مشخصات سفارش را به‌روز کرد');
  drawOrder();
}
// Save the order with its customer; `what` goes to the history.
async function commitOrder(what) {
  const o = S.ord.d;
  const c = await linkCustomer(S.ord.cname, S.ord.cphone);
  if (c) o.customerId = c.id;
  await putOrder(o); S.ord.edit = true;
  logEvent(`${orderNo(o)}${c ? ` (${c.name})` : ''}: ${what}`);
}
async function stageTo(stage) {
  const o = S.ord.d, now = Date.now(), r = orderPrice(o, S.settings);
  const undo = await snap({ orders: [o.id], invoices: o.invoiceId ? [o.invoiceId] : [] });
  o.stage = stage; o[stage + 'At'] = now;
  // The final price follows the real weight; the invoice shows it, the deposit already in.
  const inv = orderInv(o);
  if (inv && r.complete && (stage === 'ready')) { inv.items[0].price = r.final; inv.items[0].listPrice = r.final; inv.items[0].weight = o.spec.weight; await putInvoice(inv); }
  await commitOrder({ making: 'ساخت شروع شد', ready: `آماده شد؛ قیمت نهایی ${plain(r.final || 0)} تومان` }[stage] || STAGE_NAME[stage]);
  drawOrder(); offerUndo(STAGE_NAME[stage], undo);
}
async function takeDeposit() {
  const o = S.ord.d, r = orderPrice(o, S.settings), dep = suggestDeposit(r, S.settings.rounding || 100000);
  if (!S.ord.cname.trim()) return island('نام مشتری را بنویسید');
  if (!r.complete) return island('اول مشخصات و قیمت برآوردی را کامل کنید');
  const amount = o.deposit || dep.value, now = Date.now();
  const undo = await snap({ orders: [o.id] });
  const c = await linkCustomer(S.ord.cname, S.ord.cphone);
  o.customerId = c.id;
  o.metal = { silver: S.settings.prices.silver ?? null, gold: S.settings.prices.gold ?? null };
  o.estimate = r.final; o.deposit = amount; o.stage = 'deposit'; o.depositAt = now;
  const sp = o.spec, self = supplierOf(S.settings, sp.material) === 'self';
  const inv = { id: uid(), no: nextNumber(S.invoices), date: now, customer: { name: c.name, phone: c.phone || '' }, customerId: c.id, orderId: o.id,
    items: [{ title: orderTitle(o), price: r.final, listPrice: r.final, sub: sp.sub, material: sp.material, weight: self ? sp.weight : null, level: sp.level, photo: (sp.photos || [])[0] || null, detail: 'سفارش سفارشی' }],
    shipping: null, discount: null, paid: amount, note: o.note || '', terms: TERMS };
  o.invoiceId = inv.id;
  await putInvoice(inv);
  await commitOrder(`بیعانه ${plain(amount)} تومان گرفت؛ قیمت فلز قفل شد`);
  offerUndo('بیعانه ثبت شد؛ فاکتور بیعانه آماده است', async () => { await db.del('invoices', inv.id); await undo(); });
  await showInvoice(inv.id);
}
async function deliverOrder() {
  const o = S.ord.d, inv = orderInv(o), r = orderPrice(o, S.settings);
  if (!inv) return island('فاکتور این سفارش پیدا نشد');
  if (r.complete) { inv.items[0].price = r.final; inv.items[0].listPrice = r.final; }
  inv.paid = totals({ ...inv, paid: 0 }).total;  // whole amount received; Servin can change it before saving
  S.ord = null;
  openInvoice(inv);
  island('مبلغ کامل گذاشته شد؛ ارسال یا تخفیف را اگر هست وارد کنید و ذخیره بزنید');
}
async function cancelOrder() {
  const o = S.ord.d, inv = orderInv(o), paid = inv ? totals(inv).paid : 0, now = Date.now();
  const back = refundable(o);
  if (!confirm(!paid ? 'این سفارش لغو شود؟' : back ? `ساخت شروع نشده؛ ${plain(paid)} تومان بیعانه به مشتری برمی‌گردد. لغو شود؟` : `ساخت شروع شده؛ بیعانه (${plain(paid)} تومان) طبق شرایط برنمی‌گردد و درآمد ثبت می‌شود. لغو شود؟`)) return;
  const undo = await snap({ orders: [o.id], invoices: inv ? [inv.id] : [] });
  if (inv && back) { await db.del('invoices', inv.id); S.invoices = S.invoices.filter(i => i.id !== inv.id); o.invoiceId = null; o.refunded = paid; }
  else if (inv) {
    // Kept deposit: the invoice becomes a settled sale of exactly that amount.
    inv.items[0].price = paid; inv.items[0].title = `${orderTitle(o)} (لغو بعد از شروع ساخت)`; inv.discount = null; inv.shipping = null; inv.terms = null; inv.paidAt = now;
    await putInvoice(inv);
    o.spentCost = orderPrice(o, S.settings).cost ?? null;
  }
  o.stage = 'cancelled'; o.cancelledAt = now;
  await commitOrder(back ? `لغو شد؛ ${plain(paid)} تومان بیعانه برگشت` : 'لغو شد؛ بیعانه نگه داشته شد');
  drawOrder(); offerUndo('سفارش لغو شد', undo);
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
  const Y = sync.state;
  if (!Y.key) {
    h += `<div class="stitle">حساب مشترک</div><div class="group enter">
      <label class="cell"><span>نام کاربری</span><input class="bare txt" id="su" autocomplete="username" autocapitalize="off" placeholder="مثلاً seenzhin"></label>
      <label class="cell"><span>رمز</span><input class="bare txt" id="sp" type="password" autocomplete="current-password" placeholder="دست‌کم ۶ حرف"></label></div>
      <div class="actions-row"><button class="btn" data-signin>ورود</button></div>
      <p class="foot">شما و سروین با همین یک نام و رمز وارد شوید؛ هر چه روی یک گوشی ثبت شود، روی گوشی دیگر هم می‌آید.</p>
      <div class="stitle">یا وصل شدن با کد اتصال</div><div class="group enter">
        <label class="cell"><input class="bare txt" id="sc" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="کدی که از گوشی دیگر فرستاده شده"></label></div>
      <div class="actions-row"><button class="btn ghost" data-joincode>اتصال با کد</button></div>
      <p class="foot">مطمئن‌ترین راه: روی گوشی‌ای که حساب دارد «کپی کد اتصال» را بزنید، کد را بفرستید و اینجا بچسبانید.</p>`;
  } else {
    const when = Y.last ? new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(new Date(Y.last)) : '';
    const st = Y.status === 'syncing' ? 'در حال همگام‌سازی…' : Y.status === 'error' ? Y.error : when ? `آخرین همگام‌سازی ساعت ${when}` : '';
    h += `<div class="stitle">حساب مشترک</div><div class="group enter">
      <div class="cell"><span class="c-main"><b>${esc(Y.user)}</b><small class="${Y.status === 'error' ? 'err' : ''}">${esc(st)}</small></span><button class="pill" data-syncnow>الان</button></div>
      <div class="cell"><span>شناسهٔ حساب</span><b class="fp">${esc(Y.fp || '')}</b></div>
      <button class="cell" data-copycode><span>کپی کد اتصال برای گوشی دیگر</span>${svg('chev')}</button>
      <button class="cell danger-row" data-signout><span>خروج از حساب روی این گوشی</span></button></div>
      <p class="foot">هر تغییر چند ثانیه بعد روی گوشی دیگر هم می‌آید. شناسهٔ حساب روی هر دو گوشی باید یکی باشد؛ اگر فرق دارد، نام یا رمز یکی نیست.</p>`;
  }
  h += `<div class="stitle">این گوشی مال کیست؟</div><div class="group enter"><div class="cell"><div class="seg wide">${Object.entries(WHO).map(([k, n]) => `<button class="${S.who === k ? 'on' : ''}" data-who="${k}">${n}</button>`).join('')}</div></div></div>
    <p class="foot">در تاریخچه کنار هر کار نوشته می‌شود چه کسی آن را انجام داده.</p>`;
  const L = (S.log || []).slice(0, S.logAll ? 300 : 12);
  h += `<div class="stitle">تاریخچه</div><div class="group enter">${L.length ? L.map(e => `<div class="cell"><span class="c-main"><b>${say(e.text)}</b><small>${esc(whoName(e.who))}، ${timeFa(e.at)}</small></span></div>`).join('')
    : '<div class="cell"><span class="sec">هنوز کاری ثبت نشده است.</span></div>'}
    ${(S.log || []).length > L.length ? '<button class="cell" data-logall><span class="sec">نمایش همه</span></button>' : ''}</div>`;
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
  h += `<div class="stitle">هزینهٔ ساخت</div><div class="group enter">${numCell('cast', 'ریخته‌گری هر گرم', 'تومان', st.castPerGram ?? null)}${numCell('hourly', 'هر ساعت کار دستی تیم', 'تومان', st.teamHourly ?? null)}
    <div class="cell col"><span class="sec">ساعت کار معمول تیم برای هر سطح (برای پیشنهاد)</span><div class="ftable"><span></span>${LEVELS.map(l => `<span class="fh">${l.name}</span>`).join('')}<span class="fl">ساعت</span>${LEVELS.map(l => `<input data-num="hlevel:${l.id}" data-dec="1" inputmode="decimal" placeholder="—" value="${st.hoursByLevel && st.hoursByLevel[l.id] != null ? fmtDec(st.hoursByLevel[l.id]) : ''}" aria-label="ساعت ${l.name}">`).join('')}</div></div></div>
    <p class="foot">ریخته‌گری برای برآورد فاکتور کارگاهِ قطعه‌های ریختگی است؛ ساعت کار برای کارهای دستی مثل تابلو.</p>`;
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
    ${['instagram:اینستاگرام:seenzhin', 'phone:تلفن:۰۹۱۲…', 'thanks:پیام پایانی:از انتخاب شما سپاسگزاریم', 'care:نکتهٔ نگهداری:دور از رطوبت و عطر نگه دارید'].map(x => { const [k, l, ph] = x.split(':'); return `<label class="cell"><span>${l}</span><input class="bare txt" data-brand="${k}" placeholder="${ph}" value="${esc(B[k] || '')}"></label>`; }).join('')}
  </div><p class="foot">روی هر فاکتور چاپ می‌شوند؛ لوگوی رسمی سینژین همیشه بالای فاکتور است.</p>`;
  h += `<div class="stitle">پشتیبان</div><div class="group enter"><button class="cell" data-export><span>گرفتن فایل پشتیبان</span>${svg('chev')}</button>
    <label class="cell"><span>بازگردانی از فایل</span>${svg('chev')}<input type="file" accept="application/json" data-import hidden></label></div>
    <p class="foot">داده‌ها روی همین دستگاه و، با حساب مشترک، روی سرور است؛ هر چند وقت یک پشتیبان بگیرید.</p>
    <p class="foot ver">نسخهٔ اپ: ${APP_VERSION}</p>`;
  return h;
}

// ---------- product editor: one question per screen ----------
const STEPS = ['چه محصولی؟', 'سطح کار', 'هزینه‌ها', 'عکس و نام'];
const blank = () => ({ desc: '', cat: null, sub: null, level: null, title: '', material: null, weight: null, stone: null, invoice: null, w: null, h: null, status: 'available', onSite: false, note: '', photos: [], _added: [] });

function openSheet(html) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="scrim" data-close></div><div class="panel" role="dialog" aria-modal="true">${html}</div>`;
  sh.classList.add('open'); document.body.classList.add('locked');
}
function closeSheet() {
  if (S.pendingRemote) { S.pendingRemote = false; setTimeout(render, 350); }
  $('#sheet').classList.remove('open'); document.body.classList.remove('locked');
  setTimeout(() => { if (!$('#sheet').classList.contains('open')) $('#sheet').innerHTML = ''; }, 320);
}
// How many of this design are ready to sell; sales and reservations come from the invoices.
function stockBox(d) {
  const u = S.ed.edit ? unitsFor(d) : { held: 0, soldAll: 0 };
  const facts = [u.held ? `${faDigits(u.held)} رزرو در فاکتور` : '', u.soldAll ? `${faDigits(u.soldAll)} فروخته تا امروز` : ''].filter(Boolean).join('، ');
  return `<div class="stitle">موجودی</div><div class="group"><div class="cell"><span>آماده برای فروش</span>
    <span class="qty"><button class="pill" data-qty="-1" aria-label="یکی کمتر">−</button><b>${faDigits(d._ready)}</b><button class="pill" data-qty="1" aria-label="یکی بیشتر">+</button></span></div></div>
    <p class="foot">${say(`با هر فاکتور تسویه‌شده یکی کم می‌شود؛ فاکتور بیعانه یکی را رزرو می‌کند.${facts ? ' ' + facts + '.' : ''} اگر دوباره ساختید، اینجا اضافه کنید.`)}</p>`;
}
// «روی سایت نشان بده»: only these products go to the Seenzhin website, with public fields only (js/site.js).
function siteBox(d) {
  const miss = d.onSite ? siteMissing(d, S.settings) : [];
  return `<div class="stitle">سایت</div><div class="group"><button class="cell" data-onsite role="switch" aria-checked="${d.onSite ? 'true' : 'false'}">
    <span class="c-main"><b>روی سایت نشان بده</b><small>${d.onSite ? 'در کاتالوگ سایت سینژین دیده می‌شود' : 'فعلاً فقط داخل اپ'}</small></span><i class="sw ${d.onSite ? 'on' : ''}"></i></button></div>
    <p class="foot">${miss.length ? say(`برای سایت کم دارد: ${miss.join('، ')}.`) : 'روی سایت فقط نام، عکس، توضیح کوتاه، نوع، فلز، وزن، قیمت و «موجود یا سفارشی» دیده می‌شود؛ هزینه‌ها هرگز.'}</p>`;
}
function openEditor(p, step) {
  const d = p ? Object.assign(blank(), JSON.parse(JSON.stringify(p)), { _added: [] }) : blank();
  d._ready = p ? unitsFor(p).left : 1;
  S.ed = { d, step: step ?? (p ? 4 : 0), edit: !!p };
  openSheet('');
  drawEditor();
}
async function closeEditor() {
  if (S.ed) for (const id of S.ed.d._added) { await db.del('photos', id); urls.delete(id); }
  // An order's details were open: back to the order, nothing saved.
  if (S.ed && S.ed.order) { S.ed = null; return drawOrder(); }
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

// Help under the workshop invoice: a suggestion from similar products when empty, a warning when a number looks
// like zeros were left out (e.g. «۱۶۵» for ۱۶۵ میلیون).
// Cast pieces: our own silver or gold, not a hand-built panel. Their casting is computed from the weight.
// The product form also prices custom orders; an order with a deposit uses that day's metal price.
const ES = () => (S.ed && S.ed.st) || S.settings;
const isCast = d => d.cat && d.cat !== 'panel' && ['silver', 'gold'].includes(d.material) && supplierOf(ES(), d.material) === 'self';
// «کمک برای حساب»: works out a «هزینهٔ ساخت» from casting (weight × fee, cast pieces) + team hours × rate,
// with the usual hours of the chosen level filled in; one tap copies it into the field.
function workHelper(d) {
  const st = ES(), fee = st.castPerGram, rate = st.teamHourly;
  if (!d.cat || supplierOf(st, d.material) === 'workshop') return '';
  const usual = d.level && st.hoursByLevel ? st.hoursByLevel[d.level] : null;
  const hours = d.hours ?? usual;
  const cast = isCast(d) && d.weight && fee ? d.weight * fee : 0;
  const labour = hours && rate ? hours * rate : 0;
  const total = cast + labour;
  const parts = [cast ? `ریخته‌گری ${d.weight} گرم × ${plain(fee)} = ${plain(cast)}` : '', labour ? `${hours} ساعت کار تیم × ${plain(rate)} = ${plain(labour)}` : ''].filter(Boolean);
  return `<details class="explain helper" ${d.invoice == null ? 'open' : ''}><summary>کمک برای حساب هزینهٔ ساخت</summary>
    ${field('hours', 'ساعت کار تیم روی این قطعه', 'ساعت', d.hours, usual && d.hours == null ? say(`معمولاً برای «${levelOf(d.level).name}» ${usual} ساعت؛ همین حساب شده.`) : 'پرداخت، لحیم، آبکاری، مونتاژ' + (d.cat === 'panel' ? '، یا ساختن تابلو.' : '.'), true)}
    ${total ? `<p class="auto">${say(parts.join(' + '))}<br>${say(`جمع: ${plain(total)} تومان`)} <button class="link" data-usecalc="${Math.round(total / 10000) * 10000}">همین را بگذار</button></p>` : ''}
  </details>`;
}
function invoiceHint(d) {
  if (d.invoice != null && d.invoice > 0 && d.invoice < 10000) {
    return `${say(`${fmt(d.invoice)} تومان خیلی کم است؛ شاید صفرها جا افتاده.`)} <button class="link" data-fixinv="1000">${say(`${fmt(d.invoice)} هزار`)}</button> <button class="link" data-fixinv="1000000">${say(`${fmt(d.invoice)} میلیون`)}</button>`;
  }
  const sg = d.invoice == null && supplierOf(ES(), d.material) === 'workshop' ? suggestInvoice(S.products, d) : null;
  if (sg) return `${say(`پیشنهاد: ${plain(sg.value)} تومان (از ${sg.n} محصول ${sg.basis})`)} <button class="link" data-usesug="${sg.value}">همین</button>`;
  return 'ریخته‌گری، کار تیم و کارگاه، همه با هم.';
}
// A setting the price still needs (level factor, material factor, metal price) can be filled right here,
// without leaving the product form. Saved to settings and shared with the other phone.
function inlineFix(d) {
  const r = price(d, ES()), out = [];
  for (const m of r.missing) {
    if (m.key.startsWith('factor:')) { const [, f, l] = m.key.split(':'); out.push(field(m.key, `ضریب «${levelOf(l).name}» برای ${FORMULAS[f].name}`, '×', null, 'برای همهٔ محصولات همین فرمول و سطح به کار می‌رود.', true)); }
    else if (m.key === 'markup') out.push(field('markup', 'ضریب متریال', '×', null, 'روی فلزی که خودتان می‌دهید و سنگ.', true));
    else if (m.key === 'cast') out.push(field('cast', 'ریخته‌گری هر گرم', 'تومان', null, 'برای همهٔ قطعه‌های ریختگی.'));
    else if (m.key === 'hourly') out.push(field('hourly', 'ارزش هر ساعت کار تیم', 'تومان', null, 'برای همهٔ کارهای دستی تیم به کار می‌رود.'));
    else if (m.key.startsWith('price:')) { const id = m.key.slice(6); out.push(field(m.key, `قیمت روز هر گرم ${matOf(id).name}`, 'تومان', null, S.market && S.market[id] ? `${say(`بازار امروز ${plain(S.market[id].p)} تومان`)} <button class="link" data-act="market:${id}">همین</button>` : '')); }
  }
  return out.length ? `<p class="lab2">برای کامل شدن قیمت این‌ها هم لازم است</p>${out.join('')}` : '';
}

function drawEditor() {
  const { d, step } = S.ed;
  const r = price(d, ES());
  const panel = $('#sheet .panel');
  let h = `<div class="ed-top"><button class="x back" data-back aria-label="برگشت">${svg('back')}</button>
    ${step < 4 ? `<div class="ed-price ${r.complete ? 'ok' : ''}"><span>قیمت فروش</span><b>${priceTag(r)}</b></div>` : ''}</div>`;
  if (step < 4) h += `<div class="dots">${STEPS.map((_, i) => `<i class="${i === step ? 'on' : i < step ? 'done' : ''}"></i>`).join('')}</div><h2 class="q">${STEPS[step]}</h2>`;
  if (step === 0) {
    h += chips('cat', CATEGORIES, d.cat, true);
    const cat = catOf(d.cat);
    if (cat) h += `<p class="lab2">کدام؟</p>${chips('sub', cat.subs.map(s => ({ id: s, name: s })), d.sub)}`;
  } else if (step === 1) {
    h += chips('level', LEVELS, d.level, true) + `<p class="help">هر سطح ضریب خودش را دارد؛ سطح بالاتر یعنی ارزش طراحی بیشتر.</p>`;
  } else if (step === 2) {
    const sup = supplierOf(ES(), d.material);
    h += `<p class="lab2">فلز</p>${chips('material', MATERIALS, d.material)}`;
    if (sup === 'self') h += field('weight', `وزن ${matOf(d.material).name}`, 'گرم', d.weight, 'فلزی که خودتان به کارگاه می‌دهید.', true);
    if (sup === 'workshop') h += `<p class="help">${matOf(d.material).name} را کارگاه می‌دهد؛ هزینه‌اش داخل فاکتور است.</p>`;
    h += field('invoice', 'هزینهٔ ساخت', 'تومان', d.invoice, invoiceHint(d));
    h += workHelper(d);
    h += `<div class="inline-fix">${inlineFix(d)}</div>`;
    h += field('stone', 'سنگ و قطعه‌ها', 'تومان', d.stone, 'سنگ، قلاب، الاستیک، زنجیر…؛ اگر ندارد خالی بگذارید.');
    if (formulaOf(d) === 'panel') h += `<div class="two">${field('w', 'عرض', 'سانتی‌متر', d.w, '', true)}${field('h', 'ارتفاع', 'سانتی‌متر', d.h, '', true)}</div>`;
  } else if (step === 3) {
    h += `<div class="photos">${d.photos.map(id => `<div class="ph"><img src="${urls.get(id) || ''}" alt=""><button class="rm" data-rmphoto="${id}" aria-label="حذف عکس">×</button></div>`).join('')}
      <label class="addph"><input type="file" accept="image/*" multiple data-photo hidden>${svg('plus')}<small>عکس</small></label></div>
      <label class="field"><span class="lab">نام محصول</span><span class="inp"><input data-text="title" placeholder="مثلاً انگشتر موج" value="${esc(d.title)}"></span></label>
      <label class="field"><span class="lab">توضیح کوتاه برای فروش (اختیاری)</span><span class="inp"><textarea data-text="desc" rows="3" placeholder="دو خط برای اینستاگرام و سایت">${esc(d.desc || '')}</textarea></span></label>`;
  } else {
    h += summary(d, r);
  }
  if (step < 4) {
    const can = [d.cat, d.level, d.material, true][step];
    h += `<div class="ed-foot">${step ? `<button class="btn ghost" data-step="${step - 1}">قبلی</button>` : ''}<button class="btn" data-step="${step + 1}" ${can ? '' : 'disabled'}>${step === 3 ? 'مرور و ذخیره' : 'بعدی'}</button></div>`;
  }
  panel.innerHTML = h;
}

// «این قیمت از کجا آمد؟»: every input with its unit and source, then each step with full numbers, then the profit.
function priceStory(d, r) {
  if (!r.complete) return '';
  if (r.manualFinal && r.formulaFinal == null) return `<div class="ps"><p class="ps-t">قیمت دستی</p><div class="ps-r"><span>این قیمت را خودتان گذاشته‌اید<small>فرمول هنوز کامل نیست؛ با کامل شدنش، قیمت فرمول کنارش دیده می‌شود.</small></span></div></div>`;
  const st = ES(), n = v => `${iso(fmt(v))} تومان`, mt = matOf(d.material), lv = levelOf(d.level);
  const self = supplierOf(st, d.material) === 'self', g = st.prices[d.material];
  const metal = r.material - (d.stone || 0);
  const row = (k, v, note = '') => `<div class="ps-r"><span>${k}${note ? `<small>${note}</small>` : ''}</span><b>${v}</b></div>`;
  const step = (i, k, how, v) => `<div class="ps-s"><i>${faDigits(i)}</i><span>${k}<small>${how}</small></span><b>${n(v)}</b></div>`;
  let h = `<details class="explain story" open><summary>این قیمت از کجا آمد؟</summary>`;
  // 1) what we know about the piece
  h += `<div class="ps"><p class="ps-t">مشخصات</p>
    ${row('محصول', esc([catOf(d.cat) && catOf(d.cat).name, d.sub].filter(Boolean).join('، ')))}
    ${row('سطح کار', lv ? lv.name : '—', lv ? esc(lv.hint) : '')}
    ${row('فلز', mt ? mt.name : '—', self ? 'خود سینژین تأمین می‌کند' : supplierOf(st, d.material) === 'workshop' ? 'کارگاه تأمین می‌کند؛ داخل هزینهٔ ساخت' : '')}
    ${self && d.weight ? row('وزن', `${iso(fmtDec(d.weight))} گرم`) : ''}
    ${self && g ? row('قیمت روز هر گرم', n(g), st.pricesAt && st.pricesAt[d.material] ? `به‌روز شده ${new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric', month: 'long' }).format(new Date(st.pricesAt[d.material]))}` : '') : ''}
    ${row('سنگ و قطعه‌ها', d.stone ? n(d.stone) : 'ندارد')}
    ${row('هزینهٔ ساخت', r.invoice != null ? n(r.invoice) : n(r.work), r.invoice != null ? 'ریخته‌گری، کار تیم و کارگاه با هم' : [r.casting ? `ریخته‌گری ${plain(r.casting)}` : '', r.labour ? `کار تیم ${plain(r.labour)}` : ''].filter(Boolean).join(' + '))}
  </div>`;
  // 2) the calculation, step by step
  let i = 0;
  h += `<div class="ps"><p class="ps-t">محاسبه</p>`;
  if (metal) h += step(++i, `هزینهٔ ${mt.name}`, say(`${fmtDec(d.weight)} گرم × ${fmt(g)} تومان`), metal);
  if (r.material) h += step(++i, 'سهم متریال', say(`(${mt && metal ? mt.name : ''}${metal && d.stone ? ' + ' : ''}${d.stone ? 'سنگ و قطعه‌ها' : ''}) × ضریب متریال ${fmtDec(r.markup)}`), r.materialPart);
  h += step(++i, 'سهم کار و طراحی', say(`هزینهٔ ساخت ${fmt(r.work)} × ضریب «${lv.name}» ${fmtDec(r.factor)}`), r.workPart);
  h += step(++i, 'جمع', say('سهم متریال + سهم کار و طراحی'), r.internal);
  const ff = r.manualFinal ? r.formulaFinal : r.final;
  if (r.step && ff !== Math.round(r.internal)) h += step(++i, 'گرد به بالا', say(`تا مضرب ${plain(r.step)}`), ff);
  if (r.manualFinal) {
    const diff = Math.round((r.final / ff - 1) * 100);
    h += `<div class="ps-total sub"><span>قیمت فرمول</span><b>${n(ff)}</b></div>`;
    h += `<div class="ps-total"><span>قیمت نهایی (دستی)<small>${say(diff ? `${Math.abs(diff)}٪ ${diff < 0 ? 'کمتر' : 'بیشتر'} از فرمول` : 'برابر فرمول')}</small></span><b>${n(r.final)}</b></div></div>`;
  } else h += `<div class="ps-total"><span>قیمت فروش</span><b>${n(r.final)}</b></div></div>`;
  // 3) what it earns
  const profit = r.final - r.cost;
  h += `<div class="ps"><p class="ps-t">سود این محصول</p>
    ${row('هزینهٔ واقعی', n(r.cost), 'فلز + سنگ و قطعه‌ها + هزینهٔ ساخت')}
    ${row('سود', n(profit), say(`${Math.round(profit / r.final * 100)}٪ از قیمت فروش؛ قیمت ${fmtDec(Math.round(r.final / r.cost * 10) / 10)} برابر هزینه`))}
  </div></details>`;
  return h;
}

function summary(d, r) {
  const cat = catOf(d.cat), lv = levelOf(d.level), mt = matOf(d.material);
  const ph = d.photos[0] && urls.get(d.photos[0]);
  const self = supplierOf(ES(), d.material) === 'self';
  const rows = [
    [0, 'محصول', [cat && cat.name, d.sub].filter(Boolean).join('، ') || '—'],
    [1, 'سطح کار', lv ? lv.name : '—'],
    [2, 'هزینه‌ها', [mt && mt.name, self && d.weight != null ? `${d.weight} گرم` : '', d.invoice != null ? `هزینهٔ ساخت ${plain(d.invoice)}` : 'هزینهٔ ساخت وارد نشده'].filter(Boolean).join('، ')],
    [3, 'نام و عکس', `${d.title || 'بدون نام'}، ${d.photos.length} عکس`],
  ];
  let h = `<div class="sum-head">${ph ? `<img src="${ph}" alt="">` : ''}<div><h2>${esc(d.title || d.sub || (S.ed.order ? 'سفارش' : 'محصول تازه'))}</h2>
    <div class="big">${r.complete ? `${iso(fmt(r.final))} <small>تومان</small>` : '<span class="none">هنوز کامل نیست</span>'}</div></div></div>`;
  if (r.missing.length) h += `<div class="group"><div class="cell col miss"><b>برای قیمت کامل:</b>${r.missing.map(m => `<span>${say(m.text)}</span>`).join('')}</div></div>`;
  h += priceStory(d, r);
  const formula = r.manualFinal ? r.formulaFinal : r.final;
  h += `<div class="stitle">قیمت نهایی دستی (اختیاری)</div><div class="group"><label class="cell"><span>قیمت نهایی</span><input class="bare" data-num="finalPrice" inputmode="numeric" placeholder="${formula ? fmt(formula) : 'مثل فرمول'}" value="${d.finalPrice ? fmt(d.finalPrice) : ''}"><em class="u">تومان</em></label>
    ${d.finalPrice ? `<button class="cell" data-clearfinal><span class="sec">برگشت به قیمت فرمول${formula ? say(` (${plain(formula)} تومان)`) : ''}</span></button>` : ''}</div>
    <p class="foot">اگر می‌خواهید این محصول قیمتی جز فرمول داشته باشد. برای یک فروش خاص، قیمت را در خود فاکتور عوض کنید.</p>`;
  h += `<div class="group">${rows.map(([s, k, v]) => `<button class="cell" data-step="${s}"><span>${k}</span><span class="sec val">${say(v)}</span>${svg('chev')}</button>`).join('')}</div>`;
  if (S.ed.order) return h + `<div class="ed-foot"><button class="btn" data-save>${S.ed.then === 'ready' ? 'ثبت وزن واقعی' : 'ذخیره در سفارش'}</button></div>`;
  h += stockBox(d);
  h += siteBox(d);
  h += `<div class="ed-foot">${S.ed.edit ? `<button class="btn ghost danger" data-del>حذف</button><button class="btn ghost" data-dup>مشابه</button>${d._ready > 0 && r.complete ? `<button class="btn ghost" data-sell="${d.id}">فاکتور</button>` : ''}` : ''}<button class="btn" data-save>${S.ed.edit ? 'ذخیره' : 'ذخیره در ویترین'}</button></div>`;
  return h;
}

// ---------- drift: approve today's prices ----------
function openDrift() {
  const list = drifted(S.products, S.settings);
  if (!list.length) return;
  openSheet(`<div class="ed-top"><button class="x back" data-back aria-label="برگشت">${svg('back')}</button></div><h2 class="q">قیمت‌های تازه</h2>
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
  if (S.ed.order) return saveSpec();
  const d = S.ed.d, r = price(d, S.settings), now = Date.now();
  const prev = S.ed.edit ? S.products.find(x => x.id === d.id) : null;
  const { _added, _ready, ...clean } = d;
  const undo = await snap({ products: d.id ? [d.id] : [], photos: prev ? (prev.photos || []).filter(id => !d.photos.includes(id)) : [] });
  const p = Object.assign(clean, { id: d.id || uid(), createdAt: d.createdAt || now, updatedAt: now, approved: r.complete ? { price: r.final, at: now } : null });
  // Ready count changed by hand (or a new product): it becomes the new starting point; open invoices still hold theirs.
  const was = prev ? unitsFor(prev) : null;
  if (!was || _ready !== was.left) { p.stock = _ready + (was ? was.held - was.manual : 0); p.stockAt = now; }
  if (prev) for (const id of prev.photos || []) if (!p.photos.includes(id)) { await db.del('photos', id); urls.delete(id); }
  await db.put('products', p);
  const i = S.products.findIndex(x => x.id === p.id);
  if (i >= 0) S.products[i] = p; else S.products.unshift(p);
  refreshUnits();
  S.ed.d._added = [];
  await closeEditor();
  const nm = p.title || p.sub || 'بی‌نام';
  if (!prev) logEvent(`محصول «${nm}» را ثبت کرد${r.complete ? `، ${plain(r.final)} تومان` : '؛ قیمت هنوز کامل نیست'}`);
  else {
    const ch = [];
    if ((prev.approved && prev.approved.price) !== (p.approved && p.approved.price)) ch.push(p.approved ? `قیمت ${plain(p.approved.price)} تومان` : 'قیمت ناقص');
    if (was && _ready !== was.left) ch.push(`آماده ${faDigits(_ready)} عدد`);
    if (prev.invoice !== p.invoice && p.invoice != null) ch.push(`فاکتور کارگاه ${plain(p.invoice)}`);
    if (!!prev.onSite !== !!p.onSite) ch.push(p.onSite ? 'روی سایت' : 'از سایت برداشته شد');
    logEvent(`محصول «${nm}» را ویرایش کرد${ch.length ? '؛ ' + ch.join('، ') : ''}`);
  }
  // A new product's undo removes it again.
  const undoNew = async () => { await db.del('products', p.id); await load(); render(); };
  offerUndo(r.complete ? `ذخیره شد، ${plain(r.final)} تومان` : 'ذخیره شد؛ قیمت هنوز کامل نیست', prev ? undo : undoNew);
}

// ---------- backup ----------
async function exportAll() {
  const photos = [];
  for (const ph of await db.all('photos')) photos.push({ id: ph.id, data: await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(ph.blob); }) });
  const blob = new Blob([JSON.stringify({ app: 'seenzhin', v: 1, at: Date.now(), settings: S.settings, products: S.products, invoices: S.invoices, customers: S.customers, orders: S.orders, photos })], { type: 'application/json' });
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
    for (const k of ['invoices', 'customers', 'orders']) if (data[k]) { await db.clear(k); await db.putMany(k, data[k]); }
    await db.set('settings', data.settings);
    location.reload();
  } catch { island('این فایل پشتیبان سینژین نیست'); }
}

// ---------- events ----------
async function doAct(a) {
  if (a === 'new') return openEditor(null);
  if (a === 'settings') return goTab('settings');
  if (a === 'drift') return openDrift();
  if (a.startsWith('order:')) { const o = S.orders.find(x => x.id === a.slice(6)); return o && openOrder(o); }
  if (a.startsWith('edit:')) return openEditor(S.products.find(p => p.id === a.slice(5)));
  if (a.startsWith('market:')) {
    const m = a.slice(7);
    if (!S.market || !S.market[m]) return;
    const undo = await snap({ settings: true });
    S.settings.prices[m] = S.market[m].p; S.settings.pricesAt[m] = Date.now();
    await saveSettings(); render(); if (S.ed) drawEditor();
    logEvent(`قیمت ${m === 'silver' ? 'نقره' : 'طلا'} را از بازار گذاشت: ${plain(S.settings.prices[m])} تومان`);
    const n = drifted(S.products, S.settings).length;
    offerUndo(n ? `قیمت به‌روز شد؛ ${n} محصول قیمت تازه دارد` : 'قیمت به‌روز شد', undo);
  }
}

function bind() {
  document.addEventListener('click', async e => {
    const t = e.target.closest('button, [data-close]');
    if (!t || t.disabled) return;
    const ds = t.dataset;
    if (ds.tab) return goTab(ds.tab);
    if ('back' in ds) return goBack();
    if ('refresh' in ds) return refresh(t);
    if ('undo' in ds) { const f = S.undo; S.undo = null; $('#undo').classList.remove('show'); if (f) { await f(); island('برگردانده شد'); } return; }
    if ('close' in ds) { S.inv = null; S.preview = null; if (S.ed && S.ed.order) S.ed = null; S.ord = null; S.cust = null; return S.ed ? closeEditor() : (closeSheet(), render()); }
    if ('new' in ds) return openEditor(null);
    if (ds.act) return doAct(ds.act);
    if (ds.filter) { S.filter = ds.filter; return render(); }
    if (ds.edit) return openEditor(S.products.find(p => p.id === ds.edit));
    if ('approve' in ds) {
      const list = drifted(S.products, S.settings), now = Date.now();
      const undo = await snap({ products: list.map(x => x.p.id) });
      for (const x of list) x.p.approved = { price: x.to, at: now };
      await db.putMany('products', list.map(x => x.p));
      closeSheet(); render(); logEvent(`${list.length} قیمت تازه را تأیید کرد`); return offerUndo(`${list.length} قیمت تأیید شد`, undo);
    }
    if (ds.sup) { const undo = await snap({ settings: true }); S.settings.suppliers[ds.sup] = ds.val; await saveSettings(); render(); return offerUndo('ذخیره شد', undo); }
    if (ds.round != null) { const undo = await snap({ settings: true }); S.settings.rounding = Number(ds.round); await saveSettings(); render(); return offerUndo('ذخیره شد', undo); }
    if ('export' in ds) return exportAll();
    if ('signin' in ds) {
      const u = $('#su').value, p = $('#sp').value;
      t.disabled = true; t.textContent = 'در حال ورود…';
      try {
        const ok = await sync.signIn(u, p, async user => confirm(`با این نام و رمز حسابی پیدا نشد.\n\nاگر می‌خواهید به حساب سروین وصل شوید، Cancel بزنید و از «اتصال با کد» استفاده کنید.\n\nفقط اگر می‌خواهید یک حساب کاملاً تازه و خالی بسازید، OK بزنید.`));
        if (ok) { await load(); render(); island('وارد شدید؛ همه‌چیز همگام شد'); } else render();
      } catch (e) { island(e.message); render(); }
      return;
    }
    if ('syncnow' in ds) return sync.run();
    if ('joblater' in ds) { const J = S.jobs; J.snooze[J.id] = Date.now() + 3 * 864e5; J.rest = true; await db.set('jobs', J); render(); return island('باشد؛ امروز کار دیگری پیشنهاد نمی‌شود'); }
    if ('jobprompt' in ds) {
      const j = jobsFor(view(), S.settings).find(x => x.id === S.jobs.id);
      if (!j) return;
      try { await navigator.clipboard.writeText(j.prompt); island('پرامپت کپی شد؛ در ChatGPT بچسبانید و جواب را اینجا وارد کنید'); }
      catch { prompt('این متن را کپی کنید و در ChatGPT بچسبانید:', j.prompt); }
      return;
    }
    if ('joincode' in ds) {
      const c = $('#sc').value;
      t.disabled = true; t.textContent = 'در حال اتصال…';
      try { await sync.joinCode(c); await load(); render(); island('وصل شدید؛ اطلاعات حساب آمد'); }
      catch (e) { island(e.message); render(); }
      return;
    }
    if ('copycode' in ds) {
      const code = sync.shareCode();
      try { if (navigator.share) { await navigator.share({ text: code }); return; } } catch { /* cancelled */ }
      try { await navigator.clipboard.writeText(code); island('کد اتصال کپی شد؛ برای گوشی دیگر بفرستید'); }
      catch { prompt('این کد را کپی کنید و بفرستید:', code); }
      return;
    }
    if (ds.who) { S.who = ds.who; await db.set('who', ds.who); render(); return island(`این گوشی: ${WHO[ds.who]}`); }
    if ('logall' in ds) { S.logAll = true; return render(); }
    if ('signout' in ds) { if (confirm('از حساب مشترک روی این گوشی خارج شوید؟ داده‌ها پاک نمی‌شوند.')) { await sync.signOut(); render(); } return; }
    if ('inew' in ds) return openInvoice(null);
    if (ds.sv) { S.sv = ds.sv; return render(); }
    if ('onew' in ds) return openOrder(null);
    if ('cnew' in ds) return openCustomer(null);
    if (ds.oview) return openOrder(S.orders.find(o => o.id === ds.oview));
    if (ds.cview) return openCustomer(S.customers.find(c => c.id === ds.cview));
    if (S.cust && !S.ed) {
      if ('csave' in ds) return saveCustomer();
      if ('cinv' in ds) { const c = S.customers.find(x => x.id === S.cust.d.id); return openInvoice(null, null, c); }
      if ('cord' in ds) { const c = S.customers.find(x => x.id === S.cust.d.id); return openOrder(null, c); }
      if ('cdel' in ds) {
        const c = S.cust.d, undo = await snap({ customers: [c.id] });
        await db.del('customers', c.id); S.customers = S.customers.filter(x => x.id !== c.id);
        S.cust = null; closeSheet(); render(); logEvent(`مشتری «${c.name}» را حذف کرد`); return offerUndo('مشتری حذف شد', undo);
      }
    }
    if (S.ord && !S.ed) {
      const o = S.ord.d;
      if ('ospec' in ds) return openSpec();
      if (ds.odue != null) { const n = Number(ds.odue); o.due = n ? new Date().setHours(12, 0, 0, 0) + n * 864e5 : null; S.ord.dueN = n || null; return drawOrder(); }
      if ('osave' in ds) {
        if (!S.ord.cname.trim() && !o.spec) return island('نام مشتری یا مشخصات سفارش را وارد کنید');
        const undo = await snap({ orders: [o.id] }), isNew = !S.ord.edit;
        await commitOrder(isNew ? 'ثبت شد' : 'به‌روز شد');
        S.ord = null; closeSheet(); S.tab = 'sales'; S.sv = 'ord'; render(); return offerUndo('سفارش ذخیره شد', undo);
      }
      if ('odeposit' in ds) return takeDeposit();
      if ('ostart' in ds) { if (!confirm('از این لحظه بیعانه برنمی‌گردد. ساخت شروع شود؟')) return; return stageTo('making'); }
      if ('oready' in ds) return openSpec('ready');
      if ('odeliver' in ds) return deliverOrder();
      if ('ocancel' in ds) return cancelOrder();
    }
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
        const undo = await snap({ invoices: [d.id] });
        await db.del('invoices', d.id); S.invoices = S.invoices.filter(i => i.id !== d.id); refreshUnits();
        S.inv = null; closeSheet(); render(); logEvent(`فاکتور ${noFa(d.no)} را حذف کرد`); return offerUndo('فاکتور حذف شد', undo);
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
    if ('clearfinal' in ds) { d.finalPrice = null; return drawEditor(); }
    if ('onsite' in ds) { d.onSite = !d.onSite; return drawEditor(); }
    if (ds.qty) { d._ready = Math.max(0, d._ready + Number(ds.qty)); return drawEditor(); }
    if (ds.usecalc) { d.invoice = Number(ds.usecalc); return drawEditor(); }
    if (ds.fixinv) { d.invoice = d.invoice * Number(ds.fixinv); return drawEditor(); }
    if (ds.rmphoto) {
      const id = ds.rmphoto; d.photos = d.photos.filter(x => x !== id);
      if (d._added.includes(id)) { d._added = d._added.filter(x => x !== id); await db.del('photos', id); urls.delete(id); }
      return drawEditor();
    }
    if ('save' in ds) return save();
    if ('del' in ds) {
      const undo = await snap({ products: [d.id], photos: d.photos });
      for (const ph of d.photos) { await db.del('photos', ph); urls.delete(ph); }
      await db.del('products', d.id);
      S.products = S.products.filter(x => x.id !== d.id);
      S.ed.d._added = []; await closeEditor(); logEvent(`محصول «${d.title || d.sub || 'بی‌نام'}» را حذف کرد`); return offerUndo('محصول حذف شد', undo);
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
    if (S.cust && el.dataset.ctext) { S.cust.d[el.dataset.ctext] = el.value; return; }
    if (S.ord && !S.ed && (el.dataset.otext || el.dataset.onum)) {
      const k = el.dataset.otext || el.dataset.onum;
      if (el.dataset.onum) { const v = parseNum(el.value); if (v != null) el.value = fmt(v); S.ord.d[k] = v; return; }
      if (k === 'cname' || k === 'cphone') {
        S.ord[k] = el.value;
        // Picking a known name fills the phone.
        if (k === 'cname') { const c = S.customers.find(x => x.name === el.value.trim()); if (c && !S.ord.cphone) { S.ord.cphone = c.phone || ''; const p = $('[data-otext="cphone"]'); if (p) p.value = S.ord.cphone; } }
      } else S.ord.d[k] = el.value;
      return;
    }
    if (S.inv && (el.dataset.itext || el.dataset.inum)) {
      const d = S.inv.d, key = el.dataset.itext || el.dataset.inum;
      let v = el.value;
      if (el.dataset.inum) { v = parseNum(el.value); if (v != null) el.value = fmt(v); }
      const parts = key.split(':');
      if (parts[0] === 'item') d.items[+parts[1]][parts[2]] = v;
      else if (key.includes('.')) { const [a, b] = key.split('.'); d[a][b] = v; }
      else d[key] = v;
      const sum = $('.inv-sum'); if (sum) sum.innerHTML = invSum(d);
      const sub = $('#inv-sub'); if (sub) sub.innerHTML = iso(fmt(totals(d).subtotal));
      if (parts[0] === 'item') { const nt = $(`[data-note="${parts[1]}"]`); if (nt) nt.innerHTML = saleNote(d.items[+parts[1]]); }
      return;
    }
    if (el.dataset.text && S.ed) { S.ed.d[el.dataset.text] = el.value; return; }
    if (!el.dataset.num) return;
    const key = el.dataset.num, v = parseNum(el.value);
    if (!el.dataset.dec && v != null) el.value = fmt(v);
    else if (el.dataset.dec) el.value = faDigits(el.value).replace('.', '٫');
    if (key.startsWith('price:') || key.startsWith('factor:') || key.startsWith('hlevel:') || ['markup', 'cast', 'hourly'].includes(key)) return pendingSetting(key, v);
    if (!S.ed) return;
    S.ed.d[key] = v;
    const r = price(S.ed.d, ES()), box = $('.ed-price');
    if (box) { box.classList.toggle('ok', r.complete); box.querySelector('b').innerHTML = priceTag(r); }
    const big = $('.sum-head .big'); if (big && r.complete) big.innerHTML = `${iso(fmt(r.final))} <small>تومان</small>`;
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
  document.addEventListener('keydown', e => { if (e.key === 'Escape') goBack(); });
  // Swipe from left to right goes back one step (like iPhone): mostly horizontal, at least 70px.
  let sx = 0, sy = 0, st = 0;
  document.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
  document.addEventListener('touchend', e => {
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (dx > 70 && Math.abs(dy) < 50 && Date.now() - st < 600 && !e.target.closest('.picker, .chips.scroll, input, textarea')) goBack();
  }, { passive: true });
}

// Settings numbers are saved shortly after typing stops.
// One line for the history: what changed in settings.
function settingChange(a, b) {
  const out = [];
  if (a.markup !== b.markup) out.push(`ضریب متریال ${b.markup ?? 'خالی'}`);
  if (a.castPerGram !== b.castPerGram) out.push(`ریخته‌گری هر گرم ${b.castPerGram ? plain(b.castPerGram) : 'خالی'}`);
  if (a.teamHourly !== b.teamHourly) out.push(`ساعت کار تیم ${b.teamHourly ? plain(b.teamHourly) : 'خالی'}`);
  for (const l of LEVELS) { const x = (a.hoursByLevel || {})[l.id], y = (b.hoursByLevel || {})[l.id]; if (x !== y) out.push(`ساعت معمول ${l.name} ${y ?? 'خالی'}`); }
  for (const m of ['silver', 'gold']) if (a.prices[m] !== b.prices[m]) out.push(`قیمت ${m === 'silver' ? 'نقره' : 'طلا'} ${b.prices[m] ? plain(b.prices[m]) : 'خالی'}`);
  for (const f of Object.keys(FORMULAS)) for (const l of LEVELS) if (a.factors[f][l.id] !== b.factors[f][l.id]) out.push(`ضریب ${l.name} ${FORMULAS[f].name} ${b.factors[f][l.id] ?? 'خالی'}`);
  return `تنظیمات را عوض کرد: ${out.join('، ') || 'بدون تغییر'}`;
}
function pendingSetting(key, v) {
  if (!pendingSetting.before) pendingSetting.before = JSON.parse(JSON.stringify(S.settings));
  const [kind, a, b] = key.split(':');
  if (kind === 'markup') S.settings.markup = v;
  else if (kind === 'cast') S.settings.castPerGram = v;
  else if (kind === 'hourly') S.settings.teamHourly = v;
  else if (kind === 'hlevel') (S.settings.hoursByLevel ||= {})[a] = v;
  else if (kind === 'price') { S.settings.prices[a] = v; S.settings.pricesAt[a] = v == null ? null : Date.now(); }
  else S.settings.factors[a][b] = v;
  if (S.ed) { const r = price(S.ed.d, S.settings), box = $('.ed-price'); if (box) { box.classList.toggle('ok', r.complete); box.querySelector('b').innerHTML = priceTag(r); } }
  clearTimeout(pendingSetting.t);
  pendingSetting.t = setTimeout(async () => {
    await saveSettings();
    const before = pendingSetting.before; pendingSetting.before = null;
    logEvent(settingChange(before, S.settings));
    const n = drifted(S.products, S.settings).length;
    offerUndo(n ? `ذخیره شد؛ ${n} محصول قیمت تازه می‌گیرد` : 'ذخیره شد', async () => { S.settings = before; await saveSettings(); await load(); render(); });
  }, 700);
}

boot();
