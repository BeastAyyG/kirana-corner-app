import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAppServer } from '../src/server.js';
import { hmac } from '../src/v2/util.js';

const PHONES = {
  admin: '9000000001', picker: '9000000002', picker2: '9000000003',
  rider: '9000000011', rider2: '9000000012', customer: '9000000021'
};
const STORE = 'saathi-koramangala';
const ADDRESS = 'addr-demo-home';

async function makeApp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'kirana-v2-'));
  const paths = { dbPath: join(dir, 'v1.sqlite'), v2DbPath: join(dir, 'v2.sqlite') };
  let server = createAppServer(paths);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let base = `http://127.0.0.1:${server.address().port}`;
  const api = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
    const response = await fetch(`${base}/api/v2${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, payload, headers: response.headers };
  };
  const login = async phone => {
    const requested = await api('/auth/otp/request', { method: 'POST', body: { phone } });
    assert.equal(requested.status, 200, JSON.stringify(requested.payload));
    const verified = await api('/auth/otp/verify', { method: 'POST', body: { phone, code: requested.payload.dev_code } });
    assert.equal(verified.status, 200, JSON.stringify(verified.payload));
    return verified.payload.token;
  };
  const close = async () => {
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  };
  t.after(close);
  return {
    api, login, get base() { return base; }, dir,
    restart: async () => {
      await new Promise(resolve => server.close(resolve));
      server = createAppServer(paths);
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      base = `http://127.0.0.1:${server.address().port}`;
    }
  };
}

const key = () => randomBytes(12).toString('hex');
const addItems = async (app, token, items) => {
  for (const item of items) {
    const added = await app.api('/cart/items', { method: 'POST', token, body: { store_id: STORE, product_id: item.product_id, quantity: item.quantity } });
    assert.equal(added.status, 200, JSON.stringify(added.payload));
  }
};
const placeOrder = async (app, token, { payment = 'cod', coupon, tip = 0, deliveryType = 'instant', slotId = null } = {}) =>
  app.api('/orders', {
    method: 'POST', token, headers: { 'Idempotency-Key': key() },
    body: { address_id: ADDRESS, payment_method: payment, coupon_code: coupon, tip_minor: tip, delivery_type: deliveryType, slot_id: slotId }
  });

async function driveToPacked(app, { payment = 'cod' } = {}) {
  const customer = await app.login(PHONES.customer);
  const picker = await app.login(PHONES.picker);
  const rider = await app.login(PHONES.rider);
  await app.api('/rider/availability', { method: 'POST', token: rider, body: { online: true } });
  await addItems(app, customer, [{ product_id: 'tomato', quantity: 2 }, { product_id: 'amul-milk', quantity: 1 }]);
  const placed = await placeOrder(app, customer, { payment });
  assert.equal(placed.status, 201, JSON.stringify(placed.payload));
  const orderId = placed.payload.order.id;
  if (payment === 'online') {
    const confirmed = await app.api(`/payments/${placed.payload.payment.payment_id}/confirm`, { method: 'POST', token: customer });
    assert.equal(confirmed.status, 200);
  }
  const packing = await app.api(`/store/orders/${orderId}/start-packing`, { method: 'POST', token: picker });
  assert.equal(packing.status, 200, JSON.stringify(packing.payload));
  const packed = await app.api(`/store/orders/${orderId}/pack`, { method: 'POST', token: picker });
  assert.equal(packed.status, 200, JSON.stringify(packed.payload));
  return { customer, picker, rider, orderId, placed };
}

