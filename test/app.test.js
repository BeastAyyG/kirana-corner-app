import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAppServer } from '../src/server.js';
import { createSession, openDatabase } from '../src/db.js';

async function fixture({ production = false, extraStore = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'kirana-corner-'));
  const dbPath = join(directory, 'app.sqlite');
  let otherSellerCookie = '';
  if (extraStore) {
    const db = openDatabase(dbPath);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO stores (id,name,address,neighborhood,pickup_location,time_zone,active,created_at)
      VALUES ('other-shop','Other Shop','','Other neighbourhood','Side counter','Asia/Kolkata',1,?)`).run(now);
    db.prepare(`INSERT INTO users (id,role,display_name,created_at) VALUES ('other-seller','seller','Other seller',?)`).run(now);
    db.prepare('INSERT INTO seller_memberships (store_id,user_id) VALUES (?,?)').run('other-shop', 'other-seller');
    db.prepare(`INSERT INTO products (id,store_id,name,category,unit,price_minor,on_hand,reserved,art,active,created_at,updated_at)
      VALUES ('other-item','other-shop','Other rice','Staples','1 kg',12500,4,0,'staple',1,?,?)`).run(now, now);
    const token = randomBytes(32).toString('base64url');
    createSession(db, 'other-seller', token);
    otherSellerCookie = `kc_session=${encodeURIComponent(token)}`;
    db.close();
  }
  const previousNodeEnv = process.env.NODE_ENV;
  if (production) process.env.NODE_ENV = 'production';
  let server = createAppServer({ dbPath });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { cookie = '', method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    return { response, payload };
  };
  const login = async role => {
    const { response, payload } = await request('/api/v1/auth/demo', { method: 'POST', body: { role } });
    assert.equal(response.status, 200);
    return { user: payload.user, cookie: response.headers.get('set-cookie').split(';')[0] };
  };
  const store = async () => (await request('/api/v1/stores')).payload.stores.find(item => item.id === 'saathi-kirana');
  const tomorrow = async () => {
    const today = (await store()).local_date;
    const [year, month, day] = today.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  };
  const slots = async (storeId = 'saathi-kirana') => (await request(`/api/v1/stores/${storeId}/pickup-slots?date=${await tomorrow()}`)).payload.slots;
  const order = async (cookie, slotId, { key = randomBytes(12).toString('hex'), items = [{ product_id: 'tomato', quantity: 1 }], storeId = 'saathi-kirana' } = {}) => request('/api/v1/orders', {
    cookie, method: 'POST', headers: { 'Idempotency-Key': key }, body: { store_id: storeId, slot_id: slotId, items }
  });
  const close = async () => {
    await new Promise(resolve => server.close(resolve));
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    rmSync(directory, { recursive: true, force: true });
  };
  return { get base() { return base; }, request, login, store, tomorrow, slots, order, close, dbPath, otherSellerCookie, restart: async () => {
    await new Promise(resolve => server.close(resolve));
    server = createAppServer({ dbPath });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
    return server;
  } };
}

test('sample storefront exposes catalogue and blocks unauthenticated checkout', async t => {
  const app = await fixture(); t.after(app.close);
  const stores = await app.request('/api/v1/stores');
  assert.equal(stores.response.status, 200);
  assert.equal(stores.payload.stores.length, 1);
  const products = await app.request('/api/v1/stores/saathi-kirana/products?q=tomato');
  assert.equal(products.payload.products.length, 1);
  assert.equal(products.payload.products[0].price_minor, 2800);
  assert.equal(products.payload.products[0].on_hand, undefined, 'shopper endpoint must not expose stock-on-hand');
  const unauthorized = await app.request('/api/v1/orders', { method: 'POST', body: {} });
  assert.equal(unauthorized.response.status, 401);
});

test('checkout is idempotent, records paise snapshots, and survives service restart', async t => {
  const app = await fixture(); t.after(app.close);
  const shopper = await app.login('shopper');
  const seller = await app.login('seller');
  const slot = (await app.slots())[0];
  const key = randomBytes(16).toString('hex');
  const first = await app.order(shopper.cookie, slot.id, { key });
  assert.equal(first.response.status, 201);
  assert.equal(first.payload.order.total_minor, 2800);
  assert.equal(first.payload.order.items[0].price_minor, 2800);
  assert.equal(first.payload.order.pickup_code.length, 8);
  const retry = await app.order(shopper.cookie, slot.id, { key });
  assert.equal(retry.payload.order.id, first.payload.order.id);
  const changedRetry = await app.order(shopper.cookie, slot.id, { key, items: [{ product_id: 'onion', quantity: 1 }] });
  assert.equal(changedRetry.response.status, 409);
  const edit = await app.request('/api/v1/seller/products/tomato', { cookie: seller.cookie, method: 'PATCH', body: { price_minor: 3900 } });
  assert.equal(edit.response.status, 200);
  const persisted = (await app.request(`/api/v1/orders/${first.payload.order.id}`, { cookie: shopper.cookie })).payload.order;
  assert.equal(persisted.items[0].price_minor, 2800);
  await app.restart();
  const afterRestart = await app.request(`/api/v1/orders/${first.payload.order.id}`, { cookie: shopper.cookie });
  assert.equal(afterRestart.response.status, 200);
  assert.equal(afterRestart.payload.order.id, first.payload.order.id);
});

test('checkout rejects a changed displayed price without reserving stock or creating an order', async t => {
  const app = await fixture(); t.after(app.close);
  const shopper = await app.login('shopper');
  const seller = await app.login('seller');
  const slot = (await app.slots())[0];
  assert.equal((await app.request('/api/v1/seller/products/tomato', { cookie: seller.cookie, method: 'PATCH', body: { price_minor: 3100 } })).response.status, 200);
  const stale = await app.order(shopper.cookie, slot.id, { items: [{ product_id: 'tomato', quantity: 1, expected_price_minor: 2800 }] });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.code, 'PRICE_CHANGED');
  const products = (await app.request('/api/v1/seller/stores/saathi-kirana/products', { cookie: seller.cookie })).payload.products;
  assert.equal(products.find(item => item.id === 'tomato').reserved, 0);
  assert.equal((await app.request('/api/v1/seller/stores/saathi-kirana/orders', { cookie: seller.cookie })).payload.orders.length, 0);
  const current = await app.order(shopper.cookie, slot.id, { items: [{ product_id: 'tomato', quantity: 1, expected_price_minor: 3100 }] });
  assert.equal(current.response.status, 201);
  assert.equal(current.payload.order.total_minor, 3100);
});

test('shopper cancellation before packing releases stock and slot exactly once', async t => {
  const app = await fixture(); t.after(app.close);
  const shopper = await app.login('shopper');
  const slot = (await app.slots())[0];
  const placed = await app.order(shopper.cookie, slot.id);
  const orderId = placed.payload.order.id;
  const unavailable = (await app.request('/api/v1/stores/saathi-kirana/products?q=tomato')).payload.products[0];
  assert.equal(unavailable.available, 7);
  const cancelled = await app.request(`/api/v1/orders/${orderId}/cancel`, { cookie: shopper.cookie, method: 'POST', body: { reason: 'Test cancellation' } });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.payload.order.status, 'cancelled');
  const again = await app.request(`/api/v1/orders/${orderId}/cancel`, { cookie: shopper.cookie, method: 'POST', body: {} });
  assert.equal(again.response.status, 409);
  const restored = (await app.request('/api/v1/stores/saathi-kirana/products?q=tomato')).payload.products[0];
  assert.equal(restored.available, 8);
  const slotAfter = (await app.slots()).find(item => item.id === slot.id);
  assert.equal(slotAfter.reserved_count, 0);
});

test('seller workflow requires membership and a valid pickup code, and codes cannot be reused', async t => {
  const app = await fixture({ extraStore: true }); t.after(app.close);
  const shopper = await app.login('shopper');
  const seller = await app.login('seller');
  const otherStoreSeller = app.otherSellerCookie;
  const otherShopAccess = await app.request('/api/v1/seller/stores/other-shop/products', { cookie: seller.cookie });
  assert.equal(otherShopAccess.response.status, 403);
  const pilotAccess = await app.request('/api/v1/seller/stores/saathi-kirana/products', { cookie: otherStoreSeller });
  assert.equal(pilotAccess.response.status, 403);
  const slot = (await app.slots())[0];
  const placed = await app.order(shopper.cookie, slot.id);
  const id = placed.payload.order.id, pickupCode = placed.payload.order.pickup_code;
  const wrong = await app.request(`/api/v1/seller/orders/${id}/start-packing`, { cookie: shopper.cookie, method: 'POST' });
  assert.equal(wrong.response.status, 403);
  assert.equal((await app.request(`/api/v1/seller/orders/${id}/start-packing`, { cookie: seller.cookie, method: 'POST' })).response.status, 200);
  assert.equal((await app.request(`/api/v1/seller/orders/${id}/mark-ready`, { cookie: seller.cookie, method: 'POST', body: { bag_label: 'BAG-TEST1', pickup_location: 'Front counter' } })).response.status, 200);
  const invalid = await app.request(`/api/v1/seller/orders/${id}/complete-pickup`, { cookie: seller.cookie, method: 'POST', body: { pickup_code: 'XXXXXXXX' } });
  assert.equal(invalid.response.status, 400);
  assert.equal((await app.request(`/api/v1/orders/${id}`, { cookie: shopper.cookie })).payload.order.status, 'ready');
  const completed = await app.request(`/api/v1/seller/orders/${id}/complete-pickup`, { cookie: seller.cookie, method: 'POST', body: { pickup_code: pickupCode } });
  assert.equal(completed.response.status, 200);
  assert.equal(completed.payload.order.status, 'collected');
  const reused = await app.request(`/api/v1/seller/orders/${id}/complete-pickup`, { cookie: seller.cookie, method: 'POST', body: { pickup_code: pickupCode } });
  assert.equal(reused.response.status, 409);
  const stock = (await app.request('/api/v1/stores/saathi-kirana/products?q=tomato')).payload.products[0];
  assert.equal(stock.available, 7, 'collection deducts sold stock');
});

test('a shopper cannot read another shopper\'s order', async t => {
  const app = await fixture(); t.after(app.close);
  const shopper = await app.login('shopper');
  const slot = (await app.slots())[0];
  const placed = await app.order(shopper.cookie, slot.id);
  const db = openDatabase(app.dbPath);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO users (id,role,display_name,created_at) VALUES ('another-shopper','shopper','Another shopper',?)`).run(now);
  const token = randomBytes(32).toString('base64url'); createSession(db, 'another-shopper', token); db.close();
  const denied = await app.request(`/api/v1/orders/${placed.payload.order.id}`, { cookie: `kc_session=${token}` });
  assert.equal(denied.response.status, 404);
});

