// Scheduled sync (.github/workflows/site-catalog.yml): the app is the source of truth, the site follows it.
// 1. Reads the public source from the server function seenzhin_site_catalog (only products marked «روی سایت نشان بده»,
//    public fields, approved price, sale counts without customers, photos).
// 2. Applies the app's own rules (js/site.js siteCatalog, js/model.js unitsOf) so the site shows exactly what the app would export.
// 3. Writes site/data/catalog.json and site/img/p/*.jpg; nothing is written when nothing public changed.
// Usage: node site/tools/sync-catalog.mjs [source.json]   (a saved source file instead of the server, for tests)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SUPABASE_URL, SUPABASE_KEY } from '../../js/config.js';
import { defaultSettings, unitsOf } from '../../js/model.js';
import { siteCatalog, catalogFile } from '../../js/site.js';
import { writeSiteCatalog } from './import-catalog.mjs';

export function buildCatalog(src, now = new Date()) {
  if (!src || src.app !== 'seenzhin' || src.kind !== 'site-source' || !Array.isArray(src.products)) throw new Error('unexpected source');
  const st = defaultSettings();
  if (src.suppliers) st.suppliers = { ...st.suppliers, ...src.suppliers };
  const invoices = (src.sales || []).map(s => ({ items: [{ productId: s.productId, qty: s.qty }], paid: !!s.paid, paidAt: s.at }));
  const units = p => unitsOf(p, invoices, inv => inv.paid);
  // Only an approved price reaches the site (decision 21: the site price changes only after Servin approves).
  const products = src.products.map(p => ({ ...p, approved: p.approved && Number(p.approved.price) > 0 ? p.approved : undefined }));
  const items = siteCatalog(products, st, units).map((it, i) => ({ ...it, price: products[i].approved ? products[i].approved.price : null }));
  return catalogFile(items, src.photos || {}, now);
}

async function fetchSource() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/seenzhin_site_catalog`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!res.ok) throw new Error(`server ${res.status}: ${await res.text()}`);
  return res.json();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : await fetchSource();
  const r = writeSiteCatalog(buildCatalog(src));
  console.log(`${r.items} products, ${r.photos} photos${r.changed ? ' → catalog updated' : ' (no change)'}`);
}