test('OTP auth: request, cooldown, wrong code, verify, session, logout, auto-register', async t => {
  const app = await makeApp(t);
  const requested = await app.api('/auth/otp/request', { method: 'POST', body: { phone: PHONES.customer } });
  assert.equal(requested.status, 200);
  assert.match(requested.payload.dev_code, /^\d{6}$/);
  const cooldown = await app.api('/auth/otp/request', { method: 'POST', body: { phone: PHONES.customer } });
  assert.equal(cooldown.status, 429);
  assert.equal(cooldown.payload.code, 'OTP_COOLDOWN');
  const wrongCode = requested.payload.dev_code === '000000' ? '111111' : '000000';
  const wrong = await app.api('/auth/otp/verify', { method: 'POST', body: { phone: PHONES.customer, code: wrongCode } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.payload.code, 'OTP_INCORRECT');
  const verified = await app.api('/auth/otp/verify', { method: 'POST', body: { phone: PHONES.customer, code: requested.payload.dev_code } });
  assert.equal(verified.status, 200);
  assert.equal(verified.payload.user.role, 'customer');
  const me = await app.api('/auth/me', { token: verified.payload.token });
  assert.equal(me.status, 200);
  assert.equal(me.payload.user.phone, '+919000000021');
  const noAuth = await app.api('/auth/me');
  assert.equal(noAuth.status, 401);
  await app.api('/auth/logout', { method: 'POST', token: verified.payload.token });
  const revoked = await app.api('/auth/me', { token: verified.payload.token });
  assert.equal(revoked.status, 401);
  const fresh = await app.login('9000000099');
  const freshMe = await app.api('/auth/me', { token: fresh });
  assert.equal(freshMe.payload.user.role, 'customer');
  const invalid = await app.api('/auth/otp/request', { method: 'POST', body: { phone: '12345' } });
  assert.equal(invalid.status, 400);
});

test('staff roles come from seeded accounts, not self-registration', async t => {
  const app = await makeApp(t);
  const picker = await app.login(PHONES.picker);
  const me = await app.api('/auth/me', { token: picker });
  assert.equal(me.payload.user.role, 'picker');
  const rider = await app.login(PHONES.rider);
  assert.equal((await app.api('/auth/me', { token: rider })).payload.user.role, 'rider');
  const admin = await app.login(PHONES.admin);
  assert.equal((await app.api('/auth/me', { token: admin })).payload.user.role, 'admin');
});

test('serviceability, address CRUD, catalog browse/search/filter', async t => {
  const app = await makeApp(t);
  const near = await app.api('/serviceability', { method: 'POST', body: { lat: 12.939, lng: 77.621 } });
  assert.equal(near.status, 200);
  assert.equal(near.payload.serviceable, true);
  assert.equal(near.payload.store.id, STORE);
  assert.ok(near.payload.eta_minutes >= 8);
  const far = await app.api('/serviceability', { method: 'POST', body: { lat: 13.2, lng: 77.9 } });
  assert.equal(far.payload.serviceable, false);
  const customer = await app.login(PHONES.customer);
  const listed = await app.api('/addresses', { token: customer });
  assert.equal(listed.payload.addresses.length, 1);
  const created = await app.api('/addresses', {
    method: 'POST', token: customer,
    body: { label: 'Work', receiver_name: 'Demo', receiver_phone: '9000000021', line1: '42, MG Road', city: 'Bengaluru', pincode: '560001', lat: 12.975, lng: 77.606 }
  });
  assert.equal(created.status, 201);
  const patched = await app.api(`/addresses/${created.payload.address.id}`, { method: 'PATCH', token: customer, body: { label: 'Office' } });
  assert.equal(patched.payload.address.label, 'Office');
  const deleted = await app.api(`/addresses/${created.payload.address.id}`, { method: 'DELETE', token: customer });
  assert.equal(deleted.payload.deleted, true);
  const categories = await app.api('/categories');
  assert.equal(categories.payload.categories.length, 12);
  const search = await app.api(`/stores/${STORE}/products?q=milk`);
  assert.ok(search.payload.products.some(p => p.id === 'amul-milk'));
  const filtered = await app.api(`/stores/${STORE}/products?category=dairy-breakfast&in_stock=true&sort=price_asc&page_size=5`);
  assert.equal(filtered.payload.products.length, 5);
  assert.ok(filtered.payload.products.every(p => p.category_id === 'dairy-breakfast'));
  const detail = await app.api(`/stores/${STORE}/products/amul-milk`);
  assert.equal(detail.payload.product.price_minor, 2700);
  assert.equal(detail.payload.product.mrp_minor, 2800);
  assert.equal(detail.payload.product.discount_percent, 4);
  assert.equal(detail.payload.product.on_hand, undefined, 'public catalog must not expose on_hand');
});

test('cart limits and quote bill math (fees, free-delivery threshold, coupon, tip)', async t => {
  const app = await makeApp(t);
  const customer = await app.login(PHONES.customer);
  await addItems(app, customer, [{ product_id: 'amul-milk', quantity: 2 }, { product_id: 'bread', quantity: 1 }]);
  const small = await app.api('/cart/quote', { method: 'POST', token: customer, body: { address_id: ADDRESS } });
  assert.equal(small.status, 200);
  const bill = small.payload.quote.bill;
  assert.equal(bill.items_total_minor, 2 * 2700 + 4200);
  assert.ok(bill.delivery_fee_minor > 2500 && bill.delivery_fee_minor < 3500, 'distance-based delivery fee');
  assert.equal(bill.handling_fee_minor, 900);
  assert.equal(bill.grand_total_minor, bill.items_total_minor + bill.delivery_fee_minor + bill.handling_fee_minor);
  const tooMany = await app.api('/cart/items', { method: 'POST', token: customer, body: { store_id: STORE, product_id: 'amul-milk', quantity: 9 } });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.payload.code, 'MAX_PER_ORDER');
  const mixed = await app.api('/cart/items', { method: 'POST', token: customer, body: { store_id: 'saathi-hsr', product_id: 'tomato', quantity: 1 } });
  assert.equal(mixed.status, 409);
  assert.equal(mixed.payload.code, 'CART_STORE_CONFLICT');
  await addItems(app, customer, [{ product_id: 'atta', quantity: 1 }]);
  const big = await app.api('/cart/quote', { method: 'POST', token: customer, body: { address_id: ADDRESS, coupon_code: 'WELCOME50', tip_minor: 2000 } });
  const bigBill = big.payload.quote.bill;
  assert.equal(bigBill.delivery_fee_minor, 0, 'free delivery above threshold');
  assert.equal(bigBill.coupon_discount_minor, 5000);
  assert.equal(bigBill.tip_minor, 2000);
  assert.equal(bigBill.grand_total_minor, bigBill.items_total_minor - 5000 + 900 + 2000);
  const reused = await app.api('/cart/quote', { method: 'POST', token: customer, body: { address_id: ADDRESS, coupon_code: 'SAVE10' } });
  assert.equal(reused.status, 200);
  assert.equal(reused.payload.quote.bill.coupon_discount_minor, Math.min(Math.floor(reused.payload.quote.bill.items_total_minor * 0.1), 7500));
  const badCoupon = await app.api('/cart/quote', { method: 'POST', token: customer, body: { address_id: ADDRESS, coupon_code: 'NOPE' } });
  assert.equal(badCoupon.status, 400);
});

