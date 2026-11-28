// IndexedDB: products, photos (compressed JPEG blobs), invoices, customers, orders, log and key/value settings.
const DB_NAME = 'seenzhin';
const VERSION = 4; // 2: invoices, 3: activity log, 4: customers and orders

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['products', 'photos', 'invoices', 'log', 'customers', 'orders']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function run(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  }));
}

// Writes that sync should know about. Set by sync.js while signed in; null otherwise.
export const changes = { onWrite: null };
const SYNCED = { products: 'product', invoices: 'invoice', photos: 'photo', log: 'log', customers: 'customer', orders: 'order' };
const SYNCED_KV = ['settings', 'logo'];
const note = (store, ids, deleted = false) => changes.onWrite && SYNCED[store] && changes.onWrite(SYNCED[store], ids, deleted);
const noteKv = key => changes.onWrite && SYNCED_KV.includes(key) && changes.onWrite('kv', [key], false);

// Plain writes that do not tell sync; used when applying copies that came from the server.
export const raw = {
  put: (store, obj) => run(store, 'readwrite', s => { s.put(obj); }),
  del: (store, id) => run(store, 'readwrite', s => { s.delete(id); }),
  set: (key, val) => run('kv', 'readwrite', s => { s.put(val, key); }),
};

export const db = {
  all: store => run(store, 'readonly', s => s.getAll()),
  getOne: (store, id) => run(store, 'readonly', s => s.get(id)),
  put: (store, obj) => run(store, 'readwrite', s => { s.put(obj); }).then(() => note(store, [obj.id])),
  putMany: (store, list) => run(store, 'readwrite', s => { for (const o of list) s.put(o); }).then(() => note(store, list.map(o => o.id))),
  del: (store, id) => run(store, 'readwrite', s => { s.delete(id); }).then(() => note(store, [id], true)),
  clear: store => run(store, 'readwrite', s => { s.clear(); }),
  get: key => run('kv', 'readonly', s => s.get(key)),
  set: (key, val) => run('kv', 'readwrite', s => { s.put(val, key); }).then(() => noteKv(key)),
};

export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* unsupported */ }
  return false;
}
