import assert from 'node:assert/strict';
import { defaultSettings } from '../js/model.js';
import { analyse, suggestInvoice, marketGap } from '../js/analysis.js';

const st = defaultSettings();
st.prices.silver = 100000; st.markup = 1.5; st.factors.jewelry.designed = 2; st.factors.jewelry.simple = 2;
const now = Date.UTC(2026, 10, 26), D = 864e5;
const base = { cat: 'jewelry', sub: 'انگشتر', level: 'designed', material: 'silver', weight: 10, invoice: 1000000 };
const P = [
  { ...base, id: 'a', status: 'available', approved: { price: 3500000 } },          // cost 2M
  { ...base, id: 'b', status: 'sold', soldAt: now - 2 * D, createdAt: now - 12 * D, approved: { price: 3500000 } },
  { ...base, id: 'c', status: 'available', invoice: 3000000, approved: null },      // computed: 1.5M + 6M = 7.5M
];
const A = analyse(P, st, now);
assert.equal(A.value, 3500000 + 7500000);
assert.equal(A.cost, 2000000 + 4000000);
assert.equal(A.sold30, 1); assert.equal(A.revenue30, 3500000); assert.equal(A.daysToSell, 10);
assert.equal(A.metals[0].grams, 20); assert.equal(A.metals[0].impact10, 20 * 100000 * 0.1 * 1.5);
assert.equal(A.ladder.find(l => l.id === 'jewelry').broken, true);          // simple == designed
assert.deepEqual(suggestInvoice(P, { cat: 'jewelry', sub: 'انگشتر', level: 'designed' }), { value: 1000000, n: 3, basis: 'هم‌نوع و هم‌سطح' });
assert.equal(suggestInvoice(P, { cat: 'jewelry', sub: 'انگشتر', level: 'special' }).basis, 'هم‌نوع'); // falls back to the same type
assert.equal(suggestInvoice(P, { sub: 'انگشتر' }), null);                     // no category, no guess
assert.equal(marketGap(st, { silver: { p: 105000 } })[0].pct.toFixed(2), '0.05');
assert.equal(marketGap(st, { silver: { p: 101000 } }).length, 0);           // under 2%: no nagging
console.log('analysis ok');

// casting estimate: weight × fee + median of the workshop's other jobs from real invoices (illustrative numbers)
{
  const s3 = defaultSettings(); s3.castPerGram = 50000;
  const P2 = [{ id: 'a', cat: 'jewelry', sub: 'گوشواره', material: 'silver', weight: 13, invoice: 3000000 }, { id: 'b', cat: 'jewelry', sub: 'سنجاق', material: 'silver', weight: 20, invoice: 3000000 }];
  const sg = suggestInvoice(P2, { cat: 'jewelry', sub: 'گوشواره', material: 'silver', weight: 14 }, s3);
  assert.equal(sg.basis, 'ریخته‌گری'); assert.equal(sg.casting, 700000); assert.equal(sg.extra, 2175000); assert.equal(sg.value, 2880000);
  assert.notEqual(suggestInvoice(P2, { cat: 'panel', sub: 'بزرگ', material: 'silver', weight: 100 }, s3)?.basis, 'ریخته‌گری'); // panels are hand-built
  console.log('casting estimate ok');
}
