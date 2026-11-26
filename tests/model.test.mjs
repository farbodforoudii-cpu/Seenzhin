import assert from 'node:assert/strict';
import { defaultSettings, price, drifted, setupSteps } from '../js/model.js';

const st = defaultSettings();
const ring = { cat: 'jewelry', sub: 'انگشتر', level: 'designed', material: 'silver', weight: 12, stone: 500000, invoice: 1500000, status: 'available' };

// empty settings: nothing invented, everything missing is listed
let r = price(ring, st);
assert.equal(r.complete, false);
assert.ok(r.missing.some(m => m.key === 'price:silver'));
assert.ok(r.missing.some(m => m.key === 'factor:jewelry:designed'));

st.prices.silver = 100000; st.factors.jewelry.designed = 2.5;
r = price(ring, st);
assert.equal(r.cost, 12 * 100000 + 500000 + 1500000);       // 3,200,000
assert.equal(r.final, 8000000);                             // × 2.5
st.rounding = 1000000;
st.factors.jewelry.designed = 2.4;
assert.equal(price(ring, st).final, 8000000);               // 7,680,000 rounded up

// bronze: metal inside the invoice, no weight needed
st.factors.volume.special = 3;
r = price({ cat: 'statue', level: 'special', material: 'bronze', invoice: 10000000 }, st);
assert.equal(r.final, 30000000);

// drift: approved price differs after silver price change; sold items never drift
const p1 = { ...ring, id: 'a', approved: { price: 8000000 } };
const p2 = { ...ring, id: 'b', status: 'sold', approved: { price: 8000000 } };
assert.equal(drifted([p1, p2], st).length, 0);
st.prices.silver = 150000;
const d = drifted([p1, p2], st);
assert.equal(d.length, 1); assert.equal(d[0].to, 10000000);   // 3.8M × 2.4 = 9.12M, rounded up to 10M
console.log('ok', d[0].to, setupSteps(st, []).map(s => s.done));
