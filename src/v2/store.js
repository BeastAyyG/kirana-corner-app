import { AppError, isoNow, newId, requireBool, requireInt, requireLatLng, requireString } from './util.js';
import { audit, getStore, isStoreStaff } from './db.js';
import { mapProduct } from './catalog.js';
import { getOrderView } from './orders.js';
import { publishOrder } from './events.js';

function requireStaff(db, actorId, storeId) {
  if (!isStoreStaff(db, actorId, storeId)) throw new AppError(403, 'STORE_ACCESS_DENIED', 'You do not have access to this store.');
}

export function storeQueue(db, storeId, actorId, { status = '', q = '' } = {}) {
  requireStaff(db, actorId, storeId);
  const valid = ['placed', 'packing', 'packed', 'rider_assigned', 'picked_up', 'delivered', 'cancelled'];
  if (status && !valid.includes(status)) throw new AppError(400, 'INVALID_STATUS_FILTER', 'Unknown order status.');
  let sql = `SELECT id FROM orders WHERE store_id=? AND (payment_status IN ('paid','cod_due','cod_collected','partially_refunded','refunded') OR status='cancelled')`;
  const params = [storeId];
  if (status) { sql += ' AND status=?'; params.push(status); }
  const term = String(q || '').trim().slice(0, 80);
  if (term) { sql += ' AND (public_label LIKE ? OR EXISTS (SELECT 1 FROM order_items WHERE order_id=orders.id AND name LIKE ?))'; params.push(`%${term}%`, `%${term}%`); }
  sql += ` ORDER BY (status IN ('placed','packing')) DESC, created_at ASC`;
  return db.prepare(sql).all(...params).map(({ id }) => getOrderView(db, id, { id: actorId, role: 'picker' }));
}

export function storeOrder(db, storeId, orderId, actorId) {
  requireStaff(db, actorId, storeId);
  const order = db.prepare('SELECT store_id FROM orders WHERE id=?').get(orderId);
  if (!order || order.store_id !== storeId) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  return getOrderView(db, orderId, { id: actorId, role: 'picker' });
}

export function listInventory(db, storeId, actorId, { low = '' } = {}) {
  requireStaff(db, actorId, storeId);
  let sql = 'SELECT * FROM products WHERE store_id=?';
  if (String(low) === 'true') sql += ' AND on_hand-reserved<=5';
  sql += ' ORDER BY active DESC,category_id,name';
  return db.prepare(sql).all(storeId).map(row => mapProduct(row, { staff: true }));
}

export function adjustInventory(db, bus, storeId, productId, { delta, reason }, actorId) {
  requireStaff(db, actorId, storeId);
  const change = requireInt(delta, 'Delta', { min: -9999, max: 9999 });
  if (change === 0) throw new AppError(400, 'INVALID_INPUT', 'Delta cannot be zero.');
  const product = db.prepare('SELECT * FROM products WHERE store_id=? AND id=?').get(storeId, productId);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Item not found.');
  const newOnHand = Number(product.on_hand) + change;
  if (newOnHand < Number(product.reserved)) throw new AppError(409, 'RESERVED_STOCK', `Cannot go below ${product.reserved} reserved units.`);
  if (newOnHand > 99999) throw new AppError(400, 'INVALID_INPUT', 'Stock too large.');
  const now = isoNow();
  db.prepare('UPDATE products SET on_hand=?,updated_at=? WHERE store_id=? AND id=?').run(newOnHand, now, storeId, productId);
  audit(db, actorId, 'inventory.adjust', 'product', `${storeId}/${productId}`, { delta: change, reason: String(reason || '').slice(0, 160), on_hand: newOnHand });
  if (newOnHand - Number(product.reserved) <= 5)
    bus.publish(`store:${storeId}`, 'inventory.low_stock', { product_id: productId, name: product.name, available: newOnHand - Number(product.reserved) });
  return mapProduct(db.prepare('SELECT * FROM products WHERE store_id=? AND id=?').get(storeId, productId), { staff: true });
}