test('COD checkout: idempotency, reservation, shortage, full rider lifecycle, rating, reorder', async t => {
  const app = await makeApp(t);
  const customer = await app.login(PHONES.customer);
  const picker = await app.login(PHONES.picker);
  const rider = await app.login(PHONES.rider);
  await app.api('/rider/availability', { method: 'POST', token: rider, body: { online: true } });
  await addItems(app, customer, [{ product_id: 'tomato', quantity: 2 }, { product_id: 'amul-milk', quantity: 1 }]);
  const stockBefore = (await app.api(`/stores/${STORE}/products/tomato`)).payload.product.available;
  const quote = (await app.api('/cart/quote', { method: 'POST', token: customer, body: { address_id: ADDRESS, tip_minor: 1000 } })).payload.quote;
  const idem = key();
  const placed = await app.api('/orders', {
    method: 'POST', token: customer, headers: { 'Idempotency-Key': idem },
    body: { address_id: ADDRESS, payment_method: 'cod', tip_minor: 1000 }
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.payload));
  const order = placed.payload.order;
  assert.equal(order.status, 'placed');
  assert.equal(order.payment_status, 'cod_due');
  assert.equal(order.bill.grand_total_minor, quote.bill.grand_total_minor);
  assert.match(order.delivery_otp, /^\d{4}$/);
  const replay = await app.api('/orders', {
    method: 'POST', token: customer, headers: { 'Idempotency-Key': idem },
    body: { address_id: ADDRESS, payment_method: 'cod', tip_minor: 1000 }
  });
  assert.equal(replay.payload.order.id, order.id);
  const conflict = await app.api('/orders', {
    method: 'POST', token: customer, headers: { 'Idempotency-Key': idem },
    body: { address_id: ADDRESS, payment_method: 'cod', tip_minor: 2000 }
  });
  assert.equal(conflict.status, 409);
  const catalogAfter = await app.api(`/stores/${STORE}/products/tomato`);
  assert.equal(catalogAfter.payload.product.available, stockBefore - 2, 'stock reserved at checkout');
  const queue = await app.api(`/store/${STORE}/queue`, { token: picker });
  assert.ok(queue.payload.orders.some(o => o.id === order.id));
  const start = await app.api(`/store/orders/${order.id}/start-packing`, { method: 'POST', token: picker });
  assert.equal(start.payload.order.status, 'packing');
  const tomatoItem = start.payload.order.items.find(item => item.product_id === 'tomato');
  assert.ok(tomatoItem.aisle, 'picker sees aisle location');
  const picked = await app.api(`/store/orders/${order.id}/items/${tomatoItem.id}/pick`, { method: 'POST', token: picker, body: { picked_quantity: 1 } });
  assert.equal(picked.status, 200);
  const packed = await app.api(`/store/orders/${order.id}/pack`, { method: 'POST', token: picker });
  assert.equal(packed.payload.order.status, 'packed');
  assert.equal(packed.payload.order.bill.cod_due_minor, order.bill.cod_due_minor - 2800, 'shortage reduces COD due');
  const jobs = await app.api('/rider/jobs', { token: rider });
  const job = jobs.payload.jobs.find(j => j.order_id === order.id);
  assert.equal(job.status, 'offered');
  const accepted = await app.api(`/rider/jobs/${job.id}/accept`, { method: 'POST', token: rider });
  assert.equal(accepted.payload.job.status, 'accepted');
  assert.ok(accepted.payload.job.pickup_code, 'rider sees pickup code after accepting');
  const badPickup = await app.api(`/rider/jobs/${job.id}/pickup`, { method: 'POST', token: rider, body: { pickup_code: 'XXXXXX' } });
  assert.equal(badPickup.status, 400);
  const pickedUp = await app.api(`/rider/jobs/${job.id}/pickup`, { method: 'POST', token: rider, body: { pickup_code: accepted.payload.job.pickup_code } });
  assert.equal(pickedUp.payload.order.status, 'picked_up');
  const ping = await app.api('/rider/location', { method: 'POST', token: rider, body: { lat: 12.937, lng: 77.622 } });
  assert.equal(ping.status, 200);
  const tracked = await app.api(`/orders/${order.id}`, { token: customer });
  assert.equal(tracked.payload.order.rider.location.lat, 12.937);
  assert.ok(tracked.payload.order.eta_live_minutes >= 1);
  const badOtp = await app.api(`/rider/jobs/${job.id}/deliver`, { method: 'POST', token: rider, body: { delivery_otp: '0000', cash_collected: true } });
  assert.equal(badOtp.status, 400);
  const delivered = await app.api(`/rider/jobs/${job.id}/deliver`, { method: 'POST', token: rider, body: { delivery_otp: order.delivery_otp, cash_collected: true } });
  assert.equal(delivered.payload.order.status, 'delivered');
  assert.equal(delivered.payload.order.payment_status, 'cod_collected');
  const earnings = await app.api('/rider/earnings', { token: rider });
  assert.equal(earnings.payload.earnings.today.deliveries, 1);
  assert.equal(earnings.payload.earnings.today.total_minor, 3500 + 1000);
  const rated = await app.api(`/orders/${order.id}/rate`, { method: 'POST', token: customer, body: { rating: 5, comment: 'Fast!' } });
  assert.equal(rated.payload.order.rating, 5);
  const rateAgain = await app.api(`/orders/${order.id}/rate`, { method: 'POST', token: customer, body: { rating: 4 } });
  assert.equal(rateAgain.status, 409);
  const reordered = await app.api(`/orders/${order.id}/reorder`, { method: 'POST', token: customer });
  assert.ok(reordered.payload.cart.items.length >= 1);
  const notifications = await app.api('/notifications', { token: customer });
  assert.ok(notifications.payload.notifications.length >= 3);
  const first = notifications.payload.notifications[0];
  await app.api(`/notifications/${first.id}/read`, { method: 'POST', token: customer });
  const afterRead = await app.api('/notifications', { token: customer });
  assert.equal(afterRead.payload.notifications.find(n => n.id === first.id).read, true);
});

