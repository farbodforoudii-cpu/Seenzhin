// IndexedDB: products, photos (compressed JPEG blobs) and key/value settings. Everything stays on this device.
const DB_NAME = 'seenzhin';
const VERSION = 2; // 2: invoices

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['products', 'photos', 'invoices']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
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

export const db = {
  all: store => run(store, 'readonly', s => s.getAll()),
  getOne: (store, id) => run(store, 'readonly', s => s.get(id)),
  put: (store, obj) => run(store, 'readwrite', s => { s.put(obj); }),
  putMany: (store, list) => run(store, 'readwrite', s => { for (const o of list) s.put(o); }),
  del: (store, id) => run(store, 'readwrite', s => { s.delete(id); }),
  clear: store => run(store, 'readwrite', s => { s.clear(); }),
  get: key => run('kv', 'readonly', s => s.get(key)),
  set: (key, val) => run('kv', 'readwrite', s => { s.put(val, key); }),
};

export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* unsupported */ }
  return false;
}
