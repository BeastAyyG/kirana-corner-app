import { AppError, isoNow, newId, normalizePhone, requireBool, requireInt, requireLatLng, requireString } from './util.js';
import { audit, getStore } from './db.js';
import { publicStore } from './catalog.js';
import { couponView } from './promotions.js';
import { getOrderView } from './orders.js';

export function overview(db) {
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.toISOString();
  const orders = db.prepare(`SELECT status, COUNT(*) AS count, COALESCE(SUM(grand_total_minor),0) AS total
    FROM orders WHERE created_at>=? GROUP BY status`).all(since);
  const delivered = db.prepare(`SELECT COUNT(*) AS count, COALESCE(AVG((julianday(delivered_at)-julianday(placed_at))*1440),0) AS avg_minutes
    FROM orders WHERE status='delivered' AND delivered_at>=?`).get(since);
  const ridersOnline = db.prepare('SELECT COUNT(*) AS count FROM riders WHERE is_online=1 AND active=1').get().count;
  const storesOpen = db.prepare('SELECT COUNT(*) AS count FROM stores WHERE active=1 AND is_open=1 AND accepting_orders=1').get().count;
  const users = db.prepare('SELECT role, COUNT(*) AS count FROM users GROUP BY role').all();
  const pendingPayments = db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE payment_status='pending' AND status='placed'`).get().count;
  return {
    today: {
      orders_by_status: Object.fromEntries(orders.map(row => [row.status, Number(row.count)])),
      gmv_minor: orders.filter(row => row.status === 'delivered').reduce((sum, row) => sum + Number(row.total), 0),
      delivered: Number(delivered.count),
      avg_delivery_minutes: Math.round(Number(delivered.avg_minutes) * 10) / 10
    },
    riders_online: Number(ridersOnline), stores_open: Number(storesOpen),
    users_by_role: Object.fromEntries(users.map(row => [row.role, Number(row.count)])),
    pending_payments: Number(pendingPayments)
  };
}

export function listStoresAdmin(db) {
  return db.prepare('SELECT * FROM stores ORDER BY created_at').all().map(store => ({ ...publicStore(store), active: Boolean(store.active), rider_payout_minor: store.rider_payout_minor }));
}

export function createStore(db, input, actorId) {
  const point = requireLatLng(input.lat, input.lng);
  const store = {
    id: requireString(input.id, 'Store id', { min: 3, max: 40 }).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    name: requireString(input.name, 'Name', { min: 3, max: 80 }),
    address: requireString(input.address, 'Address', { min: 5, max: 160 }),
    city: requireString(input.city, 'City', { max: 60 }),
    pincode: requireString(input.pincode, 'Pincode', { min: 6, max: 6 }),
    radius_km: Number(input.radius_km ?? 3),
    prep_time_minutes: requireInt(input.prep_time_minutes ?? 8, 'prep_time_minutes', { min: 1, max: 120 })
  };
  if (!Number.isFinite(store.radius_km) || store.radius_km <= 0 || store.radius_km > 15) throw new AppError(400, 'INVALID_INPUT', 'radius_km must be 0-15.');
  if (getStore(db, store.id)) throw new AppError(409, 'STORE_EXISTS', 'A store with that id already exists.');
  const now = isoNow();
  db.prepare(`INSERT INTO stores (id,name,address,city,pincode,lat,lng,radius_km,prep_time_minutes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(store.id, store.name, store.address, store.city, store.pincode, point.lat, point.lng, store.radius_km, store.prep_time_minutes, now, now);
  audit(db, actorId, 'store.create', 'store', store.id, { name: store.name });
  return publicStore(getStore(db, store.id));
}

export function updateStoreAdmin(db, storeId, input, actorId) {
  const store = getStore(db, storeId);
  if (!store) throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found.');
  const next = { ...store };
  if (input.name !== undefined) next.name = requireString(input.name, 'Name', { min: 3, max: 80 });
  if (input.address !== undefined) next.address = requireString(input.address, 'Address', { min: 5, max: 160 });
  if (input.active !== undefined) next.active = Number(requireBool(input.active, 'active'));
  if (input.lat !== undefined || input.lng !== undefined) {
    const point = requireLatLng(input.lat ?? store.lat, input.lng ?? store.lng);
    next.lat = point.lat; next.lng = point.lng;
  }
  db.prepare('UPDATE stores SET name=?,address=?,lat=?,lng=?,active=?,updated_at=? WHERE id=?')
    .run(next.name, next.address, next.lat, next.lng, next.active, isoNow(), storeId);
  audit(db, actorId, 'store.update', 'store', storeId, input);
  return publicStore(getStore(db, storeId));
}

export function listUsers(db, { role = '' } = {}) {
  const valid = ['customer', 'picker', 'rider', 'admin'];
  if (role && !valid.includes(role)) throw new AppError(400, 'INVALID_ROLE', 'Unknown role.');
  const rows = role
    ? db.prepare('SELECT id,phone,role,name,active,created_at FROM users WHERE role=? ORDER BY created_at DESC').all(role)
    : db.prepare('SELECT id,phone,role,name,active,created_at FROM users ORDER BY created_at DESC LIMIT 500').all();
  return rows.map(row => ({ ...row, active: Boolean(row.active) }));
}

export function createStaffUser(db, input, actorId) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError(400, 'INVALID_PHONE', 'Enter a valid Indian mobile number.');
  const role = requireString(input.role, 'Role', { min: 5, max: 6 });
  if (!['picker', 'rider', 'admin'].includes(role)) throw new AppError(400, 'INVALID_ROLE', 'Role must be picker, rider or admin.');
  if (db.prepare('SELECT 1 FROM users WHERE phone=?').get(phone)) throw new AppError(409, 'USER_EXISTS', 'A user with that phone already exists.');
  const name = requireString(input.name, 'Name', { min: 2, max: 80 });
  const id = newId('usr-'), now = isoNow();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO users (id,phone,role,name,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)').run(id, phone, role, name, now, now);
    if (role === 'picker') {
      const storeId = requireString(input.store_id, 'store_id', { min: 3, max: 40 });
      if (!getStore(db, storeId)) throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found.');
      db.prepare('INSERT INTO store_staff (store_id,user_id,role) VALUES (?,?,?)').run(storeId, id, 'picker');
    }
    if (role === 'rider') {
      const storeId = requireString(input.home_store_id ?? input.store_id, 'home_store_id', { min: 3, max: 40 });
      if (!getStore(db, storeId)) throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found.');
      db.prepare('INSERT INTO riders (user_id,home_store_id,is_online,vehicle,active,created_at,updated_at) VALUES (?,?,0,?,1,?,?)')
        .run(id, storeId, String(input.vehicle || 'bike').slice(0, 20), now, now);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  audit(db, actorId, 'user.create_staff', 'user', id, { role, phone });
  return { id, phone, role, name, active: true };
}

export function setUserActive(db, userId, active, actorId) {
  const flag = requireBool(active, 'active');
  const user = db.prepare('SELECT id,role FROM users WHERE id=?').get(userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  if (user.id === actorId) throw new AppError(400, 'SELF_SUSPEND', 'You cannot suspend your own account.');
  db.prepare('UPDATE users SET active=?,updated_at=? WHERE id=?').run(Number(flag), isoNow(), userId);
  if (!flag) db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
  audit(db, actorId, flag ? 'user.activate' : 'user.suspend', 'user', userId);
  return { id: userId, active: flag };
}

export function listCouponsAdmin(db) {
  return db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all().map(row => ({ ...couponView(row), used_count: Number(row.used_count), usage_limit: Number(row.usage_limit), per_user_limit: Number(row.per_user_limit) }));
}

export function createCoupon(db, input, actorId) {
  const code = requireString(input.code, 'Code', { min: 3, max: 20 }).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (db.prepare('SELECT 1 FROM coupons WHERE code=?').get(code)) throw new AppError(409, 'COUPON_EXISTS', 'That code already exists.');
  const type = requireString(input.type, 'Type', { min: 4, max: 13 });
  if (!['flat', 'percent', 'free_delivery'].includes(type)) throw new AppError(400, 'INVALID_COUPON_TYPE', 'type must be flat, percent or free_delivery.');
  const value = requireInt(input.value ?? 0, 'value', { min: 0, max: type === 'percent' ? 90 : 1000000 });
  const id = newId('cpn-');
  db.prepare(`INSERT INTO coupons (id,code,description,type,value,min_order_minor,max_discount_minor,starts_at,ends_at,usage_limit,per_user_limit,used_count,active,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,0,1,?)`)
    .run(id, code, String(input.description || '').slice(0, 160), type, value,
      requireInt(input.min_order_minor ?? 0, 'min_order_minor', { min: 0 }),
      requireInt(input.max_discount_minor ?? 0, 'max_discount_minor', { min: 0 }),
      requireString(input.starts_at, 'starts_at', { min: 10, max: 30 }),
      requireString(input.ends_at, 'ends_at', { min: 10, max: 30 }),
      requireInt(input.usage_limit ?? 100000, 'usage_limit', { min: 1 }),
      requireInt(input.per_user_limit ?? 1, 'per_user_limit', { min: 1 }), isoNow());
  audit(db, actorId, 'coupon.create', 'coupon', id, { code });
  return couponView(db.prepare('SELECT * FROM coupons WHERE id=?').get(id));
}

export function updateCoupon(db, couponId, input, actorId) {
  const coupon = db.prepare('SELECT * FROM coupons WHERE id=?').get(couponId);
  if (!coupon) throw new AppError(404, 'COUPON_NOT_FOUND', 'Coupon not found.');
  const active = input.active === undefined ? Boolean(coupon.active) : requireBool(input.active, 'active');
  db.prepare('UPDATE coupons SET active=?,description=? WHERE id=?')
    .run(Number(active), input.description === undefined ? coupon.description : String(input.description).slice(0, 160), couponId);
  audit(db, actorId, 'coupon.update', 'coupon', couponId, { active });
  return couponView(db.prepare('SELECT * FROM coupons WHERE id=?').get(couponId));
}

export function listAllOrders(db, { status = '', store_id: storeId = '' } = {}) {
  let sql = 'SELECT id FROM orders';
  const params = [];
  const clauses = [];
  if (status) { clauses.push('status=?'); params.push(status); }
  if (storeId) { clauses.push('store_id=?'); params.push(storeId); }
  if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
  sql += ' ORDER BY created_at DESC LIMIT 200';
  return db.prepare(sql).all(...params).map(({ id }) => getOrderView(db, id, { id: 'admin-view', role: 'admin' }));
}

export function auditLog(db, { limit = 100 } = {}) {
  const size = requireInt(limit, 'limit', { min: 1, max: 500 });
  return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(size);
}