test('online payment: pending hidden from store, mock confirm, webhook signature, admin cancel refund', async t => {
  const app = await makeApp(t);
  const customer = await app.login(PHONES.customer);
  const picker = await app.login(PHONES.picker);
  const admin = await app.login(PHONES.admin);
  await addItems(app, customer, [{ product_id: 'atta', quantity: 1 }]);
  const placed = await placeOrder(app, customer, { payment: 'online' });
  assert.equal(placed.status, 201);
  assert.equal(placed.payload.order.payment_status, 'pending');
  assert.equal(placed.payload.payment.provider, 'mock');
  const queueBefore = await app.api(`/store/${STORE}/queue`, { token: picker });
  assert.ok(!queueBefore.payload.orders.some(o => o.id === placed.payload.order.id), 'unpaid order hidden from store');
  const raw = JSON.stringify({ event: 'payment.captured', payment_id: placed.payload.payment.payment_id });
  const badSig = await app.api('/payments/webhook/mock', { method: 'POST', headers: { 'x-kirana-signature': 'bad', 'content-type': 'application/json' }, body: JSON.parse(raw) });
  assert.equal(badSig.status, 401);
  const webhook = await fetch(`${app.base}/api/v2/payments/webhook/mock`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-kirana-signature': hmac(raw) }, body: raw
  });
  assert.equal(webhook.status, 200);
  const queueAfter = await app.api(`/store/${STORE}/queue`, { token: picker });
  assert.ok(queueAfter.payload.orders.some(o => o.id === placed.payload.order.id));
  const cancelled = await app.api(`/admin/orders/${placed.payload.order.id}/cancel`, { method: 'POST', token: admin, body: { reason: 'Ops test' } });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.payload.order.status, 'cancelled');
  const overview = await app.api('/admin/overview', { token: admin });
  assert.equal(overview.status, 200);
  const product = await app.api(`/stores/${STORE}/products/atta`);
  assert.ok(product.payload.product.available >= 15, 'reservation released after cancel');
});

