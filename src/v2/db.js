import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertProductionConfig, isoNow } from './util.js';
import { seedV2 } from './seed.js';

const MIGRATIONS = [
  {
    version: 1,
    sql: `
    CREATE TABLE users (
      id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('customer','picker','rider','admin')),
      name TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE INDEX idx_sessions_user ON sessions(user_id);
    CREATE TABLE otp_challenges (
      id TEXT PRIMARY KEY, phone TEXT NOT NULL, code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT
    );
    CREATE INDEX idx_otp_phone ON otp_challenges(phone,created_at DESC);
    CREATE TABLE stores (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL, pincode TEXT NOT NULL,
      lat REAL NOT NULL, lng REAL NOT NULL, radius_km REAL NOT NULL DEFAULT 3 CHECK(radius_km>0),
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      is_open INTEGER NOT NULL DEFAULT 1 CHECK(is_open IN (0,1)),
      accepting_orders INTEGER NOT NULL DEFAULT 1 CHECK(accepting_orders IN (0,1)),
      prep_time_minutes INTEGER NOT NULL DEFAULT 8 CHECK(prep_time_minutes BETWEEN 1 AND 120),
      min_order_minor INTEGER NOT NULL DEFAULT 0 CHECK(min_order_minor>=0),
      delivery_base_fee_minor INTEGER NOT NULL DEFAULT 2500 CHECK(delivery_base_fee_minor>=0),
      delivery_per_km_minor INTEGER NOT NULL DEFAULT 800 CHECK(delivery_per_km_minor>=0),
      free_delivery_above_minor INTEGER NOT NULL DEFAULT 19900 CHECK(free_delivery_above_minor>=0),
      handling_fee_minor INTEGER NOT NULL DEFAULT 900 CHECK(handling_fee_minor>=0),
      surge_fee_minor INTEGER NOT NULL DEFAULT 1500 CHECK(surge_fee_minor>=0),
      surge_active INTEGER NOT NULL DEFAULT 0 CHECK(surge_active IN (0,1)),
      rider_payout_minor INTEGER NOT NULL DEFAULT 3500 CHECK(rider_payout_minor>=0),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE store_staff (
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'picker', PRIMARY KEY(store_id,user_id)
    );
    CREATE TABLE categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE products (
      id TEXT NOT NULL, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id),
      name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '',
      mrp_minor INTEGER NOT NULL CHECK(mrp_minor>0), price_minor INTEGER NOT NULL CHECK(price_minor>0 AND price_minor<=mrp_minor),
      on_hand INTEGER NOT NULL DEFAULT 0 CHECK(on_hand>=0),
      reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=on_hand),
      aisle TEXT NOT NULL DEFAULT '', shelf TEXT NOT NULL DEFAULT '',
      max_per_order INTEGER NOT NULL DEFAULT 10 CHECK(max_per_order BETWEEN 1 AND 99),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(store_id,id)
    );
    CREATE INDEX idx_products_store_cat ON products(store_id,category_id,active,name);
    CREATE TABLE addresses (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT 'Home', receiver_name TEXT NOT NULL, receiver_phone TEXT NOT NULL,
      line1 TEXT NOT NULL, line2 TEXT NOT NULL DEFAULT '', city TEXT NOT NULL, pincode TEXT NOT NULL,
      lat REAL NOT NULL, lng REAL NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_addresses_user ON addresses(user_id,is_default DESC);
    CREATE TABLE carts (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      store_id TEXT NOT NULL REFERENCES stores(id), updated_at TEXT NOT NULL
    );
    CREATE TABLE cart_items (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99),
      quoted_price_minor INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,product_id)
    );
    CREATE TABLE saved_products (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, product_id TEXT NOT NULL,
      store_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,store_id,product_id)
    );
    CREATE TABLE coupons (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL CHECK(type IN ('flat','percent','free_delivery')),
      value INTEGER NOT NULL DEFAULT 0 CHECK(value>=0),
      min_order_minor INTEGER NOT NULL DEFAULT 0, max_discount_minor INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      usage_limit INTEGER NOT NULL DEFAULT 100000, per_user_limit INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count>=0),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
    );
    CREATE TABLE coupon_redemptions (
      id TEXT PRIMARY KEY, coupon_id TEXT NOT NULL REFERENCES coupons(id),
      user_id TEXT NOT NULL REFERENCES users(id), order_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX idx_redemptions_coupon_user ON coupon_redemptions(coupon_id,user_id);
    CREATE TABLE delivery_slots (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      slot_date TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK(capacity>0), reserved_count INTEGER NOT NULL DEFAULT 0 CHECK(reserved_count>=0 AND reserved_count<=capacity),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      UNIQUE(store_id,slot_date,starts_at)
    );
    CREATE TABLE orders (
      id TEXT PRIMARY KEY, public_label TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL REFERENCES users(id), store_id TEXT NOT NULL REFERENCES stores(id),
      address_id TEXT NOT NULL REFERENCES addresses(id),
      delivery_type TEXT NOT NULL DEFAULT 'instant' CHECK(delivery_type IN ('instant','scheduled')),
      slot_id TEXT REFERENCES delivery_slots(id),
      status TEXT NOT NULL CHECK(status IN ('placed','packing','packed','rider_assigned','picked_up','delivered','cancelled')),
      payment_method TEXT NOT NULL CHECK(payment_method IN ('cod','online')),
      payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','failed','refunded','partially_refunded','cod_due','cod_collected')),
      items_total_minor INTEGER NOT NULL CHECK(items_total_minor>=0),
      savings_minor INTEGER NOT NULL DEFAULT 0,
      delivery_fee_minor INTEGER NOT NULL DEFAULT 0, handling_fee_minor INTEGER NOT NULL DEFAULT 0,
      surge_fee_minor INTEGER NOT NULL DEFAULT 0, tip_minor INTEGER NOT NULL DEFAULT 0,
      coupon_discount_minor INTEGER NOT NULL DEFAULT 0, coupon_id TEXT REFERENCES coupons(id),
      grand_total_minor INTEGER NOT NULL CHECK(grand_total_minor>=0),
      cod_due_minor INTEGER NOT NULL DEFAULT 0,
      delivery_instructions TEXT NOT NULL DEFAULT '',
      address_snapshot TEXT NOT NULL DEFAULT '',
      distance_km REAL NOT NULL DEFAULT 0,
      eta_promise_minutes INTEGER NOT NULL DEFAULT 10, eta_estimated_at TEXT,
      delivery_otp_hash TEXT NOT NULL, pickup_code_hash TEXT NOT NULL,
      rider_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, placed_at TEXT NOT NULL,
      packing_at TEXT, packed_at TEXT, assigned_at TEXT, picked_up_at TEXT, delivered_at TEXT,
      cancelled_at TEXT, cancel_reason TEXT, cancel_actor TEXT,
      rating INTEGER CHECK(rating BETWEEN 1 AND 5), rating_comment TEXT, rated_at TEXT
    );
    CREATE INDEX idx_orders_customer ON orders(customer_id,created_at DESC);
    CREATE INDEX idx_orders_store_status ON orders(store_id,status,created_at DESC);
    CREATE INDEX idx_orders_rider ON orders(rider_id,status);
    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL, name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '', price_minor INTEGER NOT NULL CHECK(price_minor>0),
      mrp_minor INTEGER NOT NULL CHECK(mrp_minor>0), quantity INTEGER NOT NULL CHECK(quantity>0),
      picked_quantity INTEGER, refunded_minor INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL DEFAULT 'system', status TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE riders (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      home_store_id TEXT NOT NULL REFERENCES stores(id),
      is_online INTEGER NOT NULL DEFAULT 0 CHECK(is_online IN (0,1)),
      lat REAL, lng REAL, last_ping_at TEXT, vehicle TEXT NOT NULL DEFAULT 'bike',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE rider_jobs (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      rider_id TEXT NOT NULL REFERENCES users(id), store_id TEXT NOT NULL REFERENCES stores(id),
      status TEXT NOT NULL CHECK(status IN ('offered','accepted','picked_up','delivered','declined','cancelled','expired')),
      payout_minor INTEGER NOT NULL DEFAULT 0, tip_minor INTEGER NOT NULL DEFAULT 0,
      cash_to_collect_minor INTEGER NOT NULL DEFAULT 0, cash_collected INTEGER NOT NULL DEFAULT 0 CHECK(cash_collected IN (0,1)),
      offered_at TEXT NOT NULL, accepted_at TEXT, picked_up_at TEXT, delivered_at TEXT, ended_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_jobs_one_active ON rider_jobs(order_id) WHERE status IN ('offered','accepted','picked_up');
    CREATE INDEX idx_jobs_rider_status ON rider_jobs(rider_id,status,created_at DESC);
    CREATE TABLE payments (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, provider_ref TEXT NOT NULL DEFAULT '',
      amount_minor INTEGER NOT NULL CHECK(amount_minor>=0),
      status TEXT NOT NULL CHECK(status IN ('created','captured','failed','refunded','partially_refunded')),
      method TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_payments_order ON payments(order_id);
    CREATE TABLE refunds (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      payment_id TEXT REFERENCES payments(id), amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
      reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('initiated','processed','failed')),
      provider_ref TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE idempotency_keys (
      user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL,
      payload_hash TEXT NOT NULL, request_hash TEXT NOT NULL DEFAULT '', order_id TEXT NOT NULL REFERENCES orders(id),
      created_at TEXT NOT NULL, PRIMARY KEY(user_id,key)
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, order_id TEXT,
      read_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX idx_notifications_user ON notifications(user_id,created_at DESC);
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, action TEXT NOT NULL,
      entity TEXT NOT NULL, entity_id TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    `
  }
];

