// Money in and out, per Jalali month. Pure functions; every number says what it is made of.
// Decided 1405/09/07: every kind of cost is recorded (Farbod: the most accurate data). Making money (metal, stone,
// workshop, team wages) shows in the month's cash; in profit it counts through the making cost of what was sold,
// so nothing is counted twice. Selling and fixed costs come straight off the month's profit.
import { totals } from './invoice.js';

export const EXP = [
  { id: 'metal', name: 'خرید فلز', group: 'make', hint: 'نقره یا طلا، با گرم' },
  { id: 'stone', name: 'سنگ و قطعه', group: 'make' },
  { id: 'workshop', name: 'رسید کارگاه', group: 'make', hint: 'ریخته‌گری و کارهای کارگاه' },
  { id: 'wages', name: 'دستمزد تیم', group: 'make', monthly: true },
  { id: 'packaging', name: 'بسته‌بندی', group: 'sell' },
  { id: 'shipping', name: 'ارسال', group: 'sell' },
  { id: 'ads', name: 'تبلیغات و عکاسی', group: 'sell' },
  { id: 'rent', name: 'اجاره', group: 'fixed', monthly: true },
  { id: 'bills', name: 'قبض و اینترنت', group: 'fixed', monthly: true },
  { id: 'other', name: 'سایر', group: 'fixed' },
];
export const expOf = id => EXP.find(e => e.id === id) || EXP[EXP.length - 1];
export const GROUP_NAME = { make: 'ساخت', sell: 'فروش و بازاریابی', fixed: 'ثابت و سایر' };

// «1405-09» for any moment, in the Persian calendar.
export function monthKey(ts) {
  const parts = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'numeric' }).formatToParts(new Date(ts));
  const y = parts.find(p => p.type === 'year').value.replace(/\D/g, ''), m = parts.find(p => p.type === 'month').value;
  return `${y}-${String(m).padStart(2, '0')}`;
}
export function shiftMonth(key, n) {
  let [y, m] = key.split('-').map(Number);
  m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
export const monthName = key => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

// A sale counts in the month it was settled. costOf(item, invoice) → making cost, or null when unknown.
export function monthReport(key, invoices, expenses, costOf) {
  const sales = invoices.filter(i => totals(i).status === 'paid' && monthKey(i.paidAt || i.date) === key);
  let revenue = 0, cogs = 0, unknown = 0;
  for (const inv of sales) {
    revenue += totals(inv).total;
    for (const it of inv.items || []) { const c = costOf(it, inv); if (c == null) unknown++; else cogs += c * (it.qty || 1); }
  }
  const mine = expenses.filter(e => monthKey(e.date) === key);
  const by = { make: 0, sell: 0, fixed: 0 };
  for (const e of mine) by[expOf(e.cat).group] += e.amount || 0;
  const overhead = by.sell + by.fixed, gross = revenue - cogs, net = gross - overhead;
  const out = by.make + by.sell + by.fixed;
  // Deposits taken but not yet settled: money in hand that is not yet a sale.
  const held = invoices.filter(i => totals(i).status === 'deposit').reduce((a, i) => a + totals(i).paid, 0);
  return { key, sales, revenue, cogs, unknown, gross, overhead, net, by, expenses: mine, cashIn: revenue, cashOut: out, cash: revenue - out, held };
}

// Metal bought so far: grams, money and the average price per gram (to compare with today's price).
export function metalBought(expenses, metal) {
  const list = expenses.filter(e => e.cat === 'metal' && e.metal === metal && e.grams > 0);
  const grams = list.reduce((a, e) => a + e.grams, 0), spent = list.reduce((a, e) => a + e.amount, 0);
  return { grams, spent, avg: grams ? spent / grams : null, n: list.length };
}

// Monthly costs from last month that this month does not have yet: offered with one tap, never added silently.
export function recurringDue(expenses, key) {
  const prev = shiftMonth(key, -1);
  const now = expenses.filter(e => monthKey(e.date) === key);
  const seen = new Set(now.map(e => e.cat + '|' + (e.note || '').trim()));
  return expenses.filter(e => e.monthly && monthKey(e.date) === prev && !seen.has(e.cat + '|' + (e.note || '').trim()));
}
