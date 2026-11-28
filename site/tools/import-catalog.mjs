// Turns the app's export (Settings → «خروجی کاتالوگ سایت», contract v1) into the site's own files:
//   site/data/catalog.json  (same format, photos as { id, url })
//   site/img/p/<photo id>.jpg
// Usage: node site/tools/import-catalog.mjs path/to/seenzhin-catalog-YYYY-MM-DD.json
// Only what the app already made public is written (the app's siteCatalog decides the fields).
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { catalogOk, normalize } from '../js/catalog.js';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) { console.error('usage: node site/tools/import-catalog.mjs <catalog.json>'); process.exit(2); }

const raw = JSON.parse(readFileSync(src, 'utf8'));
if (!catalogOk(raw) || raw.app !== 'seenzhin' || raw.kind !== 'catalog') { console.error('not a Seenzhin catalog v1 file'); process.exit(1); }
const ALLOWED = ['id', 'title', 'desc', 'category', 'type', 'material', 'weight', 'price', 'availability', 'photos'];

const imgDir = join(SITE, 'img', 'p');
if (existsSync(imgDir)) rmSync(imgDir, { recursive: true });
mkdirSync(imgDir, { recursive: true });

const safe = s => String(s).replace(/[^\w-]/g, '');
let n = 0;
const items = raw.items.map(it => {
  const out = Object.fromEntries(ALLOWED.filter(k => k in it).map(k => [k, it[k]]));
  out.photos = (it.photos || []).map(ph => {
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(ph && ph.data || '');
    if (!m || !ph.id) return ph && ph.url ? { id: safe(ph.id), url: ph.url } : null;
    const file = `img/p/${safe(ph.id)}.jpg`;
    writeFileSync(join(SITE, file), Buffer.from(m[1], 'base64')); n++;
    return { id: safe(ph.id), url: file };
  }).filter(Boolean);
  return out;
});

const cat = { app: 'seenzhin', kind: 'catalog', v: 1, at: raw.at, currency: 'IRT', items };
if (normalize(cat).length !== items.length) { console.error('some items are incomplete (title or id missing)'); process.exit(1); }
writeFileSync(join(SITE, 'data', 'catalog.json'), JSON.stringify(cat, null, 1) + '\n');
console.log(`${items.length} products, ${n} photos → site/data/catalog.json, site/img/p/`);
