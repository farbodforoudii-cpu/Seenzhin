// Analysis for Servin. Pure functions; every number returned with what it is made of, so the UI can explain it.
import { CATEGORIES, LEVELS, FORMULAS, price, supplierOf, drifted } from './model.js';

const DAY = 864e5;
export const shownPrice = (p, st) => (p.approved ? p.approved.price : price(p, st).final);
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function analyse(products, st, now = Date.now()) {
  const stock = products.filter(p => p.status !== 'sold');
  const sold = products.filter(p => p.status === 'sold');

  // Stock value: sum of the prices customers see; cost: what was paid (metal at today's price + stone + workshop).
  let value = 0, cost = 0, priced = 0, vWithCost = 0;
  for (const p of stock) {
    const v = shownPrice(p, st), c = price(p, st).cost;
    if (v != null) { value += v; priced++; }
    if (v != null && c != null) { cost += c; vWithCost += v; }
  }

  // Per category (stock and sales together tell what moves).
  const cats = CATEGORIES.map(c => {
    const inStock = stock.filter(p => p.cat === c.id);
    const ratios = inStock.map(p => { const v = shownPrice(p, st), k = price(p, st).cost; return v && k ? v / k : null; }).filter(x => x != null);
    const s30 = sold.filter(p => p.cat === c.id && p.soldAt && now - p.soldAt <= 30 * DAY);
    return { ...c, stock: inStock.length, sold30: s30.length, revenue30: s30.reduce((a, p) => a + (p.approved ? p.approved.price : 0), 0), ratio: median(ratios) };
  });

  // Sales in the last 30 days and how long pieces take to sell (sold date − date added).
  const s30 = sold.filter(p => p.soldAt && now - p.soldAt <= 30 * DAY);
  const days = sold.filter(p => p.soldAt && p.createdAt && p.soldAt >= p.createdAt).map(p => (p.soldAt - p.createdAt) / DAY);

  // Metal held in stock and what a 10% rise in its price does to stock value (grams × price × 10% × material factor).
  const metals = ['silver', 'gold'].map(m => {
    const grams = stock.filter(p => p.material === m && supplierOf(st, m) === 'self').reduce((a, p) => a + (p.weight || 0), 0);
    const g = st.prices[m];
    return { id: m, grams, impact10: grams && g && st.markup ? grams * g * 0.1 * st.markup : null };
  }).filter(x => x.grams > 0);

  // Price ladder: within each formula, a higher level must carry a higher factor, or customers see no reason to pay more.
  const ladder = Object.entries(FORMULAS).map(([fid, f]) => {
    const vals = LEVELS.map(l => ({ level: l, v: st.factors[fid][l.id] }));
    const set = vals.filter(x => x.v != null);
    const broken = set.some((x, i) => i && x.v <= set[i - 1].v);
    return { id: fid, name: f.name, vals, broken };
  });

  // Products that cannot be priced yet, with the first thing they miss.
  const incomplete = stock.map(p => ({ p, r: price(p, st) })).filter(x => !x.r.complete);

  return {
    stockCount: stock.length, priced, value, cost, margin: vWithCost ? (vWithCost - cost) / vWithCost : null,
    cats, sold30: s30.length, revenue30: s30.reduce((a, p) => a + (p.approved ? p.approved.price : 0), 0),
    daysToSell: median(days), daysN: days.length, metals, ladder, incomplete,
  };
}

// Suggest a workshop invoice from similar products (same type and level): the median, with how many it is based on.
export function suggestInvoice(products, d) {
  if (!d.sub || !d.level) return null;
  const xs = products.filter(p => p.id !== d.id && p.sub === d.sub && p.level === d.level && typeof p.invoice === 'number').map(p => p.invoice);
  return xs.length >= 2 ? { value: median(xs), n: xs.length } : null;
}

// Market price check: how far the saved metal price is from today's market (hesab-man's tgju feed).
export function marketGap(st, market) {
  if (!market) return [];
  return ['silver', 'gold'].filter(m => supplierOf(st, m) === 'self' && market[m] && st.prices[m])
    .map(m => ({ id: m, saved: st.prices[m], market: market[m].p, pct: market[m].p / st.prices[m] - 1 }))
    .filter(x => Math.abs(x.pct) >= 0.02);
}

// Headlines for the analysis page: one sentence each, what it means in small text, newest/most urgent first.
// tone: 'g' good, 'o' watch, 'r' act. act: what tapping does.
export function insights(products, st, market, now = Date.now()) {
  const A = analyse(products, st, now);
  const out = [];
  const pc = x => Math.round(x * 100);
  for (const g of marketGap(st, market)) {
    out.push({ tone: 'o', t: `${g.id === 'silver' ? 'نقره' : 'طلا'} در بازار ${pc(Math.abs(g.pct))}٪ ${g.pct > 0 ? 'گران‌تر' : 'ارزان‌تر'} شده است`, d: 'قیمت ثبت‌شده را به‌روز کنید تا قیمت محصولات درست بماند.', act: { kind: 'market', id: g.id } });
  }
  const drift = drifted(products, st);
  if (drift.length) out.push({ tone: 'o', t: `${drift.length} محصول منتظر تأیید قیمت تازه است`, d: 'قیمت فلز یا ضریب‌ها عوض شده است.', act: { kind: 'drift' } });
  if (A.incomplete.length) out.push({ tone: 'r', t: `${A.incomplete.length} محصول هنوز قیمت ندارد`, d: A.incomplete[0].r.missing[0].text, act: { kind: 'edit', id: A.incomplete[0].p.id } });
  const broken = A.ladder.filter(l => l.broken);
  if (broken.length) out.push({ tone: 'r', t: `پلکان قیمت ${broken.map(l => l.name).join('، ')} به هم ریخته است`, d: 'سطح بالاتر باید ضریب بزرگ‌تری داشته باشد، وگرنه مشتری دلیل گرانی را نمی‌بیند.', act: { kind: 'settings' } });
  const best = [...A.cats].sort((a, b) => b.sold30 - a.sold30)[0];
  if (best && best.sold30) out.push({ tone: 'g', t: `${best.name} بیشترین فروش این ماه را داشت`, d: `${best.sold30} فروش در ۳۰ روز اخیر.` });
  if (A.daysToSell != null) out.push({ tone: 'g', t: `هر محصول حدود ${Math.round(A.daysToSell)} روزه فروش می‌رود`, d: `میانهٔ ${A.daysN} فروش؛ از روز ثبت تا روز فروش.` });
  const m = A.metals.find(x => x.impact10);
  if (m) out.push({ tone: 'g', t: `${m.id === 'silver' ? 'نقره' : 'طلا'} ۱۰٪ گران شود، ویترین ${Math.round(m.impact10 / 1e5) / 10} میلیون بیشتر می‌ارزد`, d: `${Math.round(m.grams)} گرم در محصولات موجود.` });
  return { A, items: out };
}
