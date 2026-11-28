// Shared account: one username + password for Servin and Farbod; every device signed in sees the same data.
// Uses the ecosystem's Supabase project (eco_* functions, app = 'seenzhin'). The username and password are turned
// into a long key on the device (PBKDF2); the server keeps only the SHA-256 of that key, never the password.
// Each record is a whole JSON copy; the newer `updatedAt` wins, so the last change to a product is kept.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { db, raw, changes } from './db.js';

const APP = 'seenzhin';
const S = { key: null, user: null, cursor: null, status: 'off', error: '', last: null, meta: { at: {}, dirty: {}, gone: {} } };
const listeners = new Set();
const emit = () => listeners.forEach(f => f(S));

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!res.ok) throw Object.assign(new Error((data && (data.message || data.error)) || res.statusText), { status: res.status });
  return data;
}
const persian = e => /unknown sync key/i.test(e.message) ? 'حسابی با این نام و رمز پیدا نشد.'
  : /failed to fetch|network|load failed/i.test(e.message) ? 'اتصال به سرور برقرار نشد. اینترنت یا VPN را بررسی کنید.' : e.message;

// username + password → 64 hex characters. Same input on any device gives the same key.
export async function deriveKey(user, pass) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('seenzhin:' + user), iterations: 150000, hash: 'SHA-256' }, base, 256);
  return 'SZ1-' + [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const cleanUser = u => String(u || '').trim().toLowerCase();
// A short public fingerprint of the account (4 letters): two phones are in the same account only if it matches.
async function fingerprint(key) {
  if (!key) return '';
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fp:' + key)));
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...h.slice(0, 4)].map(b => A[b % 32]).join('');
}

const recId = (kind, key) => `s:${kind}:${key}`;
// Record kind → IndexedDB store. A kind this version does not know is left on the server, untouched and unread,
// so the next version still finds it.
const STORE = { product: 'products', invoice: 'invoices', photo: 'photos', log: 'log', customer: 'customers', order: 'orders', expense: 'expenses' };
// Raised when a version learns new kinds: such phones read the whole account once more.
const KINDS_V = 3;
const saveMeta = () => raw.set('syncMeta', S.meta);

function track(kind, ids, deleted) {
  const now = new Date().toISOString();
  for (const id of ids) {
    const r = recId(kind, id);
    S.meta.at[r] = now; S.meta.dirty[r] = true;
    if (deleted) S.meta.gone[r] = true; else delete S.meta.gone[r];
  }
  saveMeta();
  clearTimeout(track.t); track.t = setTimeout(() => sync.run(), 2000);
}

const blobToData = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
const dataToBlob = async d => (await fetch(d)).blob();

// Server → device. Returns true when anything here changed.
async function pull() {
  let changed = false, more = true;
  while (more) {
    const rows = await rpc('eco_pull', { p_key: S.key, p_app: APP, p_after: S.cursor, p_limit: 200 });
    for (const { data: d } of rows) {
      if (S.meta.at[d.id] && S.meta.at[d.id] >= d.updatedAt) continue;
      const store = STORE[d.kind];
      if (!store && d.kind !== 'kv') continue;
      if (store) {
        if (d.deleted) await raw.del(store, d.key);
        else if (d.kind === 'photo') await raw.put('photos', { id: d.key, blob: await dataToBlob(d.value) });
        else await raw.put(store, d.value);
      } else if (d.kind === 'kv') {
        if (d.key === 'logo') await raw.set('logo', d.value ? await dataToBlob(d.value) : null);
        else if (d.key === 'settings') await raw.set('settings', d.value);
      }
      S.meta.at[d.id] = d.updatedAt; delete S.meta.dirty[d.id];
      if (d.deleted) S.meta.gone[d.id] = true; else delete S.meta.gone[d.id];
      changed = true;
    }
    if (rows.length) { S.cursor = rows[rows.length - 1].server_updated_at; await raw.set('syncCursor', S.cursor); }
    await saveMeta();
    more = rows.length === 200;
  }
  return changed;
}

// Device → server. Photos go one per request (they are large); everything else in batches.
async function push() {
  const ids = Object.keys(S.meta.dirty);
  if (!ids.length) return;
  const small = [], photos = [];
  for (const r of ids) {
    const [, kind, key] = r.match(/^s:([^:]+):(.*)$/s);
    const base = { id: r, kind, key, app: APP, updatedAt: S.meta.at[r] };
    if (S.meta.gone[r]) { small.push({ ...base, deleted: true }); continue; }
    if (kind === 'photo') { const p = await db.getOne('photos', key); if (p) photos.push({ ...base, value: await blobToData(p.blob) }); else delete S.meta.dirty[r]; continue; }
    if (kind === 'kv') { const v = await db.get(key); small.push({ ...base, value: key === 'logo' ? (v ? await blobToData(v) : null) : v ?? null }); continue; }
    const v = await db.getOne(STORE[kind], key);
    if (v) small.push({ ...base, value: v }); else delete S.meta.dirty[r];
  }
  const send = async chunk => {
    await rpc('eco_push', { p_key: S.key, p_app: APP, p_rows: chunk });
    for (const d of chunk) if (S.meta.at[d.id] === d.updatedAt) delete S.meta.dirty[d.id];
    await saveMeta();
  };
  for (const p of photos) await send([p]);
  for (let i = 0; i < small.length; i += 100) await send(small.slice(i, i + 100));
}