test('cancellation rules and coupon release', async t => {
  const app = await makeApp(t);
  const customer = await app.login(PHONES.customer);
  const picker = await app.login(PHONES.picker);
  await addItems(app, customer, [{ product_id: 'atta', quantity: 1 }]);
  const placed = await placeOrder(app, customer, { coupon: 'WELCOME50' });
  assert.equal(placed.payload.order.bill.coupon_discount_minor, 5000);
  const cancelled = await app.api(`/orders/${placed.payload.order.id}/cancel`, { method: 'POST', token: customer, body: { reason: 'Changed my mind' } });
  assert.equal(cancelled.status, 200);
  const coupons = await app.api('/coupons', { token: customer });
  assert.ok(coupons.payload.coupons.some(c => c.code === 'WELCOME50'), 'coupon released for reuse');
  await addItems(app, customer, [{ product_id: 'atta', quantity: 1 }]);
  const second = await placeOrder(app, customer, { coupon: 'WELCOME50' });
  assert.equal(second.status, 201);
  await app.api(`/store/orders/${second.payload.order.id}/start-packing`, { method: 'POST', token: picker });
  const lateCancel = await app.api(`/orders/${second.payload.order.id}/cancel`, { method: 'POST', token: customer });
  assert.equal(lateCancel.status, 409);
  assert.equal(lateCancel.payload.code, 'CANCELLATION_CLOSED');
  const staffCancel = await app.api(`/orders/${second.payload.order.id}/cancel`, { method: 'POST', token: picker, body: { reason: 'Store issue' } });
  assert.equal(staffCancel.status, 200);
});

