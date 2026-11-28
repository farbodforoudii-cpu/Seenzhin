// Scheduled website sync: server source → the app's own catalog rules → catalog v1 (site/tools/sync-catalog.mjs).
import assert from 'node:assert/strict';
import { buildCatalog } from '../site/tools/sync-catalog.mjs';

const px = 'data:image/jpeg;base64,/9j/2Q==';
const src = { app: 'seenzhin', kind: 'site-source', v: 1, suppliers: { silver: 'self', bronze: 'workshop' },
  products: [
    { id: 'e1', title: 'شکوفه', desc: '', cat: 'jewelry', sub: 'گوشواره', material: 'silver', weight: 10, photos: ['ph1', 'missing'], onSite: true, approved: { price: 12000000 }, stock: null, status: 'available' },
    { id: 's1', title: 'قو', cat: 'statue', sub: 'مجسمه', material: 'bronze', weight: 3000, photos: [], onSite: true, approved: { price: 54000000 }, stock: 1, stockAt: 0, status: 'available' },
    { id: 'n1', title: 'بی‌قیمت', cat: 'jewelry', sub: 'انگشتر', material: 'silver', weight: 7, photos: [], onSite: true, approved: undefined, stock: null, status: 'available' },
  ],
  sales: [{ productId: 's1', qty: 1, paid: true, at: 10 }],
  photos: { ph1: px } };
const cat = buildCatalog(src, new Date('2026-11-28T10:00:00Z'));
assert.equal(cat.app, 'seenzhin'); assert.equal(cat.kind, 'catalog'); assert.equal(cat.v, 1); assert.equal(cat.currency, 'IRT');
const [e1, s1, n1] = cat.items;
assert.deepEqual(e1, { id: 'e1', title: 'شکوفه', desc: '', category: 'جواهرات', type: 'گوشواره', material: 'نقره', weight: 10, price: 12000000, availability: 'available', photos: [{ id: 'ph1', data: px }] });
assert.equal(s1.weight, null);                      // bronze is the workshop's metal: no weight on the site
assert.equal(s1.availability, 'made-to-order');     // its one piece is sold → made to order
assert.equal(n1.price, null);                       // no approved price → «تماس بگیرید», never a computed one
assert.throws(() => buildCatalog({ kind: 'x' }));
console.log('site sync ok');
