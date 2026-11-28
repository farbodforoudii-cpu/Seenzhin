// Website core on phone (iPhone, Android), iPad and laptop, light and dark:
// every page, no horizontal scroll, filters, gallery, save, custom-order form, phone menu, zero console errors.
// Run: python3 -m http.server 8771 (repo root), then node tests/e2e/site-core.cjs   → screenshots in $OUT
const { chromium, devices } = require('playwright');
const OUT = process.env.OUT || '/tmp/seenzhin-site-shots/';
require('fs').mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:8771/site/';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const SITE = { instagram: 'example_brand', whatsapp: '09120000000', telegram: '', tagline: 'HANDCRAFTED FOR SELF & SPACE' };

const DEVICES = [
  ['iphone', { ...devices['iPhone 14'] }],
  ['android', { ...devices['Pixel 7'] }],
  ['ipad', { ...devices['iPad Pro 11'] }],
  ['laptop', { viewport: { width: 1440, height: 900 } }],
];

(async () => {
  const b = await chromium.launch();
  for (const [name, dev] of DEVICES) for (const scheme of name === 'iphone' || name === 'laptop' ? ['light', 'dark'] : ['light']) {
    const tag = `${name}-${scheme}`, errors = [];
    const ctx = await b.newContext({ ...dev, colorScheme: scheme, locale: 'fa-IR', deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    await pg.route('**/site/data/site.json', r => r.fulfill({ json: SITE }));
    pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => m.type() === 'error' && errors.push(m.text()));
    const noOverflow = async page => ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag} ${page}: no horizontal scroll`);
    const shot = async page => pg.screenshot({ path: `${OUT}${tag}-${page}.png`, fullPage: true });

    await pg.goto(BASE); await pg.waitForSelector('.card');
    ok(await pg.locator('.card').count() === 8, `${tag} home: 8 featured`);
    await noOverflow('home'); await shot('home');

    // phone menu
    if (name === 'iphone' || name === 'android') {
      await pg.click('#menuBtn'); await pg.waitForTimeout(250);
      ok(await pg.isVisible('#nav a[href="#/custom"]'), `${tag}: phone menu opens`);
      await pg.screenshot({ path: `${OUT}${tag}-menu.png` });
      await pg.click('#nav a[href="#/shop"]');
    } else await pg.click('#nav a[href="#/shop"]');
    await pg.waitForSelector('.tools');
    ok(await pg.locator('.card').count() === 8, `${tag} shop: all 8`);
    await pg.click('.chip:has-text("تابلوی نقره")'); await pg.waitForTimeout(150);
    ok(await pg.locator('.card').count() === 1, `${tag} shop: category filter`);
    await pg.click('.chip:has-text("همه")'); await pg.click('.chip:has-text("فقط موجود")'); await pg.waitForTimeout(150);
    ok(await pg.locator('.card').count() === 5, `${tag} shop: only available → 5`);
    await pg.selectOption('select[name=sort]', 'dear'); await pg.waitForTimeout(150);
    ok((await pg.locator('.card-title').first().innerText()).includes('تابلو'), `${tag} shop: most expensive first`);
    await pg.fill('input[name=q]', 'باران'); await pg.waitForTimeout(400);
    ok(await pg.locator('.card').count() === 0, `${tag} shop: search respects «only available»`);
    await pg.goto(BASE + '#/shop?q=' + encodeURIComponent('باران')); await pg.waitForTimeout(200);
    ok(await pg.locator('.card').count() === 1, `${tag} shop: search finds one`);
    await pg.goto(BASE + '#/shop'); await pg.waitForTimeout(200);
    await noOverflow('shop'); await shot('shop');

    // product
    await pg.click('.card-link >> nth=0'); await pg.waitForSelector('.pdp');
    ok(/تومان/.test(await pg.locator('.price.big').innerText()), `${tag} product: exact price`);
    ok(await pg.locator('.thumb').count() === 3, `${tag} product: 3 photos`);
    await pg.click('.thumb >> nth=2'); await pg.waitForTimeout(700);
    ok(await pg.locator('.thumb.on').getAttribute('data-slide') === '2', `${tag} product: thumbnail moves gallery`);
    const wa = await pg.getAttribute('a[href^="https://wa.me/98912"]', 'href');
    ok(wa && decodeURIComponent(wa).includes('کد محصول: s01'), `${tag} product: WhatsApp message has product code`);
    ok(await pg.isVisible('[data-dm]'), `${tag} product: Instagram button`);
    ok(await pg.locator('script#ld').count() === 1, `${tag} product: structured data for search engines`);
    await pg.click('.info [data-save]'); await pg.waitForTimeout(150);
    ok(await pg.locator('#savedCount').innerText() === '۱', `${tag} product: saved, header shows ۱`);
    await noOverflow('product'); await shot('product');
    await pg.goto(BASE + '#/saved'); await pg.waitForTimeout(200);
    ok(await pg.locator('.card').count() === 1, `${tag} saved page lists it`);
    await pg.reload(); await pg.waitForSelector('.card');
    ok(await pg.locator('.card').count() === 1, `${tag} saved survives reload`);

    // custom order
    await pg.goto(BASE + '#/custom'); await pg.waitForSelector('[data-custom]');
    await pg.click('[data-custom] button[type=submit]'); await pg.waitForTimeout(200);
    ok(await pg.locator('.err').count() >= 3, `${tag} custom: errors shown`);
    await noOverflow('custom-errors'); await shot('custom-errors');
    await pg.click('.radio:has-text("جواهر")'); await pg.click('.radio:has-text("نقره")');
    await pg.fill('textarea[name=idea]', 'گوشوارهٔ نقره با نقش انار');
    await pg.fill('input[name=name]', 'آزمایش'); await pg.fill('input[name=phone]', '۰۹۱۲۰۰۰۰۰۰۰');
    await pg.click('[data-custom] button[type=submit]'); await pg.waitForSelector('.done');
    ok((await pg.locator('.msg').innerText()).includes('تماس: 09120000000'), `${tag} custom: message ready with digits normalised`);
    await noOverflow('custom-done'); await shot('custom-done');

    for (const p of ['about', 'care', 'contact', 'p/nope', 'nope']) { await pg.goto(BASE + '#/' + p); await pg.waitForTimeout(150); await noOverflow(p); }
    await pg.goto(BASE + '#/p/nope'); await pg.waitForTimeout(150);
    ok((await pg.locator('main h1').innerText()) === 'پیدا نشد', `${tag}: missing product → not found page`);

    // preview with a catalog exported from the app (contract v1, photo as data URL), memory only
    if (name === 'laptop' && scheme === 'light') {
      const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const file = { app: 'seenzhin', kind: 'catalog', v: 1, at: new Date().toISOString(), currency: 'IRT', items: [
        { id: 'real1', title: 'اثر از اپ', desc: '', category: 'جواهرات', type: 'گوشواره', material: 'نقره', weight: 8, price: 12000000, availability: 'available', photos: [{ id: 'ph', data: px }] },
        { id: 'real2', title: 'بدون قیمت', desc: '', category: 'تابلوی نقره', type: 'بزرگ', material: 'نقره', weight: null, price: null, availability: 'made-to-order', photos: [] }] };
      await pg.goto(BASE + '#/preview'); await pg.waitForSelector('[data-previewfile]', { state: 'attached' });
      await pg.setInputFiles('[data-previewfile]', { name: 'seenzhin-catalog-2026-11-28.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
      await pg.waitForSelector('.ok-note');
      await pg.click('a[href="#/shop"].btn'); await pg.waitForSelector('.card');
      ok(await pg.locator('.card').count() === 2 && await pg.isVisible('.preview-bar'), `${tag} preview: 2 products from the app file, banner shown`);
      ok((await pg.locator('.card:has-text("بدون قیمت") .price').innerText()) === 'تماس بگیرید', `${tag} preview: no price → «تماس بگیرید»`);
      await shot('preview');
      await pg.goto(BASE + '#/preview');
      await pg.setInputFiles('[data-previewfile]', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...file, v: 2 })) });
      await pg.waitForTimeout(200);
      ok(await pg.locator('#toast.show').count() === 1, `${tag} preview: newer catalog version refused`);
      await pg.reload(); await pg.goto(BASE + '#/shop'); await pg.waitForSelector('.card');
      ok(await pg.locator('.card').count() === 8, `${tag} preview: reload returns to sample`);
    }

    // catalog failure → friendly message with retry
    const ctx2 = await b.newContext({ ...dev, colorScheme: scheme });
    const pg2 = await ctx2.newPage();
    await pg2.route('**/site/data/catalog.json', r => r.fulfill({ status: 500, body: '' }));
    await pg2.goto(BASE); await pg2.waitForSelector('[data-retry]');
    ok(true, `${tag}: catalog failure shows retry`); await ctx2.close();

    ok(!errors.length, `${tag}: no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  await b.close();
})();
