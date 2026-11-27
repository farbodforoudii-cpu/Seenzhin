const { chromium } = require('playwright');
require('fs').mkdirSync(process.env.OUT || '/tmp/seenzhin-shots/', { recursive: true });
const USER = 'zz-test-' + Date.now().toString(36), PASS = 'test-pass-123';
(async () => {
  const b = await chromium.launch();
  // In-memory copy of the server functions (same rules as eco_create_space / eco_push / eco_pull).
  const spaces = new Set(), items = new Map(); let clock = 0;
  const handle = async route => {
    const fn = route.request().url().split('/rpc/')[1], a = JSON.parse(route.request().postData());
    const err = m => route.fulfill({ status: 400, json: { message: m } });
    if (fn === 'eco_create_space') { spaces.add(a.p_key); return route.fulfill({ json: true }); }
    if (!spaces.has(a.p_key)) return err('unknown sync key');
    if (fn === 'eco_push') { let n = 0; for (const r of a.p_rows) { const k = a.p_key + '|' + r.id, old = items.get(k); if (!old || old.data.updatedAt <= r.updatedAt) { items.set(k, { space: a.p_key, app: a.p_app, data: r, t: ++clock }); n++; } } return route.fulfill({ json: n }); }
    if (fn === 'eco_pull') { const after = a.p_after == null ? 0 : a.p_after; const rows = [...items.values()].filter(i => i.space === a.p_key && i.app === a.p_app && i.t > after).sort((x, y) => x.t - y.t).slice(0, a.p_limit || 500).map(i => ({ data: i.data, server_updated_at: i.t })); return route.fulfill({ json: rows }); }
    return err('?');
  };
  const mk = async () => { const c = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] }); await c.route('**/rest/v1/rpc/*', handle); const p = await c.newPage(); p.on('dialog', d => d.accept()); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.goto('http://localhost:8771/'); await p.waitForTimeout(800); return { p, errs }; };
  const A = await mk(), B = await mk();
  const signIn = async ({ p }) => { await p.click('[data-tab="settings"]'); await p.fill('#su', USER); await p.fill('#sp', PASS); await p.click('[data-signin]'); await p.waitForTimeout(6000); return p.textContent('#island'); };
  // phone A: a product first, then sign in (creates the account)
  await A.p.click('[data-new] >> nth=0'); await A.p.waitForTimeout(400);
  await A.p.click('[data-set="cat"][data-val="statue"]'); await A.p.click('[data-set="sub"][data-val="تندیس"]'); await A.p.waitForTimeout(500);
  await A.p.click('[data-set="level"][data-val="special"]'); await A.p.waitForTimeout(500);
  await A.p.click('[data-set="material"][data-val="bronze"]');
  await A.p.fill('[data-num="invoice"]', '9000000'); await A.p.dispatchEvent('[data-num="invoice"]', 'input');
  await A.p.click('.ed-foot [data-step="3"]'); await A.p.fill('[data-text="title"]', 'تندیس آزمون همگام'); await A.p.dispatchEvent('[data-text="title"]', 'input');
  await A.p.click('.ed-foot [data-step="4"]'); await A.p.click('[data-save]'); await A.p.waitForTimeout(500);
  console.log('A sign in:', await signIn(A));
  await A.p.click('[data-tab="settings"]'); await A.p.waitForTimeout(300);
  await A.p.click('[data-copycode]'); await A.p.waitForTimeout(400);
  const code = await A.p.evaluate(() => navigator.clipboard.readText());
  console.log('code looks like:', code.slice(0, 20) + '…');
  await B.p.click('[data-tab="settings"]'); await B.p.fill('#sc', '  ' + code + ' '); await B.p.click('[data-joincode]'); await B.p.waitForTimeout(5000);
  console.log('B join:', await B.p.textContent('#island'));
  console.log('same account id:', (await A.p.textContent('.fp')) === (await B.p.textContent('.fp')));
  // a wrong code never creates an account
  const C = await mk(); await C.p.click('[data-tab="settings"]'); await C.p.fill('#sc', 'x~SZ1-' + '0'.repeat(64)); await C.p.click('[data-joincode]'); await C.p.waitForTimeout(1500);
  console.log('wrong code:', await C.p.textContent('#island'));
  await B.p.click('[data-tab="home"]'); await B.p.waitForTimeout(500);
  console.log('B sees product:', await B.p.locator('.pname', { hasText: 'تندیس آزمون همگام' }).count());
  // change on B (status reserved) → appears on A after a sync run
  await B.p.click('.pcard'); await B.p.waitForTimeout(500); await B.p.click('[data-set="status"][data-val="reserved"]'); await B.p.click('[data-save]'); await B.p.waitForTimeout(4500);
  await A.p.click('[data-tab="settings"]'); await A.p.click('[data-syncnow]'); await A.p.waitForTimeout(4000);
  await A.p.click('[data-tab="home"]'); await A.p.waitForTimeout(400);
  console.log('A sees reserved:', await A.p.locator('.badge.s-reserved').count());
  await A.p.click('[data-tab="settings"]'); await A.p.waitForTimeout(300);
  await A.p.screenshot({ path: (process.env.OUT || '/tmp/seenzhin-shots/') + 'sync-settings.png' });
  console.log('user', USER, 'errors', A.errs, B.errs);
  await b.close();
})();
