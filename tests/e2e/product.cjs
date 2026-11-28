// The product page (summary): screenshots for before/after, light and dark, phone.
const { chromium } = require('playwright');
const OUT = process.env.OUT || '/tmp/seenzhin-shots/', TAG = process.env.TAG || 'now';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch(), errors = [];
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, locale: 'fa-IR', serviceWorkers: 'block', deviceScaleFactor: 2 });
    const pg = await ctx.newPage();
    await pg.route('**/hesab-man/data/prices.json', r => r.fulfill({ json: { at: '2026-11-26T18:25:35Z', now: { silver: { p: 150000 } } } }));
    pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => m.type() === 'error' && errors.push(m.text()));
    await pg.goto('http://localhost:8771/'); await pg.waitForTimeout(400);
    await pg.evaluate(async () => {
      const db = await new Promise(r => { const q = indexedDB.open('seenzhin', 5); q.onsuccess = () => r(q.result); });
      const put = (s, o, k) => new Promise(r => { const t = db.transaction(s, 'readwrite'); k ? t.objectStore(s).put(o, k) : t.objectStore(s).put(o); t.oncomplete = r; });
      const c = document.createElement('canvas'); c.width = c.height = 600; const g = c.getContext('2d');
      const gr = g.createRadialGradient(300, 260, 30, 300, 300, 420); gr.addColorStop(0, '#8a8f8b'); gr.addColorStop(1, '#2b2e2c'); g.fillStyle = gr; g.fillRect(0, 0, 600, 600);
      g.strokeStyle = '#e6e2da'; g.lineWidth = 30; g.beginPath(); g.arc(300, 320, 120, 0, 7); g.stroke();
      await put('photos', { id: 'ph1', blob: await new Promise(r => c.toBlob(r, 'image/jpeg', .8)) });
      await put('kv', { prices: { silver: 150000 }, pricesAt: { silver: Date.now() }, suppliers: { silver: 'self', gold: 'self', bronze: 'workshop' },
        factors: { jewelry: { simple: 2.2, designed: 2.8, special: 3.5 }, panel: {}, volume: {} }, markup: 2, rounding: 100000, brand: {} }, 'settings');
      const now = Date.now();
      await put('products', { id: 'p1', title: 'انگشتر موج', cat: 'jewelry', sub: 'انگشتر', level: 'designed', material: 'silver', weight: 12, stone: 0, invoice: 1500000, photos: ['ph1'], desc: '', onSite: true, stock: 2, stockAt: 0, createdAt: now, updatedAt: now, approved: { price: 7800000, at: now } });
    });
    await pg.reload(); await pg.waitForTimeout(900);
    await pg.click('[data-edit="p1"]'); await pg.waitForTimeout(700);
    await pg.screenshot({ path: `${OUT}product-${TAG}-${scheme}.png` });
    const full = await pg.evaluate(() => { const p = document.querySelector('#sheet .panel'); return p.scrollHeight; });
    await pg.setViewportSize({ width: 390, height: Math.min(full + 40, 4000) }); await pg.waitForTimeout(300);
    await pg.screenshot({ path: `${OUT}product-${TAG}-${scheme}-full.png` });
    console.log(scheme, 'panel height', full);
    const main = async () => pg.locator('#sheet .ed-foot .btn:not(.more)').innerText();
    if (TAG === 'after') {
      const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + scheme + ': ' + m); if (!c) process.exitCode = 1; };
      ok(await main() === 'فاکتور فروش', 'nothing changed → main button is «فاکتور فروش»');
      await pg.click('[data-more]'); await pg.waitForTimeout(200);
      ok(await pg.locator('[data-dup]').count() === 1 && await pg.locator('[data-del]').count() === 1, '«بیشتر» shows similar and delete');
      await pg.click('[data-qty="1"]'); await pg.waitForTimeout(200);
      ok(await main() === 'ذخیره', 'a change → main button is «ذخیره»');
      await pg.fill('[data-num="finalPrice"]', '8000000'); await pg.dispatchEvent('[data-num="finalPrice"]', 'input'); await pg.waitForTimeout(100);
      ok(await main() === 'ذخیره', 'typing a price keeps «ذخیره»');
    }
    await ctx.close();
  }
  console.log('errors', errors);
  await b.close();
})();
