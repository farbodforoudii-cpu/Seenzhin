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
    markup: null, // material factor on metal + stones
    castPerGram: null, // workshop casting fee per gram (entered in settings)
    teamHourly: null, // value of one hour of the team's own handwork (entered in settings)
    hoursByLevel: { simple: null, designed: null, special: null }, // usual team hours per level, for suggestions
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

  // 2) stones and bought parts (hooks, elastic, chain…), entered per product
  const stone = num(p.stone) || 0;
  if (stone) lines.push({ label: 'سنگ و قطعه‌ها', how: null, value: stone });

  // 3) The work: one number, «هزینهٔ ساخت» (casting, the team's hand-work and any workshop together), the way
  // Servin enters it. When it is empty, it is worked out: casting (weight × fee, cast pieces only) + team hours ×
  // team rate. Bronze and other workshop-supplied metal need the workshop's figure.
  const inv = num(p.invoice), hours = num(p.hours), rate = num(settings.teamHourly), fee = num(settings.castPerGram);
  const castable = formula && formula !== 'panel' && sup === 'self';
  let casting = 0, labour = 0;
  if (inv != null) lines.push({ label: 'هزینهٔ ساخت', how: null, value: inv });
  else if (sup === 'workshop') missing.push({ key: 'invoice', text: 'هزینهٔ ساخت کارگاه را وارد کنید (فلز را کارگاه داده)' });
  else if (!hours) missing.push({ key: 'invoice', text: 'هزینهٔ ساخت را وارد کنید' });
  else {
    if (castable && num(p.weight)) {
      if (fee == null) missing.push({ key: 'cast', text: 'هزینهٔ ریخته‌گری هر گرم در تنظیمات وارد نشده است' });
      else { casting = num(p.weight) * fee; lines.push({ label: 'ریخته‌گری', how: { kind: 'mul', a: num(p.weight), aUnit: 'گرم', b: fee, bUnit: 'تومان' }, value: casting }); }
    }
    if (rate == null) missing.push({ key: 'hourly', text: 'ارزش هر ساعت کار تیم در تنظیمات وارد نشده است' });
    else { labour = hours * rate; lines.push({ label: 'کار تیم', how: { kind: 'mul', a: hours, aUnit: 'ساعت', b: rate, bUnit: 'تومان' }, value: labour }); }
  }
  const work = inv != null ? inv : casting + labour;

  // 4) Expensive materials (metal we supply + stones) take a small material factor; the workshop work takes the
  // level factor that carries Servin's design value. Pattern used by independent jewellers (Metalsmith Society):
  // a 2-2.5× markup on gold would price the piece out of its market. See DECISIONS §5.
  const material = metal + stone;
  const markup = num(settings.markup);
  if (material > 0 && markup == null) missing.push({ key: 'markup', text: 'ضریب متریال در تنظیمات وارد نشده است' });
  const factor = formula && p.level ? num(settings.factors[formula][p.level]) : null;
  if (formula && p.level && factor == null) {
    missing.push({ key: `factor:${formula}:${p.level}`, text: `ضریب «${levelOf(p.level).name}» برای فرمول ${FORMULAS[formula].name} در تنظیمات وارد نشده است` });
  }

  const costKnown = !missing.some(m => ['weight', 'invoice', 'material', 'hourly', 'hours', 'cast'].includes(m.key) || m.key.startsWith('price:'));
  const cost = costKnown ? material + work : null;
  const materialPart = costKnown && (material === 0 || markup != null) ? material * (material ? markup : 0) : null;
  const workPart = costKnown && factor != null ? work * factor : null;
  const internal = materialPart != null && workPart != null ? materialPart + workPart : null;
  const step = settings.rounding || 0;
  const final = internal == null ? null : step ? Math.ceil(internal / step) * step : Math.round(internal);
  return { formula, lines, cost, material, invoice: inv, casting, labour, work, markup, factor, materialPart, workPart, internal, step, final, missing, complete: final != null };
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
    { id: 'markup', text: 'ضریب متریال را وارد کنید', done: settings.markup != null, go: 'settings' },
    { id: 'factors', text: 'ضریب سطح‌ها را وارد کنید', done: anyFactor, go: 'settings' },
    { id: 'first', text: 'اولین محصول را ثبت کنید', done: products.length > 0, go: 'price' },
  ];
}
