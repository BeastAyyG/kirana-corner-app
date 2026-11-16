import { createHmac } from 'node:crypto';
import {
  AppError, canonical, config, etaMinutes, haversineKm, hmac, isoNow, newId,
  requireInt, requireString, sha256, tx
} from './util.js';
import { audit, getStore, isStoreStaff, storeAcceptingOrders } from './db.js';
import { getAddress, mapAddress, publicStore, slotBookable } from './catalog.js';
import { computeBill, getCart, putCart } from './cart.js';
import { redeemCoupon, releaseCoupon, validateCoupon } from './promotions.js';
import { createPaymentIntent, refundPayment } from './payments.js';
import { assignRider } from './dispatch.js';
import { notify, publishOrder } from './events.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PENDING_PAYMENT_TTL_MS = 15 * 60 * 1000;

function derivedCode(orderId, kind, length, alphabet) {
  const bytes = createHmac('sha256', process.env.KIRANA_SESSION_SECRET || 'local-only-dev-secret-change-me-32chars!!')
    .update(`${kind}:${orderId}`).digest();
  let out = '';
  for (let i = 0; out.length < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
export const deliveryOtpFor = orderId => derivedCode(orderId, 'delivery-otp', 4, '0123456789');
export const pickupCodeFor = orderId => derivedCode(orderId, 'pickup-code', 6, CODE_ALPHABET);
const deliveryOtpHash = orderId => hmac(`delivery:${orderId}:${deliveryOtpFor(orderId)}`);
const pickupCodeHash = orderId => hmac(`pickup:${orderId}:${pickupCodeFor(orderId)}`);
export const verifyDeliveryOtp = (orderId, code) => hmac(`delivery:${orderId}:${String(code).trim()}`) === deliveryOtpHash(orderId);
export const verifyPickupCode = (orderId, code) => hmac(`pickup:${orderId}:${String(code).trim().toUpperCase()}`) === pickupCodeHash(orderId);

function orderRow(db, id) {
  const row = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!row) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  return row;
}

export function billView(row) {
  return {
    items_total_minor: Number(row.items_total_minor), savings_minor: Number(row.savings_minor),
    delivery_fee_minor: Number(row.delivery_fee_minor), handling_fee_minor: Number(row.handling_fee_minor),
    surge_fee_minor: Number(row.surge_fee_minor), tip_minor: Number(row.tip_minor),
    coupon_discount_minor: Number(row.coupon_discount_minor),
    grand_total_minor: Number(row.grand_total_minor), cod_due_minor: Number(row.cod_due_minor)
  };
}

export function getOrderView(db, id, viewer) {
  const row = orderRow(db, id);
  const store = getStore(db, row.store_id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(id).map(item => ({
    id: item.id, product_id: item.product_id, name: item.name, brand: item.brand, unit: item.unit,
    image_url: item.image_url, price_minor: Number(item.price_minor), mrp_minor: Number(item.mrp_minor),
    quantity: Number(item.quantity), picked_quantity: item.picked_quantity === null ? null : Number(item.picked_quantity),
    refunded_minor: Number(item.refunded_minor)
  }));
  const events = db.prepare('SELECT status,note,created_at FROM order_events WHERE order_id=? ORDER BY id').all(id);
  const address = JSON.parse(row.address_snapshot || '{}');
  const view = {
    id: row.id, public_label: row.public_label, store: store ? publicStore(store) : { id: row.store_id, name: 'Store (inactive)' },
    status: row.status, delivery_type: row.delivery_type, slot_id: row.slot_id,
    payment_method: row.payment_method, payment_status: row.payment_status,
    bill: billView(row), items, events, address,
    delivery_instructions: row.delivery_instructions,
    distance_km: row.distance_km, eta_promise_minutes: row.eta_promise_minutes,
    created_at: row.created_at, updated_at: row.updated_at, placed_at: row.placed_at,
    packing_at: row.packing_at, packed_at: row.packed_at, assigned_at: row.assigned_at,
    picked_up_at: row.picked_up_at, delivered_at: row.delivered_at,
    cancelled_at: row.cancelled_at, cancel_reason: row.cancel_reason,
    rating: row.rating, rating_comment: row.rating_comment
  };
  if (row.slot_id) {
    const slot = db.prepare('SELECT * FROM delivery_slots WHERE id=?').get(row.slot_id);
    if (slot) view.slot = { id: slot.id, starts_at: slot.starts_at, ends_at: slot.ends_at, slot_date: slot.slot_date };
  }
  if (row.rider_id) {
    const rider = db.prepare(`SELECT u.id,u.name,u.phone,r.lat,r.lng,r.vehicle,r.last_ping_at
      FROM users u LEFT JOIN riders r ON r.user_id=u.id WHERE u.id=?`).get(row.rider_id);
    if (rider) {
      view.rider = { id: rider.id, name: rider.name, phone: rider.phone, vehicle: rider.vehicle };
      if (['rider_assigned', 'picked_up'].includes(row.status) && rider.lat !== null) {
        view.rider.location = { lat: rider.lat, lng: rider.lng, at: rider.last_ping_at };
        const remainingKm = haversineKm(rider.lat, rider.lng, address.lat, address.lng);
        const remainingMin = Math.max(1, Math.ceil((remainingKm / config.avgSpeedKmph()) * 60) + (row.status === 'rider_assigned' ? 3 : 0));
        view.eta_live_minutes = remainingMin;
        view.eta_estimated_at = new Date(Date.now() + remainingMin * 60000).toISOString();
      }
    }
  }
  if (!view.eta_estimated_at && !['delivered', 'cancelled'].includes(row.status))
    view.eta_estimated_at = new Date(Date.parse(row.placed_at) + row.eta_promise_minutes * 60000).toISOString();
  const isCustomer = viewer.id === row.customer_id;
  const isStaff = isStoreStaff(db, viewer.id, row.store_id);
  const isAssignedRider = viewer.id === row.rider_id;
  const isAdmin = viewer.role === 'admin';
  if (isCustomer && !['delivered', 'cancelled'].includes(row.status)) view.delivery_otp = deliveryOtpFor(id);
  if ((isStaff || isAssignedRider || isAdmin) && !['delivered', 'cancelled'].includes(row.status)) view.pickup_code = pickupCodeFor(id);
  if (isStaff || isAdmin) {
    view.customer = db.prepare('SELECT id,name,phone FROM users WHERE id=?').get(row.customer_id);
    const pickRows = db.prepare(`SELECT p.aisle,p.shelf,oi.id FROM order_items oi
      JOIN products p ON p.id=oi.product_id AND p.store_id=? WHERE oi.order_id=?`).all(row.store_id, id);
    const locations = new Map(pickRows.map(r => [r.id, { aisle: r.aisle, shelf: r.shelf }]));
    view.items = items.map(item => ({ ...item, ...(locations.get(item.id) || {}) }));
  }
  return view;
}

export function listCustomerOrders(db, userId, { status = '' } = {}) {
  const valid = ['placed', 'packing', 'packed', 'rider_assigned', 'picked_up', 'delivered', 'cancelled'];
  if (status && !valid.includes(status)) throw new AppError(400, 'INVALID_STATUS_FILTER', 'Unknown order status.');
  const rows = status
    ? db.prepare('SELECT id FROM orders WHERE customer_id=? AND status=? ORDER BY created_at DESC').all(userId, status)
    : db.prepare('SELECT id FROM orders WHERE customer_id=? ORDER BY created_at DESC').all(userId);
  return rows.map(({ id }) => getOrderView(db, id, { id: userId, role: 'customer' }));
}

export async function createOrder(db, bus, {
  userId, addressId, items = null, storeId = null, couponCode = '', tipMinor = 0,
  paymentMethod = 'cod', deliveryInstructions = '', deliveryType = 'instant', slotId = null, idempotencyKey
}) {
  if (!/^[A-Za-z0-9._~-]{16,128}$/.test(String(idempotencyKey || '')))
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header (16-128 chars) is required.');
  if (!['cod', 'online'].includes(paymentMethod)) throw new AppError(400, 'INVALID_PAYMENT_METHOD', 'payment_method must be cod or online.');
  if (!['instant', 'scheduled'].includes(deliveryType)) throw new AppError(400, 'INVALID_DELIVERY_TYPE', 'delivery_type must be instant or scheduled.');
  const instructions = String(deliveryInstructions || '').trim().slice(0, 240);
  const requestHash = sha256(canonical({
    address_id: String(addressId || ''), items: items || null, store_id: storeId, coupon: couponCode || '',
    tip: tipMinor, payment_method: paymentMethod, delivery_type: deliveryType, slot_id: slotId || '', instructions
  }));

  const created = tx(db, () => {
    const prior = db.prepare('SELECT payload_hash,request_hash,order_id FROM idempotency_keys WHERE user_id=? AND key=?').get(userId, idempotencyKey);
    if (prior && prior.request_hash === requestHash) return { orderId: prior.order_id, replayed: true };
    const cart = items ? null : getCart(db, userId);
    const resolvedStoreId = String(storeId || cart?.store_id || '');
    const sourceItems = items || cart?.items || [];
    if (prior && (!Array.isArray(sourceItems) || !sourceItems.length))
      throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'That retry key was used for a different order.');
    if (!Array.isArray(sourceItems) || !sourceItems.length || sourceItems.length > 60)
      throw new AppError(400, 'EMPTY_CART', 'Add at least one item.');
    const quantities = new Map(), expectedPrices = new Map();
    for (const item of sourceItems) {
      const productId = String(item.product_id || item.id || '');
      const quantity = requireInt(item.quantity, 'Quantity', { min: 1, max: 99 });
      if (!productId) throw new AppError(400, 'INVALID_ORDER_ITEM', 'Each item needs a product_id.');
      quantities.set(productId, (quantities.get(productId) || 0) + quantity);
      if (item.expected_price_minor !== undefined) {
        const expected = requireInt(item.expected_price_minor, 'Displayed price', { min: 1 });
        if (expectedPrices.has(productId) && expectedPrices.get(productId) !== expected)
          throw new AppError(400, 'INVALID_ORDER_ITEM', 'Conflicting displayed prices for one item.');
        expectedPrices.set(productId, expected);
      }
    }
    const sortedItems = [...quantities.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([product_id, quantity]) => ({ product_id, quantity }));
    const payloadHash = sha256(canonical({ store_id: resolvedStoreId, address_id: addressId, items: sortedItems, coupon: couponCode || '', tip: tipMinor, payment_method: paymentMethod, delivery_type: deliveryType, slot_id: slotId || '' }));
    if (prior) {
      if (prior.payload_hash !== payloadHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'That retry key was used for a different order.');
      return { orderId: prior.order_id, replayed: true };
    }
    const store = getStore(db, resolvedStoreId);
    if (!store) throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found.');
    if (!storeAcceptingOrders(db, store.id)) throw new AppError(409, 'STORE_CLOSED', 'This store is not accepting orders right now.');
    const address = getAddress(db, userId, String(addressId || ''));
    const distance = haversineKm(address.lat, address.lng, store.lat, store.lng);
    if (distance > store.radius_km) throw new AppError(409, 'OUT_OF_RANGE', 'The selected address is outside this store\'s delivery range.');
    const lines = [];
    for (const [productId, quantity] of quantities) {
      const product = db.prepare('SELECT * FROM products WHERE store_id=? AND id=? AND active=1').get(store.id, productId);
      if (!product) throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'An item is no longer available. Refresh your cart.');
      if (quantity > product.max_per_order) throw new AppError(400, 'MAX_PER_ORDER', `${product.name} is limited to ${product.max_per_order} per order.`);
      const expected = expectedPrices.get(productId);
      if (expected !== undefined && expected !== Number(product.price_minor))
        throw new AppError(409, 'PRICE_CHANGED', `${product.name}'s price changed. Review your cart.`, { product_id: productId, current_price_minor: Number(product.price_minor) });
      const available = Number(product.on_hand) - Number(product.reserved);
      if (available < quantity) throw new AppError(409, 'INSUFFICIENT_STOCK', `${product.name} has only ${available} available.`, { product_id: productId, available });
      lines.push({ product, quantity, price_minor: Number(product.price_minor), mrp_minor: Number(product.mrp_minor) });
    }
    const itemsTotal = lines.reduce((sum, line) => sum + line.price_minor * line.quantity, 0);
    if (itemsTotal < store.min_order_minor) throw new AppError(400, 'MIN_ORDER', `Minimum order is ₹${store.min_order_minor / 100}.`);
    const coupon = validateCoupon(db, couponCode, userId, itemsTotal);
    const bill = computeBill(db, { store, lines, distanceKm: distance, coupon, tipMinor });
    let slot = null;
    if (deliveryType === 'scheduled') {
      slot = slotBookable(db, String(slotId || ''), store.id);
      if (!slot) throw new AppError(409, 'SLOT_UNAVAILABLE', 'That delivery slot is no longer available. Choose another.');
    }
    const id = newId('ord-');
    const label = `KC${randomLabel()}`;
    const now = isoNow();
    const eta = etaMinutes(distance, store.prep_time_minutes);
    const codDue = paymentMethod === 'cod' ? bill.grand_total_minor : 0;
    db.prepare(`INSERT INTO orders (id,public_label,customer_id,store_id,address_id,delivery_type,slot_id,status,payment_method,payment_status,
      items_total_minor,savings_minor,delivery_fee_minor,handling_fee_minor,surge_fee_minor,tip_minor,coupon_discount_minor,coupon_id,
      grand_total_minor,cod_due_minor,delivery_instructions,address_snapshot,distance_km,eta_promise_minutes,delivery_otp_hash,pickup_code_hash,
      created_at,updated_at,placed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, label, userId, store.id, addressId, deliveryType, slot?.id || null, 'placed', paymentMethod,
        paymentMethod === 'cod' ? 'cod_due' : 'pending',
        bill.items_total_minor, bill.savings_minor, bill.delivery_fee_minor, bill.handling_fee_minor, bill.surge_fee_minor,
        bill.tip_minor, bill.coupon_discount_minor, coupon?.id || null, bill.grand_total_minor, codDue, instructions,
        JSON.stringify(address), bill.distance_km, eta, deliveryOtpHash(id), pickupCodeHash(id), now, now, now);
    const addItem = db.prepare(`INSERT INTO order_items (order_id,product_id,name,brand,unit,image_url,price_minor,mrp_minor,quantity)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    const reserve = db.prepare('UPDATE products SET reserved=reserved+?,updated_at=? WHERE store_id=? AND id=? AND active=1 AND on_hand-reserved>=?');
    for (const { product, quantity } of lines) {
      if (reserve.run(quantity, now, store.id, product.id, quantity).changes !== 1)
        throw new AppError(409, 'INSUFFICIENT_STOCK', `${product.name} stock changed. Refresh your cart.`);
      addItem.run(id, product.id, product.name, product.brand, product.unit, product.image_url, product.price_minor, product.mrp_minor, quantity);
    }
    if (slot && db.prepare('UPDATE delivery_slots SET reserved_count=reserved_count+1 WHERE id=? AND active=1 AND reserved_count<capacity').run(slot.id).changes !== 1)
      throw new AppError(409, 'SLOT_FULL', 'That slot just filled. Choose another.');
    redeemCoupon(db, coupon, userId, id);
    db.prepare('INSERT INTO order_events (order_id,actor_id,status,note,created_at) VALUES (?,?,?,?,?)')
      .run(id, userId, 'placed', paymentMethod === 'cod' ? 'Order placed (pay on delivery)' : 'Order placed, awaiting payment', now);
    db.prepare('INSERT INTO idempotency_keys (user_id,key,payload_hash,request_hash,order_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(userId, idempotencyKey, payloadHash, requestHash, id, now);
    if (!items) {
      db.prepare('DELETE FROM cart_items WHERE user_id=?').run(userId);
      db.prepare('DELETE FROM carts WHERE user_id=?').run(userId);
    }
    audit(db, userId, 'order.placed', 'order', id, { total: bill.grand_total_minor, payment_method: paymentMethod });
    return { orderId: id, replayed: false };
  });

  const order = getOrderView(db, created.orderId, { id: userId, role: 'customer' });
  if (created.replayed) return { order, replayed: true };
  publishOrder(bus, created.orderId, 'order.placed', { order_id: created.orderId, status: 'placed', payment_status: order.payment_status });
  let payment = null;
  if (paymentMethod === 'online') {
    payment = await createPaymentIntent(db, orderRow(db, created.orderId));
  } else {
    const store = getStore(db, order.store.id);
    for (const member of db.prepare('SELECT user_id FROM store_staff WHERE store_id=?').all(store.id)) {
      notify(db, bus, { userId: member.user_id, kind: 'new_order', title: 'New order', body: `${order.public_label} is ready to pick.`, orderId: order.id });
    }
    bus.publish(`store:${store.id}`, 'order.new', { order_id: order.id, public_label: order.public_label });
    notify(db, bus, { userId, kind: 'order', title: 'Order placed', body: `${order.public_label} confirmed. Pay ₹${(order.bill.cod_due_minor / 100).toFixed(0)} on delivery.`, orderId: order.id });
  }
  return { order, payment };
}

function randomLabel() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = createHmac('sha256', 'label').update(`${Date.now()}:${Math.random()}`).digest();
  for (let i = 0; i < 6; i += 1) out += chars[bytes[i] % chars.length];
  return out;
}

export function cancelOrder(db, bus, id, { actorId, role, reason = '' }) {
  const result = tx(db, () => {
    const order = orderRow(db, id);
    const isCustomer = role === 'customer' && order.customer_id === actorId;
    const isStaff = role === 'picker' && isStoreStaff(db, actorId, order.store_id);
    const isAdmin = role === 'admin' || actorId === 'system';
    if (!isCustomer && !isStaff && !isAdmin) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    if (isCustomer && order.status !== 'placed')
      throw new AppError(409, 'CANCELLATION_CLOSED', 'Orders can only be cancelled before packing starts. Contact support for help.');
    if (!isCustomer && ['picked_up', 'delivered', 'cancelled'].includes(order.status))
      throw new AppError(409, 'CANCELLATION_CLOSED', `An order that is ${order.status} cannot be cancelled.`);
    if (order.status === 'cancelled') throw new AppError(409, 'ALREADY_CANCELLED', 'This order is already cancelled.');
    const now = isoNow();
    for (const item of db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(id)) {
      if (db.prepare('UPDATE products SET reserved=reserved-?,updated_at=? WHERE store_id=? AND id=? AND reserved>=?')
        .run(item.quantity, now, order.store_id, item.product_id, item.quantity).changes !== 1)
        throw new AppError(409, 'INVENTORY_INVARIANT', 'Reserved stock could not be released.');
    }
    if (order.slot_id) db.prepare('UPDATE delivery_slots SET reserved_count=MAX(0,reserved_count-1) WHERE id=?').run(order.slot_id);
    releaseCoupon(db, id);
    const job = db.prepare(`SELECT * FROM rider_jobs WHERE order_id=? AND status IN ('offered','accepted')`).get(id);
    if (job) {
      db.prepare(`UPDATE rider_jobs SET status='cancelled',ended_at=?,updated_at=? WHERE id=?`).run(now, now, job.id);
      bus.publish(`rider:${job.rider_id}`, 'job.cancelled', { job_id: job.id, order_id: id });
    }
    const cleanReason = String(reason || 'Cancelled').slice(0, 240);
    db.prepare(`UPDATE orders SET status='cancelled',cancelled_at=?,updated_at=?,cancel_reason=?,cancel_actor=?,cod_due_minor=0,rider_id=NULL WHERE id=?`)
      .run(now, now, cleanReason, actorId, id);
    db.prepare('INSERT INTO order_events (order_id,actor_id,status,note,created_at) VALUES (?,?,?,?,?)')
      .run(id, actorId, 'cancelled', cleanReason, now);
    audit(db, actorId, 'order.cancelled', 'order', id, { reason: cleanReason });
    return order;
  });
  if (result.payment_method === 'online' && ['paid', 'partially_refunded'].includes(result.payment_status))
    refundPayment(db, bus, id, Number(result.grand_total_minor), `Order cancelled: ${reason || 'cancelled'}`);
  publishOrder(bus, id, 'order.cancelled', { order_id: id, reason });
  notify(db, bus, { userId: result.customer_id, kind: 'order', title: 'Order cancelled', body: `${result.public_label} was cancelled. ${result.payment_method === 'online' ? 'Refund initiated.' : ''}`, orderId: id });
  bus.publish(`store:${result.store_id}`, 'order.cancelled', { order_id: id });
  return getOrderView(db, id, { id: actorId, role });
}

export function startPacking(db, bus, id, actorId) {
  const order = orderRow(db, id);
  if (!isStoreStaff(db, actorId, order.store_id)) throw new AppError(403, 'STORE_ACCESS_DENIED', 'You do not have access to this store.');
  if (order.status !== 'placed') throw new AppError(409, 'INVALID_TRANSITION', `Cannot start packing an order that is ${order.status}.`);
  if (!['paid', 'cod_due'].includes(order.payment_status)) throw new AppError(409, 'PAYMENT_PENDING', 'Payment is not confirmed yet.');
  const now = isoNow();
  db.prepare(`UPDATE orders SET status='packing',packing_at=?,updated_at=? WHERE id=? AND status='placed'`).run(now, now, id);
  db.prepare('INSERT INTO order_events (order_id,actor_id,status,note,created_at) VALUES (?,?,?,?,?)')
    .run(id, actorId, 'packing', 'Store started picking items', now);
  publishOrder(bus, id, 'order.status', { order_id: id, status: 'packing' });
  notify(db, bus, { userId: order.customer_id, kind: 'order', title: 'Packing your order', body: `${order.public_label} is being picked and packed.`, orderId: id });
  return getOrderView(db, id, { id: actorId, role: 'picker' });
}

export function pickItem(db, bus, id, itemId, pickedQuantity, actorId) {
  const order = orderRow(db, id);
  if (!isStoreStaff(db, actorId, order.store_id)) throw new AppError(403, 'STORE_ACCESS_DENIED', 'You do not have access to this store.');
  if (order.status !== 'packing') throw new AppError(409, 'INVALID_TRANSITION', 'Items can only be picked while packing.');
  const item = db.prepare('SELECT * FROM order_items WHERE id=? AND order_id=?').get(itemId, id);
  if (!item) throw new AppError(404, 'ITEM_NOT_FOUND', 'Order item not found.');
  const quantity = requireInt(pickedQuantity, 'Picked quantity', { min: 0, max: Number(item.quantity) });
  db.prepare('UPDATE order_items SET picked_quantity=? WHERE id=?').run(quantity, itemId);
  publishOrder(bus, id, 'order.item_picked', { order_id: id, item_id: itemId, picked_quantity: quantity, quantity: Number(item.quantity) });
  return getOrderView(db, id, { id: actorId, role: 'picker' });
}

export function packOrder(db, bus, id, actorId) {
  const order = orderRow(db, id);
  if (!isStoreStaff(db, actorId, order.store_id)) throw new AppError(403, 'STORE_ACCESS_DENIED', 'You do not have access to this store.');
  if (order.status !== 'packing') throw new AppError(409, 'INVALID_TRANSITION', `Cannot pack an order that is ${order.status}.`);
  const now = isoNow();
  let shortageTotal = 0;
  const shortages = [];
  tx(db, () => {
    for (const item of db.prepare('SELECT * FROM order_items WHERE order_id=?').all(id)) {
      const picked = item.picked_quantity === null ? Number(item.quantity) : Number(item.picked_quantity);
      if (item.picked_quantity === null) db.prepare('UPDATE order_items SET picked_quantity=? WHERE id=?').run(picked, item.id);
      const shortage = Number(item.quantity) - picked;
      if (shortage > 0) {
        const refund = shortage * Number(item.price_minor);
        shortageTotal += refund;
        shortages.push({ item_id: item.id, name: item.name, shortage, refund_minor: refund });
        db.prepare('UPDATE order_items SET refunded_minor=refunded_minor+? WHERE id=?').run(refund, item.id);
      }
    }
    if (shortageTotal > 0 && order.payment_method === 'cod') {
      db.prepare('UPDATE orders SET grand_total_minor=MAX(0,grand_total_minor-?),cod_due_minor=MAX(0,cod_due_minor-?),updated_at=? WHERE id=?')
        .run(shortageTotal, shortageTotal, now, id);
    }
    db.prepare(`UPDATE orders SET status='packed',packed_at=?,updated_at=? WHERE id=? AND status='packing'`).run(now, now, id);
    db.prepare('INSERT INTO order_events (order_id,actor_id,status,note,created_at) VALUES (?,?,?,?,?)')
      .run(id, actorId, 'packed', shortages.length ? `Packed with ${shortages.length} shortage(s)` : 'All items picked and packed', now);
  });
  if (shortageTotal > 0 && order.payment_method === 'online' && order.payment_status === 'paid')
    refundPayment(db, bus, id, shortageTotal, 'Items out of stock at packing');
  if (shortages.length)
    notify(db, bus, { userId: order.customer_id, kind: 'order', title: 'Some items were unavailable', body: shortages.map(s => `${s.name} ×${s.shortage}`).join(', ') + ` — ₹${(shortageTotal / 100).toFixed(0)} ${order.payment_method === 'online' ? 'refunded' : 'reduced from cash due'}.`, orderId: id });
  publishOrder(bus, id, 'order.status', { order_id: id, status: 'packed', shortages });
  assignRider(db, bus, id);
  return getOrderView(db, id, { id: actorId, role: 'picker' });
}

export function markPickedUp(db, bus, id, actorId) {
  const order = orderRow(db, id);
  if (order.status !== 'rider_assigned') throw new AppError(409, 'INVALID_TRANSITION', `Cannot pick up an order that is ${order.status}.`);
  const now = isoNow();
  tx(db, () => {
    for (const item of db.prepare('SELECT * FROM order_items WHERE order_id=?').all(id)) {
      const picked = item.picked_quantity === null ? Number(item.quantity) : Number(item.picked_quantity);
      if (db.prepare(`UPDATE products SET on_hand=on_hand-?,reserved=reserved-?,updated_at=?
        WHERE store_id=? AND id=? AND on_hand>=? AND reserved>=?`)
        .run(picked, Number(item.quantity), now, order.store_id, item.product_id, picked, Number(item.quantity)).changes !== 1)
        throw new AppError(409, 'INVENTORY_INVARIANT', 'Inventory could not be settled at pickup.');
    }
    db.prepare(`UPDATE orders SET status='picked_up',picked_up_at=?,updated_at=? WHERE id=? AND status='rider_assigned'`).run(now, now, id);
    db.prepare('INSERT INTO order_events (order_id,actor_id,status,note,created_at) VALUES (?,?,?,?,?)')
      .run(id, actorId, 'picked_up', 'Rider collected the order from the store', now);
  });
  publishOrder(bus, id, 'order.status', { order_id: id, status: 'picked_up' });
  notify(db, bus, { userId: order.customer_id, kind: 'order', title: 'Order on the way', body: `${order.public_label} has left the store. Track your rider live.`, orderId: id });
  return getOrderView(db, id, { id: actorId, role: 'rider' });
}

export function markDelivered(db, bus, id, actorId, { cashCollected = false } = {}) {
  const order = orderRow(db, id);
  if (order.status !== 'picked_up') throw new AppError(409, 'INVALID_TRANSITION', `Cannot deliver an order that is ${order.status}.`);
  const now = isoNow();
  tx(db, () => {
    db.prepare(`UPDATE orders SET status='delivered',delivered_at=?,updated_at=?${order.payment_method === 'cod' && cashCollected ? ",payment_status='cod_collected',cod_due_minor=0" : ''} WHERE id=? AND status='picked_up'`)
      .run(now, now, id);
    db.prepare('INSERT INTO order_events (order_id,actor_id,status,note,created_at) VALUES (?,?,?,?,?)')
      .run(id, actorId, 'delivered', order.payment_method === 'cod' ? `Delivered${cashCollected ? ', cash collected' : ''}` : 'Delivered', now);
    db.prepare(`UPDATE rider_jobs SET status='delivered',delivered_at=?,ended_at=?,cash_collected=?,updated_at=? WHERE order_id=? AND status='picked_up'`)
      .run(now, now, Number(cashCollected), now, id);
    audit(db, actorId, 'order.delivered', 'order', id, { cash_collected: cashCollected });
  });
  publishOrder(bus, id, 'order.status', { order_id: id, status: 'delivered' });
  notify(db, bus, { userId: order.customer_id, kind: 'order', title: 'Delivered', body: `${order.public_label} was delivered. Rate your experience!`, orderId: id });
  bus.publish(`store:${order.store_id}`, 'order.delivered', { order_id: id });
  return getOrderView(db, id, { id: actorId, role: 'rider' });
}

export function rateOrder(db, bus, id, userId, { rating, comment = '' }) {
  const order = orderRow(db, id);
  if (order.customer_id !== userId) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  if (order.status !== 'delivered') throw new AppError(409, 'NOT_DELIVERED', 'Only delivered orders can be rated.');
  if (order.rating) throw new AppError(409, 'ALREADY_RATED', 'This order is already rated.');
  const stars = requireInt(rating, 'Rating', { min: 1, max: 5 });
  const text = String(comment || '').trim().slice(0, 240);
  db.prepare('UPDATE orders SET rating=?,rating_comment=?,rated_at=?,updated_at=? WHERE id=?').run(stars, text, isoNow(), isoNow(), id);
  publishOrder(bus, id, 'order.rated', { order_id: id, rating: stars });
  return getOrderView(db, id, { id: userId, role: 'customer' });
}

export function reorder(db, userId, id) {
  const order = orderRow(db, id);
  if (order.customer_id !== userId) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  const items = [], skipped = [];
  for (const item of db.prepare('SELECT * FROM order_items WHERE order_id=?').all(id)) {
    const product = db.prepare('SELECT * FROM products WHERE store_id=? AND id=? AND active=1').get(order.store_id, item.product_id);
    const available = product ? Number(product.on_hand) - Number(product.reserved) : 0;
    if (!product || available < 1) { skipped.push({ product_id: item.product_id, name: item.name, reason: 'unavailable' }); continue; }
    const quantity = Math.min(Number(item.quantity), available, Number(product.max_per_order));
    items.push({ product_id: item.product_id, quantity });
    if (quantity < Number(item.quantity)) skipped.push({ product_id: item.product_id, name: item.name, reason: 'quantity_reduced', quantity });
  }
  if (!items.length) throw new AppError(409, 'NOTHING_TO_REORDER', 'None of the items from this order are available right now.');
  const cart = putCart(db, userId, { store_id: order.store_id, items });
  return { cart, skipped };
}

export function sweepStalePendingPayments(db, bus) {
  const cutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MS).toISOString();
  const stale = db.prepare(`SELECT id FROM orders WHERE payment_method='online' AND payment_status='pending' AND status='placed' AND placed_at<?`).all(cutoff);
  for (const { id } of stale) {
    try { cancelOrder(db, bus, id, { actorId: 'system', role: 'admin', reason: 'Payment not completed in time' }); }
    catch (error) { console.error('sweep cancel failed', id, error.message); }
  }
  return stale.length;
}