const { chromium } = require('playwright');
require('fs').mkdirSync(process.env.OUT || '/tmp/seenzhin-shots/', { recursive: true });
const OUT = (process.env.OUT || '/tmp/seenzhin-shots/');
(async () => {
  const b = await chromium.launch();
  const errors = [];
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, locale: 'fa-IR', serviceWorkers: 'block' });
    const pg = await ctx.newPage();
    await pg.route('**/hesab-man/data/prices.json', r => r.fulfill({ json: { at: '2026-11-26T18:25:35Z', now: { silver: { p: 420760 }, gold: { p: 25797800 } } } }));
    pg.on('console', m => m.type() === 'error' && errors.push(scheme + ': ' + m.text())); pg.on('response', r => r.status() >= 400 && errors.push('404 ' + r.url()));
    pg.on('pageerror', e => errors.push(scheme + ' pageerror: ' + e.message));
    await pg.goto('http://localhost:8771/');
    await pg.waitForTimeout(400);
    if (scheme === 'light') await pg.screenshot({ path: OUT + 'empty.png' });
    // seed
    await pg.evaluate(async () => {
      const open = () => new Promise(r => { const q = indexedDB.open('seenzhin', 4); q.onsuccess = () => r(q.result); });
      const db = await open();
      const put = (store, obj, key) => new Promise(r => { const t = db.transaction(store, 'readwrite'); key ? t.objectStore(store).put(obj, key) : t.objectStore(store).put(obj); t.oncomplete = r; });
      const photo = async (h1, h2) => { const c = document.createElement('canvas'); c.width = c.height = 600; const g = c.getContext('2d');
        const gr = g.createRadialGradient(300, 260, 30, 300, 300, 420); gr.addColorStop(0, h1); gr.addColorStop(1, h2); g.fillStyle = gr; g.fillRect(0, 0, 600, 600);
        g.strokeStyle = '#d9d6d0'; g.lineWidth = 34; g.beginPath(); g.arc(300, 320, 120, 0, 7); g.stroke(); return new Promise(r => c.toBlob(r, 'image/jpeg', .8)); };
      await put('photos', { id: 'ph1', blob: await photo('#55524d', '#1e1d1b') });
      await put('photos', { id: 'ph2', blob: await photo('#a88a66', '#3b2f22') });
      await put('kv', { prices: { silver: 150000, gold: null }, pricesAt: { silver: Date.now(), gold: null }, suppliers: { silver: 'self', gold: 'self', bronze: 'workshop' },
        factors: { jewelry: { simple: 2.2, designed: 2.8, special: 3.5 }, panel: { simple: null, designed: 2.6, special: null }, volume: { simple: 2, designed: 2, special: 3 } }, markup: 1.3, rounding: 100000, brand: { instagram: 'seenzhin.studio', phone: '09120000000', thanks: 'از انتخاب شما سپاسگزاریم' } }, 'settings');
      const now = Date.now();
      const P = [
        { id: 'p1', title: 'انگشتر موج', cat: 'jewelry', sub: 'انگشتر', level: 'designed', material: 'silver', weight: 12, stone: 0, invoice: 1500000, status: 'available', photos: ['ph1'], approved: { price: 7900000, at: now } },
        { id: 'p2', title: 'تندیس رقصنده', cat: 'statue', sub: 'تندیس', level: 'special', material: 'bronze', invoice: 12000000, status: 'reserved', photos: ['ph2'], approved: { price: 36000000, at: now } },
        { id: 'p5', title: 'انگشتر برگ', cat: 'jewelry', sub: 'انگشتر', level: 'designed', material: 'silver', weight: 9, invoice: 1300000, status: 'available', photos: [], approved: { price: 6000000, at: now } },
        { id: 'p3', title: 'تابلوی باغ', cat: 'panel', sub: 'متوسط', level: 'designed', material: 'silver', weight: 40, invoice: null, w: 30, h: 40, status: 'available', photos: [] , approved: null },
        { id: 'p4', title: 'گوشوارهٔ قطره', cat: 'jewelry', sub: 'گوشواره', level: 'simple', material: 'silver', weight: 6, invoice: 600000, status: 'sold', soldAt: now - 3*864e5, photos: [], approved: { price: 2900000, at: now } },
      ];
      for (const [i, p] of P.entries()) await put('products', Object.assign({ note: '', stone: null, createdAt: now - 20*864e5 - i * 1000, updatedAt: now }, p));
    });
    await pg.reload(); await pg.waitForTimeout(1200);
    await pg.screenshot({ path: OUT + scheme + '-home.png' });
    await pg.screenshot({ path: OUT + scheme + '-home-full.png', fullPage: true });
    await pg.click('[data-act="drift"]'); await pg.waitForTimeout(500);
    await pg.screenshot({ path: OUT + scheme + '-drift.png' });
    await pg.click('.panel [data-back]'); await pg.waitForTimeout(400);
    await pg.click('[data-edit="p1"]'); await pg.waitForTimeout(600);
    await pg.screenshot({ path: OUT + scheme + '-summary.png' });
    await pg.click('.explain summary'); await pg.waitForTimeout(200);
    await pg.screenshot({ path: OUT + scheme + '-summary-open.png' });
    await pg.click('.panel [data-back]'); await pg.waitForTimeout(400);
    await pg.click('[data-new] >> nth=0'); await pg.waitForTimeout(500);
    await pg.click('[data-set="cat"][data-val="jewelry"]'); await pg.waitForTimeout(300);
    await pg.screenshot({ path: OUT + scheme + '-step1.png' });
    await pg.click('[data-set="sub"][data-val="انگشتر"]'); await pg.waitForTimeout(600);
    await pg.screenshot({ path: OUT + scheme + '-step2.png' });
    await pg.click('[data-set="level"][data-val="special"]'); await pg.waitForTimeout(600);
    await pg.click('[data-set="material"][data-val="silver"]'); await pg.waitForTimeout(200);
    await pg.fill('[data-num="weight"]', '8'); await pg.dispatchEvent('[data-num="weight"]', 'input');
    await pg.screenshot({ path: OUT + scheme + '-step3.png' });
    await pg.click('[data-usesug]').catch(() => {}); await pg.waitForTimeout(200);
    await pg.click('.ed-foot [data-step="3"]'); await pg.waitForTimeout(300);
    await pg.fill('[data-text="title"]', 'انگشتر ماه'); await pg.dispatchEvent('[data-text="title"]', 'input');
    await pg.click('.ed-foot [data-step="4"]'); await pg.waitForTimeout(300);
    await pg.screenshot({ path: OUT + scheme + '-step5.png' });
    await pg.click('[data-save]'); await pg.waitForTimeout(800);
    await pg.click('[data-tab="analysis"]'); await pg.waitForTimeout(1200);
    await pg.screenshot({ path: OUT + scheme + '-analysis.png', fullPage: true });
    await pg.click('[data-tab="settings"]'); await pg.waitForTimeout(500);
    await pg.screenshot({ path: OUT + scheme + '-settings.png', fullPage: true });
    // invoice flow
    await pg.click('[data-tab="sales"]'); await pg.waitForTimeout(600);
    await pg.screenshot({ path: OUT + scheme + '-sales-empty.png' });
    await pg.click('[data-tab="home"]'); await pg.waitForTimeout(400);
    await pg.click('[data-edit="p5"]'); await pg.waitForTimeout(500);
    await pg.click('[data-sell]'); await pg.waitForTimeout(600);
    await pg.click('[data-itog="p1"]'); await pg.waitForTimeout(200);
    await pg.fill('[data-inum="shipping"]', '150000'); await pg.dispatchEvent('[data-inum="shipping"]', 'input');
    await pg.fill('[data-inum="paid"]', '7000000'); await pg.dispatchEvent('[data-inum="paid"]', 'input');
    await pg.waitForTimeout(200);
    await pg.screenshot({ path: OUT + scheme + '-inv-edit.png' });
    await pg.evaluate(() => { const p = document.querySelector('#sheet .panel'); p.scrollTop = p.scrollHeight; }); await pg.waitForTimeout(200);
    await pg.screenshot({ path: OUT + scheme + '-inv-edit-bottom.png' });
    await pg.click('[data-isave]'); await pg.waitForTimeout(2500);
    await pg.screenshot({ path: OUT + scheme + '-inv-preview.png' });
    const src = await pg.getAttribute('.inv-img', 'src');
    require('fs').writeFileSync(OUT + scheme + '-invoice.png', Buffer.from(src.split(',')[1], 'base64'));
    await pg.click('.panel [data-back]'); await pg.waitForTimeout(500);
    await pg.screenshot({ path: OUT + scheme + '-sales.png' });
    await pg.click('[data-tab="home"]'); await pg.waitForTimeout(500);
    const st = await pg.locator('[data-edit="p5"] .badge').innerText().catch(() => 'none');  // status comes from the invoices
    console.log(scheme, 'p5 status after deposit invoice:', st);
    if (scheme === 'light') { await pg.setViewportSize({ width: 1024, height: 1366 }); await pg.click('[data-tab="home"]'); await pg.waitForTimeout(800); await pg.screenshot({ path: OUT + 'ipad-home.png' }); }
    await ctx.close();
  }
  console.log('errors:', errors.length ? errors : 'none');
  await b.close();
})();
