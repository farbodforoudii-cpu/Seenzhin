import assert from 'node:assert/strict';
import { monthKey, shiftMonth, monthName, monthReport, metalBought, recurringDue } from '../js/money.js';

// 1405/09/07 = 2026-11-28
const T = Date.UTC(2026, 10, 28, 9), D = 864e5;
assert.equal(monthKey(T), '1405-09');
assert.equal(shiftMonth('1405-01', -1), '1404-12');
assert.equal(shiftMonth('1405-12', 1), '1406-01');
assert.equal(monthName('1405-09'), 'آذر 1405');

const inv = [
  { items: [{ productId: 'a', price: 10000000, cost: 4000000 }], shipping: 200000, paid: 10200000, date: T, paidAt: T },   // settled this month
  { items: [{ title: 'دستی', price: 3000000 }], paid: 3000000, date: T, paidAt: T },                                          // cost unknown
  { items: [{ price: 8000000 }], paid: 2000000, date: T },                                                                     // deposit only
  { items: [{ price: 5000000, cost: 1 }], paid: 5000000, date: T - 40 * D, paidAt: T - 40 * D },                              // last month
];
const exp = [
  { cat: 'metal', metal: 'silver', grams: 100, amount: 15000000, date: T },
  { cat: 'workshop', amount: 2000000, date: T },
  { cat: 'packaging', amount: 300000, date: T },
  { cat: 'rent', amount: 5000000, date: T - 20 * D, monthly: true, note: 'کارگاه' },
  { cat: 'bills', amount: 400000, date: T - 20 * D, monthly: true },
  { cat: 'bills', amount: 450000, date: T, monthly: true },
];
const R = monthReport('1405-09', inv, exp, it => it.cost ?? null);
assert.equal(R.revenue, 13200000);                 // two settled sales, shipping included
assert.equal(R.cogs, 4000000); assert.equal(R.unknown, 1);
assert.equal(R.gross, 9200000);
assert.deepEqual(R.by, { make: 17000000, sell: 300000, fixed: 450000 });
assert.equal(R.overhead, 750000);
assert.equal(R.net, 8450000);                      // making money is NOT subtracted again (it is in cogs)
assert.equal(R.cashOut, 17750000); assert.equal(R.cash, 13200000 - 17750000);
assert.equal(R.held, 2000000);

assert.deepEqual(metalBought(exp, 'silver'), { grams: 100, spent: 15000000, avg: 150000, n: 1 });
assert.equal(metalBought(exp, 'gold').avg, null);
// rent from last month is offered again; bills already entered this month are not
assert.deepEqual(recurringDue(exp, '1405-09').map(e => e.cat), ['rent']);
console.log('money ok');
