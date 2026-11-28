// «روی سایت نشان بده»: the switch, what is still missing for the site, the history line and the home filter.
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
        factors: { jewelry: { simple: 2.2, designed: 2.8, special: 3.5 }, panel: { special: 3 }, volume: {} }, markup: 2, rounding: 100000, brand: {} }, 'settings');
      const now = Date.now(), b = { sub: 'گوشواره', level: 'designed', material: 'silver', weight: 8, invoice: 1500000, stone: 0, photos: [], createdAt: now, updatedAt: now, approved: { price: 7000000, at: now } };
      await put('products', { ...b, id: 'g1', cat: 'jewelry', title: 'گوشوارهٔ آزمایشی' });
      await put('products', { ...b, id: 'g2', cat: 'jewelry', title: 'گوشوارهٔ دوم', desc: 'دست‌ساز' });
      await put('products', { ...b, id: 'p1', cat: 'panel', sub: 'بزرگ', level: 'special', title: 'تابلوی آزمایشی' });
    });
    await pg.reload(); await pg.waitForTimeout(1000);
    await pg.click('[data-edit="g1"]'); await pg.waitForTimeout(500);
    await pg.evaluate(() => { const p = document.querySelector('#sheet .panel'); p.scrollTop = p.scrollHeight; });
    ok(await pg.getAttribute('[data-onsite]', 'aria-checked') === 'false', scheme + ': off by default');
    await pg.click('[data-onsite]'); await pg.waitForTimeout(200);
    ok(await pg.getAttribute('[data-onsite]', 'aria-checked') === 'true', scheme + ': switch turns on');
    const foot = await pg.locator('[data-onsite]').locator('xpath=../following-sibling::p[1]').innerText();
    ok(/عکس/.test(foot) && /توضیح کوتاه فروش/.test(foot), scheme + ': says what the site still needs: ' + foot);
    await pg.evaluate(() => { const p = document.querySelector('#sheet .panel'); p.scrollTop = p.scrollHeight; }); await pg.waitForTimeout(150);
    await pg.screenshot({ path: OUT + scheme + '-site-switch.png' });
    await pg.click('[data-save]'); await pg.waitForTimeout(800);
    const saved = await pg.evaluate(() => new Promise(r => { const q = indexedDB.open('seenzhin', 5); q.onsuccess = () => { const g = q.result.transaction('products').objectStore('products').get('g1'); g.onsuccess = () => r(g.result); }; }));
    ok(saved.onSite === true, scheme + ': saved on the product');
    await pg.click('[data-filter="site"]'); await pg.waitForTimeout(300);
    const cards = await pg.$$eval('.pcard', els => els.length);
    ok(cards === 1, scheme + ': «روی سایت» filter shows 1 product, got ' + cards);
    await pg.screenshot({ path: OUT + scheme + '-site-filter.png' });
    // Catalog file: only the marked product, only public fields, photo inside.
    await pg.evaluate(async () => {
      const db = await new Promise(r => { const q = indexedDB.open('seenzhin', 5); q.onsuccess = () => r(q.result); });
      const c = document.createElement('canvas'); c.width = c.height = 40; c.getContext('2d').fillRect(0, 0, 40, 40);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .8));
      await new Promise(r => { const t = db.transaction(['photos', 'products'], 'readwrite'); t.objectStore('photos').put({ id: 'phx', blob });
        const st = t.objectStore('products'); const g = st.get('g1'); g.onsuccess = () => { st.put({ ...g.result, photos: ['phx'], desc: 'دست‌ساز' }); }; t.oncomplete = r; });
    });
    await pg.reload(); await pg.waitForTimeout(800);
    await pg.click('[data-tab="settings"]'); await pg.waitForTimeout(400);
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('[data-sitecat]')]);
    const cat = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
    ok(cat.kind === 'catalog' && cat.v === 1 && cat.currency === 'IRT' && cat.items.length === 1, scheme + ': catalog file with 1 product');
    const it = cat.items[0];
    ok(it.title === 'گوشوارهٔ آزمایشی' && it.price === 6600000 && it.availability === 'available' && /^data:image\/jpeg/.test(it.photos[0].data), scheme + ': fields and photo');
    ok(!['invoice', 'stone', 'level', 'approved', 'stock', 'cost'].some(k => k in it) && !JSON.stringify(cat).includes('1500000'), scheme + ': no making cost in the file');
    await pg.evaluate(() => document.querySelector('[data-sitecat]').scrollIntoView({ block: 'center' })); await pg.waitForTimeout(150);
    await pg.screenshot({ path: OUT + scheme + '-site-export.png' });
    await ctx.close();
  }
  ok(!errors.length, 'no console errors ' + errors.join('; '));
  await b.close();
})();
