// What the Seenzhin website may show. Only products marked «روی سایت نشان بده», and only public fields:
// never making cost, factors, workshop numbers or anything about customers.
import { price, catOf, matOf, supplierOf } from './model.js';

// What a product still needs before it looks right on the site (shown under the switch).
export function siteMissing(p, st) {
  const out = [];
  if (!price(p, st).complete && !(p.approved && p.approved.price)) out.push('قیمت کامل');
  if (!(p.photos && p.photos.length)) out.push('عکس');
  if (!String(p.desc || '').trim()) out.push('توضیح کوتاه فروش');
  if (!String(p.title || '').trim()) out.push('نام');
  return out;
}

// The public catalog. `unitsOf(p)` gives ready pieces; none ready → «سفارشی» (made to order) instead of hidden.
export function siteCatalog(products, st, unitsOf) {
  return products.filter(p => p.onSite).map(p => {
    const cat = catOf(p.cat), mt = matOf(p.material), u = unitsOf(p);
    const own = supplierOf(st, p.material) === 'self';
    return {
      id: p.id, title: p.title || p.sub || '', desc: p.desc || '',
      category: cat ? cat.name : '', type: p.sub || '', material: mt && p.material !== 'none' ? mt.name : '',
      weight: own && p.weight ? p.weight : null,
      price: p.approved ? p.approved.price : price(p, st).final,
      availability: u.left > 0 ? 'available' : 'made-to-order',
      photos: p.photos || [],
    };
  });
}

// The file the website reads (v1). Photos travel inside it as data URLs until the site has a live server.
export const CATALOG_VERSION = 1;
export function catalogFile(items, photoData, now = new Date()) {
  return {
    app: 'seenzhin', kind: 'catalog', v: CATALOG_VERSION, at: now.toISOString(), currency: 'IRT',
    items: items.map(it => ({ ...it, photos: it.photos.filter(id => photoData[id]).map(id => ({ id, data: photoData[id] })) })),
  };
}
