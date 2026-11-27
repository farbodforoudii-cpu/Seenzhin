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
  assert.ok(price(panel, s2).missing.some(m => m.key === 'invoice'));         // nothing entered yet
  const r2 = price({ ...panel, hours: 40 }, s2);
  assert.equal(r2.labour, 16000000);
  assert.equal(r2.final, 176000000);                                           // 100g×444,730×2.5 + 40h×400k×4 → up to 1M
  s2.teamHourly = null;
  assert.ok(price({ ...panel, hours: 40 }, s2).missing.some(m => m.key === 'hourly'));
  console.log('team hours ok');
}

// one «هزینهٔ ساخت» field; when empty, casting (weight × fee) + team hours × rate
{
  const s4 = defaultSettings();
  Object.assign(s4, { markup: 2, rounding: 0, castPerGram: 50000, teamHourly: 400000 });
  s4.prices.silver = 400000; s4.factors.jewelry.designed = 2.5;
  const ear = { cat: 'jewelry', sub: 'گوشواره', level: 'designed', material: 'silver', weight: 10 };
  assert.ok(price(ear, s4).missing.some(m => m.key === 'invoice'));             // nothing entered yet
  const r = price({ ...ear, hours: 5 }, s4);
  assert.equal(r.casting, 500000); assert.equal(r.labour, 2000000);
  assert.equal(r.final, 10 * 400000 * 2 + (500000 + 2000000) * 2.5);           // 8M + 6.25M
  const typed = price({ ...ear, invoice: 3000000, hours: 5 }, s4);              // a typed figure is the whole work cost
  assert.equal(typed.casting, 0); assert.equal(typed.labour, 0); assert.equal(typed.work, 3000000);
  const bronze = price({ cat: 'statue', sub: 'مجسمه', level: 'special', material: 'bronze', hours: 5 }, { ...s4, factors: { ...s4.factors, volume: { simple: 2, designed: 3, special: 4 } } });
  assert.ok(bronze.missing.some(m => m.key === 'invoice'));                     // bronze: the workshop's figure is needed
  console.log('work cost ok');
}

// a final price typed by hand wins and never drifts; the formula price stays beside it
{
  const s5 = defaultSettings(); Object.assign(s5, { markup: 2, rounding: 0 }); s5.prices.silver = 400000; s5.factors.jewelry.designed = 2.5;
  const p = { id: 'x', cat: 'jewelry', sub: 'انگشتر', level: 'designed', material: 'silver', weight: 7, invoice: 2000000, status: 'available' };
  const r = price({ ...p, finalPrice: 7300000 }, s5);
  assert.equal(r.final, 7300000); assert.equal(r.formulaFinal, 7 * 400000 * 2 + 2000000 * 2.5); assert.equal(r.manualFinal, true);
  s5.prices.silver = 500000;
  assert.equal(drifted([{ ...p, finalPrice: 7300000, approved: { price: 7300000 } }], s5).length, 0);
  console.log('manual final ok');
}

// Ready units come from invoices: paid after stockAt sells one, an open invoice holds one.
{
  const { unitsOf } = await import('../js/model.js');
  const paid = i => i.paid >= 10;
  const inv = [{ items: [{ productId: 'x', price: 10 }], paid: 10, paidAt: 200 }, { items: [{ productId: 'x', price: 10 }], paid: 2, date: 300 },
    { items: [{ productId: 'x', price: 8 }], paid: 10, paidAt: 50 }];
  const u = unitsOf({ id: 'x', stock: 3, stockAt: 100 }, inv, paid);
  assert.equal(u.left, 1); assert.equal(u.held, 1); assert.equal(u.soldAll, 2); assert.equal(u.status, 'available');
  assert.equal(unitsOf({ id: 'x', stock: 2, stockAt: 100 }, inv, paid).status, 'reserved');
  assert.equal(unitsOf({ id: 'y', status: 'sold' }, inv, paid).status, 'sold');           // old product marked sold
  assert.equal(unitsOf({ id: 'x', status: 'sold' }, inv.slice(0, 1), paid).left, 0);     // old sale: one piece, sold
  assert.equal(unitsOf({ id: 'z', status: 'available' }, [], paid).left, 1);            // old product: one piece
  assert.equal(unitsOf({ id: 'r', status: 'reserved' }, [], paid).status, 'reserved');  // old manual reservation
  console.log('units ok');
}

// Status is never fed back: an old product whose invoice was deleted is one ready piece again.
{
  const { unitsOf } = await import('../js/model.js');
  const paid = i => i.paid >= 10;
  assert.equal(unitsOf({ id: 'a', status: 'available' }, [{ items: [{ productId: 'a', price: 5 }], paid: 1 }], paid).status, 'reserved');
  assert.equal(unitsOf({ id: 'a', status: 'available' }, [], paid).status, 'available');
  assert.equal(unitsOf({ id: 'r', status: 'reserved' }, [{ items: [{ productId: 'r', price: 5 }], paid: 10, paidAt: 1 }], paid).status, 'sold'); // old reservation, then paid
  console.log('units feedback ok');
}
