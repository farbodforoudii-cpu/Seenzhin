import assert from 'node:assert/strict';
import { defaultSettings } from '../js/model.js';
import { siteMissing, siteCatalog } from '../js/site.js';

const st = defaultSettings();
st.prices.silver = 100000; st.markup = 2; st.factors.jewelry.designed = 2;
const base = { cat: 'jewelry', sub: 'گوشواره', level: 'designed', material: 'silver', weight: 8, invoice: 1000000, stone: 500000 };
const ready = { ...base, id: 'a', title: 'شکوفه', desc: 'گوشوارهٔ دست‌ساز', photos: ['ph1'], onSite: true, approved: { price: 12000000 } };
assert.deepEqual(siteMissing(ready, st), []);
assert.deepEqual(siteMissing({ ...base, title: '', photos: [] }, st), ['عکس', 'توضیح کوتاه فروش', 'نام']);
const cat = siteCatalog([ready, { ...ready, id: 'b', onSite: false }], st, () => ({ left: 0 }));
assert.equal(cat.length, 1);                                                    // only marked products
assert.equal(cat[0].availability, 'made-to-order');                             // none ready → made to order
assert.equal(cat[0].price, 12000000);
// Nothing private leaves the app.
for (const k of ['invoice', 'stone', 'level', 'approved', 'stock', 'finalPrice', 'hours', 'cost']) assert.ok(!(k in cat[0]), k + ' must not be public');
assert.deepEqual(Object.keys(cat[0]).sort(), ['availability', 'category', 'desc', 'id', 'material', 'photos', 'price', 'title', 'type', 'weight']);
console.log('site ok');
