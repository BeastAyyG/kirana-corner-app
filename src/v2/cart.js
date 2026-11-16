import { AppError, etaMinutes, haversineKm, isoNow, requireInt } from './util.js';
import { getStore, storeAcceptingOrders } from './db.js';
import { getAddress, mapProduct } from './catalog.js';
import { couponDiscount, validateCoupon } from './promotions.js';

export function getCart(db, userId) {
  const cart = db.prepare('SELECT store_id,updated_at FROM carts WHERE user_id=?').get(userId);
  if (!cart) return { store_id: null, updated_at: null, items: [], items_total_minor: 0, savings_minor: 0 };
  const items = db.prepare(`SELECT p.*,ci.quantity,ci.quoted_price_minor FROM cart_items ci
    JOIN products p ON p.id=ci.product_id AND p.store_id=? WHERE ci.user_id=? ORDER BY p.category_id,p.name`)
    .all(cart.store_id, userId)
    .map(row => ({
      ...mapProduct(row), quantity: Number(row.quantity),
      quoted_price_minor: Number(row.quoted_price_minor || row.price_minor),
      price_changed: Number(row.quoted_price_minor) > 0 && Number(row.quoted_price_minor) !== Number(row.price_minor),
      line_total_minor: Number(row.price_minor) * Number(row.quantity)
    }));
  return {
    store_id: cart.store_id, updated_at: cart.updated_at, items,
    items_total_minor: items.reduce((sum, item) => sum + item.line_total_minor, 0),
    savings_minor: items.reduce((sum, item) => sum + (item.mrp_minor - item.price_minor) * item.quantity, 0)
  };
}

export function putCart(db, userId, { store_id: storeId, items }) {
  const store = getStore(db, String(storeId || ''));
  if (!store) throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found.');
  if (!Array.isArray(items) || items.length > 60) throw new AppError(400, 'INVALID_CART', 'A cart may contain up to 60 items.');
  const quantities = new Map(), quotes = new Map();
  for (const item of items) {
    const productId = String(item.product_id || '');
    const quantity = requireInt(item.quantity, 'Quantity', { min: 1, max: 99 });
    if (!productId) throw new AppError(400, 'INVALID_CART_ITEM', 'Each item needs a product_id.');
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
    if (item.expected_price_minor !== undefined) {
      const quote = requireInt(item.expected_price_minor, 'Displayed price', { min: 1 });
      if (quotes.has(productId) && quotes.get(productId) !== quote) throw new AppError(400, 'INVALID_CART_ITEM', 'Conflicting displayed prices for one item.');
      quotes.set(productId, quote);
    }
  }
  const now = isoNow();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [productId, quantity] of quantities) {
      const product = db.prepare('SELECT * FROM products WHERE store_id=? AND id=? AND active=1').get(store.id, productId);
      if (!product) throw new AppError(400, 'MIXED_STORE_CART', 'Every cart item must belong to the selected store.');
      if (quantity > product.max_per_order) throw new AppError(400, 'MAX_PER_ORDER', `${product.name} is limited to ${product.max_per_order} per order.`);
    }
    db.prepare(`INSERT INTO carts (user_id,store_id,updated_at) VALUES (?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET store_id=excluded.store_id,updated_at=excluded.updated_at`).run(userId, store.id, now);
    db.prepare('DELETE FROM cart_items WHERE user_id=?').run(userId);
    const add = db.prepare('INSERT INTO cart_items (user_id,product_id,quantity,quoted_price_minor,updated_at) VALUES (?,?,?,?,?)');
    for (const [productId, quantity] of quantities) {
      const current = db.prepare('SELECT price_minor FROM products WHERE store_id=? AND id=?').get(store.id, productId);
      add.run(userId, productId, quantity, quotes.get(productId) || Number(current.price_minor), now);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return getCart(db, userId);
}

export function addCartItem(db, userId, { store_id: storeId, product_id: productId, quantity = 1 }) {
  const store = getStore(db, String(storeId || ''));
  if (!store) throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found.');
  const product = db.prepare('SELECT * FROM products WHERE store_id=? AND id=? AND active=1').get(store.id, String(productId || ''));
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Item not found.');
  const qty = requireInt(quantity, 'Quantity', { min: 1, max: 99 });
  const existing = db.prepare('SELECT quantity FROM cart_items WHERE user_id=? AND product_id=?').get(userId, productId);
  const cart = db.prepare('SELECT store_id FROM carts WHERE user_id=?').get(userId);
  if (cart && cart.store_id !== store.id && (existing || qty > 0)) {
    const existingItems = db.prepare('SELECT COUNT(*) AS count FROM cart_items WHERE user_id=?').get(userId).count;
    if (existingItems > 0) throw new AppError(409, 'CART_STORE_CONFLICT', 'Your cart has items from another store. Clear it first.', { current_store_id: cart.store_id });
  }
  const newQuantity = (existing?.quantity || 0) + qty;
  if (newQuantity > product.max_per_order) throw new AppError(400, 'MAX_PER_ORDER', `${product.name} is limited to ${product.max_per_order} per order.`);
  const available = product.on_hand - product.reserved;
  if (newQuantity > available) throw new AppError(409, 'INSUFFICIENT_STOCK', `Only ${available} left of ${product.name}.`, { available });
  const now = isoNow();
  db.prepare(`INSERT INTO carts (user_id,store_id,updated_at) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET store_id=excluded.store_id,updated_at=excluded.updated_at`).run(userId, store.id, now);
  db.prepare(`INSERT INTO cart_items (user_id,product_id,quantity,quoted_price_minor,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at`)
    .run(userId, productId, newQuantity, Number(product.price_minor), now);
  return getCart(db, userId);
}

