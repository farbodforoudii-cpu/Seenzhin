// A sale below the library price: the invoice keeps the sale price, the library keeps its own price,
// and the ready count of the design goes down by one per paid invoice (a deposit reserves one).
// Also checks the one-time repair of a product sold before v23 (library price overwritten by the sale price).
const { chromium } = require('playwright');
const OUT = process.env.OUT || '/tmp/seenzhin-shots/';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch(), errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: process.env.SCHEME || 'dark', locale: 'fa-IR', serviceWorkers: 'block' });
  const pg = await ctx.newPage();
  await pg.route('**/hesab-man/data/prices.json', r => r.fulfill({ json: { at: '2026-11-26T18:25:35Z', now: { silver: { p: 150000 } } } }));
  pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await pg.goto('http://localhost:8771/'); await pg.waitForTimeout(400);
  await pg.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('seenzhin', 4); q.onsuccess = () => r(q.result); });
    const put = (s, o, k) => new Promise(r => { const t = db.transaction(s, 'readwrite'); k ? t.objectStore(s).put(o, k) : t.objectStore(s).put(o); t.oncomplete = r; });
    await put('kv', { prices: { silver: 150000, gold: null }, pricesAt: { silver: Date.now() }, suppliers: { silver: 'self', gold: 'self', bronze: 'workshop' },
      factors: { jewelry: { simple: 2.2, designed: 2.8, special: 3.5 }, panel: {}, volume: {} }, markup: 2, rounding: 100000, brand: {} }, 'settings');
    const now = Date.now(), base = { cat: 'jewelry', sub: 'انگشتر', level: 'designed', material: 'silver', stone: 0, note: '', photos: [], createdAt: now - 864e6, updatedAt: now };
    // Old-style sale: library price was overwritten with the sale price 3,000,000.
    await put('products', { ...base, id: 'old', title: 'قدیمی', weight: 10, invoice: 1500000, status: 'sold', soldAt: now - 864e5, approved: { price: 3000000, at: now } });
    await put('products', { ...base, id: 'new', title: 'تازه', weight: 10, invoice: 1500000, status: 'available', stock: 2, stockAt: now - 864e6, approved: { price: 7200000, at: now } });
    await put('invoices', { id: 'i1', no: '1405-001', date: now - 864e5, items: [{ productId: 'old', title: 'قدیمی', price: 3000000, listPrice: 7200000 }], shipping: 0, discount: 0, paid: 3000000, customer: {}, note: '' });
  });
  await pg.reload(); await pg.waitForTimeout(1200);
  const get = id => pg.evaluate(id => new Promise(r => { const q = indexedDB.open('seenzhin', 4); q.onsuccess = () => { const g = q.result.transaction('products').objectStore('products').get(id); g.onsuccess = () => r(g.result); }; }), id);
  let o = await get('old');
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  // formula: silver 10 g × 150,000 × 2 = 3,000,000 + 1,500,000 × 2.8 = 4,200,000 → 7,200,000
  ok(o.approved.price === 7200000 && o.soldPrice === 3000000, `repair: library ${o.approved.price}, sold ${o.soldPrice}`);
  // New sale at a lower price through the invoice.
  await pg.click('[data-edit="new"]'); await pg.waitForTimeout(500);
  await pg.click('[data-sell]'); await pg.waitForTimeout(500);
  await pg.fill('[data-inum="item:0:price"]', '5300000'); await pg.dispatchEvent('[data-inum="item:0:price"]', 'input');
  await pg.click('[data-ifull]'); await pg.waitForTimeout(200);
  await pg.screenshot({ path: OUT + 'sold-invoice-edit.png' });
  await pg.click('[data-isave]'); await pg.waitForTimeout(900);
  await pg.screenshot({ path: OUT + 'sold-invoice.png' });
  const n = await get('new');
  const inv = await pg.evaluate(() => new Promise(r => { const q = indexedDB.open('seenzhin', 4); q.onsuccess = () => { const g = q.result.transaction('invoices').objectStore('invoices').getAll(); g.onsuccess = () => r(g.result); }; }));
  const ni = inv.find(i => i.items[0].productId === 'new');
  ok(n.approved.price === 7200000, `new sale: library price stays ${n.approved.price}`);
  ok(ni && ni.items[0].price === 5300000, `invoice item ${ni && ni.items[0].price}`);
  await pg.keyboard.press('Escape').catch(() => {});
  await pg.goto('http://localhost:8771/'); await pg.waitForTimeout(1000);
  const cards = await pg.$$eval('.pcard', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
  console.log(cards.join(' | '));
  ok(cards.every(c => /۷[٫,.]۲/.test(c)), 'showcase shows the library price on both cards');
  ok(/تمام شد قدیمی/.test(cards.join('|')) && !/تمام شد تازه|رزرو تازه/.test(cards.join('|')), 'old one sold out, new one still has 1 ready');
  // A deposit on the last ready one reserves it.
  await pg.click('[data-edit="new"]'); await pg.waitForTimeout(500);
  const box = await pg.$eval('.qty b', e => e.textContent); ok(box === '۱', 'editor shows 1 ready, got ' + box);
  await pg.screenshot({ path: OUT + 'sold-editor.png' });
  await pg.evaluate(() => { const p = document.querySelector('#sheet .panel'); p.scrollTop = p.scrollHeight; }); await pg.waitForTimeout(200);
  await pg.screenshot({ path: OUT + 'sold-editor-bottom.png' });
  await pg.click('[data-sell]'); await pg.waitForTimeout(500);
  await pg.fill('[data-inum="paid"]', '1000000'); await pg.dispatchEvent('[data-inum="paid"]', 'input');
  await pg.click('[data-isave]'); await pg.waitForTimeout(900);
  await pg.goto('http://localhost:8771/'); await pg.waitForTimeout(1000);
  const c2 = await pg.$$eval('.pcard', els => els.map(e => e.innerText.replace(/\s+/g, ' '))).then(a => a.join('|'));
  ok(/رزرو تازه/.test(c2), 'deposit reserves the last one: ' + c2);
  // Making two more by hand: 2 ready, the reserved one still held.
  await pg.click('[data-edit="new"]'); await pg.waitForTimeout(500);
  await pg.click('[data-qty="1"]'); await pg.click('[data-qty="1"]'); await pg.click('[data-save]'); await pg.waitForTimeout(900);
  const c3 = await pg.$$eval('.pcard', els => els.map(e => e.innerText.replace(/\s+/g, ' '))).then(a => a.join('|'));
  ok(/۲ عدد تازه/.test(c3), 'two more made: ' + c3);
  await pg.screenshot({ path: OUT + 'sold-home2.png' });
  await pg.screenshot({ path: OUT + 'sold-home.png' });
  ok(!errors.length, 'no console errors ' + errors.join('; '));
  await b.close();
})();
