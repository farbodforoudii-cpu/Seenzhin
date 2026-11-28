import assert from 'node:assert/strict';
import { defaultSettings } from '../js/model.js';
import { suggestDeposit, orderPrice, orderSettings, refundable, normPhone, customerId, findCustomer, customerStats, orderAlerts, orderProfit } from '../js/orders.js';

// Deposit: the larger of half the estimate and the making cost, rounded up.
assert.deepEqual(suggestDeposit({ complete: true, final: 7200000, cost: 3000000 }), { value: 3600000, half: 3600000, cost: 3000000, by: 'half' });
assert.equal(suggestDeposit({ complete: true, final: 10000000, cost: 6230000 }).value, 6300000);           // heavy metal: cost wins
assert.equal(suggestDeposit({ complete: true, final: 10000000, cost: 6230000 }).by, 'cost');
assert.equal(suggestDeposit({ complete: false }), null);

// Metal locked on the deposit day.
const st = defaultSettings();
st.prices.silver = 100000; st.markup = 2; st.factors.jewelry.designed = 2;
const o = { spec: { cat: 'jewelry', sub: 'انگشتر', level: 'designed', material: 'silver', weight: 10, invoice: 1000000 } };
assert.equal(orderPrice(o, st).final, 10 * 100000 * 2 + 1000000 * 2);
const locked = { ...o, metal: { silver: 80000 } };
assert.equal(orderSettings(st, locked).prices.silver, 80000);
assert.equal(st.prices.silver, 100000);                                                                     // settings untouched
assert.equal(orderPrice(locked, st).final, 10 * 80000 * 2 + 1000000 * 2);

// Refund only before making starts.
assert.equal(refundable({ stage: 'deposit' }), true);
assert.equal(refundable({ stage: 'making' }), false);

// One person, one id, whatever the phone looks like.
assert.equal(normPhone('۰۹۱۲ ۱۲۳ ۴۵۶۷'), '09121234567');
assert.equal(normPhone('+98 912 123 4567'), '09121234567');
assert.equal(normPhone('00989121234567'), '09121234567');
assert.equal(customerId('سارا', '09121234567'), customerId('سارا احمدی', '+989121234567'));
assert.equal(customerId('سارا', ''), customerId(' سارا ', null));
assert.equal(customerId('', ''), null);
const list = [{ id: 'a', name: 'مینا', phone: '09120000000' }, { id: 'b', name: 'سارا' }];
assert.equal(findCustomer(list, 'هر کس', '+989120000000').id, 'a');
assert.equal(findCustomer(list, 'سارا', '').id, 'b');
assert.equal(findCustomer(list, 'نیما', ''), null);

// Customer history from invoices.
const inv = [
  { customerId: 'a', items: [{ price: 5000000 }], paid: 5000000, date: 1, paidAt: 10 },
  { customerId: 'a', items: [{ price: 4000000 }], paid: 1000000, date: 20 },
  { customerId: 'b', items: [{ price: 9 }], paid: 9, date: 5 },
];
const cs = customerStats({ id: 'a' }, inv, [{ customerId: 'a', stage: 'making' }, { customerId: 'a', stage: 'done' }]);
assert.equal(cs.bought, 5000000); assert.equal(cs.n, 1); assert.equal(cs.owed, 3000000); assert.equal(cs.last, 10); assert.equal(cs.open, 1);

// Follow-up order: ready first, then late, then soon; finished ones never.
const D = 864e5, now = 100 * D;
const al = orderAlerts([
  { id: 1, stage: 'making', due: now + 2 * D }, { id: 2, stage: 'making', due: now - D }, { id: 3, stage: 'ready' },
  { id: 4, stage: 'done', due: now - D }, { id: 5, stage: 'request', due: now + D }, { id: 6, stage: 'making', due: now + 9 * D },
], now);
assert.deepEqual(al.map(a => a.o.id), [3, 2, 1]);

// Profit after delivery: items − discount − making cost.
const pr = orderProfit(o, st, { items: [{ price: 4500000 }], discount: 100000, shipping: 200000 });
assert.deepEqual(pr, { sale: 4400000, cost: 2000000, profit: 2400000 });
console.log('orders ok');
