// «مالی»: record costs, the month's profit and cash, metal bought, monthly costs offered with one tap.
const { chromium } = require('playwright');
const OUT = process.env.OUT || '/tmp/seenzhin-shots/';
require('fs').mkdirSync(OUT, { recursive: true });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch(), errors = [];
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, locale: 'fa-IR', serviceWorkers: 'block' });
    const pg = await ctx.newPage();
    await pg.route('**/hesab-man/data/prices.json', r => r.fulfill({ json: { at: '2026-11-26T18:25:35Z', now: { silver: { p: 150000 } } } }));
    pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => m.type() === 'error' && errors.push(m.text()));
    await pg.goto('http://localhost:8771/'); await pg.waitForTimeout(400);
    await pg.evaluate(async () => {
      const db = await new Promise(r => { const q = indexedDB.open('seenzhin', 5); q.onsuccess = () => r(q.result); });
      const put = (s, o, k) => new Promise(r => { const t = db.transaction(s, 'readwrite'); k ? t.objectStore(s).put(o, k) : t.objectStore(s).put(o); t.oncomplete = r; });
      await put('kv', { prices: { silver: 150000 }, pricesAt: { silver: Date.now() }, suppliers: { silver: 'self', gold: 'self', bronze: 'workshop' },
        factors: { jewelry: { designed: 2.8 }, panel: {}, volume: {} }, markup: 2, rounding: 100000, brand: {} }, 'settings');
      const now = Date.now();
      await put('products', { id: 'g1', cat: 'jewelry', sub: 'گوشواره', level: 'designed', material: 'silver', weight: 10, invoice: 1500000, stone: 0, photos: [], title: 'گوشوارهٔ آزمایشی', createdAt: now, updatedAt: now, approved: { price: 7200000, at: now }, stock: 2, stockAt: 0 });
      // A sale settled today; its making cost (10 g × 150,000 + 1,500,000 = 3,000,000) is worked out by the app.
      await put('invoices', { id: 'i1', no: '1405-001', date: now, items: [{ productId: 'g1', title: 'گوشوارهٔ آزمایشی', price: 7200000 }], shipping: 300000, paid: 7500000, paidAt: now, customer: { name: '' }, note: '' });
      // Last month's rent, marked monthly.
      await put('expenses', { id: 'x0', cat: 'rent', amount: 5000000, date: now - 30 * 864e5, monthly: true, note: 'کارگاه' });
    });
    await pg.reload(); await pg.waitForTimeout(1000);
    const tabsFit = await pg.evaluate(() => { const r = document.querySelector('#tabs .inner').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
    ok(tabsFit, scheme + ': five tabs fit the phone width');
    await pg.click('[data-tab="money"]'); await pg.waitForTimeout(500);
    ok(await pg.locator('[data-xrepeat="x0"]').count() === 1, scheme + ': last month\'s rent offered');
    await pg.click('[data-xrepeat="x0"]'); await pg.waitForTimeout(500);
    // Silver bought today: 100 g for 16,000,000 → 160,000 a gram.
    await pg.click('[data-xnew] >> nth=0'); await pg.waitForTimeout(300);
    await pg.click('[data-xcat="metal"]'); await pg.waitForTimeout(200);
    await pg.fill('[data-xnum="grams"]', '100'); await pg.dispatchEvent('[data-xnum="grams"]', 'input');
    await pg.fill('[data-xnum="amount"]', '16000000'); await pg.dispatchEvent('[data-xnum="amount"]', 'input');
    const hint = await pg.textContent('#xhint');
    ok(/۱۶۰⁩? هزار/.test(hint), scheme + ': price per gram shown: ' + hint);
    await pg.screenshot({ path: OUT + scheme + '-money-expense.png' });
    await pg.click('[data-xsave]'); await pg.waitForTimeout(500);
    await pg.click('[data-xnew] >> nth=0'); await pg.waitForTimeout(300);
    await pg.click('[data-xcat="packaging"]'); await pg.fill('[data-xnum="amount"]', '200000'); await pg.dispatchEvent('[data-xnum="amount"]', 'input');
    await pg.click('[data-xsave]'); await pg.waitForTimeout(600);
    await pg.screenshot({ path: OUT + scheme + '-money.png' });
    await pg.screenshot({ path: OUT + scheme + '-money-full.png', fullPage: true });
    const txt = (await pg.locator('#view').innerText()).replace(/\s+/g, ' ');
    // revenue 7,500,000 − making 3,000,000 = 4,500,000 gross; − packaging 200,000 − rent 5,000,000 = −700,000 → a loss
    ok(/زیان این ماه/.test(txt), scheme + ': month shows a loss');
    ok(txt.includes('۷٬۵۰۰٬۰۰۰') && txt.includes('۳٬۰۰۰٬۰۰۰') && txt.includes('۴٬۵۰۰٬۰۰۰') && txt.includes('۷۰۰٬۰۰۰'), scheme + ': revenue, making cost, gross and loss');
    ok(txt.includes('۲۱٬۲۰۰٬۰۰۰'), scheme + ': cash out = 16,000,000 + 200,000 + 5,000,000');
    ok(await pg.locator('[data-xrepeat]').count() === 0, scheme + ': rent no longer offered');
    await pg.click('[data-month="-1"]'); await pg.waitForTimeout(300);
    ok((await pg.locator('#view').innerText()).includes('۵٬۰۰۰٬۰۰۰'), scheme + ': previous month shows its rent');
    const inv = await pg.evaluate(() => new Promise(r => { const q = indexedDB.open('seenzhin', 5); q.onsuccess = () => { const g = q.result.transaction('expenses').objectStore('expenses').getAll(); g.onsuccess = () => r(g.result); }; }));
    ok(inv.length === 4 && inv.find(e => e.cat === 'metal').grams === 100 && inv.filter(e => e.cat === 'rent').length === 2, scheme + ': four expenses stored (rent twice)');
    await ctx.close();
  }
  ok(!errors.length, 'no console errors ' + errors.join('; '));
  await b.close();
})();
