import { AppError, etaMinutes, haversineKm, isoNow, newId, requireInt, requireLatLng, requireString } from './util.js';
import { getStore, storeAcceptingOrders } from './db.js';

export function listCategories(db) {
  return db.prepare('SELECT id,name,sort_order FROM categories ORDER BY sort_order').all();
}

export function publicStore(store, distanceKm = null) {
  return {
    id: store.id, name: store.name, address: store.address, city: store.city, pincode: store.pincode,
    lat: store.lat, lng: store.lng, radius_km: store.radius_km,
    is_open: Boolean(store.is_open), accepting_orders: Boolean(store.accepting_orders),
    prep_time_minutes: store.prep_time_minutes, min_order_minor: store.min_order_minor,
    delivery_base_fee_minor: store.delivery_base_fee_minor, delivery_per_km_minor: store.delivery_per_km_minor,
    free_delivery_above_minor: store.free_delivery_above_minor, handling_fee_minor: store.handling_fee_minor,
    surge_active: Boolean(store.surge_active), surge_fee_minor: store.surge_active ? store.surge_fee_minor : 0,
    distance_km: distanceKm === null ? null : Math.round(distanceKm * 100) / 100
  };
}

export function checkServiceability(db, { lat, lng }) {
  const point = requireLatLng(lat, lng);
  const stores = db.prepare('SELECT * FROM stores WHERE active=1 AND is_open=1 AND accepting_orders=1').all();
  let best = null;
  for (const store of stores) {
    const distance = haversineKm(point.lat, point.lng, store.lat, store.lng);
    if (distance <= store.radius_km && (!best || distance < best.distance)) best = { store, distance };
  }
  if (!best) return { serviceable: false, reason: 'NO_STORE_IN_RANGE', message: 'We do not deliver to this location yet. Try another address.' };
  const eta = etaMinutes(best.distance, best.store.prep_time_minutes);
  return {
    serviceable: true, store: publicStore(best.store, best.distance),
    distance_km: Math.round(best.distance * 100) / 100,
    eta_minutes: eta, eta_range: [eta, eta + 4],
    promise: `Delivery in ${eta}–${eta + 4} minutes`
  };
}

export function listStores(db) {
  return db.prepare('SELECT * FROM stores WHERE active=1 ORDER BY name').all().map(store => publicStore(store));
}

export function mapProduct(row, { staff = false } = {}) {
  const product = {
    id: row.id, store_id: row.store_id, category_id: row.category_id,
    name: row.name, brand: row.brand, unit: row.unit, description: row.description, image_url: row.image_url,
    mrp_minor: Number(row.mrp_minor), price_minor: Number(row.price_minor),
    discount_percent: row.mrp_minor > row.price_minor ? Math.round((1 - row.price_minor / row.mrp_minor) * 100) : 0,
    available: Math.max(0, Number(row.on_hand) - Number(row.reserved)),
    max_per_order: Number(row.max_per_order), active: Boolean(row.active), updated_at: row.updated_at
  };
  if (staff) Object.assign(product, { on_hand: Number(row.on_hand), reserved: Number(row.reserved), aisle: row.aisle, shelf: row.shelf });
  return product;
}