export function openV2Database(dbPath = process.env.KIRANA_V2_DB_PATH || './data/kirana-delivery.sqlite') {
  assertProductionConfig();
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode=WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version,applied_at) VALUES (?,?)').run(migration.version, isoNow());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const hasStores = db.prepare('SELECT COUNT(*) AS count FROM stores').get().count > 0;
  if (!hasStores && process.env.KIRANA_V2_SKIP_SEED !== 'true') seedV2(db);
  return db;
}

export function audit(db, actorId, action, entity, entityId, detail = '') {
  db.prepare('INSERT INTO audit_log (actor_id,action,entity,entity_id,detail,created_at) VALUES (?,?,?,?,?,?)')
    .run(actorId, action, entity, entityId, typeof detail === 'string' ? detail : JSON.stringify(detail), isoNow());
}

export function getStore(db, storeId) {
  return db.prepare('SELECT * FROM stores WHERE id=? AND active=1').get(storeId) || null;
}

export function storeAcceptingOrders(db, storeId) {
  const store = getStore(db, storeId);
  return Boolean(store && store.is_open && store.accepting_orders);
}

export function isStoreStaff(db, userId, storeId) {
  return Boolean(db.prepare('SELECT 1 FROM store_staff WHERE store_id=? AND user_id=?').get(storeId, userId));
}