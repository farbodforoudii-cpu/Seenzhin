// Custom order end to end: customer, details and estimate, fair deposit, locked metal, making, real weight,
// delivery and profit; a cancel before and after making starts; old invoice buyers become customers.
const { chromium } = require('playwright');
const OUT = process.env.OUT || '/tmp/seenzhin-shots/';
require('fs').mkdirSync(OUT, { recursive: true });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch(), errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: process.env.SCHEME || 'light', locale: 'fa-IR', serviceWorkers: 'block' });
  const pg = await ctx.newPage();
  await pg.route('**/hesab-man/data/prices.json', r => r.fulfill({ json: { at: '2026-11-26T18:25:35Z', now: { silver: { p: 150000 } } } }));
  pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => m.type() === 'error' && errors.push(m.text()));
  pg.on('dialog', d => d.accept());
  await pg.goto('http://localhost:8771/'); await pg.waitForTimeout(400);
  await pg.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('seenzhin', 4); q.onsuccess = () => r(q.result); });
    const put = (s, o, k) => new Promise(r => { const t = db.transaction(s, 'readwrite'); k ? t.objectStore(s).put(o, k) : t.objectStore(s).put(o); t.oncomplete = r; });
    await put('kv', { prices: { silver: 150000, gold: null }, pricesAt: { silver: Date.now() }, suppliers: { silver: 'self', gold: 'self', bronze: 'workshop' },
      factors: { jewelry: { simple: 2.2, designed: 2.8, special: 3.5 }, panel: {}, volume: {} }, markup: 2, rounding: 100000, brand: {} }, 'settings');
    // An old invoice with a buyer typed by hand, from before customers existed.
    await put('invoices', { id: 'old1', no: '1405-001', date: Date.now() - 5 * 864e5, paidAt: Date.now() - 5 * 864e5, items: [{ title: 'گوشواره', price: 2000000 }], paid: 2000000, customer: { name: 'مینا آزمایشی', phone: '۰۹۱۲۰۰۰۰۰۰۰' }, note: '' });
  });
  await pg.reload(); await pg.waitForTimeout(1200);
  const read = st => pg.evaluate(st => new Promise(r => { const q = indexedDB.open('seenzhin', 4); q.onsuccess = () => { const g = q.result.transaction(st).objectStore(st).getAll(); g.onsuccess = () => r(g.result); }; }), st);
  let cs = await read('customers');
  ok(cs.length === 1 && cs[0].name === 'مینا آزمایشی', 'old buyer became a customer');
  ok((await read('invoices'))[0].customerId === cs[0].id, 'old invoice linked to the customer');

  // New order for that customer.
  await pg.click('[data-tab="sales"]'); await pg.waitForTimeout(400);
  await pg.click('[data-sv="ord"]'); await pg.waitForTimeout(300);
  await pg.screenshot({ path: OUT + 'ord-empty.png' });
  await pg.click('[data-onew] >> nth=0'); await pg.waitForTimeout(400);
  await pg.fill('[data-otext="cname"]', 'مینا آزمایشی'); await pg.dispatchEvent('[data-otext="cname"]', 'input');
  ok(await pg.inputValue('[data-otext="cphone"]') === '۰۹۱۲۰۰۰۰۰۰۰', 'known name fills the phone');
  await pg.click('[data-ospec]'); await pg.waitForTimeout(300);
  await pg.click('[data-set="cat"][data-val="jewelry"]'); await pg.waitForTimeout(200);
  await pg.click('[data-set="sub"][data-val="انگشتر"]'); await pg.waitForTimeout(600);
  await pg.click('[data-set="level"][data-val="designed"]'); await pg.waitForTimeout(600);
  await pg.click('[data-set="material"][data-val="silver"]'); await pg.waitForTimeout(200);
  await pg.fill('[data-num="weight"]', '10'); await pg.dispatchEvent('[data-num="weight"]', 'input');
  await pg.fill('[data-num="invoice"]', '1500000'); await pg.dispatchEvent('[data-num="invoice"]', 'input');
  await pg.click('.ed-foot [data-step="3"]'); await pg.waitForTimeout(300);
  await pg.fill('[data-text="title"]', 'انگشتر نام'); await pg.dispatchEvent('[data-text="title"]', 'input');
  await pg.click('.ed-foot [data-step="4"]'); await pg.waitForTimeout(300);
  await pg.click('[data-save]'); await pg.waitForTimeout(400);
  await pg.click('[data-odue="14"]'); await pg.waitForTimeout(200);
  await pg.screenshot({ path: OUT + 'ord-new.png', fullPage: false });
  await pg.evaluate(() => { const p = document.querySelector('#sheet .panel'); p.scrollTop = p.scrollHeight; }); await pg.waitForTimeout(200);
  await pg.screenshot({ path: OUT + 'ord-new-bottom.png' });
  // estimate: 10 g × 150,000 × 2 = 3,000,000 + 1,500,000 × 2.8 = 4,200,000 → 7,200,000; cost 3,000,000; deposit max(3.6M, 3M) = 3.6M
  const ph = await pg.getAttribute('[data-onum="deposit"]', 'placeholder');
  ok(ph === '3,600,000' || ph === '۳٬۶۰۰٬۰۰۰' || /3.?600.?000|۳.?۶۰۰.?۰۰۰/.test(ph), 'suggested deposit 3.6M, got ' + ph);
  await pg.click('[data-odeposit]'); await pg.waitForTimeout(1500);
  await pg.screenshot({ path: OUT + 'ord-deposit-invoice.png' });
  let [o] = await read('orders'), inv = (await read('invoices')).find(i => i.orderId === o.id);
  ok(o.stage === 'deposit' && o.metal.silver === 150000 && o.deposit === 3600000, 'deposit taken, metal locked');
  ok(inv && inv.paid === 3600000 && inv.items[0].price === 7200000 && inv.terms, 'deposit invoice with terms');
  ok(o.customerId === cs[0].id, 'order on the same customer');

  // Silver gets dearer: the order keeps its locked price.
  await pg.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('seenzhin', 4); q.onsuccess = () => r(q.result); });
    const st = await new Promise(r => { const g = db.transaction('kv').objectStore('kv').get('settings'); g.onsuccess = () => r(g.result); });
    st.prices.silver = 200000;
    await new Promise(r => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(st, 'settings'); t.oncomplete = r; });
  });
  await pg.reload(); await pg.waitForTimeout(1000);
  await pg.click('[data-tab="sales"]'); await pg.click('[data-sv="ord"]'); await pg.waitForTimeout(300);
  await pg.click(`[data-oview="${o.id}"]`); await pg.waitForTimeout(400);
  await pg.click('[data-ostart]'); await pg.waitForTimeout(400);
  await pg.click('[data-oready]'); await pg.waitForTimeout(400);
  await pg.fill('[data-num="weight"]', '12'); await pg.dispatchEvent('[data-num="weight"]', 'input');
  await pg.click('.ed-foot [data-step="3"]'); await pg.click('.ed-foot [data-step="4"]'); await pg.waitForTimeout(300);
  await pg.click('[data-save]'); await pg.waitForTimeout(600);
  await pg.screenshot({ path: OUT + 'ord-ready.png' });
  [o] = await read('orders'); inv = (await read('invoices')).find(i => i.orderId === o.id);
  // real weight 12 g at the locked 150,000: 3,600,000 + 4,200,000 = 7,800,000 (not 200,000 × …)
  ok(o.stage === 'ready' && inv.items[0].price === 7800000, 'ready: final price from real weight and locked metal ' + inv.items[0].price);
  // Home shows the follow-up.
  await pg.click('[data-back]'); await pg.waitForTimeout(300); await pg.click('[data-tab="home"]'); await pg.waitForTimeout(400);
  ok(await pg.locator('.todo', { hasText: 'آماده است' }).count() === 1, 'home: «ready» follow-up');
  await pg.click('.todo >> text=آماده است'); await pg.waitForTimeout(400);
  await pg.click('[data-odeliver]'); await pg.waitForTimeout(500);
  await pg.screenshot({ path: OUT + 'ord-deliver.png' });
  await pg.click('[data-isave]'); await pg.waitForTimeout(1200);
  [o] = await read('orders'); inv = (await read('invoices')).find(i => i.orderId === o.id);
  ok(o.stage === 'done' && inv.paid === 7800000 && inv.paidAt && !inv.terms, 'delivered and settled');
  await pg.click('[data-back]'); await pg.waitForTimeout(300);
  await pg.click('[data-sv="ord"]'); await pg.waitForTimeout(300);
  await pg.click(`[data-oview="${o.id}"]`); await pg.waitForTimeout(400);
  await pg.evaluate(() => { const p = document.querySelector('#sheet .panel'); p.scrollTop = p.scrollHeight; }); await pg.waitForTimeout(200);
  await pg.screenshot({ path: OUT + 'ord-done.png' });
  const prof = await pg.locator('.group', { hasText: 'هزینهٔ ساخت' }).last().innerText();
  // cost at locked metal: 12 × 150,000 + 1,500,000 = 3,300,000 → profit 4,500,000
  ok(/۴٬?۵۰۰٬?۰۰۰|4,500,000/.test(prof), 'profit shown: ' + prof.replace(/\s+/g, ' '));
  await pg.click('[data-back]'); await pg.waitForTimeout(300);

  // Cancel before making: deposit refunded, invoice gone. Cancel after: deposit kept as a sale.
  for (const late of [false, true]) {
    await pg.click('[data-onew] >> nth=0'); await pg.waitForTimeout(300);
    await pg.fill('[data-otext="cname"]', late ? 'نیما آزمایشی' : 'سارا آزمایشی'); await pg.dispatchEvent('[data-otext="cname"]', 'input');
    await pg.click('[data-ospec]'); await pg.waitForTimeout(300);
    await pg.click('[data-set="cat"][data-val="jewelry"]'); await pg.click('[data-set="sub"][data-val="گوشواره"]'); await pg.waitForTimeout(600);
    await pg.click('[data-set="level"][data-val="simple"]'); await pg.waitForTimeout(600);
    await pg.click('[data-set="material"][data-val="silver"]');
    await pg.fill('[data-num="weight"]', '5'); await pg.dispatchEvent('[data-num="weight"]', 'input');
    await pg.fill('[data-num="invoice"]', '500000'); await pg.dispatchEvent('[data-num="invoice"]', 'input');
    await pg.click('.ed-foot [data-step="3"]'); await pg.click('.ed-foot [data-step="4"]'); await pg.waitForTimeout(300);
    await pg.click('[data-save]'); await pg.waitForTimeout(300);
    await pg.click('[data-odeposit]'); await pg.waitForTimeout(1200);
    await pg.click('[data-back]'); await pg.waitForTimeout(300);
    const id = (await read('orders')).find(x => x.stage === 'deposit').id;
    await pg.click('[data-tab="sales"]'); await pg.click('[data-sv="ord"]'); await pg.waitForTimeout(300);
    await pg.click(`[data-oview="${id}"]`); await pg.waitForTimeout(300);
    if (late) { await pg.click('[data-ostart]'); await pg.waitForTimeout(300); }
    await pg.click('[data-ocancel]'); await pg.waitForTimeout(500);
    const c = (await read('orders')).find(x => x.id === id), ci = (await read('invoices')).find(i => i.orderId === id);
    if (!late) ok(c.stage === 'cancelled' && !ci && c.refunded > 0, 'cancel before making: deposit back, invoice removed');
    else ok(c.stage === 'cancelled' && ci && ci.paidAt && ci.items[0].price === ci.paid, 'cancel after making: deposit kept as a settled sale');
    await pg.screenshot({ path: OUT + `ord-cancel-${late ? 'late' : 'early'}.png` });
    await pg.click('[data-back]'); await pg.waitForTimeout(300);
  }
  await pg.screenshot({ path: OUT + 'ord-list.png', fullPage: true });
  // Customer page.
  await pg.click('[data-sv="cust"]'); await pg.waitForTimeout(300);
  await pg.screenshot({ path: OUT + 'cust-list.png' });
  cs = await read('customers');
  ok(cs.length === 3, 'three customers: ' + cs.map(c => c.name).join('، '));
  await pg.click(`[data-cview="${cs.find(c => c.name === 'مینا آزمایشی').id}"]`); await pg.waitForTimeout(400);
  await pg.screenshot({ path: OUT + 'cust-page.png' });
  const txt = await pg.locator('#sheet .panel').innerText();
  ok(/۹٫۸|9.8/.test(txt.replace(/\s+/g, ' ')), 'customer total 2M + 7.8M = 9.8M');
  ok(!errors.length, 'no console errors ' + errors.join('; '));
  await b.close();
})();
