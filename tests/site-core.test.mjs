// Website core (site/js/catalog.js): data cleaning, filters, messages, links, routes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalize, filterItems, categoriesOf, related, specs, orderMessage, customRequest, waLink, igLink,
  parseRoute, shopHash, shortPrice, toman, catSlug,
} from '../site/js/catalog.js';
import { defaultSettings } from '../js/model.js';
import { siteCatalog, catalogFile } from '../js/site.js';
import { catalogOk } from '../site/js/catalog.js';

// The app's public catalog is accepted as is (contract between app and site).
const st = defaultSettings(); st.prices.silver = 100000;
const fromApp = siteCatalog([{ id: 'a', cat: 'jewelry', sub: 'گوشواره', level: 'designed', material: 'silver', weight: 8, invoice: 1, stone: 0,
  title: 'شکوفه', desc: 'دست‌ساز', photos: ['x.jpg'], onSite: true, approved: { price: 12000000 } }], st, () => ({ left: 1 }));
const n0 = normalize({ items: fromApp });
assert.equal(n0.length, 1);
assert.deepEqual({ ...n0[0], order: undefined }, { id: 'a', title: 'شکوفه', desc: 'دست‌ساز', category: 'جواهرات', type: 'گوشواره', material: 'نقره',
  weight: 8, price: 12000000, availability: 'available', photos: ['x.jpg'], order: undefined });

// The exported file (contract v1): photos as { id, data }, later { id, url }.
const file = catalogFile(fromApp, { 'x.jpg': 'data:image/jpeg;base64,AAAA' }, new Date('2026-11-28T09:00:00Z'));
assert.ok(catalogOk(file));
assert.deepEqual(normalize(file)[0].photos, ['data:image/jpeg;base64,AAAA']);
assert.deepEqual(normalize({ ...file, items: [{ ...file.items[0], photos: [{ id: 'a', url: 'https://cdn/a.jpg' }, { id: 'b' }, { id: 'c', url: 'javascript:alert(1)' }] }] })[0].photos, ['https://cdn/a.jpg']);
// Anything that is not a Seenzhin v1 catalog in tomans is refused, not shown wrongly.
for (const bad of [{ ...file, v: 2 }, { ...file, app: 'hesab' }, { ...file, kind: 'request' }, { ...file, currency: 'USD' }, { items: 3 }, null, 'x']) {
  assert.equal(catalogOk(bad), false); assert.equal(normalize(bad).length, 0);
}

// Malformed rows are dropped, duplicates removed, unknown availability → made to order.
const items = normalize([
  { id: 1, title: 'الف', category: 'جواهرات', type: 'گوشواره', price: 20000000, availability: 'available', photos: ['a', 3, ''] },
  { id: 2, title: 'ب', category: 'جواهرات', type: 'انگشتر', price: 9000000, availability: 'weird' },
  { id: 3, title: 'تابلو کوه', category: 'تابلوی نقره', price: 0, availability: 'available' },
  { id: 4, title: '' }, null, { id: 1, title: 'تکراری' },
  { id: 5, title: 'قو', category: 'تندیس و مجسمه', desc: 'برنز', price: 50000000, availability: 'made-to-order' },
]);
assert.deepEqual(items.map(p => p.id), ['1', '2', '3', '5']);
assert.deepEqual(items[0].photos, ['a']);
assert.equal(items[1].availability, 'made-to-order');
assert.equal(items[2].price, null);
assert.equal(normalize(null).length, 0);
assert.equal(normalize({ nope: 1 }).length, 0);

// Filters and sort; items without a price always go last.
assert.deepEqual(filterItems(items, { cat: 'jewelry' }).map(p => p.id), ['1', '2']);
assert.deepEqual(filterItems(items, { avail: 'available' }).map(p => p.id), ['1', '3']);
assert.deepEqual(filterItems(items, { sort: 'cheap' }).map(p => p.id), ['2', '1', '5', '3']);
assert.deepEqual(filterItems(items, { sort: 'dear' }).map(p => p.id), ['5', '1', '2', '3']);
assert.deepEqual(filterItems(items, { q: 'كوه' }).map(p => p.id), ['3']);       // Arabic kaf still finds کوه
assert.deepEqual(filterItems(items, { q: 'برنز' }).map(p => p.id), ['5']);      // description is searched
assert.deepEqual(filterItems(items, { q: 'نیست' }), []);
assert.equal(catSlug('دسته‌ای تازه'), 'دسته‌ای تازه');

assert.deepEqual(categoriesOf(items).map(c => [c.slug, c.count]), [['jewelry', 2], ['panel', 1], ['statue', 1]]);
assert.deepEqual(related(items, items[0]).map(p => p.id)[0], '2');               // same category first
assert.ok(!related(items, items[0]).some(p => p.id === '1'));

