// End-to-end smoke: boots the real server on an ephemeral port with throwaway
// databases and drives a complete quick-commerce lifecycle over HTTP.
// Usage: node scripts/smoke.mjs   (exits 0 on success, 1 on any failure)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAppServer } from '../src/server.js';

let passed = 0;
const ok = (label, condition, detail = '') => {
  if (!condition) throw new Error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  passed += 1;
  console.log(`  ok ${label}`);
};

const dir = mkdtempSync(join(tmpdir(), 'kirana-smoke-'));
const server = createAppServer({ dbPath: join(dir, 'v1.sqlite'), v2DbPath: join(dir, 'v2.sqlite') });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;

const api = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
  const response = await fetch(`${base}/api/v2${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, payload: await response.json() };
};
const login = async phone => {
  const req = await api('/auth/otp/request', { method: 'POST', body: { phone } });
  const ver = await api('/auth/otp/verify', { method: 'POST', body: { phone, code: req.payload.dev_code } });
  if (!ver.payload.token) throw new Error(`login failed for ${phone}: ${JSON.stringify(ver.payload)}`);
  return ver.payload.token;
};

try {
  console.log('Kirana Corner smoke —', base);
  const health = await fetch(`${base}/healthz`).then(r => r.json());
  ok('healthz', health.ok === true);
  const ready = await fetch(`${base}/readyz`).then(r => r.json());
  ok('readyz (both databases)', ready.ok === true && ready.databases.length === 2);

  const customer = await login('9000000021');
  const picker = await login('9000000002');
  const rider = await login('9000000011');
  const admin = await login('9000000001');
  ok('OTP sign-in for customer/picker/rider/admin', true);

  const svc = await api('/serviceability', { method: 'POST', body: { lat: 12.939, lng: 77.621 } });
  ok('serviceability assigns nearest dark store', svc.payload.serviceable && svc.payload.store.id === 'saathi-koramangala');
  const catalog = await api('/stores/saathi-koramangala/products?page_size=100');
  ok('catalog seeded', catalog.payload.products.length >= 70, `${catalog.payload.products.length} products`);

  for (const [product_id, quantity] of [['tomato', 2], ['amul-milk', 1], ['atta', 1]]) {
    const added = await api('/cart/items', { method: 'POST', token: customer, body: { store_id: 'saathi-koramangala', product_id, quantity } });
    if (added.status !== 200) throw new Error(`cart add ${product_id}: ${JSON.stringify(added.payload)}`);
  }
  const quote = await api('/cart/quote', { method: 'POST', token: customer, body: { address_id: 'addr-demo-home', coupon_code: 'WELCOME50', tip_minor: 1000 } });
  ok('quote: free delivery above threshold + WELCOME50', quote.payload.quote.bill.delivery_fee_minor === 0 && quote.payload.quote.bill.coupon_discount_minor === 5000);

  const idem = randomBytes(12).toString('hex');
  const orderBody = { address_id: 'addr-demo-home', payment_method: 'cod', coupon_code: 'WELCOME50', tip_minor: 1000 };
  const placed = await api('/orders', { method: 'POST', token: customer, headers: { 'Idempotency-Key': idem }, body: orderBody });
  ok('COD order placed', placed.status === 201 && placed.payload.order.payment_status === 'cod_due', JSON.stringify(placed.payload));
  const orderId = placed.payload.order.id;
  const replay = await api('/orders', { method: 'POST', token: customer, headers: { 'Idempotency-Key': idem }, body: orderBody });
  ok('idempotent replay returns same order', replay.payload.order.id === orderId);

  const stream = await fetch(`${base}/api/v2/events/stream?order_id=${orderId}`, { headers: { authorization: `Bearer ${customer}` } });
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  const ssePump = (async () => { for (;;) { const { done, value } = await reader.read(); if (done) break; sseBuffer += decoder.decode(value, { stream: true }); } })().catch(() => {});

  const queue = await api('/store/saathi-koramangala/queue', { token: picker });
  ok('store queue shows new order', queue.payload.orders.some(o => o.id === orderId));
  await api('/rider/availability', { method: 'POST', token: rider, body: { online: true } });
  const start = await api(`/store/orders/${orderId}/start-packing`, { method: 'POST', token: picker });
  const tomatoItem = start.payload.order.items.find(i => i.product_id === 'tomato');
  ok('picker sees aisle/shelf', Boolean(tomatoItem.aisle));
  await api(`/store/orders/${orderId}/items/${tomatoItem.id}/pick`, { method: 'POST', token: picker, body: { picked_quantity: 1 } });
  const packed = await api(`/store/orders/${orderId}/pack`, { method: 'POST', token: picker });
  ok('shortage reduces COD due', packed.payload.order.bill.cod_due_minor === placed.payload.order.bill.cod_due_minor - 2800);

  const jobs = await api('/rider/jobs', { token: rider });
  const job = jobs.payload.jobs.find(j => j.order_id === orderId);
  ok('dispatch offered job to nearest online rider', job && job.status === 'offered');
  const accepted = await api(`/rider/jobs/${job.id}/accept`, { method: 'POST', token: rider });
  ok('rider accepted, pickup code issued', accepted.payload.job.status === 'accepted' && Boolean(accepted.payload.job.pickup_code));
  await api(`/rider/jobs/${job.id}/pickup`, { method: 'POST', token: rider, body: { pickup_code: accepted.payload.job.pickup_code } });
  await api('/rider/location', { method: 'POST', token: rider, body: { lat: 12.937, lng: 77.622 } });
  const tracked = await api(`/orders/${orderId}`, { token: customer });
  ok('live tracking exposes rider location + ETA', tracked.payload.order.rider.location.lat === 12.937 && tracked.payload.order.eta_live_minutes >= 1);
  const delivered = await api(`/rider/jobs/${job.id}/deliver`, { method: 'POST', token: rider, body: { delivery_otp: placed.payload.order.delivery_otp, cash_collected: true } });
  ok('delivered with OTP + COD collected', delivered.payload.order.status === 'delivered' && delivered.payload.order.payment_status === 'cod_collected');
  await api(`/orders/${orderId}/rate`, { method: 'POST', token: customer, body: { rating: 5 } });
  const earnings = await api('/rider/earnings', { token: rider });
  ok('rider earnings include payout + tip', earnings.payload.earnings.today.total_minor === 4500);

  await reader.cancel().catch(() => {});
  await ssePump;
  ok('SSE streamed order status events', sseBuffer.includes('order.status') && sseBuffer.includes('"status":"delivered"'));

  await api('/cart/items', { method: 'POST', token: customer, body: { store_id: 'saathi-koramangala', product_id: 'bread', quantity: 1 } });
  const online = await api('/orders', { method: 'POST', token: customer, headers: { 'Idempotency-Key': randomBytes(12).toString('hex') }, body: { address_id: 'addr-demo-home', payment_method: 'online' } });
  ok('online order awaits payment', online.payload.order.payment_status === 'pending' && online.payload.payment.provider === 'mock');
  const confirmed = await api(`/payments/${online.payload.payment.payment_id}/confirm`, { method: 'POST', token: customer });
  ok('mock payment captured', confirmed.payload.payment_status === 'paid');
  const cancelled = await api(`/admin/orders/${online.payload.order.id}/cancel`, { method: 'POST', token: admin, body: { reason: 'smoke' } });
  ok('admin cancel refunds online payment', cancelled.payload.order.payment_status === 'refunded');

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const slots = await api(`/stores/saathi-koramangala/delivery-slots?date=${tomorrow}`);
  await api('/cart/items', { method: 'POST', token: customer, body: { store_id: 'saathi-koramangala', product_id: 'sona-rice', quantity: 1 } });
  const scheduled = await api('/orders', { method: 'POST', token: customer, headers: { 'Idempotency-Key': randomBytes(12).toString('hex') }, body: { address_id: 'addr-demo-home', payment_method: 'cod', delivery_type: 'scheduled', slot_id: slots.payload.slots[0].id } });
  ok('scheduled slot order (Big Basket mode)', scheduled.status === 201 && scheduled.payload.order.delivery_type === 'scheduled');

  const overview = await api('/admin/overview', { token: admin });
  ok('admin overview aggregates', overview.payload.overview.today.delivered >= 1 && overview.payload.overview.riders_online >= 1);
  const notifications = await api('/notifications', { token: customer });
  ok('customer notifications delivered', notifications.payload.notifications.length >= 3);

  console.log(`\nSMOKE PASS — ${passed} checks`);
} catch (error) {
  console.error(`\nSMOKE FAIL after ${passed} checks:`, error.message);
  process.exitCode = 1;
} finally {
  await new Promise(resolve => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}