export function setCartItemQuantity(db, userId, productId, quantity) {
  const cart = db.prepare('SELECT store_id FROM carts WHERE user_id=?').get(userId);
  if (!cart) throw new AppError(404, 'CART_EMPTY', 'Your cart is empty.');
  const qty = requireInt(quantity, 'Quantity', { min: 0, max: 99 });
  if (qty === 0) {
    db.prepare('DELETE FROM cart_items WHERE user_id=? AND product_id=?').run(userId, productId);
  } else {
    const product = db.prepare('SELECT * FROM products WHERE store_id=? AND id=? AND active=1').get(cart.store_id, productId);
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Item not found.');
    if (qty > product.max_per_order) throw new AppError(400, 'MAX_PER_ORDER', `${product.name} is limited to ${product.max_per_order} per order.`);
    if (qty > product.on_hand - product.reserved) throw new AppError(409, 'INSUFFICIENT_STOCK', `Only ${product.on_hand - product.reserved} left of ${product.name}.`);
    db.prepare('UPDATE cart_items SET quantity=?,updated_at=? WHERE user_id=? AND product_id=?').run(qty, isoNow(), userId, productId);
  }
  const remaining = db.prepare('SELECT COUNT(*) AS count FROM cart_items WHERE user_id=?').get(userId).count;
  if (!remaining) db.prepare('DELETE FROM carts WHERE user_id=?').run(userId);
  return getCart(db, userId);
}

export function clearCart(db, userId) {
  db.prepare('DELETE FROM cart_items WHERE user_id=?').run(userId);
  db.prepare('DELETE FROM carts WHERE user_id=?').run(userId);
  return getCart(db, userId);
}

// Single source of truth for money math. Used by quote AND checkout.
export function computeBill(db, { store, lines, distanceKm, coupon = null, tipMinor = 0 }) {
  const itemsTotal = lines.reduce((sum, line) => sum + line.price_minor * line.quantity, 0);
  const savings = lines.reduce((sum, line) => sum + (line.mrp_minor - line.price_minor) * line.quantity, 0);
  const { discount_minor: couponDiscountMinor, free_delivery: couponFreeDelivery } = couponDiscount(coupon, itemsTotal, 0);
  const threshold = Number(store.free_delivery_above_minor);
  const qualifiesFree = itemsTotal >= threshold;
  const rawDelivery = Math.round(Number(store.delivery_base_fee_minor) + Number(store.delivery_per_km_minor) * distanceKm);
  const deliveryFee = (qualifiesFree || couponFreeDelivery) ? 0 : rawDelivery;
  const handling = Number(store.handling_fee_minor);
  const surge = store.surge_active ? Number(store.surge_fee_minor) : 0;
  const tip = requireInt(tipMinor, 'Tip', { min: 0, max: 50000 });
  const grand = Math.max(0, itemsTotal - couponDiscountMinor) + deliveryFee + handling + surge + tip;
  return {
    items_total_minor: itemsTotal, savings_minor: savings,
    delivery_fee_minor: deliveryFee, delivery_fee_waived: deliveryFee === 0 && rawDelivery > 0,
    free_delivery_above_minor: threshold,
    amount_to_free_delivery_minor: qualifiesFree ? 0 : threshold - itemsTotal,
    handling_fee_minor: handling, surge_fee_minor: surge,
    coupon_code: coupon?.code || null, coupon_discount_minor: couponDiscountMinor,
    tip_minor: tip, grand_total_minor: grand,
    distance_km: Math.round(distanceKm * 100) / 100
  };
}

export function quoteCart(db, userId, { address_id: addressId, coupon_code: couponCode, tip_minor: tipMinor = 0, delivery_type: deliveryType = 'instant' } = {}) {
  const cart = getCart(db, userId);
  if (!cart.store_id || !cart.items.length) throw new AppError(400, 'CART_EMPTY', 'Your cart is empty.');
  const store = getStore(db, cart.store_id);
  const address = getAddress(db, userId, String(addressId || ''));
  const distance = haversineKm(address.lat, address.lng, store.lat, store.lng);
  if (distance > store.radius_km) throw new AppError(409, 'OUT_OF_RANGE', 'This store does not deliver to the selected address.');
  if (!storeAcceptingOrders(db, store.id)) throw new AppError(409, 'STORE_CLOSED', 'This store is not accepting orders right now.');
  if (deliveryType !== 'instant' && deliveryType !== 'scheduled') throw new AppError(400, 'INVALID_DELIVERY_TYPE', 'delivery_type must be instant or scheduled.');
  for (const item of cart.items) {
    if (!item.active) throw new AppError(409, 'PRODUCT_UNAVAILABLE', `${item.name} is no longer available.`);
    if (item.quantity > item.available) throw new AppError(409, 'INSUFFICIENT_STOCK', `${item.name} has only ${item.available} available.`, { product_id: item.id, available: item.available });
  }
  const coupon = validateCoupon(db, couponCode, userId, cart.items_total_minor);
  const bill = computeBill(db, { store, lines: cart.items, distanceKm: distance, coupon, tipMinor });
  if (bill.items_total_minor < store.min_order_minor)
    throw new AppError(400, 'MIN_ORDER', `Minimum order for this store is ₹${store.min_order_minor / 100}.`);
  const eta = etaMinutes(distance, store.prep_time_minutes);
  return {
    store: { id: store.id, name: store.name }, address, delivery_type: deliveryType,
    items: cart.items, bill,
    eta_minutes: deliveryType === 'instant' ? eta : null,
    eta_range: deliveryType === 'instant' ? [eta, eta + 4] : null,
    payment_methods: ['cod', 'online']
  };
}