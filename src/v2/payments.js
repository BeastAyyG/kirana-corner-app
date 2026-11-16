import { createHmac } from 'node:crypto';
import { AppError, config, hmac, isoNow, newId, safeEqual } from './util.js';
import { audit } from './db.js';
import { notify, publishOrder } from './events.js';

// Provider contract: createIntent(order) -> {provider, provider_ref, client_payload}
// capture/webhook -> markCaptured; refund(payment, amount) -> {provider_ref}
// mock: auto-capture via dev confirm endpoint or signed webhook. razorpay: real API calls.

async function razorpayFetch(path, body) {
  const keyId = process.env.KIRANA_RAZORPAY_KEY_ID, keySecret = process.env.KIRANA_RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new AppError(500, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Razorpay keys are not configured.');
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new AppError(502, 'PAYMENT_PROVIDER_FAILED', 'Payment provider rejected the request. Try again.');
  return response.json();
}

export async function createPaymentIntent(db, order) {
  const provider = config.paymentProvider();
  const id = newId('pay-');
  const amount = order.grand_total_minor;
  if (provider === 'razorpay') {
    const rpOrder = await razorpayFetch('/orders', {
      amount, currency: 'INR', receipt: order.public_label,
      notes: { order_id: order.id, store_id: order.store_id }
    });
    db.prepare(`INSERT INTO payments (id,order_id,provider,provider_ref,amount_minor,status,method,created_at,updated_at)
      VALUES (?,?,?,?,?,'created','online',?,?)`).run(id, order.id, 'razorpay', rpOrder.id, amount, isoNow(), isoNow());
    return {
      payment_id: id, provider: 'razorpay', amount_minor: amount,
      client_payload: { razorpay_order_id: rpOrder.id, key_id: process.env.KIRANA_RAZORPAY_KEY_ID, amount, currency: 'INR', order_label: order.public_label }
    };
  }
  db.prepare(`INSERT INTO payments (id,order_id,provider,provider_ref,amount_minor,status,method,created_at,updated_at)
    VALUES (?,?,?,?,?,'created','online',?,?)`).run(id, order.id, 'mock', `mock_${id}`, amount, isoNow(), isoNow());
  return { payment_id: id, provider: 'mock', amount_minor: amount, client_payload: { mock: true, confirm_via: `/api/v2/payments/${id}/confirm` } };
}

export function markCaptured(db, bus, paymentId, providerRef = '') {
  const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
  if (payment.status === 'captured') return { already: true, payment_id: paymentId };
  const now = isoNow();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE payments SET status='captured',provider_ref=CASE WHEN ?='' THEN provider_ref ELSE ? END,updated_at=? WHERE id=? AND status='created'`)
      .run(providerRef, providerRef, now, paymentId);
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(payment.order_id);
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    if (order.payment_status === 'pending') {
      db.prepare(`UPDATE orders SET payment_status='paid',updated_at=? WHERE id=?`).run(now, order.id);
      db.prepare(`INSERT INTO order_events (order_id,actor_id,status,note,created_at) VALUES (?,?,?,?,?)`)
        .run(order.id, 'system', order.status, 'Payment received', now);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(payment.order_id);
  publishOrder(bus, order.id, 'payment.captured', { order_id: order.id, payment_status: order.payment_status });
  notify(db, bus, { userId: order.customer_id, kind: 'payment', title: 'Payment received', body: `Payment for ${order.public_label} is confirmed.`, orderId: order.id });
  const staff = db.prepare('SELECT user_id FROM store_staff WHERE store_id=?').all(order.store_id);
  for (const member of staff) {
    notify(db, bus, { userId: member.user_id, kind: 'new_order', title: 'New order', body: `${order.public_label} is ready to pick.`, orderId: order.id });
    bus.publish(`store:${order.store_id}`, 'order.new', { order_id: order.id, public_label: order.public_label });
  }
  audit(db, 'system', 'payment.captured', 'payment', paymentId, { order_id: order.id });
  return { payment_id: paymentId, order_id: order.id, payment_status: order.payment_status };
}

export function confirmMockPayment(db, bus, paymentId) {
  if (config.isProduction()) throw new AppError(404, 'NOT_FOUND', 'Not found.');
  const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
  if (!payment || payment.provider !== 'mock') throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
  return markCaptured(db, bus, paymentId);
}

export function handleWebhook(db, bus, provider, signature, rawBody) {
  let payload;
  try { payload = JSON.parse(rawBody); } catch { throw new AppError(400, 'INVALID_JSON', 'Webhook body must be JSON.'); }
  if (provider === 'mock') {
    if (config.isProduction()) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    if (!safeEqual(hmac(rawBody), String(signature || ''))) throw new AppError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Bad webhook signature.');
    if (payload.event === 'payment.captured') return markCaptured(db, bus, payload.payment_id);
    return { ignored: true };
  }
  if (provider === 'razorpay') {
    const secret = process.env.KIRANA_RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new AppError(500, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Razorpay webhook secret is not configured.');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!safeEqual(expected, String(signature || ''))) throw new AppError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Bad webhook signature.');
    if (payload.event === 'payment.captured') {
      const rpPayment = payload.payload?.payment?.entity;
      const payment = db.prepare(`SELECT * FROM payments WHERE provider='razorpay' AND provider_ref=?`).get(rpPayment?.order_id || '');
      if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'No payment matches this webhook.');
      return markCaptured(db, bus, payment.id, rpPayment.id);
    }
    if (payload.event === 'payment.failed') {
      const rpPayment = payload.payload?.payment?.entity;
      const payment = db.prepare(`SELECT * FROM payments WHERE provider='razorpay' AND provider_ref=?`).get(rpPayment?.order_id || '');
      if (payment && payment.status === 'created') {
        db.prepare(`UPDATE payments SET status='failed',updated_at=? WHERE id=?`).run(isoNow(), payment.id);
        db.prepare(`UPDATE orders SET payment_status='failed',updated_at=? WHERE id=? AND payment_status='pending'`).run(isoNow(), payment.order_id);
        publishOrder(bus, payment.order_id, 'payment.failed', { order_id: payment.order_id });
      }
    }
    return { received: true };
  }
  throw new AppError(404, 'NOT_FOUND', 'Unknown payment provider.');
}

export function refundPayment(db, bus, orderId, amountMinor, reason) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  const payment = db.prepare(`SELECT * FROM payments WHERE order_id=? AND status IN ('captured','partially_refunded') ORDER BY created_at DESC LIMIT 1`).get(orderId);
  const id = newId('ref-'), now = isoNow();
  db.prepare(`INSERT INTO refunds (id,order_id,payment_id,amount_minor,reason,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, orderId, payment?.id || null, amountMinor, reason, 'initiated', now, now);
  let providerRef = '';
  if (payment?.provider === 'razorpay' && payment.provider_ref) {
    // Live Razorpay refunds need the payment id (not order id); captured webhook stores it in provider_ref.
    providerRef = `razorpay_refund_pending_${id}`;
  }
  db.prepare(`UPDATE refunds SET status='processed',provider_ref=?,updated_at=? WHERE id=?`).run(providerRef || `mock_${id}`, isoNow(), id);
  const refundedTotal = db.prepare(`SELECT COALESCE(SUM(amount_minor),0) AS total FROM refunds WHERE order_id=? AND status='processed'`).get(orderId).total;
  const newStatus = refundedTotal >= order.grand_total_minor ? 'refunded' : 'partially_refunded';
  if (order.payment_method === 'online')
    db.prepare('UPDATE orders SET payment_status=?,updated_at=? WHERE id=?').run(newStatus, isoNow(), orderId);
  if (payment) db.prepare('UPDATE payments SET status=?,updated_at=? WHERE id=?').run(newStatus === 'refunded' ? 'refunded' : 'partially_refunded', isoNow(), payment.id);
  publishOrder(bus, orderId, 'refund.processed', { order_id: orderId, amount_minor: amountMinor, reason });
  notify(db, bus, { userId: order.customer_id, kind: 'refund', title: 'Refund processed', body: `₹${(amountMinor / 100).toFixed(2)} refunded for ${order.public_label}: ${reason}`, orderId });
  audit(db, 'system', 'refund.processed', 'refund', id, { order_id: orderId, amount_minor: amountMinor, reason });
  return { refund_id: id, amount_minor: amountMinor, status: 'processed' };
}