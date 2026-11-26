import { db, requestPersistence } from './db.js';
import {
  FORMULAS, CATEGORIES, LEVELS, MATERIALS, STATUSES, ROUNDING,
  defaultSettings, catOf, formulaOf, matOf, levelOf, supplierOf, price, drifted, setupSteps,
} from './model.js';
import { fmt, fmtDec, iso, toman, parseNum, esc, faDate, faDigits } from './format.js';

const S = { settings: null, products: [], tab: 'catalog', filter: 'all', draft: null };
const urls = new Map(); // photo id -> object URL
const $ = (sel, el = document) => el.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- boot ----------
async function boot() {
  const saved = await db.get('settings');
  S.settings = Object.assign(defaultSettings(), saved || {});
  S.products = (await db.all('products')).sort((a, b) => b.createdAt - a.createdAt);
  for (const ph of await db.all('photos')) urls.set(ph.id, URL.createObjectURL(ph.blob));
  S.draft = newDraft();
  requestPersistence();
  bindGlobal();
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

const newDraft = () => ({ cat: null, sub: null, level: null, title: '', material: null, weight: null, stone: null, invoice: null, w: null, h: null, status: 'available', note: '', photos: [], _added: [] });
const saveSettings = () => db.set('settings', S.settings);

// ---------- shell ----------
const TABS = [
  { id: 'catalog', name: 'کاتالوگ', icon: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>' },
  { id: 'price', name: 'قیمت‌گذاری', icon: '<path d="M4 12.5 11.5 5H19v7.5L11.5 20z"/><circle cx="15.3" cy="8.7" r="1.4"/>' },
  { id: 'settings', name: 'تنظیمات', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>' },
];

function render() {
  const t = TABS.find(x => x.id === S.tab);
  $('#title').textContent = t.name;
  $('#tabs').innerHTML = TABS.map(x => `<button class="tab ${x.id === S.tab ? 'on' : ''}" data-tab="${x.id}" aria-label="${x.name}">
    <svg viewBox="0 0 24 24" aria-hidden="true">${x.icon}</svg><span>${x.name}</span></button>`).join('');
  const v = $('#view');
  v.innerHTML = S.tab === 'catalog' ? catalogHTML() : S.tab === 'price' ? editorHTML(S.draft, 'new') : settingsHTML();
  if (S.tab === 'price') refreshPrice(v, S.draft);
  stagger(v);
}

function stagger(root) {
  root.querySelectorAll('.card, .pcard').forEach((el, i) => { el.style.setProperty('--i', Math.min(i, 12)); el.classList.add('enter'); });
}

function island(text) {
  const el = $('#island');
  el.textContent = text;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(island.t); island.t = setTimeout(() => el.classList.remove('show'), 1900);
}

// ---------- catalog ----------
function catalogHTML() {
  const steps = setupSteps(S.settings, S.products);
  const drift = drifted(S.products, S.settings);
  const list = S.products.filter(p => S.filter === 'all' || p.cat === S.filter);
  let h = '';
  if (steps.some(s => !s.done)) {
    h += `<section class="card setup"><h2>شروع کار</h2><p class="muted">با پرکردن این سه قدم، سینژین آمادهٔ قیمت‌گذاری می‌شود.</p><ol>
      ${steps.map(s => `<li class="${s.done ? 'done' : ''}"><button class="row" data-go="${s.go}"><span class="tick">${s.done ? '✓' : ''}</span><span>${s.text}</span><span class="chev">‹</span></button></li>`).join('')}
    </ol></section>`;
  }
  if (drift.length) {
    h += `<button class="card banner" data-open="drift"><span class="dot"></span><span><b>قیمت ${iso(faDigits(drift.length))} محصول با قیمت روز فرق دارد.</b><br><span class="muted">برای بررسی و تأیید بزنید.</span></span><span class="chev">‹</span></button>`;
  }
  h += `<div class="chips scroll">${[{ id: 'all', name: 'همه' }, ...CATEGORIES].map(c =>
    `<button class="chip ${S.filter === c.id ? 'on' : ''}" data-filter="${c.id}">${c.name}<small>${iso(faDigits(c.id === 'all' ? S.products.length : S.products.filter(p => p.cat === c.id).length))}</small></button>`).join('')}</div>`;
  if (!list.length) {
    h += `<div class="empty"><div class="ring"></div><p>${S.products.length ? 'در این دسته هنوز محصولی نیست.' : 'هنوز محصولی ثبت نشده است.'}</p>
      <button class="btn" data-go="price">ثبت اولین محصول</button></div>`;
  } else {
    h += `<div class="grid">${list.map(productCard).join('')}</div>`;
  }
  return h;
}

function productCard(p) {
  const r = price(p, S.settings);
  const ph = p.photos && p.photos[0] && urls.get(p.photos[0]);
  const st = STATUSES.find(s => s.id === p.status);
  const name = p.title || [p.sub, levelOf(p.level) && levelOf(p.level).name].filter(Boolean).join('، ') || 'بی‌نام';
  const shown = p.approved ? p.approved.price : r.final; // the approved price is the one customers see
  return `<button class="pcard" data-edit="${p.id}">
    <div class="thumb">${ph ? `<img src="${ph}" alt="">` : `<span class="noimg">${esc((catOf(p.cat) || {}).name || '')}</span>`}
      <span class="status s-${p.status}">${st.name}</span></div>
    <div class="pmeta"><div class="pname">${esc(name)}</div>
      ${shown != null ? `<div class="pprice">${toman(shown)}</div>` : `<div class="pprice incomplete">قیمت کامل نیست</div>`}</div>
  </button>`;
}

// ---------- editor (new product = «قیمت‌گذاری» tab; existing = sheet) ----------
function chips(field, items, cur, extra = '') {
  return `<div class="chips wrap" ${extra}>${items.map(it => `<button class="chip ${cur === it.id ? 'on' : ''}" data-set="${field}" data-val="${esc(it.id)}">${esc(it.name)}${it.hint ? `<small class="hint">${esc(it.hint)}</small>` : ''}</button>`).join('')}</div>`;
}

function numField(field, label, unit, val, help = '', dec = false) {
  const shown = val == null ? '' : dec ? fmtDec(val) : fmt(val);
  return `<label class="field"><span class="lab">${label}</span>
    <span class="inp"><input data-num="${field}" ${dec ? 'data-dec="1"' : ''} inputmode="decimal" autocomplete="off" placeholder="وارد نشده" value="${shown}"><em>${unit}</em></span>
    ${help ? `<span class="help">${help}</span>` : ''}</label>`;
}

function editorHTML(d, mode) {
  const cat = catOf(d.cat);
  const formula = formulaOf(d);
  const sup = supplierOf(S.settings, d.material);
  let h = `<div class="editor" data-mode="${mode}">`;
  h += `<section class="card"><h3><span class="n">۱</span>دسته</h3>${chips('cat', CATEGORIES, d.cat)}
    ${cat ? `<h4>نوع</h4>${chips('sub', cat.subs.map(s => ({ id: s, name: s })), d.sub)}<p class="help">فرمول قیمت: <b>${FORMULAS[formula].name}</b> (${FORMULAS[formula].hint})</p>` : ''}</section>`;
  h += `<section class="card"><h3><span class="n">۲</span>سطح کار</h3>${chips('level', LEVELS, d.level)}
    <p class="help">سطح کار ارزش طراحی را تعیین می‌کند: هزینهٔ تمام‌شده در ضریب این سطح ضرب می‌شود.</p></section>`;
  h += `<section class="card"><h3><span class="n">۳</span>متریال و هزینه‌ها</h3>${chips('material', MATERIALS, d.material)}
    ${sup === 'self' ? numField('weight', `وزن ${matOf(d.material).name}`, 'گرم', d.weight, 'فلزی که سینژین خودش به کارگاه می‌دهد.', true) : ''}
    ${sup === 'workshop' ? `<p class="help">${matOf(d.material).name} را کارگاه تأمین می‌کند؛ هزینه‌اش داخل فاکتور کارگاه است. (قابل تغییر در تنظیمات)</p>` : ''}
    ${numField('invoice', 'فاکتور کارگاه', 'تومان', d.invoice, 'مبلغ کامل فاکتور ساخت.')}
    ${numField('stone', 'سنگ', 'تومان', d.stone, 'اگر سنگ ندارد، خالی بگذارید.')}
    ${formula === 'panel' ? `<div class="two">${numField('w', 'عرض', 'سانتی‌متر', d.w, '', true)}${numField('h', 'ارتفاع', 'سانتی‌متر', d.h, '', true)}</div>` : ''}
  </section>`;
  h += `<div class="pricecard"></div>`;
  h += `<section class="card"><h3><span class="n">۴</span>معرفی محصول</h3>
    <label class="field"><span class="lab">نام محصول</span><span class="inp"><input data-text="title" placeholder="مثلاً انگشتر موج" value="${esc(d.title)}"></span></label>
    <div class="photos">${(d.photos || []).map(id => `<div class="ph"><img src="${urls.get(id) || ''}" alt=""><button class="x" data-rmphoto="${id}" aria-label="حذف عکس">×</button></div>`).join('')}
      <label class="addph"><input type="file" accept="image/*" multiple data-photo hidden><span>+</span><small>عکس</small></label></div>
    <h4>وضعیت</h4>${chips('status', STATUSES, d.status)}
    <label class="field"><span class="lab">یادداشت</span><span class="inp"><textarea data-text="note" rows="2" placeholder="اختیاری">${esc(d.note)}</textarea></span></label>
  </section>`;
  h += `<div class="pbar"></div>`;
  h += `<div class="actions">${mode === 'edit' ? `<button class="btn ghost danger" data-del>حذف</button>` : `<button class="btn ghost" data-reset>پاک کردن فرم</button>`}
    <button class="btn" data-save>${mode === 'edit' ? 'ذخیرهٔ تغییرات' : 'ذخیره در کاتالوگ'}</button></div>`;
  return h + '</div>';
}

function refreshPrice(root, d) {
  const box = $('.pricecard', root);
  if (!box) return;
  const r = price(d, S.settings);
  let h = `<div class="plabel">قیمت فروش</div>`;
  h += r.complete ? `<div class="pbig">${iso(fmt(r.final))}<small>تومان</small></div>` : `<div class="pbig muted-big">هنوز کامل نیست</div>`;
  if (r.lines.length || r.cost != null) {
    h += `<div class="calc">`;
    for (const l of r.lines) {
      const how = l.how && l.how.kind === 'mul' ? `${iso(fmtDec(l.how.a))} ${l.how.aUnit} × ${toman(l.how.b)}` : l.how ? l.how.text : '';
      h += `<div class="cl"><span>${l.label}${how ? `<small>${how}</small>` : ''}</span><b>${l.value ? toman(l.value) : '—'}</b></div>`;
    }
    if (r.cost != null) h += `<div class="cl sum"><span>هزینهٔ تمام‌شده<small>جمع ردیف‌های بالا</small></span><b>${toman(r.cost)}</b></div>`;
    if (r.cost != null && r.factor != null) {
      h += `<div class="cl"><span>× ضریب «${levelOf(d.level).name}»<small>فرمول ${FORMULAS[r.formula].name}؛ هزینه × ${iso(fmtDec(r.factor))}</small></span><b>${toman(r.internal)}</b></div>`;
      h += r.step ? `<div class="cl"><span>گرد به بالا<small>تا مضرب ${toman(r.step)}</small></span><b>${toman(r.final)}</b></div>` : '';
    }
    h += `</div>`;
  }
  if (r.missing.length) {
    h += `<ul class="missing">${r.missing.map(m => `<li>${m.key.startsWith('price:') || m.key.startsWith('factor:') ? `<button data-go="settings">${m.text}<span class="chev">‹</span></button>` : m.text}</li>`).join('')}</ul>`;
  }
  box.innerHTML = h;
  box.classList.toggle('ok', r.complete);
  const bar = $('.pbar', root);
  if (bar) bar.innerHTML = `<span class="plabel">قیمت فروش</span><b>${r.complete ? toman(r.final) : 'هنوز کامل نیست'}</b>`;
}

// ---------- settings ----------
function settingsHTML() {
  const st = S.settings;
  let h = `<section class="card"><h3>قیمت روز فلز</h3><p class="help">قیمت هر گرم را وارد کنید. با هر تغییر، کاتالوگ نشان می‌دهد قیمت کدام محصولات عوض می‌شود.</p>`;
  for (const m of MATERIALS.filter(x => x.id !== 'none')) {
    const sup = st.suppliers[m.id] || m.supplier;
    h += `<div class="metal"><div class="mhead"><b>${m.name}</b>
      <div class="seg"><button class="${sup === 'self' ? 'on' : ''}" data-sup="${m.id}" data-val="self">خودمان تأمین می‌کنیم</button><button class="${sup === 'workshop' ? 'on' : ''}" data-sup="${m.id}" data-val="workshop">داخل فاکتور کارگاه</button></div></div>
      ${sup === 'self' ? numField('price:' + m.id, `هر گرم ${m.name}`, 'تومان', st.prices[m.id] ?? null, st.pricesAt[m.id] ? `آخرین به‌روزرسانی: ${faDate(st.pricesAt[m.id])}` : 'هنوز وارد نشده است.') : ''}
    </div>`;
  }
  h += `</section>`;
  h += `<section class="card"><h3>ضریب سطح‌ها</h3>
    <p class="help">قیمت = هزینهٔ تمام‌شده × ضریب. ضریب ${iso('۲٫۵')} یعنی قیمت فروش دو و نیم برابر هزینه است. این ضریب ارزش طراحی سروین (و فعلاً سود) را در بر می‌گیرد. عددها بعد از بررسی چند محصول واقعی تنظیم می‌شوند.</p>
    <div class="ftable"><div class="fh"><span></span>${LEVELS.map(l => `<span>${l.name}</span>`).join('')}</div>
    ${Object.entries(FORMULAS).map(([fid, f]) => `<div class="fr"><span>${f.name}</span>${LEVELS.map(l => {
      const v = st.factors[fid][l.id];
      return `<input data-num="factor:${fid}:${l.id}" data-dec="1" inputmode="decimal" placeholder="—" value="${v == null ? '' : fmtDec(v)}" aria-label="ضریب ${l.name} ${f.name}">`;
    }).join('')}</div>`).join('')}</div></section>`;
  h += `<section class="card"><h3>گرد کردن قیمت</h3><p class="help">قیمت نهایی به بالا گرد می‌شود تا عددی تمیز باشد.</p>
    <div class="chips wrap">${ROUNDING.map(r => `<button class="chip ${st.rounding === r ? 'on' : ''}" data-round="${r}">${r ? toman(r) : 'بدون گرد کردن'}</button>`).join('')}</div></section>`;
  h += `<section class="card"><h3>پشتیبان</h3><p class="help">همهٔ داده‌ها فقط روی همین دستگاه است. هر چند وقت یک فایل پشتیبان بگیرید.</p>
    <div class="actions"><button class="btn ghost" data-export>گرفتن پشتیبان</button><label class="btn ghost">بازگردانی<input type="file" accept="application/json" data-import hidden></label></div></section>`;
  h += `<p class="foot">سینژین، نسخهٔ آزمایشی</p>`;
  return h;
}

// ---------- sheets ----------
function openSheet(html, onBind) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="scrim" data-close></div><div class="panel" role="dialog" aria-modal="true"><div class="grab"></div><button class="close" data-close aria-label="بستن">×</button>${html}</div>`;
  sh.classList.add('open');
  document.body.classList.add('locked');
  if (onBind) onBind($('.panel', sh));
}
function closeSheet() {
  const sh = $('#sheet');
  if (S.editing) discardAdded(S.editing);
  S.editing = null;
  sh.classList.remove('open');
  document.body.classList.remove('locked');
  setTimeout(() => { if (!sh.classList.contains('open')) sh.innerHTML = ''; }, 300);
}

function openEdit(id) {
  const p = S.products.find(x => x.id === id);
  if (!p) return;
  S.editing = Object.assign(newDraft(), JSON.parse(JSON.stringify(p)), { _added: [] });
  openSheet(`<h2 class="stitle">ویرایش محصول</h2>${editorHTML(S.editing, 'edit')}`, panel => refreshPrice(panel, S.editing));
}

function openDrift() {
  const list = drifted(S.products, S.settings);
  if (!list.length) return;
  openSheet(`<h2 class="stitle">قیمت‌های تازه</h2><p class="help">قیمت فلز یا ضریب‌ها تغییر کرده است. قیمت قبلی و قیمت تازهٔ هر محصول:</p>
    <div class="drift">${list.map(x => {
      const n = x.p.title || x.p.sub || 'بی‌نام';
      const pct = x.from ? Math.round((x.to - x.from) / x.from * 100) : null;
      return `<div class="dl"><span>${esc(n)}</span><span class="dv">${x.from != null ? `<s>${toman(x.from)}</s>` : '<s>بدون قیمت</s>'}<b>${toman(x.to)}</b>${pct != null ? `<small class="${pct >= 0 ? 'up' : 'down'}">${iso(faDigits((pct > 0 ? '+' : '') + pct) + '٪')}</small>` : ''}</span></div>`;
    }).join('')}</div>
    <p class="help">درصد = (قیمت تازه − قیمت قبلی) ÷ قیمت قبلی.</p>
    <div class="actions"><button class="btn ghost" data-close>بعداً</button><button class="btn" data-approve>تأیید همهٔ قیمت‌ها</button></div>`);
}

// ---------- photos ----------
async function compress(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const max = 1400, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
}
async function addPhotos(d, files) {
  for (const f of files) {
    try {
      const blob = await compress(f);
      const id = uid();
      await db.put('photos', { id, blob });
      urls.set(id, URL.createObjectURL(blob));
      d.photos.push(id); d._added.push(id);
    } catch { island('این عکس خوانده نشد'); }
  }
}
async function discardAdded(d) {
  for (const id of d._added || []) { await db.del('photos', id); urls.delete(id); }
  d._added = [];
}

// ---------- save / delete ----------
async function saveDraft(d, mode) {
  if (!d.cat) { island('اول دسته را انتخاب کنید'); return false; }
  const r = price(d, S.settings);
  const now = Date.now();
  const { _added, ...clean } = d;
  const prev = mode === 'edit' ? S.products.find(x => x.id === d.id) : null;
  const p = Object.assign(clean, {
    id: d.id || uid(), createdAt: d.createdAt || now, updatedAt: now,
    approved: r.complete ? { price: r.final, at: now } : null,
  });
  // A sold product keeps the price it was sold at.
  if (prev && prev.status === 'sold' && p.status === 'sold' && prev.approved) p.approved = prev.approved;
  if (prev) for (const id of prev.photos || []) if (!p.photos.includes(id)) { await db.del('photos', id); urls.delete(id); }
  await db.put('products', p);
  const i = S.products.findIndex(x => x.id === p.id);
  if (i >= 0) S.products[i] = p; else S.products.unshift(p);
  d._added = [];
  island(r.complete ? `ذخیره شد، ${fmt(r.final)} تومان` : 'ذخیره شد؛ قیمت هنوز کامل نیست');
  return true;
}

async function deleteProduct(id) {
  const p = S.products.find(x => x.id === id);
  if (!p || !confirm('این محصول حذف شود؟')) return;
  for (const ph of p.photos || []) { await db.del('photos', ph); urls.delete(ph); }
  await db.del('products', id);
  S.products = S.products.filter(x => x.id !== id);
  S.editing = null; closeSheet(); render(); island('حذف شد');
}

// ---------- backup ----------
async function exportAll() {
  const photos = [];
  for (const ph of await db.all('photos')) photos.push({ id: ph.id, data: await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(ph.blob); }) });
  const blob = new Blob([JSON.stringify({ app: 'seenzhin', v: 1, at: Date.now(), settings: S.settings, products: S.products, photos })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `seenzhin-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importAll(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'seenzhin') throw 0;
    if (!confirm('داده‌های فعلی این دستگاه با فایل پشتیبان جایگزین شود؟')) return;
    await db.clear('products'); await db.clear('photos');
    for (const ph of data.photos || []) await db.put('photos', { id: ph.id, blob: await (await fetch(ph.data)).blob() });
    await db.putMany('products', data.products || []);
    await db.set('settings', data.settings);
    location.reload();
  } catch { island('این فایل پشتیبان سینژین نیست'); }
}

// ---------- events ----------
function ctxDraft(el) { return el.closest('#sheet') ? S.editing : S.draft; }
function ctxRoot(el) { return el.closest('#sheet') ? $('#sheet .panel') : $('#view'); }

function rerenderEditor(el) {
  const inSheet = !!el.closest('#sheet');
  const d = ctxDraft(el);
  const root = ctxRoot(el);
  const ed = $('.editor', root);
  const y = (inSheet ? root : document.scrollingElement).scrollTop;
  ed.outerHTML = editorHTML(d, inSheet ? 'edit' : 'new');
  refreshPrice(root, d);
  (inSheet ? root : document.scrollingElement).scrollTop = y;
}

function bindGlobal() {
  document.addEventListener('click', async e => {
    const t = e.target.closest('button, [data-close]');
    if (!t) return;
    const ds = t.dataset;
    if (ds.tab) { S.tab = ds.tab; render(); scrollTo(0, 0); return; }
    if (ds.go) { if (t.closest('#sheet')) closeSheet(); S.tab = ds.go; render(); scrollTo(0, 0); return; }
    if ('close' in ds) { closeSheet(); return; }
    if (ds.filter) { S.filter = ds.filter; render(); return; }
    if (ds.edit) { openEdit(ds.edit); return; }
    if (ds.open === 'drift') { openDrift(); return; }
    if ('approve' in ds) {
      const list = drifted(S.products, S.settings), now = Date.now();
      for (const x of list) x.p.approved = { price: x.to, at: now };
      await db.putMany('products', list.map(x => x.p));
      closeSheet(); render(); island(`قیمت ${faDigits(list.length)} محصول به‌روز شد`); return;
    }
    if (ds.set) {
      const d = ctxDraft(t), f = ds.set;
      d[f] = d[f] === ds.val && f !== 'status' ? null : ds.val;
      if (f === 'cat') d.sub = null;
      rerenderEditor(t); return;
    }
    if (ds.rmphoto) {
      const d = ctxDraft(t), id = ds.rmphoto;
      d.photos = d.photos.filter(x => x !== id);
      if (d._added.includes(id)) { d._added = d._added.filter(x => x !== id); await db.del('photos', id); urls.delete(id); }
      rerenderEditor(t); return;
    }
    if ('save' in ds) {
      const inSheet = !!t.closest('#sheet');
      const ok = await saveDraft(inSheet ? S.editing : S.draft, inSheet ? 'edit' : 'new');
      if (!ok) return;
      if (inSheet) { S.editing = null; closeSheet(); } else { S.draft = newDraft(); S.tab = 'catalog'; }
      render(); return;
    }
    if ('reset' in ds) { await discardAdded(S.draft); S.draft = newDraft(); render(); return; }
    if ('del' in ds) { deleteProduct(S.editing.id); return; }
    if (ds.sup) { S.settings.suppliers[ds.sup] = ds.val; await saveSettings(); render(); return; }
    if (ds.round != null) { S.settings.rounding = Number(ds.round); await saveSettings(); render(); island('ذخیره شد'); return; }
    if ('export' in ds) { exportAll(); return; }
  });

  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.text) { ctxDraft(el)[el.dataset.text] = el.value; return; }
    if (el.dataset.num) {
      const key = el.dataset.num, v = parseNum(el.value);
      // live grouping for money fields; decimals are left as typed
      if (!el.dataset.dec && v != null) el.value = fmt(v);
      if (key.startsWith('price:') || key.startsWith('factor:')) { pendingSetting(key, v); return; }
      const d = ctxDraft(el);
      d[key] = v;
      refreshPrice(ctxRoot(el), d);
    }
  });

  document.addEventListener('change', async e => {
    const el = e.target;
    if ('photo' in el.dataset && el.files.length) { const d = ctxDraft(el); await addPhotos(d, [...el.files]); rerenderEditor(el); return; }
    if ('import' in el.dataset && el.files[0]) importAll(el.files[0]);
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#sheet').classList.contains('open')) closeSheet(); });
}

// Settings numbers are saved shortly after typing stops.
function pendingSetting(key, v) {
  const [kind, a, b] = key.split(':');
  if (kind === 'price') { S.settings.prices[a] = v; S.settings.pricesAt[a] = v == null ? null : Date.now(); }
  else S.settings.factors[a][b] = v;
  clearTimeout(pendingSetting.t);
  pendingSetting.t = setTimeout(async () => {
    await saveSettings();
    const n = drifted(S.products, S.settings).length;
    island(n ? `ذخیره شد؛ قیمت ${faDigits(n)} محصول تغییر می‌کند` : 'ذخیره شد');
  }, 700);
}

boot();
