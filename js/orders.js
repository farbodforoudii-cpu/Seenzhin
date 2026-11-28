// Custom orders and customers. Pure functions, so the rules can be tested and every number explained.
import { price } from './model.js';
import { totals } from './invoice.js';

// The road of a custom order. «لغو شد» can happen at any point before delivery.
export const STAGES = [
  { id: 'request', name: 'درخواست', hint: 'قیمت برآوردی داده شد' },
  { id: 'deposit', name: 'بیعانه', hint: 'بیعانه گرفته شد' },
  { id: 'making', name: 'در ساخت', hint: 'ساخت شروع شد' },
  { id: 'ready', name: 'آماده', hint: 'وزن واقعی ثبت شد' },
  { id: 'done', name: 'تحویل شد', hint: 'تسویه و تحویل' },
];
export const STAGE_NAME = Object.fromEntries([...STAGES.map(s => [s.id, s.name]), ['cancelled', 'لغو شد']]);
export const isOpen = o => o.stage !== 'done' && o.stage !== 'cancelled';

// Decided 1405/09/07: the deposit comes back only while making has not started.
export const refundable = o => o.stage === 'request' || o.stage === 'deposit';
export const TERMS = 'بیعانه تا پیش از شروع ساخت کامل برمی‌گردد؛ پس از شروع ساخت برنمی‌گردد. قیمت نهایی با وزن واقعی و قیمت فلزِ روز بیعانه حساب می‌شود.';

// Metal is bought the day the deposit comes in, so from then on the order is priced with that day's metal.
export const orderSettings = (st, o) => (o.metal ? { ...st, prices: { ...st.prices, ...o.metal } } : st);
export const orderPrice = (o, st) => price(o.spec || {}, orderSettings(st, o));

// Deposit = the larger of half the estimate and the whole making cost (metal + stone + work), rounded up.
// If the customer walks away after making starts, Seenzhin never carries the cost.
export function suggestDeposit(r, step = 100000) {
  if (!r || !r.complete) return null;
  const half = r.final / 2, cost = r.cost || 0;
  const by = cost > half ? 'cost' : 'half';
  const s = step || 10000;
  return { value: Math.ceil(Math.max(half, cost) / s) * s, half, cost, by };
}

// After delivery: what was sold (items, without shipping), what it cost, what stayed.
export function orderProfit(o, st, inv) {
  if (!inv) return null;
  const sale = (inv.items || []).reduce((a, it) => a + (it.price || 0) * (it.qty || 1), 0) - (inv.discount || 0);
  const cost = o.stage === 'cancelled' ? (o.spentCost ?? null) : orderPrice(o, st).cost;
  return { sale, cost, profit: cost == null ? null : sale - cost };
}

// Phone numbers in any form (۰۹۱۲…، +98912…، 0098 912…) become one key: 09121234567.
export function normPhone(p) {
  let d = String(p || '').replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, '');
  if (d.startsWith('0098')) d = '0' + d.slice(4); else if (d.startsWith('98') && d.length === 12) d = '0' + d.slice(2);
  else if (d.length === 10 && d.startsWith('9')) d = '0' + d;
  return d;
}
const normName = n => String(n || '').trim().replace(/\s+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase();
// Same person on both phones → same id, so two phones never create two copies of one customer.
export function customerId(name, phone) {
  const k = normPhone(phone) || normName(name);
  if (!k) return null;
  let h = 2166136261;
  for (const ch of k) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return 'c' + h.toString(36);
}
// An existing customer for these details: same phone first, then same name.
export function findCustomer(list, name, phone) {
  const ph = normPhone(phone), nm = normName(name);
  return (ph && list.find(c => normPhone(c.phone) === ph)) || (nm && list.find(c => normName(c.name) === nm)) || null;
}

// What a customer has done with Seenzhin: paid total, how many purchases, last one, still owed.
export function customerStats(c, invoices, orders) {
  const mine = invoices.filter(i => i.customerId === c.id);
  let bought = 0, owed = 0, last = 0, n = 0;
  for (const i of mine) {
    const t = totals(i);
    if (t.status === 'paid') { bought += t.total; n++; last = Math.max(last, i.paidAt || i.date); }
    else owed += t.remaining;
  }
  const open = orders.filter(o => o.customerId === c.id && isOpen(o)).length;
  return { invoices: mine, bought, n, last: last || null, owed, open };
}

// Follow-up for «کارهای امروز»: ready but not delivered, then late, then due within three days.
export function orderAlerts(orders, now = Date.now()) {
  const D = 864e5, out = [];
  for (const o of orders.filter(isOpen)) {
    if (o.stage === 'ready') out.push({ o, kind: 'ready', rank: 0 });
    else if (o.due && o.due < now) out.push({ o, kind: 'late', rank: 1, days: Math.ceil((now - o.due) / D) });
    else if (o.due && o.due - now <= 3 * D && o.stage !== 'request') out.push({ o, kind: 'soon', rank: 2, days: Math.max(0, Math.ceil((o.due - now) / D)) });
  }
  return out.sort((a, b) => a.rank - b.rank || (a.o.due || 0) - (b.o.due || 0));
}