export function getProducts(db, storeId, { q = '', category = '', inStock = '', sort = '', page = 1, pageSize = 40 } = {}) {
  if (!getStore(db, storeId)) throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found.');
  const params = [storeId];
  let sql = 'SELECT * FROM products WHERE store_id=? AND active=1';
  if (category) { sql += ' AND category_id=?'; params.push(category); }
  if (q) {
    const term = `%${String(q).slice(0, 80)}%`;
    sql += ' AND (name LIKE ? OR brand LIKE ? OR description LIKE ?)';
    params.push(term, term, term);
  }
  if (String(inStock) === 'true') sql += ' AND on_hand-reserved>0';
  const orderBy = {
    price_asc: 'price_minor ASC,name ASC', price_desc: 'price_minor DESC,name ASC',
    discount: '(mrp_minor-price_minor) DESC,name ASC', name: 'name ASC'
  }[sort] || 'category_id,name ASC';
  const size = requireInt(pageSize, 'page_size', { min: 1, max: 100 });
  const pageNum = requireInt(page, 'page', { min: 1, max: 10000 });
  const total = db.prepare(`SELECT COUNT(*) AS count FROM (${sql})`).get(...params).count;
  const rows = db.prepare(`${sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, size, (pageNum - 1) * size);
  return { products: rows.map(row => mapProduct(row)), total: Number(total), page: pageNum, page_size: size };
}

export function getProduct(db, storeId, productId, { staff = false } = {}) {
  if (!getStore(db, storeId)) throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found.');
  const row = db.prepare('SELECT * FROM products WHERE store_id=? AND id=? AND active=1').get(storeId, productId);
  if (!row) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Item not found.');
  return mapProduct(row, { staff });
}

export function searchProducts(db, storeId, q) {
  return getProducts(db, storeId, { q, inStock: 'true', pageSize: 50 }).products;
}

// ---- Addresses ----
function addressRow(db, id, userId) {
  const row = db.prepare('SELECT * FROM addresses WHERE id=? AND user_id=?').get(id, userId);
  if (!row) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found.');
  return row;
}
export function mapAddress(row) {
  return {
    id: row.id, label: row.label, receiver_name: row.receiver_name, receiver_phone: row.receiver_phone,
    line1: row.line1, line2: row.line2, city: row.city, pincode: row.pincode,
    lat: row.lat, lng: row.lng, is_default: Boolean(row.is_default),
    full_address: [row.line1, row.line2, `${row.city} ${row.pincode}`].filter(Boolean).join(', ')
  };
}
export function listAddresses(db, userId) {
  return db.prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC,created_at DESC').all(userId).map(mapAddress);
}
export function createAddress(db, userId, input) {
  const point = requireLatLng(input.lat, input.lng);
  const address = {
    label: requireString(input.label || 'Home', 'Label', { max: 30 }),
    receiver_name: requireString(input.receiver_name, 'Receiver name', { max: 80 }),
    receiver_phone: requireString(input.receiver_phone, 'Receiver phone', { min: 10, max: 15 }),
    line1: requireString(input.line1, 'Address line 1', { max: 160 }),
    line2: String(input.line2 || '').trim().slice(0, 160),
    city: requireString(input.city, 'City', { max: 60 }),
    pincode: requireString(input.pincode, 'Pincode', { min: 6, max: 6 })
  };
  if (!/^\d{6}$/.test(address.pincode)) throw new AppError(400, 'INVALID_PINCODE', 'Pincode must be 6 digits.');
  const count = db.prepare('SELECT COUNT(*) AS count FROM addresses WHERE user_id=?').get(userId).count;
  if (count >= 10) throw new AppError(400, 'ADDRESS_LIMIT', 'You can save up to 10 addresses.');
  const id = newId('addr-'), now = isoNow();
  const isDefault = input.is_default === true || count === 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (isDefault) db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(userId);
    db.prepare(`INSERT INTO addresses (id,user_id,label,receiver_name,receiver_phone,line1,line2,city,pincode,lat,lng,is_default,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, userId, address.label, address.receiver_name, address.receiver_phone, address.line1, address.line2,
        address.city, address.pincode, point.lat, point.lng, Number(isDefault), now, now);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return mapAddress(addressRow(db, id, userId));
}
export function updateAddress(db, userId, id, input) {
  const current = addressRow(db, id, userId);
  const merged = { ...current, ...input, lat: input.lat ?? current.lat, lng: input.lng ?? current.lng };
  const point = requireLatLng(merged.lat, merged.lng);
  db.prepare(`UPDATE addresses SET label=?,receiver_name=?,receiver_phone=?,line1=?,line2=?,city=?,pincode=?,lat=?,lng=?,updated_at=? WHERE id=? AND user_id=?`)
    .run(requireString(merged.label, 'Label', { max: 30 }), requireString(merged.receiver_name, 'Receiver name', { max: 80 }),
      requireString(merged.receiver_phone, 'Receiver phone', { min: 10, max: 15 }), requireString(merged.line1, 'Address line 1', { max: 160 }),
      String(merged.line2 || '').slice(0, 160), requireString(merged.city, 'City', { max: 60 }),
      requireString(merged.pincode, 'Pincode', { min: 6, max: 6 }), point.lat, point.lng, isoNow(), id, userId);
  if (input.is_default === true) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(userId);
      db.prepare('UPDATE addresses SET is_default=1 WHERE id=? AND user_id=?').run(id, userId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return mapAddress(addressRow(db, id, userId));
}
export function deleteAddress(db, userId, id) {
  addressRow(db, id, userId);
  db.prepare('DELETE FROM addresses WHERE id=? AND user_id=?').run(id, userId);
  const remaining = listAddresses(db, userId);
  if (remaining.length && !remaining.some(a => a.is_default))
    db.prepare('UPDATE addresses SET is_default=1 WHERE id=?').run(remaining[0].id);
  return { deleted: true };
}
export function getAddress(db, userId, id) { return mapAddress(addressRow(db, id, userId)); }

// ---- Saved products ----
export function listSaved(db, userId) {
  return db.prepare(`SELECT p.*,s.created_at AS saved_at FROM saved_products s
    JOIN products p ON p.id=s.product_id AND p.store_id=s.store_id
    WHERE s.user_id=? AND p.active=1 ORDER BY s.created_at DESC`).all(userId)
    .map(row => ({ ...mapProduct(row), saved_at: row.saved_at }));
}
export function saveProduct(db, userId, storeId, productId) {
  getProduct(db, storeId, productId);
  db.prepare('INSERT OR IGNORE INTO saved_products (user_id,product_id,store_id,created_at) VALUES (?,?,?,?)')
    .run(userId, productId, storeId, isoNow());
  return listSaved(db, userId);
}
export function unsaveProduct(db, userId, storeId, productId) {
  db.prepare('DELETE FROM saved_products WHERE user_id=? AND store_id=? AND product_id=?').run(userId, storeId, productId);
  return listSaved(db, userId);
}

// ---- Scheduled delivery slots (Big Basket-style) ----
const SLOT_WINDOWS = [['07:00', '09:00'], ['09:00', '11:00'], ['11:00', '13:00'], ['13:00', '15:00'], ['15:00', '17:00'], ['17:00', '19:00'], ['19:00', '21:00']];
const SLOT_CAPACITY = 20;
const SLOT_CUTOFF_MS = 60 * 60 * 1000;

function istDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function istDateTimeToUtc(date, time) {
  return new Date(`${date}T${time}:00+05:30`).toISOString();
}
export function getDeliverySlots(db, storeId, date) {
  const store = getStore(db, storeId);
  if (!store) throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found.');
  const today = istDate();
  const day = date || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < today) throw new AppError(400, 'INVALID_DATE', 'Choose today or a future date (YYYY-MM-DD).');
  const maxDay = istDate(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
  if (day > maxDay) throw new AppError(400, 'INVALID_DATE', 'Slots are available for today and the next 2 days.');
  const insert = db.prepare(`INSERT OR IGNORE INTO delivery_slots (id,store_id,slot_date,starts_at,ends_at,capacity,reserved_count,active)
    VALUES (?,?,?,?,?,?,0,1)`);
  for (const [start, end] of SLOT_WINDOWS)
    insert.run(`${storeId}_${day}_${start.replace(':', '')}`, storeId, day, istDateTimeToUtc(day, start), istDateTimeToUtc(day, end), SLOT_CAPACITY);
  const now = Date.now();
  return db.prepare('SELECT * FROM delivery_slots WHERE store_id=? AND slot_date=? AND active=1 ORDER BY starts_at')
    .all(storeId, day)
    .filter(slot => Date.parse(slot.starts_at) > now + SLOT_CUTOFF_MS && slot.reserved_count < slot.capacity)
    .map(slot => ({
      id: slot.id, store_id: storeId, slot_date: day,
      starts_at: slot.starts_at, ends_at: slot.ends_at,
      label: `${slot.starts_at.slice(11, 16)}–${slot.ends_at.slice(11, 16)} IST`,
      capacity: slot.capacity, remaining: slot.capacity - slot.reserved_count
    }));
}
export function slotBookable(db, slotId, storeId) {
  const slot = db.prepare('SELECT * FROM delivery_slots WHERE id=? AND store_id=? AND active=1').get(slotId, storeId);
  if (!slot) return null;
  if (Date.parse(slot.starts_at) <= Date.now() + SLOT_CUTOFF_MS) return null;
  if (slot.reserved_count >= slot.capacity) return null;
  return slot;
}
export { storeAcceptingOrders };