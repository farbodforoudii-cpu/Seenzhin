// Seenzhin website: router, pages and events. Rules live in catalog.js (tested in Node).
import {
  normalize, catalogOk, filterItems, categoriesOf, related, specs, orderMessage, customRequest, waLink, igLink, tgLink,
  parseRoute, shopHash, shortPrice, toman, esc, faDigits, fmt, fmtDec, iso, AVAIL, catName,
  CUSTOM_KINDS, CUSTOM_METALS, CUSTOM_BUDGETS,
} from './catalog.js';

const S = { items: [], site: {}, loaded: false, failed: false, saved: new Set(), form: {}, preview: '' };
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

// ---------- small storage (wishlist, form draft); never required for the page to work ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('sz.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sz.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
S.saved = new Set(store.get('saved', []));
S.form = store.get('custom', {});

// Demand signal (decision 21, step 5): kept on the device for now, sent to the app once the server exists.
function signal(type, id) {
  const q = store.get('signals', []);
  q.push({ type, id, at: Date.now() });
  store.set('signals', q.slice(-200));
}

// ---------- data ----------
async function load() {
  try {
    const [cat, site] = await Promise.all([
      fetch('data/catalog.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch('data/site.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]);
    if (!catalogOk(cat)) throw new Error('version');
    if (!S.preview) S.items = normalize(cat);
    S.site = site || {};
  } catch (e) {
    S.failed = true;
  }
  S.loaded = true;
  render();
}

// ---------- pieces ----------
const icon = name => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const photo = (p, i = 0, cls = '') => p.photos[i]
  ? `<img class="${cls}" src="${esc(p.photos[i])}" alt="${esc(p.title)}${i ? ' — نمای ' + faDigits(i + 1) : ''}" loading="${i ? 'lazy' : 'eager'}" decoding="async">`
  : `<span class="${cls} nophoto" role="img" aria-label="${esc(p.title)}">${mark()}</span>`;

function card(p) {
  const saved = S.saved.has(p.id);
  return `<article class="card">
    <a class="card-link" href="#/p/${encodeURIComponent(p.id)}">
      <span class="card-media">${photo(p, 0, 'card-img')}${p.photos[1] ? photo(p, 1, 'card-img alt') : ''}
        ${p.availability === 'made-to-order' ? `<span class="tag">سفارشی</span>` : ''}</span>
      <span class="card-body">
        <span class="card-title">${esc(p.title)}</span>
        <span class="card-meta">${esc([p.type || p.category, p.material].filter(Boolean).join('، '))}</span>
        <span class="price">${p.price ? shortPrice(p.price) : 'تماس بگیرید'}</span>
      </span>
    </a>
    <button class="save ${saved ? 'on' : ''}" data-save="${esc(p.id)}" aria-pressed="${saved}" aria-label="${saved ? 'حذف از ذخیره‌ها' : 'ذخیره'}">${icon('heart')}</button>
  </article>`;
}
const grid = list => `<div class="grid">${list.map(card).join('')}</div>`;

function contactButtons(text, { compact = false } = {}) {
  const s = S.site, out = [];
  const wa = waLink(s.whatsapp, text);
  if (wa) out.push(`<a class="btn primary" href="${wa}" target="_blank" rel="noopener" data-signal="ask">${icon('chat')}<span>${compact ? 'واتس‌اپ' : 'پیام در واتس‌اپ'}</span></a>`);
  if (s.instagram) out.push(`<button class="btn ${wa ? '' : 'primary'}" data-dm="${esc(text)}">${icon('insta')}<span>${compact ? 'اینستاگرام' : 'پیام در اینستاگرام'}</span></button>`);
  if (s.telegram) out.push(`<a class="btn" href="${tgLink(s.telegram)}" target="_blank" rel="noopener">${icon('send')}<span>تلگرام</span></a>`);
  if (!out.length) out.push(`<p class="muted">راه تماس هنوز در تنظیمات سایت ثبت نشده است.</p>`);
  return `<div class="actions">${out.join('')}</div>`;
}

const crumbs = list => `<nav class="crumbs" aria-label="مسیر">${list.map(([t, h]) => h ? `<a href="${h}">${esc(t)}</a>` : `<span aria-current="page">${esc(t)}</span>`).join('<span class="sep">/</span>')}</nav>`;

// ---------- pages ----------
// The Seenzhin logo exactly as designed (brand/logo-sun.png). Only motion is added: a sunrise on first view.
const LOGO = `<img class="brandmark" src="img/logo-sun.png" alt="" width="809" height="593">`;
const mark = (cls = '') => `<img class="mark ${cls}" src="img/logo-sun.png" alt="" aria-hidden="true">`;

function home() {
  const cats = categoriesOf(S.items);
  const works = filterItems(S.items, {}).sort((a, b) => (b.availability === 'available') - (a.availability === 'available')).slice(0, 8);
  return `<section class="hero">
      <div class="hero-text">
        <h1>هر قطعه،<br>یک‌بار ساخته می‌شود.</h1>
        <p class="lead">جواهر، تابلو و تندیس نقره؛ دست‌ساز در کارگاه سینژین.</p>
        <div class="actions"><a class="btn primary" href="#/shop">دیدن آثار</a><a class="link" href="#/custom">سفارش اختصاصی</a></div>
      </div>
      <div class="hero-art" aria-hidden="true">${LOGO}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2 class="section-title">آثار</h2>
        ${cats.length > 1 ? `<nav class="catlinks" aria-label="دسته‌ها">${cats.map(c => `<a href="${shopHash({ cat: c.slug })}">${esc(c.name)}</a>`).join('')}</nav>` : ''}</div>
      ${works.length ? grid(works) : empty('هنوز اثری روی سایت نیست.')}
      ${S.items.length > works.length ? `<p class="more-link"><a class="btn" href="#/shop">همهٔ آثار</a></p>` : ''}
    </section>
    <section class="section closing">
      <h2>طرحی در ذهن دارید؟</h2>
      <p>سینژین آن را با نقره، طلا یا برنز برایتان می‌سازد.</p>
      <a class="btn" href="#/custom">سفارش اختصاصی</a>
    </section>`;
}

function shop(q) {
  const cats = categoriesOf(S.items);
  const list = filterItems(S.items, q);
  const chip = (label, next, on) => `<a class="chip ${on ? 'on' : ''}" href="${shopHash({ ...q, ...next })}" ${on ? 'aria-current="true"' : ''}>${label}</a>`;
  const seg = [['', 'همه'], ['available', 'موجود'], ['made-to-order', 'سفارشی']]
    .map(([v, t]) => `<a href="${shopHash({ ...q, avail: v })}" class="${(q.avail || '') === v ? 'on' : ''}" ${(q.avail || '') === v ? 'aria-current="true"' : ''}>${t}</a>`).join('');
  return `${crumbs([['خانه', '#/'], [q.cat ? catName(q.cat) : 'همهٔ آثار']])}
    <h1>${esc(q.cat ? catName(q.cat) : 'همهٔ آثار')}</h1>
    <form class="tools" data-shopform role="search">
      <label class="search">${icon('search')}<input type="search" name="q" value="${esc(q.q || '')}" placeholder="جستجو در آثار" aria-label="جستجو در آثار" enterkeyhint="search"></label>
    </form>
    ${cats.length > 1 ? `<div class="chips">${chip('همه', { cat: '' }, !q.cat)}${cats.map(c => chip(esc(c.name), { cat: c.slug }, q.cat === c.slug)).join('')}</div>` : ''}
    <div class="bar">
      <nav class="seg" aria-label="وضعیت">${seg}</nav>
      <label class="select"><span class="sr">ترتیب</span><select name="sort" aria-label="ترتیب" form="sortform" data-sort>
        ${[['new', 'تازه‌ترین'], ['cheap', 'ارزان‌ترین'], ['dear', 'گران‌ترین']].map(([v, t]) => `<option value="${v}" ${(q.sort || 'new') === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select></label>
    </div>
    <p class="count" aria-live="polite">${faDigits(list.length)} اثر</p>
    ${list.length ? grid(list) : empty('اثری با این انتخاب پیدا نشد.', `<a class="btn" href="#/shop">پاک کردن فیلترها</a>`)}`;
}

function product(id) {
  const p = S.items.find(x => x.id === id);
  if (!p) return notfound('این اثر روی سایت نیست؛ شاید فروخته شده یا برداشته شده است.');
  signal('view', p.id);
  const msg = orderMessage(p, location.href);
  const saved = S.saved.has(p.id);
  const rel = related(S.items, p);
  const meta = [p.type || p.category, p.material === 'نقره' ? 'نقرهٔ ۹۲۵' : p.material, p.weight ? `${iso(fmtDec(p.weight))} گرم` : ''].filter(Boolean).join('، ');
  const wa = waLink(S.site.whatsapp, msg);
  // One main action, named for what it does; on phones it sits in a bar with the price (always in reach).
  const main = wa ? `<a class="btn primary" href="${wa}" target="_blank" rel="noopener" data-signal="ask">${icon('chat')}<span>سفارش در واتس‌اپ</span></a>`
    : S.site.instagram ? `<button class="btn primary" data-dm="${esc(msg)}">${icon('insta')}<span>سفارش در اینستاگرام</span></button>` : '';
  const second = wa && S.site.instagram ? `<button class="btn" data-dm="${esc(msg)}">${icon('insta')}<span>پیام در اینستاگرام</span></button>` : '';
  return `${crumbs([['خانه', '#/'], [p.category || 'آثار', shopHash({ cat: p.category ? (categoriesOf(S.items).find(c => c.name === p.category) || {}).slug : '' })], [p.title]])}
    <div class="pdp">
      <div class="gallery" data-gallery>
        <div class="slides" tabindex="0" aria-label="عکس‌های ${esc(p.title)}">${(p.photos.length ? p.photos : [null]).map((_, i) => `<figure class="slide">${photo(p, i, 'slide-img')}</figure>`).join('')}</div>
        ${p.photos.length > 1 ? `<div class="thumbs">${p.photos.map((_, i) => `<button class="thumb ${i ? '' : 'on'}" data-slide="${i}" aria-label="عکس ${faDigits(i + 1)}">${photo(p, i)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="info">
        <h1>${esc(p.title)}</h1>
        ${meta ? `<p class="meta">${meta}</p>` : ''}
        <p class="price big" ${p.price ? `data-roll="${p.price}"` : ''}>${p.price ? toman(p.price) : 'تماس بگیرید'}</p>
        <p class="avail ${p.availability}"><i aria-hidden="true"></i>${AVAIL[p.availability].name}<span>${AVAIL[p.availability].hint}</span></p>
        ${p.desc ? `<p class="desc">${esc(p.desc)}</p>` : ''}
        <div class="actions buy">${main}${second}</div>
        <div class="actions small">
          <button class="btn ghost save-btn ${saved ? 'on' : ''}" data-save="${esc(p.id)}" aria-pressed="${saved}">${icon('heart')}<span>${saved ? 'ذخیره شد' : 'ذخیره'}</span></button>
          <button class="btn ghost" data-share>${icon('share')}<span>اشتراک</span></button>
        </div>
        <details class="more"><summary><span>جزئیات، ارسال و نگهداری</span></summary>
          <dl class="specs">${specs(p).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
          <p>قیمت با نرخ روز ${p.material ? esc(p.material) : 'فلز'} تنظیم می‌شود و هنگام سفارش تأیید می‌شود. هزینهٔ ارسال جداست.</p>
          <p>${esc(S.site.shipping || 'ارسال به سراسر ایران. زمان و هزینهٔ ارسال در پیام اعلام می‌شود.')}</p>
          <p><a class="link" href="#/care">راهنمای نگهداری</a></p></details>
      </div>
    </div>
    ${main ? `<div class="buybar" role="region" aria-label="سفارش"><span class="price">${p.price ? shortPrice(p.price) : 'تماس بگیرید'}</span>${main}</div>` : ''}
    ${rel.length ? `<section class="section"><h2 class="section-title">آثار دیگر</h2>${grid(rel)}</section>` : ''}`;
}

function custom() {
  const f = S.form, e = S.form._errors || {};
  const radios = (name, list) => `<div class="radios" role="radiogroup">${list.map(v => `<label class="radio"><input type="radio" name="${name}" value="${esc(v)}" ${f[name] === v ? 'checked' : ''}><span>${esc(v)}</span></label>`).join('')}</div>`;
  const err = k => e[k] ? `<p class="err" id="err-${k}">${esc(e[k])}</p>` : '';
  const result = S.form._message;
  return `${crumbs([['خانه', '#/'], ['سفارش اختصاصی']])}
    <h1>سفارش اختصاصی</h1>
    <p class="lead">طرح را بگویید؛ سینژین قیمت برآوردی و زمان ساخت را اعلام می‌کند.</p>
    <ol class="steps">
      <li><b>طرح و برآورد</b><span>دربارهٔ طرح، فلز و اندازه گفتگو می‌کنیم و قیمت برآوردی را می‌گوییم.</span></li>
      <li><b>بیعانه</b><span>با پرداخت بیعانه، قیمت فلز همان روز ثابت می‌شود.</span></li>
      <li><b>ساخت</b><span>بیعانه فقط پیش از شروع ساخت برمی‌گردد.</span></li>
      <li><b>تحویل و تسویه</b><span>قیمت نهایی با وزن واقعی قطعه.</span></li>
    </ol>
    ${result ? `<div class="done" role="status"><div class="burst" aria-hidden="true">${mark()}</div><h2>پیام آماده است</h2><p>با یکی از راه‌های زیر بفرستید.</p><pre class="msg">${esc(result)}</pre>${contactButtons(result)}<button class="btn ghost" data-newcustom>ویرایش درخواست</button></div>` : `
    <form class="form" data-custom novalidate>
      <fieldset><legend>چه چیزی بسازیم؟</legend>${radios('kind', CUSTOM_KINDS)}${err('kind')}</fieldset>
      <fieldset><legend>فلز</legend>${radios('metal', CUSTOM_METALS)}</fieldset>
      <fieldset><legend>بودجهٔ تقریبی</legend>${radios('budget', CUSTOM_BUDGETS)}</fieldset>
      <label class="field"><span>طرحی که در ذهن دارید</span><textarea name="idea" rows="4" placeholder="مثلاً: گوشوارهٔ نقره با نقش انار، اندازهٔ متوسط" ${e.idea ? 'aria-invalid="true" aria-describedby="err-idea"' : ''}>${esc(f.idea || '')}</textarea>${err('idea')}</label>
      <label class="field"><span>تا چه زمانی لازم دارید؟ (اختیاری)</span><input name="when" value="${esc(f.when || '')}" placeholder="مثلاً: تا اواخر بهمن"></label>
      <div class="row">
        <label class="field"><span>نام</span><input name="name" autocomplete="name" value="${esc(f.name || '')}" ${e.name ? 'aria-invalid="true" aria-describedby="err-name"' : ''}>${err('name')}</label>
        <label class="field"><span>شمارهٔ تماس</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" value="${esc(f.phone || '')}" placeholder="0912…" ${e.phone ? 'aria-invalid="true" aria-describedby="err-phone"' : ''}>${err('phone')}</label>
        <label class="field"><span>اینستاگرام (اختیاری)</span><input name="insta" dir="ltr" autocapitalize="off" value="${esc(f.insta || '')}" placeholder="@"></label>
      </div>
      <p class="muted">عکس نمونه را بعد از ارسال پیام، در همان گفتگو بفرستید.</p>
      <div class="submitbar"><button class="btn primary wide" type="submit" data-cta>${ctaLabel(f)}</button></div>
    </form>`}`;
}

// The button says what will be asked for, built from the choices so far.
function ctaLabel(f) {
  if (!f.kind) return 'آماده کردن پیام';
  const metal = f.metal && f.metal !== 'هنوز نمی‌دانم' ? ' ' + f.metal : '';
  return `درخواست ${f.kind}${metal}`;
}

function saved() {
  const list = S.items.filter(p => S.saved.has(p.id));
  return `${crumbs([['خانه', '#/'], ['ذخیره‌ها']])}<h1>ذخیره‌ها</h1>
    ${list.length ? grid(list) : empty('هنوز اثری ذخیره نکرده‌اید. با قلب روی هر اثر، آن را اینجا نگه دارید.', `<a class="btn" href="#/shop">دیدن آثار</a>`)}`;
}

function textPage(title, body) { return `${crumbs([['خانه', '#/'], [title]])}<article class="prose"><h1>${title}</h1>${body}</article>`; }
const about = () => textPage('دربارهٔ سینژین', `<p class="lead">${esc(S.site.motto || 'seen for vision, zhin for life')}</p>
  <p>سینژین برندی دست‌ساز است: جواهر نقره، تابلوی نقره، تندیس و اشیای دست‌ساز. هر قطعه در سینژین طراحی می‌شود و پرداخت، لحیم و مونتاژ آن با دست انجام می‌شود.</p>
  <p>بیشتر کارها تک‌نسخه‌اند. اگر قطعه‌ای فروخته شود، می‌توان نمونه‌ای مشابه سفارش داد؛ اما هیچ دو قطعه‌ای کاملاً یکی نیستند.</p>
  <p><a class="btn" href="#/custom">سفارش اختصاصی</a></p>`);
const care = () => textPage('راهنمای نگهداری', `<ul class="list">
  <li>${esc(S.site.care || 'دور از رطوبت و عطر نگه دارید.')}</li>
  <li>پس از استفاده، با پارچهٔ نرم و خشک پاک کنید و در کیسه یا جعبهٔ دربسته بگذارید.</li>
  <li>هنگام شنا، ورزش و استفاده از مواد شوینده جواهر را در بیاورید.</li>
  <li>تیره شدن نقره طبیعی است و با پارچهٔ مخصوص نقره برطرف می‌شود.</li></ul>`);
const contact = () => textPage('تماس', `<p>برای سفارش، پرسش دربارهٔ یک اثر یا سفارش اختصاصی پیام بدهید.</p>
  ${contactButtons('سلام، وقت بخیر.')}
  <h2>سفارش از خارج از ایران</h2>
  <p>ارسال به خارج از ایران با هماهنگی انجام می‌شود. پیش از هر پرداختی، در گفتگو هزینهٔ ارسال و روش پرداخت را اعلام می‌کنیم.</p>`);

// Preview with a real catalog exported from the app (Settings → «خروجی کاتالوگ سایت»).
// The file stays in this tab's memory only: nothing is uploaded or saved, a reload returns to the sample.
function preview() {
  return textPage('پیش‌نمایش با کاتالوگ اپ', `<p>فایل «خروجی کاتالوگ سایت» را از اپ سینژین انتخاب کنید تا سایت با محصولات واقعی دیده شود.</p>
    <p class="muted">فایل فقط در همین صفحه خوانده می‌شود؛ جایی فرستاده یا ذخیره نمی‌شود و با بارگذاری دوباره، سایت به دادهٔ نمونه برمی‌گردد.</p>
    <label class="btn primary file">انتخاب فایل کاتالوگ<input type="file" accept="application/json,.json" data-previewfile hidden></label>
    ${S.preview ? `<p class="ok-note" role="status">${esc(S.preview)}</p><p><a class="btn" href="#/shop">دیدن آثار</a></p>` : ''}`);
}

function empty(text, extra = '') { return `<div class="empty">${mark()}<p>${text}</p>${extra}</div>`; }
function notfound(text = 'این صفحه پیدا نشد.') { return `<div class="empty">${mark()}<h1>پیدا نشد</h1><p>${esc(text)}</p><a class="btn" href="#/shop">دیدن آثار</a></div>`; }

// ---------- render + meta ----------
const TITLES = { home: '', shop: 'آثار', custom: 'سفارش اختصاصی', saved: 'ذخیره‌ها', about: 'دربارهٔ ما', care: 'راهنمای نگهداری', contact: 'تماس', preview: 'پیش‌نمایش', notfound: 'پیدا نشد' };
let lastPage = '';
function render() {
  const r = parseRoute(location.hash);
  if (r.page !== 'custom') { delete S.form._message; delete S.form._errors; }
  let html, title = TITLES[r.page] || '';
  if (!S.loaded) html = `<div class="loading" aria-busy="true">${mark()}</div>`;
  else if (S.failed) html = empty('آثار بارگذاری نشد. اتصال اینترنت را بررسی کنید.', `<button class="btn" data-retry>تلاش دوباره</button>`);
  else if (r.page === 'home') html = home();
  else if (r.page === 'shop') { html = shop(r.query); if (r.query.cat) title = catName(r.query.cat); }
  else if (r.page === 'product') { html = product(r.id); const p = S.items.find(x => x.id === r.id); title = p ? p.title : 'پیدا نشد'; setProductMeta(p); }
  else if (r.page === 'custom') html = custom();
  else if (r.page === 'saved') html = saved();
  else if (r.page === 'about') html = about();
  else if (r.page === 'care') html = care();
  else if (r.page === 'contact') html = contact();
  else if (r.page === 'preview') html = preview();
  else html = notfound();
  if (r.page !== 'product') setProductMeta(null);
  app.innerHTML = (S.preview && r.page !== 'preview' ? `<p class="preview-bar" role="status">پیش‌نمایش با کاتالوگ اپ؛ فقط روی همین صفحه</p>` : '') + html;
  document.title = title ? `${title} | سینژین` : 'سینژین | جواهر و آثار دست‌ساز نقره';
  document.querySelectorAll('[data-nav]').forEach(a => a.toggleAttribute('aria-current', a.dataset.nav === r.page || (a.dataset.nav === 'shop' && r.page === 'product')));
  const nSaved = S.items.filter(p => S.saved.has(p.id)).length;
  $('#savedCount').textContent = nSaved ? faDigits(nSaved) : '';
  const key = r.page + (r.id || '') + (r.page === 'shop' ? JSON.stringify({ ...r.query, q: '' }) : '');
  if (key !== lastPage) { if (r.page !== 'shop' || !lastPage.startsWith('shop')) window.scrollTo(0, 0); lastPage = key; }
  bindGallery();
  rollPrices();
  closeMenu();
}

// Product structured data for search engines (schema.org Product).
function setProductMeta(p) {
  let el = $('#ld'); if (el) el.remove();
  if (!p) return;
  el = document.createElement('script'); el.type = 'application/ld+json'; el.id = 'ld';
  el.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: p.title, description: p.desc || undefined,
    image: p.photos.map(u => new URL(u, location.href).href), sku: p.id, brand: { '@type': 'Brand', name: 'Seenzhin' },
    offers: p.price ? { '@type': 'Offer', price: p.price * 10, priceCurrency: 'IRR',
      availability: p.availability === 'available' ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder' } : undefined });
  document.head.appendChild(el);
}

// ---------- number roll: the price counts up once when a product opens ----------
function rollPrices() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('[data-roll]').forEach(el => {
    const to = +el.dataset.roll, t0 = performance.now(), dur = 900;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      el.textContent = `${iso(fmt(Math.round(to * e / 1000) * 1000))} تومان`;
      if (k < 1) requestAnimationFrame(step); else el.textContent = toman(to);
    };
    requestAnimationFrame(step);
  });
}

// ---------- gallery: swipe (scroll snap) + thumbnails ----------
function bindGallery() {
  const g = $('[data-gallery]'); if (!g) return;
  const slides = $('.slides', g), thumbs = [...g.querySelectorAll('.thumb')];
  if (!thumbs.length) return;
  let t;
  slides.addEventListener('scroll', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const i = Math.round(Math.abs(slides.scrollLeft) / slides.clientWidth);
      thumbs.forEach((b, k) => b.classList.toggle('on', k === i));
    }, 60);
  }, { passive: true });
}
function goSlide(i) {
  const slides = $('.slides'); if (!slides) return;
  document.querySelectorAll('.thumb').forEach((b, k) => b.classList.toggle('on', k === i));
  const rtl = getComputedStyle(slides).direction === 'rtl';
  slides.scrollTo({ left: (rtl ? -1 : 1) * i * slides.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// ---------- toast ----------
let toastT;
function toast(text) {
  const el = $('#toast'); el.textContent = text; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- menu (phone) ----------
function closeMenu() { document.body.classList.remove('menu-open'); $('#menuBtn').setAttribute('aria-expanded', 'false'); }

// ---------- events ----------
document.addEventListener('click', async e => {
  const t = e.target.closest('button, a'); if (!t) return;
  if (t.id === 'menuBtn') { const open = !document.body.classList.contains('menu-open'); document.body.classList.toggle('menu-open', open); t.setAttribute('aria-expanded', String(open)); return; }
  if (t.dataset.save) {
    e.preventDefault();
    const id = t.dataset.save, on = !S.saved.has(id);
    on ? S.saved.add(id) : S.saved.delete(id); store.set('saved', [...S.saved]);
    if (on) signal('save', id);
    toast(on ? 'ذخیره شد' : 'از ذخیره‌ها برداشته شد');
    render(); return;
  }
  if (t.dataset.slide) { goSlide(+t.dataset.slide); return; }
  if ('share' in t.dataset) {
    const data = { title: document.title, url: location.href };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(location.href); toast('پیوند کپی شد'); } } catch { /* cancelled */ }
    return;
  }
  if (t.dataset.dm != null) {
    // Instagram cannot prefill a Direct message: copy the text, then open the profile.
    try { await navigator.clipboard.writeText(t.dataset.dm); toast('متن پیام کپی شد؛ در دایرکت بچسبانید'); } catch { toast('صفحهٔ اینستاگرام باز می‌شود'); }
    const m = location.hash.match(/^#\/p\/([^?]+)/); if (m) signal('ask', decodeURIComponent(m[1]));
    setTimeout(() => window.open(igLink(S.site.instagram), '_blank', 'noopener'), 350);
    return;
  }
  if (t.dataset.signal === 'ask') { const m = location.hash.match(/^#\/p\/([^?]+)/); if (m) signal('ask', decodeURIComponent(m[1])); return; }
  if ('newcustom' in t.dataset) { delete S.form._message; render(); return; }
  if ('retry' in t.dataset) { S.loaded = false; S.failed = false; render(); load(); }
});

document.addEventListener('submit', e => {
  const f = e.target;
  if (f.matches('[data-shopform]')) { e.preventDefault(); applyShopForm(f); return; }
  if (f.matches('[data-custom]')) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    const res = customRequest(data);
    S.form = { ...data }; store.set('custom', data);
    if (res.ok) { S.form._message = res.message; signal('custom', data.kind); }
    else S.form._errors = res.errors;
    render();
    const first = $('.err') ? $('[aria-invalid="true"], .err') : $('.done');
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
});
document.addEventListener('change', async e => {
  if (e.target.matches('[data-sort]')) { const q = { ...parseRoute(location.hash).query, sort: e.target.value }; history.replaceState(null, '', shopHash(q)); render(); return; }
  if (e.target.matches('[data-previewfile]')) {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (!catalogOk(raw)) throw new Error('version');
      const list = normalize(raw);
      S.items = list; S.preview = `${faDigits(list.length)} محصول از فایل ${file.name} نشان داده می‌شود.`;
    } catch { S.preview = ''; toast('این فایل کاتالوگ سینژین نیست یا نسخه‌اش جدیدتر از سایت است.'); }
    render(); return;
  } const f = e.target.closest('[data-shopform]'); if (f && e.target.name === 'sort') applyShopForm(f); });
let qT;
document.addEventListener('input', e => {
  const f = e.target.closest('[data-shopform]'); if (f && e.target.name === 'q') { clearTimeout(qT); qT = setTimeout(() => applyShopForm(f, true), 250); }
  const c = e.target.closest('[data-custom]');
  if (c) { const d = Object.fromEntries(new FormData(c)); store.set('custom', d); S.form = { ...S.form, ...d }; const b = $('[data-cta]', c); if (b) b.textContent = ctaLabel(d); }
});
function applyShopForm(f, keepFocus) {
  const q = { ...parseRoute(location.hash).query, ...Object.fromEntries(new FormData(f)) };
  const hash = shopHash(q);
  if (hash === location.hash) return;
  history.replaceState(null, '', hash); render();
  if (keepFocus) { const i = $('[data-shopform] input[name=q]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

window.addEventListener('hashchange', render);
render();
load();
