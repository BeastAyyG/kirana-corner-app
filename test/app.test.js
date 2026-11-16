import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAppServer } from '../src/server.js';

test('basket price-note is computed before item rendering', () => {
  const modular=new URL('../public/js/views/cart.js',import.meta.url);
  if(existsSync(modular)){
    const source=readFileSync(modular,'utf8');
    const start=source.indexOf('export async function renderCart(');
    assert.ok(start>=0,'cart renderer should exist');
    const note=source.indexOf('const priceChanged =',start);
    const items=source.indexOf('lines.map(',start);
    assert.ok(note>=0&&items>=0&&note<items,'price-change note must be computed before rendering item lines');
    return;
  }
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('function renderBasket()');
  const end=source.indexOf('function renderSlots()',start);
  assert.ok(start>=0&&end>start,'basket renderer should exist');
  const renderer=source.slice(start,end);
  const note=renderer.indexOf('const priceNote=');
  const items=renderer.indexOf('const contents = lines.map');
  assert.ok(note>=0&&items>=0&&note<items,'priceNote must be initialized before rendering item lines');
});

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
  const previousSecret = process.env.KIRANA_PICKUP_CODE_SECRET;
  const previousSessionSecret = process.env.KIRANA_SESSION_SECRET;
  const previousConsoleOtp = process.env.KIRANA_ALLOW_CONSOLE_OTP;
  if (production) {
    process.env.NODE_ENV = 'production';
    process.env.KIRANA_PICKUP_CODE_SECRET = randomBytes(40).toString('base64url');
    process.env.KIRANA_SESSION_SECRET = randomBytes(40).toString('base64url');
    process.env.KIRANA_ALLOW_CONSOLE_OTP = 'true';
  }
  const v2DbPath = join(directory, 'delivery.sqlite');
  let server = createAppServer({ dbPath, v2DbPath });
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
    if (previousSecret === undefined) delete process.env.KIRANA_PICKUP_CODE_SECRET;
    else process.env.KIRANA_PICKUP_CODE_SECRET = previousSecret;
    if (previousSessionSecret === undefined) delete process.env.KIRANA_SESSION_SECRET;
    else process.env.KIRANA_SESSION_SECRET = previousSessionSecret;
    if (previousConsoleOtp === undefined) delete process.env.KIRANA_ALLOW_CONSOLE_OTP;
    else process.env.KIRANA_ALLOW_CONSOLE_OTP = previousConsoleOtp;
    rmSync(directory, { recursive: true, force: true });
  };
  return { get base() { return base; }, request, login, store, tomorrow, slots, order, close, dbPath, otherSellerCookie, restart: async () => {
    await new Promise(resolve => server.close(resolve));
    server = createAppServer({ dbPath, v2DbPath });
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

test('duplicate raw product entries cannot bypass the aggregate quantity cap', async t => {
  const app=await fixture();t.after(app.close);
  const shopper=await app.login('shopper');
  const slot=(await app.slots())[0];
  const result=await app.order(shopper.cookie,slot.id,{items:[{product_id:'tomato',quantity:60},{product_id:'tomato',quantity:40}]});
  assert.equal(result.response.status,400);
  assert.equal(result.payload.code,'INVALID_ORDER_ITEM');
  const products=(await app.request('/api/v1/seller/stores/saathi-kirana/products',{cookie:(await app.login('seller')).cookie})).payload.products;
  assert.equal(products.find(item=>item.id==='tomato').reserved,0);
});

test('production refuses to start with a missing or weak pickup-code secret', async t => {
  const priorEnv=process.env.NODE_ENV,priorSecret=process.env.KIRANA_PICKUP_CODE_SECRET;
  process.env.NODE_ENV='production';delete process.env.KIRANA_PICKUP_CODE_SECRET;
  try { assert.throws(()=>openDatabase(':memory:'),/requires a unique KIRANA_PICKUP_CODE_SECRET/); }
  finally {if(priorEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=priorEnv;if(priorSecret===undefined)delete process.env.KIRANA_PICKUP_CODE_SECRET;else process.env.KIRANA_PICKUP_CODE_SECRET=priorSecret;}
});

test('catalog filters, product details, shopper profile, basket and saved items are scoped and persistent', async t => {
  const app=await fixture();t.after(app.close);
  const products=(await app.request('/api/v1/stores/saathi-kirana/products?in_stock=true&sort=price_asc')).payload.products;
  assert.ok(products.length>10);assert.ok(products.every(item=>item.available>0));assert.ok(products[0].price_minor<=products.at(-1).price_minor);
  const details=await app.request('/api/v1/stores/saathi-kirana/products/tomato');
  assert.equal(details.response.status,200);assert.ok(details.payload.product.description);
  const shopper=await app.login('shopper');
  const basket=await app.request('/api/v1/shopper/basket',{cookie:shopper.cookie,method:'PUT',body:{store_id:'saathi-kirana',items:[{product_id:'tomato',quantity:2}]}});
  assert.equal(basket.response.status,200);assert.equal(basket.payload.basket.items[0].quantity,2);
  assert.equal((await app.request('/api/v1/shopper/basket',{cookie:shopper.cookie})).payload.basket.items[0].price_minor,2800);
  const saved=await app.request('/api/v1/shopper/me/saved-products/tomato',{cookie:shopper.cookie,method:'PUT'});
  assert.equal(saved.payload.products.length,1);
  assert.equal((await app.request('/api/v1/shopper/me/saved-products',{cookie:shopper.cookie})).payload.products[0].product_id,'tomato');
  const profile=await app.request('/api/v1/shopper/me',{cookie:shopper.cookie,method:'PATCH',body:{display_name:'Ayy Sample'}});
  assert.equal(profile.payload.profile.display_name,'Ayy Sample');
  const contact=await app.request('/api/v1/shopper/me',{cookie:shopper.cookie,method:'PATCH',body:{email:'person@example.com'}});
  assert.equal(contact.response.status,400);assert.equal(contact.payload.code,'CONTACT_DETAILS_DISABLED');
  await app.restart();
  assert.equal((await app.request('/api/v1/shopper/basket',{cookie:shopper.cookie})).payload.basket.items[0].quantity,2);
  assert.equal((await app.request('/api/v1/shopper/me/saved-products',{cookie:shopper.cookie})).payload.products.length,1);
});

test('persistent baskets preserve a quoted price and flag a later catalog change', async t => {
  const app=await fixture();t.after(app.close);
  const shopper=await app.login('shopper');const seller=await app.login('seller');
  const savedQuote=await app.request('/api/v1/shopper/basket',{cookie:shopper.cookie,method:'PUT',body:{store_id:'saathi-kirana',items:[{product_id:'tomato',quantity:2,expected_price_minor:2800}]}});
  assert.equal(savedQuote.payload.basket.items[0].price_changed,false);
  await app.request('/api/v1/seller/products/tomato',{cookie:seller.cookie,method:'PATCH',body:{price_minor:3300}});
  const refreshed=await app.request('/api/v1/shopper/basket',{cookie:shopper.cookie});
  assert.equal(refreshed.payload.basket.items[0].quoted_price_minor,2800);
  assert.equal(refreshed.payload.basket.items[0].price_minor,3300);
  assert.equal(refreshed.payload.basket.items[0].price_changed,true);
  const product=(await app.request('/api/v1/seller/stores/saathi-kirana/products',{cookie:seller.cookie})).payload.products.find(item=>item.id==='tomato');
  assert.equal(product.reserved,0);
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

test('store discovery, filters, product details, and seller store/queue controls work', async t => {
  const app=await fixture({extraStore:true});t.after(app.close);
  const discovered=await app.request('/api/v1/stores?q=Other');
  assert.equal(discovered.payload.stores.length,1);assert.equal(discovered.payload.stores[0].id,'other-shop');
  const filter=await app.request('/api/v1/stores/saathi-kirana/products?min_price=50&max_price=80&sort=price_asc&in_stock=true');
  assert.ok(filter.payload.products.length>0);assert.ok(filter.payload.products.every(p=>p.price_minor>=5000&&p.price_minor<=8000&&p.available>0));
  const seller=await app.login('seller');
  const sellerStores=await app.request('/api/v1/seller/stores',{cookie:seller.cookie});
  assert.deepEqual(sellerStores.payload.stores.map(s=>s.id),['saathi-kirana']);
  const closed=await app.request('/api/v1/seller/stores/saathi-kirana',{cookie:seller.cookie,method:'PATCH',body:{is_open:false,pickup_location:'Side door'}});
  assert.equal(closed.response.status,200);assert.equal(closed.payload.store.is_open,false);
  assert.equal((await app.request('/api/v1/stores')).payload.stores.find(s=>s.id==='saathi-kirana').is_open,false);
  const reopened=await app.request('/api/v1/seller/stores/saathi-kirana',{cookie:seller.cookie,method:'PATCH',body:{is_open:true,pickup_location:'Main counter'}});
  assert.equal(reopened.payload.store.pickup_location,'Main counter');
  const date=await app.tomorrow();
  const settings=await app.request('/api/v1/seller/stores/saathi-kirana/pickup-settings',{cookie:seller.cookie});
  const update=await app.request('/api/v1/seller/stores/saathi-kirana/pickup-settings',{cookie:seller.cookie,method:'PUT',body:{...settings.payload.settings,closure_dates:[date],service_days:[0,1,2,3,4,5,6]}});
  assert.equal(update.response.status,200);
  assert.equal((await app.request(`/api/v1/stores/saathi-kirana/pickup-slots?date=${date}`)).payload.slots.length,0);
  const clear=await app.request('/api/v1/seller/stores/saathi-kirana/pickup-settings',{cookie:seller.cookie,method:'PUT',body:{...update.payload.settings,closure_dates:[]}});
  assert.equal(clear.response.status,200);
  const shopper=await app.login('shopper');const slot=(await app.slots())[0];
  const placed=await app.order(shopper.cookie,slot.id);
  const query=await app.request(`/api/v1/seller/stores/saathi-kirana/orders?date=${date}&status=placed&q=${placed.payload.order.public_label}`,{cookie:seller.cookie});
  assert.equal(query.payload.orders.length,1);
  assert.equal(query.payload.orders[0].public_label,placed.payload.order.public_label);
});

test('sample sign-in is disabled when running in production mode', async t => {
  const app = await fixture({ production: true }); t.after(app.close);
  const session = await app.request('/api/v1/auth/session');
  assert.equal(session.payload.demo_available, false);
  const attempt = await app.request('/api/v1/auth/demo', { method: 'POST', body: { role: 'seller' } });
  assert.equal(attempt.response.status, 404);
});