function validateProductInput(db, input, existing = null) {
  const merged = { ...existing, ...input };
  const name = requireString(merged.name, 'Name', { min: 2, max: 80 });
  const brand = String(merged.brand || '').trim().slice(0, 60);
  const unit = requireString(merged.unit, 'Unit', { min: 1, max: 24 });
  const categoryId = requireString(merged.category_id ?? merged.category, 'Category', { min: 2, max: 40 });
  if (!db.prepare('SELECT 1 FROM categories WHERE id=?').get(categoryId)) throw new AppError(400, 'INVALID_CATEGORY', 'Unknown category.');
  const mrp = requireInt(merged.mrp_minor, 'MRP', { min: 1, max: 10000000 });
  const price = requireInt(merged.price_minor, 'Price', { min: 1, max: mrp });
  const onHand = requireInt(merged.on_hand ?? 0, 'Stock', { min: Number(existing?.reserved || 0), max: 99999 });
  const maxPerOrder = requireInt(merged.max_per_order ?? 10, 'Max per order', { min: 1, max: 99 });
  const imageUrl = String(merged.image_url || '').trim();
  if (imageUrl && !/^https:\/\//i.test(imageUrl)) throw new AppError(400, 'INVALID_IMAGE_URL', 'Image URL must be https.');
  return {
    name, brand, unit, category_id: categoryId,
    description: String(merged.description || '').trim().slice(0, 400),
    image_url: imageUrl.slice(0, 500), mrp_minor: mrp, price_minor: price, on_hand: onHand,
    aisle: String(merged.aisle || '').trim().slice(0, 12), shelf: String(merged.shelf || '').trim().slice(0, 12),
    max_per_order: maxPerOrder, active: merged.active === undefined ? true : requireBool(merged.active, 'active')
  };
}

export function createStoreProduct(db, storeId, input, actorId) {
  requireStaff(db, actorId, storeId);
  const p = validateProductInput(db, input);
  const id = `item-${newId().slice(0, 8)}`, now = isoNow();
  db.prepare(`INSERT INTO products (id,store_id,category_id,name,brand,unit,description,image_url,mrp_minor,price_minor,on_hand,reserved,aisle,shelf,max_per_order,active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)`)
    .run(id, storeId, p.category_id, p.name, p.brand, p.unit, p.description, p.image_url, p.mrp_minor, p.price_minor,
      p.on_hand, p.aisle, p.shelf, p.max_per_order, Number(p.active), now, now);
  audit(db, actorId, 'product.create', 'product', `${storeId}/${id}`, { name: p.name });
  return mapProduct(db.prepare('SELECT * FROM products WHERE store_id=? AND id=?').get(storeId, id), { staff: true });
}

export function updateStoreProduct(db, storeId, productId, input, actorId) {
  requireStaff(db, actorId, storeId);
  const existing = db.prepare('SELECT * FROM products WHERE store_id=? AND id=?').get(storeId, productId);
  if (!existing) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Item not found.');
  const p = validateProductInput(db, input, existing);
  db.prepare(`UPDATE products SET category_id=?,name=?,brand=?,unit=?,description=?,image_url=?,mrp_minor=?,price_minor=?,on_hand=?,aisle=?,shelf=?,max_per_order=?,active=?,updated_at=?
    WHERE store_id=? AND id=?`)
    .run(p.category_id, p.name, p.brand, p.unit, p.description, p.image_url, p.mrp_minor, p.price_minor, p.on_hand,
      p.aisle, p.shelf, p.max_per_order, Number(p.active), isoNow(), storeId, productId);
  audit(db, actorId, 'product.update', 'product', `${storeId}/${productId}`, { price: p.price_minor, on_hand: p.on_hand });
  return mapProduct(db.prepare('SELECT * FROM products WHERE store_id=? AND id=?').get(storeId, productId), { staff: true });
}

export function updateStoreSettings(db, storeId, input, actorId) {
  requireStaff(db, actorId, storeId);
  const store = getStore(db, storeId);
  if (!store) throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found.');
  const next = { ...store };
  if (input.is_open !== undefined) next.is_open = Number(requireBool(input.is_open, 'is_open'));
  if (input.accepting_orders !== undefined) next.accepting_orders = Number(requireBool(input.accepting_orders, 'accepting_orders'));
  if (input.surge_active !== undefined) next.surge_active = Number(requireBool(input.surge_active, 'surge_active'));
  if (input.prep_time_minutes !== undefined) next.prep_time_minutes = requireInt(input.prep_time_minutes, 'prep_time_minutes', { min: 1, max: 120 });
  if (input.radius_km !== undefined) {
    const radius = Number(input.radius_km);
    if (!Number.isFinite(radius) || radius <= 0 || radius > 15) throw new AppError(400, 'INVALID_INPUT', 'radius_km must be 0-15.');
    next.radius_km = radius;
  }
  for (const key of ['min_order_minor', 'delivery_base_fee_minor', 'delivery_per_km_minor', 'free_delivery_above_minor', 'handling_fee_minor', 'surge_fee_minor', 'rider_payout_minor'])
    if (input[key] !== undefined) next[key] = requireInt(input[key], key, { min: 0, max: 1000000 });
  db.prepare(`UPDATE stores SET is_open=?,accepting_orders=?,surge_active=?,prep_time_minutes=?,radius_km=?,min_order_minor=?,
    delivery_base_fee_minor=?,delivery_per_km_minor=?,free_delivery_above_minor=?,handling_fee_minor=?,surge_fee_minor=?,rider_payout_minor=?,updated_at=? WHERE id=?`)
    .run(next.is_open, next.accepting_orders, next.surge_active, next.prep_time_minutes, next.radius_km, next.min_order_minor,
      next.delivery_base_fee_minor, next.delivery_per_km_minor, next.free_delivery_above_minor, next.handling_fee_minor,
      next.surge_fee_minor, next.rider_payout_minor, isoNow(), storeId);
  audit(db, actorId, 'store.settings', 'store', storeId, input);
  return getStore(db, storeId);
}

export function storeMetrics(db, storeId, actorId) {
  requireStaff(db, actorId, storeId);
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.toISOString();
  const today = db.prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN status='delivered' THEN grand_total_minor ELSE 0 END),0) AS gmv,
    COALESCE(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END),0) AS cancelled,
    COALESCE(SUM(CASE WHEN status IN ('placed','packing') THEN 1 ELSE 0 END),0) AS pending
    FROM orders WHERE store_id=? AND created_at>=?`).get(storeId, since);
  const packTimes = db.prepare(`SELECT packing_at,packed_at FROM orders WHERE store_id=? AND packed_at>=? AND packing_at IS NOT NULL`).all(storeId, since);
  const avgPack = packTimes.length ? packTimes.reduce((sum, row) => sum + (Date.parse(row.packed_at) - Date.parse(row.packing_at)) / 60000, 0) / packTimes.length : null;
  const lowStock = db.prepare('SELECT COUNT(*) AS count FROM products WHERE store_id=? AND active=1 AND on_hand-reserved<=5').get(storeId).count;
  const shortages = db.prepare(`SELECT COALESCE(SUM(refunded_minor),0) AS total FROM order_items oi
    JOIN orders o ON o.id=oi.order_id WHERE o.store_id=? AND o.created_at>=?`).get(storeId, since).total;
  return {
    today: {
      orders: Number(today.total), gmv_minor: Number(today.gmv), cancelled: Number(today.cancelled),
      pending: Number(today.pending), avg_pack_minutes: avgPack === null ? null : Math.round(avgPack * 10) / 10,
      shortage_refunds_minor: Number(shortages)
    },
    low_stock_count: Number(lowStock)
  };
}