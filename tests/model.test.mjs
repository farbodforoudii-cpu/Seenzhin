import assert from 'node:assert/strict';
import { defaultSettings, price, drifted, setupSteps } from '../js/model.js';

const st = defaultSettings();
const ring = { cat: 'jewelry', sub: 'انگشتر', level: 'designed', material: 'silver', weight: 12, stone: 500000, invoice: 1500000, status: 'available' };

// empty settings: nothing invented, everything missing is listed
let r = price(ring, st);
assert.equal(r.complete, false);
for (const k of ['price:silver', 'factor:jewelry:designed']) assert.ok(r.missing.some(m => m.key === k), k);

st.prices.silver = 100000; st.factors.jewelry.designed = 2.5;
r = price(ring, st);
assert.equal(r.complete, false);
assert.ok(r.missing.some(m => m.key === 'markup'));          // metal + stone need the material factor
st.markup = 1.3;
r = price(ring, st);
assert.equal(r.cost, 1200000 + 500000 + 1500000);
assert.equal(r.materialPart, 1700000 * 1.3);                 // 2,210,000
assert.equal(r.workPart, 1500000 * 2.5);                     // 3,750,000
assert.equal(r.final, 5960000);
st.rounding = 100000;
assert.equal(price(ring, st).final, 6000000);                // rounded up

// gold example from the decision: 20M metal, 2M workshop, ×1.3 and ×2.5 -> 31M
st.prices.gold = 2000000; st.rounding = 0;
assert.equal(price({ ...ring, material: 'gold', weight: 10, stone: null, invoice: 2000000 }, st).final, 31000000);

// bronze: metal inside the invoice, no material factor needed
st.markup = null; st.factors.volume.special = 3;
r = price({ cat: 'statue', level: 'special', material: 'bronze', invoice: 10000000 }, st);
assert.equal(r.final, 30000000);
st.markup = 1.3;

// drift: approved price differs after silver price change; sold items never drift
const p1 = { ...ring, id: 'a', approved: { price: 5960000 } };
const p2 = { ...ring, id: 'b', status: 'sold', approved: { price: 1 } };
assert.equal(drifted([p1, p2], st).length, 0);
st.prices.silver = 150000;
const d = drifted([p1, p2], st);
assert.equal(d.length, 1);
assert.equal(d[0].to, Math.round((1800000 + 500000) * 1.3 + 3750000));
assert.equal(setupSteps(st, []).filter(s => s.done).length, 3);
console.log('model ok');

// team hours: hand-built panel without a workshop invoice (illustrative numbers)
{
  const s2 = defaultSettings();
  Object.assign(s2, { markup: 2.5, rounding: 1000000, teamHourly: 400000 });
  s2.prices.silver = 444730; s2.factors.panel.special = 4;
  const panel = { cat: 'panel', sub: 'بزرگ', level: 'special', material: 'silver', weight: 100 };
  assert.ok(price(panel, s2).missing.some(m => m.key === 'invoice'));         // neither invoice nor hours yet
  const r2 = price({ ...panel, hours: 40 }, s2);
  assert.equal(r2.labour, 16000000);
  assert.equal(r2.final, 176000000);                                           // 100g×444,730×2.5 + 40h×400k×4 → up to 1M
  s2.teamHourly = null;
  assert.ok(price({ ...panel, hours: 40 }, s2).missing.some(m => m.key === 'hourly'));
  console.log('team hours ok');
}