test('capacity-one concurrent checkouts cannot oversell or overbook', async t => {
  const app = await fixture(); t.after(app.close);
  const shopper = await app.login('shopper');
  const seller = await app.login('seller');
  assert.equal((await app.request('/api/v1/seller/products/tomato', { cookie: seller.cookie, method: 'PATCH', body: { on_hand: 1 } })).response.status, 200);
  assert.equal((await app.request('/api/v1/seller/stores/saathi-kirana/pickup-settings', { cookie: seller.cookie, method: 'PUT', body: { evening_start: '17:30', evening_end: '19:30', slot_minutes: 30, capacity: 1, cutoff_minutes: 30 } })).response.status, 200);
  const slot = (await app.slots())[0];
  const [left, right] = await Promise.all([
    app.order(shopper.cookie, slot.id, { key: randomBytes(16).toString('hex') }),
    app.order(shopper.cookie, slot.id, { key: randomBytes(16).toString('hex') })
  ]);
  const successes = [left, right].filter(result => result.response.status === 201);
  const conflicts = [left, right].filter(result => result.response.status === 409);
  assert.equal(successes.length, 1);
  assert.equal(conflicts.length, 1);
  const products = (await app.request('/api/v1/seller/stores/saathi-kirana/products', { cookie: seller.cookie })).payload.products;
  assert.equal(products.find(item => item.id === 'tomato').reserved, 1);
  const orders = (await app.request('/api/v1/seller/stores/saathi-kirana/orders', { cookie: seller.cookie })).payload.orders;
  assert.equal(orders.length, 1);
  assert.equal((await app.slots()).some(item => item.id === slot.id), false, 'full slot must not appear in bookable slots');
});

test('sample sign-in is disabled when running in production mode', async t => {
  const app = await fixture({ production: true }); t.after(app.close);
  const session = await app.request('/api/v1/auth/session');
  assert.equal(session.payload.demo_available, false);
  const attempt = await app.request('/api/v1/auth/demo', { method: 'POST', body: { role: 'seller' } });
  assert.equal(attempt.response.status, 404);
});
