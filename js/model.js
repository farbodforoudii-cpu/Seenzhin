// Catalog, pricing formulas and default settings. Pure functions, no DOM, so they can be tested in Node.
// The decisions behind every rule here are in docs/DECISIONS.md.

// Three pricing formulas share one structure; they differ only in which inputs are asked and in their factors.
export const FORMULAS = {
  jewelry: { name: 'جواهر', hint: 'وزن فلز، سنگ و فاکتور کارگاه' },
  panel: { name: 'تابلو', hint: 'ابعاد، وزن فلز و فاکتور کارگاه' },
  volume: { name: 'حجمی', hint: 'تندیس، مجسمه و دست‌ساز؛ متریال و فاکتور کارگاه' },
};

// What the customer sees. Each category points to one formula.
export const CATEGORIES = [
  { id: 'jewelry', name: 'جواهرات', formula: 'jewelry', subs: ['انگشتر', 'گردنبند', 'گوشواره', 'سنجاق'] },
  { id: 'panel', name: 'تابلوی نقره', formula: 'panel', subs: ['کوچک', 'متوسط', 'بزرگ'] },
  { id: 'statue', name: 'تندیس و مجسمه', formula: 'volume', subs: ['تندیس', 'مجسمه'] },
  { id: 'craft', name: 'دست‌سازها', formula: 'volume', subs: ['ظروف', 'اشیای دکوری', 'سایر'] },
];

export const LEVELS = [
  { id: 'simple', name: 'ساده', hint: 'طرح ساده یا تکراری' },
  { id: 'designed', name: 'طراحی‌شده', hint: 'طرح اختصاصی سروین' },
  { id: 'special', name: 'خاص', hint: 'پرکار، تک یا هنری' },
];

// supplier 'self': Seenzhin buys the metal and gives it to the workshop, so its weight × day price is a cost.
// supplier 'workshop': the metal is already inside the workshop invoice (assumed for bronze; see DECISIONS §4).
export const MATERIALS = [
  { id: 'silver', name: 'نقره', supplier: 'self' },
  { id: 'gold', name: 'طلا', supplier: 'self' },
  { id: 'bronze', name: 'برنز', supplier: 'workshop' },
  { id: 'none', name: 'بدون فلز', supplier: 'none' },
];

export const STATUSES = [
  { id: 'available', name: 'موجود' },
  { id: 'reserved', name: 'رزرو' },
  { id: 'sold', name: 'فروخته‌شده' },
];

export const ROUNDING = [0, 10000, 100000, 1000000];

// Every number starts empty on purpose: Servin enters the real ones (learning the app while doing it).
export function defaultSettings() {
  const factors = {};
  for (const f of Object.keys(FORMULAS)) factors[f] = { simple: null, designed: null, special: null };
  return {
    prices: { silver: null, gold: null }, // toman per gram
    pricesAt: { silver: null, gold: null },
    suppliers: { silver: 'self', gold: 'self', bronze: 'workshop' },
    factors,
    rounding: 0,
  };
}

export const catOf = id => CATEGORIES.find(c => c.id === id) || null;
export const formulaOf = p => (catOf(p.cat) || {}).formula || null;
export const matOf = id => MATERIALS.find(m => m.id === id) || null;
export const levelOf = id => LEVELS.find(l => l.id === id) || null;

export function supplierOf(settings, material) {
  if (!material || material === 'none') return 'none';
  return (settings.suppliers && settings.suppliers[material]) || (matOf(material) || {}).supplier || 'none';
}

const num = v => (typeof v === 'number' && isFinite(v) ? v : null);

// Price of one product with every step explained. Never guesses: anything missing is listed, not filled in.
export function price(p, settings) {
  const missing = [];
  const lines = [];
  const formula = formulaOf(p);
  if (!formula) missing.push({ key: 'cat', text: 'دسته را انتخاب کنید' });
  if (!p.level) missing.push({ key: 'level', text: 'سطح کار را انتخاب کنید' });
  if (!p.material) missing.push({ key: 'material', text: 'متریال را انتخاب کنید' });

  // 1) metal that Seenzhin supplies itself
  let metal = 0;
  const sup = supplierOf(settings, p.material);
  if (sup === 'self') {
    const w = num(p.weight), g = num(settings.prices[p.material]);
    const mname = matOf(p.material).name;
    if (w == null) missing.push({ key: 'weight', text: `وزن ${mname} را وارد کنید` });
    if (g == null) missing.push({ key: 'price:' + p.material, text: `قیمت روز هر گرم ${mname} در تنظیمات وارد نشده است` });
    if (w != null && g != null) {
      metal = w * g;
      lines.push({ label: `${mname}`, how: { kind: 'mul', a: w, aUnit: 'گرم', b: g, bUnit: 'تومان' }, value: metal });
    }
  } else if (sup === 'workshop') {
    lines.push({ label: matOf(p.material).name, how: { kind: 'text', text: 'داخل فاکتور کارگاه' }, value: 0 });
  }

  // 2) stones, 3) workshop invoice
  const stone = num(p.stone) || 0;
  if (stone) lines.push({ label: 'سنگ', how: null, value: stone });
  const inv = num(p.invoice);
  if (inv == null) missing.push({ key: 'invoice', text: 'مبلغ فاکتور کارگاه را وارد کنید' });
  else lines.push({ label: 'فاکتور کارگاه', how: null, value: inv });

  // 4) design value as a level factor
  const factor = formula && p.level ? num(settings.factors[formula][p.level]) : null;
  if (formula && p.level && factor == null) {
    missing.push({ key: `factor:${formula}:${p.level}`, text: `ضریب «${levelOf(p.level).name}» برای فرمول ${FORMULAS[formula].name} در تنظیمات وارد نشده است` });
  }

  const cost = missing.some(m => ['weight', 'invoice', 'material'].includes(m.key) || m.key.startsWith('price:')) ? null : metal + stone + (inv || 0);
  const internal = cost != null && factor != null ? cost * factor : null;
  const step = settings.rounding || 0;
  const final = internal == null ? null : step ? Math.ceil(internal / step) * step : Math.round(internal);
  return { formula, lines, cost, factor, internal, step, final, missing, complete: final != null };
}

// Products whose saved price no longer matches today's formula (metal price or factor changed).
// Sold products keep their price.
export function drifted(products, settings) {
  const out = [];
  for (const p of products) {
    if (p.status === 'sold') continue;
    const r = price(p, settings);
    if (!r.complete) continue;
    // Saved before the numbers were complete: the new price still needs Servin's approval.
    if (!p.approved) out.push({ p, from: null, to: r.final });
    else if (r.final !== p.approved.price) out.push({ p, from: p.approved.price, to: r.final });
  }
  return out;
}

// Steps of the first-use checklist, so Servin learns the app by filling it in.
export function setupSteps(settings, products) {
  const anyFactor = Object.values(settings.factors).some(l => Object.values(l).some(v => v != null));
  return [
    { id: 'silver', text: 'قیمت روز هر گرم نقره را وارد کنید', done: settings.prices.silver != null, go: 'settings' },
    { id: 'factors', text: 'ضریب سطح‌ها را وارد کنید', done: anyFactor, go: 'settings' },
    { id: 'first', text: 'اولین محصول را ثبت کنید', done: products.length > 0, go: 'price' },
  ];
}