test('rider decline reassigns; role and store isolation enforced', async t => {
  const app = await makeApp(t);
  const { customer, picker, rider, orderId } = await driveToPacked(app);
  const rider2 = await app.login(PHONES.rider2);
  await app.api('/rider/availability', { method: 'POST', token: rider2, body: { online: true } });
  const jobs1 = await app.api('/rider/jobs', { token: rider });
  const job1 = jobs1.payload.jobs.find(j => j.order_id === orderId);
  assert.equal(job1.status, 'offered');
  const declined = await app.api(`/rider/jobs/${job1.id}/decline`, { method: 'POST', token: rider });
  assert.equal(declined.payload.declined, true);
  const jobs2 = await app.api('/rider/jobs', { token: rider2 });
  const job2 = jobs2.payload.jobs.find(j => j.order_id === orderId);
  assert.equal(job2.status, 'offered', 'reassigned to next nearest rider');
  await app.api(`/rider/jobs/${job2.id}/accept`, { method: 'POST', token: rider2 });
  const stolen = await app.api(`/rider/jobs/${job2.id}/pickup`, { method: 'POST', token: rider, body: { pickup_code: 'AAAAAA' } });
  assert.equal(stolen.status, 404);
  const picker2 = await app.login(PHONES.picker2);
  const foreignQueue = await app.api(`/store/${STORE}/queue`, { token: picker2 });
  assert.equal(foreignQueue.status, 403);
  const foreignPack = await app.api(`/store/orders/${orderId}/start-packing`, { method: 'POST', token: picker2 });
  assert.equal(foreignPack.status, 403);
  const customerQueue = await app.api(`/store/${STORE}/queue`, { token: customer });
  assert.equal(customerQueue.status, 403);
  const customerAdmin = await app.api('/admin/overview', { token: customer });
  assert.equal(customerAdmin.status, 403);
  const anon = await app.api('/orders');
  assert.equal(anon.status, 401);
});