// First sign-in on a device: after the server's copies are in, what exists only here is sent too.
async function seed() {
  const now = new Date().toISOString();
  const mark = r => { if (!S.meta.at[r]) { S.meta.at[r] = now; S.meta.dirty[r] = true; } };
  for (const p of await db.all('products')) mark(recId('product', p.id));
  for (const i of await db.all('invoices')) mark(recId('invoice', i.id));
  for (const l of await db.all('log')) mark(recId('log', l.id));
  for (const c of await db.all('customers')) mark(recId('customer', c.id));
  for (const o of await db.all('orders')) mark(recId('order', o.id));
  for (const e of await db.all('expenses')) mark(recId('expense', e.id));
  for (const p of await db.all('photos')) mark(recId('photo', p.id));
  for (const k of ['settings', 'logo']) if ((await db.get(k)) != null) mark(recId('kv', k));
  await saveMeta();
}

export const sync = {
  state: S,
  onChange: f => listeners.add(f),
  onRemote: null, // called after server copies changed this device

  async init() {
    S.key = (await db.get('syncKey')) || null;
    S.user = (await db.get('syncUser')) || null;
    S.cursor = (await db.get('syncCursor')) || null;
    S.last = (await db.get('syncLast')) || null;
    S.meta = (await db.get('syncMeta')) || S.meta;
    // An older version skipped kinds it did not know (customers, orders): read everything once more.
    if (S.key && ((await db.get('syncKinds')) || 1) < KINDS_V) {
      S.cursor = null;
      for (const r of Object.keys(S.meta.at)) if (/^s:(customer|order|expense):/.test(r) && !S.meta.dirty[r]) delete S.meta.at[r];
      await raw.set('syncCursor', null); await saveMeta();
    }
    await raw.set('syncKinds', KINDS_V);
    S.fp = await fingerprint(S.key);
    S.status = S.key ? 'idle' : 'off';
    changes.onWrite = S.key ? track : null;
    addEventListener('online', () => sync.run());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync.run(); });
    setInterval(() => { if (!document.hidden) sync.run(); }, 30000);
    if (S.key) sync.run();
  },

  // Sign in. If no account has this username + password, ask before making a new one (a typo must not
  // silently start an empty account).
  async signIn(user, pass, confirmNew) {
    user = cleanUser(user);
    if (user.length < 3) throw new Error('نام کاربری دست‌کم ۳ حرف باشد.');
    if (String(pass).length < 6) throw new Error('رمز دست‌کم ۶ حرف باشد.');
    const key = await deriveKey(user, pass);
    try { await rpc('eco_pull', { p_key: key, p_app: APP, p_limit: 1 }); }
    catch (e) {
      if (!/unknown sync key/i.test(e.message)) throw new Error(persian(e));
      if (!(await confirmNew(user))) return false;
      await rpc('eco_create_space', { p_key: key }).catch(err => { throw new Error(persian(err)); });
    }
    return sync.start(key, user);
  },

  // Join with the code copied on the other phone: exactly the same account, nothing to retype.
  // The code never creates a new account.
  async joinCode(input) {
    const t = String(input || '').trim().replace(/\s+/g, '');
    const m = t.match(/^(?:([^~]*)~)?(SZ1-[0-9a-f]{64})$/i);
    if (/^[A-Z2-9]{4}$/i.test(t)) throw new Error('این «شناسهٔ حساب» است، نه کد اتصال. روی گوشی سروین: تنظیمات ← «کپی کد اتصال برای گوشی دیگر».');
    if (!m) throw new Error('این کد کامل نیست؛ کد را دوباره از گوشی دیگر کپی کنید.');
    const key = 'SZ1-' + m[2].slice(4).toLowerCase();
    try { await rpc('eco_pull', { p_key: key, p_app: APP, p_limit: 1 }); }
    catch (e) { throw new Error(/unknown sync key/i.test(e.message) ? 'حسابی با این کد پیدا نشد.' : persian(e)); }
    return sync.start(key, cleanUser(m[1] || '') || 'حساب مشترک');
  },
  // The code to paste on another phone: «username~key».
  shareCode: () => (S.key ? `${S.user || ''}~${S.key}` : ''),

  async start(key, user) {
    S.key = key; S.user = user; S.cursor = null; S.fp = await fingerprint(key);
    S.meta = { at: {}, dirty: {}, gone: {} };
    await raw.set('syncKey', key); await raw.set('syncUser', user); await raw.set('syncCursor', null); await saveMeta();
    changes.onWrite = track;
    S.status = 'syncing'; emit();
    const changed = await pull();
    await seed();
    await push();
    S.last = new Date().toISOString(); await raw.set('syncLast', S.last);
    S.status = 'idle'; emit();
    if (changed && sync.onRemote) await sync.onRemote();
    return true;
  },

  // Leave the account on this device only; data here and on the server stay.
  async signOut() {
    S.key = null; S.user = null; S.cursor = null; S.fp = ''; S.status = 'off';
    changes.onWrite = null;
    await raw.set('syncKey', null); await raw.set('syncUser', null);
    emit();
  },

  async run() {
    if (!S.key || S.status === 'syncing' || !navigator.onLine) return;
    S.status = 'syncing'; S.error = ''; emit();
    try {
      const changed = await pull();
      await push();
      S.last = new Date().toISOString(); await raw.set('syncLast', S.last);
      S.status = 'idle'; emit();
      if (changed && sync.onRemote) await sync.onRemote();
    } catch (e) { S.status = 'error'; S.error = persian(e); emit(); }
  },
};