// Specs: silver is shown as 925; unknown fields left out.
const sp = specs({ ...items[0], material: 'نقره', weight: 9.5 });
assert.deepEqual(sp.map(s => s[0]), ['دسته', 'فلز', 'وزن تقریبی']);   // availability has its own line above
assert.equal(sp[1][1], 'نقرهٔ ۹۲۵');
assert.ok(sp[2][1].includes('۹٫۵'));
assert.deepEqual(specs(items[2]).map(s => s[0]), ['دسته']);

// Prices: Persian digits, wrapped in isolates (Safari number+unit bug).
assert.equal(toman(12500000), '⁦۱۲٬۵۰۰٬۰۰۰⁩ تومان');
assert.equal(shortPrice(12500000), '⁦۱۲٫۵⁩ میلیون تومان');
assert.equal(shortPrice(118000000), '⁦۱۱۸⁩ میلیون تومان');
assert.equal(shortPrice(1250000000), '⁦۱٫۲۵⁩ میلیارد تومان');
assert.equal(shortPrice(null), '');

// Order message carries name, price and product code.
const m = orderMessage(items[1], 'https://x/#/p/2');
assert.ok(m.includes('«ب»') && m.includes('سفارش ساخت') && m.includes('۹٬۰۰۰٬۰۰۰') && m.includes('کد محصول: 2') && m.endsWith('https://x/#/p/2'));
assert.ok(!orderMessage(items[0]).includes('سفارش ساخت'));

// Custom order: validation and message.
let r = customRequest({});
assert.equal(r.ok, false);
assert.deepEqual(Object.keys(r.errors).sort(), ['idea', 'kind', 'name', 'phone']);
r = customRequest({ name: 'سارا', kind: 'جواهر', idea: 'گوشوارهٔ نقره با نقش انار', phone: '۰۹۱۲ ۱۲۳ ۴۵۶۷', metal: 'نقره', budget: 'تا ۲۰ میلیون' });
assert.equal(r.ok, true);
assert.ok(r.message.includes('تماس: 09121234567') && r.message.includes('فلز: نقره') && r.message.includes('نوع: جواهر'));
// …and the request record for the app (contract §2) is ready for when the server exists.
assert.equal(r.request.kind, 'request'); assert.equal(r.request.v, 1); assert.equal(r.request.type, 'custom');
assert.equal(r.request.phone, '09121234567'); assert.equal(r.request.productId, null);
assert.ok(r.request.message.includes('طرح: گوشوارهٔ نقره با نقش انار') && !isNaN(Date.parse(r.request.createdAt)) && r.request.id);
assert.equal(customRequest({}).request, null);
r = customRequest({ name: 'سارا', kind: 'جواهر', idea: 'گوشوارهٔ نقره با نقش انار', insta: '@sara' });
assert.equal(r.ok, true); assert.ok(r.message.includes('اینستاگرام: @sara'));
assert.equal(customRequest({ name: 'x', kind: 'جواهر', idea: 'یک طرح بلند کافی', phone: '12' }).errors.phone, 'شماره درست به نظر نمی‌رسد.');

// Contact links.
assert.equal(waLink('09121234567', 'سلام'), 'https://wa.me/989121234567?text=%D8%B3%D9%84%D8%A7%D9%85');
assert.equal(waLink('+44 7700 900123'), 'https://wa.me/447700900123');
assert.equal(waLink('0049 151 1234'), 'https://wa.me/491511234');
assert.equal(waLink(''), '');
assert.equal(igLink('@seenzhin'), 'https://instagram.com/seenzhin');
assert.equal(igLink(''), '');

// Routes.
assert.deepEqual(parseRoute(''), { page: 'home', query: {} });
assert.deepEqual(parseRoute('#/shop?cat=panel&sort=cheap'), { page: 'shop', query: { cat: 'panel', sort: 'cheap' } });
assert.deepEqual(parseRoute('#/p/s%2001'), { page: 'product', id: 's 01', query: {} });
assert.equal(parseRoute('#/p').page, 'notfound');
assert.equal(parseRoute('#/nope').page, 'notfound');
assert.equal(shopHash({ cat: 'panel', sort: 'new', q: '' }), '#/shop?cat=panel');
assert.equal(shopHash({}), '#/shop');

// The sample catalog in the repo is valid and marked as sample (never real prices in the repo).
const sample = JSON.parse(readFileSync(new URL('../site/data/catalog.json', import.meta.url)));
assert.equal(sample.sample, true);
assert.ok(catalogOk(sample) && sample.app === 'seenzhin' && sample.v === 1);
assert.equal(normalize(sample).length, sample.items.length);
console.log('site core ok');