test('SSE stream delivers live order events', async t => {
  const app = await makeApp(t);
  const customer = await app.login(PHONES.customer);
  const picker = await app.login(PHONES.picker);
  await addItems(app, customer, [{ product_id: 'bread', quantity: 1 }]);
  const placed = await placeOrder(app, customer);
  const orderId = placed.payload.order.id;
  const controller = new AbortController();
  const response = await fetch(`${app.base}/api/v2/events/stream?order_id=${orderId}`, {
    headers: { authorization: `Bearer ${customer}` }, signal: controller.signal
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const readUntil = async (needle, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    while (!buffer.includes(needle)) {
      if (Date.now() > deadline) throw new Error(`timeout waiting for ${needle}; got: ${buffer}`);
      const chunk = await Promise.race([reader.read(), new Promise((_, reject) => setTimeout(() => reject(new Error('read timeout')), timeoutMs))]);
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    return buffer;
  };
  await readUntil('event: hello');
  await app.api(`/store/orders/${orderId}/start-packing`, { method: 'POST', token: picker });
  await readUntil('order.status');
  assert.ok(buffer.includes('"status":"packing"'));
  controller.abort();
  await reader.cancel().catch(() => {});
});

test('scheduled delivery slots and persistence across restart', async t => {
  const app = await makeApp(t);
  const customer = await app.login(PHONES.customer);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const slots = await app.api(`/stores/${STORE}/delivery-slots?date=${tomorrow}`);
  assert.equal(slots.status, 200);
  assert.ok(slots.payload.slots.length >= 5);
  const slot = slots.payload.slots[0];
  await addItems(app, customer, [{ product_id: 'sona-rice', quantity: 1 }]);
  const placed = await placeOrder(app, customer, { deliveryType: 'scheduled', slotId: slot.id });
  assert.equal(placed.status, 201, JSON.stringify(placed.payload));
  assert.equal(placed.payload.order.delivery_type, 'scheduled');
  assert.equal(placed.payload.order.slot.id, slot.id);
  const slotsAfter = await app.api(`/stores/${STORE}/delivery-slots?date=${tomorrow}`);
  assert.equal(slotsAfter.payload.slots.find(s => s.id === slot.id).remaining, slot.remaining - 1);
  const orderId = placed.payload.order.id;
  await app.restart();
  const me = await app.api('/auth/me', { token: customer });
  assert.equal(me.status, 200, 'session survives restart');
  const order = await app.api(`/orders/${orderId}`, { token: customer });
  assert.equal(order.payload.order.id, orderId);
  assert.equal(order.payload.order.delivery_type, 'scheduled');
});

test('admin ops: overview, store creation, staff onboarding, coupons, suspension, audit', async t => {
  const app = await makeApp(t);
  const admin = await app.login(PHONES.admin);
  const overview = await app.api('/admin/overview', { token: admin });
  assert.equal(overview.status, 200);
  assert.ok(overview.payload.overview.users_by_role.customer >= 1);
  const store = await app.api('/admin/stores', {
    method: 'POST', token: admin,
    body: { id: 'saathi-whitefield', name: 'Saathi Kirana — Whitefield', address: '100 Main Rd, Whitefield', city: 'Bengaluru', pincode: '560066', lat: 12.9698, lng: 77.75, radius_km: 3 }
  });
  assert.equal(store.status, 201);
  const rider = await app.api('/admin/users', { method: 'POST', token: admin, body: { phone: '9000000077', name: 'New Rider', role: 'rider', home_store_id: 'saathi-whitefield' } });
  assert.equal(rider.status, 201);
  const riderToken = await app.login('9000000077');
  const riderMe = await app.api('/rider/me', { token: riderToken });
  assert.equal(riderMe.payload.rider.home_store_id, 'saathi-whitefield');
  const coupon = await app.api('/admin/coupons', {
    method: 'POST', token: admin,
    body: { code: 'TEST20', type: 'flat', value: 2000, min_order_minor: 9900, starts_at: '2026-01-01T00:00:00.000Z', ends_at: '2027-01-01T00:00:00.000Z' }
  });
  assert.equal(coupon.status, 201);
  const customer = await app.login(PHONES.customer);
  const available = await app.api('/coupons', { token: customer });
  assert.ok(available.payload.coupons.some(c => c.code === 'TEST20'));
  const suspended = await app.api(`/admin/users/${(await app.api('/auth/me', { token: customer })).payload.user.id}`, { method: 'PATCH', token: admin, body: { active: false } });
  assert.equal(suspended.status, 200);
  const blocked = await app.api('/auth/me', { token: customer });
  assert.equal(blocked.status, 401);
  const audit = await app.api('/admin/audit', { token: admin });
  assert.ok(audit.payload.events.length >= 3);
});

test('checkout guards: price change, out-of-range address, empty cart, store closed', async t => {
  const app = await makeApp(t);
  const customer = await app.login(PHONES.customer);
  const picker = await app.login(PHONES.picker);
  const empty = await placeOrder(app, customer);
  assert.equal(empty.status, 400);
  await addItems(app, customer, [{ product_id: 'amul-milk', quantity: 1 }]);
  const stale = await app.api('/orders', {
    method: 'POST', token: customer, headers: { 'Idempotency-Key': key() },
    body: { address_id: ADDRESS, items: [{ product_id: 'amul-milk', quantity: 1, expected_price_minor: 2500 }], store_id: STORE, payment_method: 'cod' }
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.code, 'PRICE_CHANGED');
  const farAddress = await app.api('/addresses', {
    method: 'POST', token: customer,
    body: { label: 'Far', receiver_name: 'D', receiver_phone: '9000000021', line1: 'Far away', city: 'Bengaluru', pincode: '560100', lat: 13.1, lng: 77.7 }
  });
  const outOfRange = await app.api('/orders', {
    method: 'POST', token: customer, headers: { 'Idempotency-Key': key() },
    body: { address_id: farAddress.payload.address.id, payment_method: 'cod' }
  });
  assert.equal(outOfRange.status, 409);
  assert.equal(outOfRange.payload.code, 'OUT_OF_RANGE');
  await app.api(`/store/${STORE}/settings`, { method: 'PUT', token: picker, body: { accepting_orders: false } });
  const closed = await placeOrder(app, customer);
  assert.equal(closed.status, 409);
  assert.equal(closed.payload.code, 'STORE_CLOSED');
  await app.api(`/store/${STORE}/settings`, { method: 'PUT', token: picker, body: { accepting_orders: true } });
});