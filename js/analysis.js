// Analysis for Servin. Pure functions; every number returned with what it is made of, so the UI can explain it.
import { CATEGORIES, LEVELS, FORMULAS, price, supplierOf, drifted } from './model.js';

const DAY = 864e5;
export const shownPrice = (p, st) => (p.approved ? p.approved.price : price(p, st).final);
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function analyse(products, st, now = Date.now()) {
  const stock = products.filter(p => p.status !== 'sold');
  const sold = products.filter(p => p.status === 'sold');

  // Stock value: sum of the prices customers see; cost: what was paid (metal at today's price + stone + workshop).
  let value = 0, cost = 0, priced = 0;
  for (const p of stock) {
    const v = shownPrice(p, st), c = price(p, st).cost;
    if (v != null && c != null) { value += v; cost += c; priced++; }
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
    stockCount: stock.length, priced, value, cost, margin: value ? (value - cost) / value : null,
    cats, sold30: s30.length, revenue30: s30.reduce((a, p) => a + (p.approved ? p.approved.price : 0), 0),
    daysToSell: median(days), daysN: days.length, metals, ladder, incomplete,
  };
}

// Suggest an outside workshop invoice (e.g. a bronze piece) from products that have one: same type and level,
// then type, then category. The median, with how many it rests on.
export function suggestInvoice(products, d) {
  if (!d.cat) return null;
  const has = products.filter(p => p.id !== d.id && typeof p.invoice === 'number' && p.invoice >= 10000);
  const tiers = [
    [has.filter(p => p.sub === d.sub && p.level === d.level), 'هم‌نوع و هم‌سطح'],
    [has.filter(p => p.sub === d.sub), 'هم‌نوع'],
    [has.filter(p => p.cat === d.cat), 'هم‌دسته'],
  ];
  for (const [xs, basis] of tiers) if (d.sub || basis === 'هم‌دسته') if (xs.length) return { value: median(xs.map(p => p.invoice)), n: xs.length, basis };
  return null;
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

// ---------- small jobs for Servin: one a day, each makes the data a little more exact ----------
// Each job: id (stable, so «later» can snooze it), title, why, act (what tapping opens), prompt (for her own ChatGPT,
// which knows her work well; the answer is short and typed back into the app).
const DAY_MS = 864e5;
const fa = n => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]).replace('.', '٫');
function describe(p) {
  const cat = (CATEGORIES.find(c => c.id === p.cat) || {}).name || '';
  const lv = (LEVELS.find(l => l.id === p.level) || {}).name || '';
  const metal = { silver: 'نقره', gold: 'طلا', bronze: 'برنز' }[p.material] || '';
  return `«${p.title || p.sub || 'محصول'}» (${[cat, p.sub, lv, metal && p.weight ? `${metal} ${fa(p.weight)} گرم` : metal].filter(Boolean).join('، ')})`;
}
const INTRO = 'من سروین هستم، طراح و سازندهٔ برند جواهرات و آثار دست‌ساز «سینژین». تو از کارها و روند ساخت من زیاد می‌دانی.';
export function jobsFor(products, st, now = Date.now()) {
  const out = [];
  const live = products.filter(p => p.status !== 'sold');
  // 1) a product without a full price
  for (const p of live) {
    const r = price(p, st);
    if (r.complete) continue;
    const m = r.missing[0];
    out.push({ id: 'price:' + p.id, act: 'edit:' + p.id, title: `قیمت ${describe(p)} را کامل کن`, why: m ? m.text : '',
      prompt: `${INTRO}\nبرای محصول ${describe(p)} لطفاً تخمین بزن:\n۱) کار تیم روی آن (پرداخت، لحیم، آبکاری، مونتاژ) چند ساعت بوده؟\n۲) سنگ و قطعه‌های خریدنی (قلاب، الاستیک، زنجیر…) چه بوده و حدوداً چند تومان؟\nجواب را فقط در دو خط بده: «ساعت: …» و «قطعه‌ها: … تومان».` });
  }
  // 2) the same build cost typed for pieces of very different weight: probably a round guess
  const typed = live.filter(p => typeof p.invoice === 'number' && p.weight && p.cat !== 'panel');
  const groups = {};
  for (const p of typed) (groups[p.invoice] ||= []).push(p);
  for (const [v, ps] of Object.entries(groups)) {
    if (ps.length < 3) continue;
    const ws = ps.map(p => p.weight), spread = Math.max(...ws) / Math.min(...ws);
    if (spread < 1.8) continue;
    const p = ps.sort((a, b) => b.weight - a.weight)[0];
    out.push({ id: 'same:' + p.id + ':' + v, act: 'edit:' + p.id, title: `هزینهٔ ساخت ${describe(p)} را دقیق کن`,
      why: `${fa(ps.length)} محصول با وزن‌های ${fa(Math.min(...ws))} تا ${fa(Math.max(...ws))} گرم همه یک هزینهٔ ساخت دارند؛ احتمالاً تخمینی است.`,
      prompt: `${INTRO}\nبرای ${describe(p)} هزینهٔ ساخت را دقیق‌تر حساب کن: ریخته‌گری (هر گرم ${st.castPerGram ? fa(st.castPerGram) : '…'} تومان)، ساعت کار تیم روی پرداخت و لحیم و آبکاری و مونتاژ، و قطعه‌های خریدنی.\nجواب را فقط در سه خط بده: «ساعت: …»، «قطعه‌ها: … تومان»، «جمع هزینهٔ ساخت: … تومان».` });
  }
  // 3) a hand-built panel priced without its hours
  for (const p of live.filter(p => p.cat === 'panel' && !p.hours)) {
    out.push({ id: 'hours:' + p.id, act: 'edit:' + p.id, title: `ساعت کار ${describe(p)} را بپرس`,
      why: 'تابلو دست‌ساز تیم است؛ ارزش کارش از ساعت کار درمی‌آید.',
      prompt: `${INTRO}\nتابلوی ${describe(p)} را تیم با دست ساخته. با توجه به آنچه از این کار می‌دانی، ساختنش حدوداً چند ساعت کار برده؟ (طراحی، برش، ساخت، لحیم، پرداخت)\nجواب را فقط در یک خط بده: «ساعت: …».` });
  }
  // 4) the silver price not refreshed for a week
  const at = st.pricesAt && st.pricesAt.silver;
  if (st.prices && st.prices.silver && (!at || now - at > 7 * DAY_MS)) {
    out.push({ id: 'silver:' + Math.floor(now / (7 * DAY_MS)), act: 'settings', title: 'قیمت روز نقره را به‌روز کن', why: 'بیش از یک هفته از آخرین به‌روزرسانی گذشته؛ در تنظیمات «استفاده» را بزن.', prompt: '' });
  }
  // 5) a product without a photo
  for (const p of live.filter(p => !(p.photos && p.photos.length))) {
    out.push({ id: 'photo:' + p.id, act: 'edit:' + p.id, title: `برای ${describe(p)} عکس بگذار`, why: 'عکس روی فاکتور و بعداً روی سایت دیده می‌شود.', prompt: '' });
  }
  // 6) a short selling description (for invoices, Instagram and the website later)
  for (const p of live.filter(p => !(p.desc && p.desc.trim()))) {
    out.push({ id: 'desc:' + p.id, act: 'edit:' + p.id, title: `یک توضیح کوتاه برای ${describe(p)} بنویس`, why: 'دو خط برای اینستاگرام و سایت؛ GPT کمک می‌کند.',
      prompt: `${INTRO}\nبرای محصول ${describe(p)} یک توضیح فروش کوتاه بنویس: حداکثر دو جمله، فارسی، با لحن آرام و هنری سینژین (seen for vision, zhin for life)، بدون اغراق و بدون ایموجی. فقط خود متن را بده.` });
  }
  return out;
}
