import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';

const PILOT_STORE = 'saathi-kirana';
const CATEGORIES = new Set(['Vegetables', 'Dairy', 'Staples', 'Snacks']);
const SEED_PRODUCTS = [
  { id: 'tomato', name: 'Tomatoes', category: 'Vegetables', unit: '500 g', price_minor: 2800, on_hand: 8, art: 'veg' },
  { id: 'onion', name: 'Onions', category: 'Vegetables', unit: '1 kg', price_minor: 3600, on_hand: 6, art: 'veg' },
  { id: 'banana', name: 'Bananas', category: 'Vegetables', unit: '6 pieces', price_minor: 4000, on_hand: 5, art: 'veg' },
  { id: 'milk', name: 'Fresh milk', category: 'Dairy', unit: '500 ml', price_minor: 3400, on_hand: 7, art: 'dairy' },
  { id: 'bread', name: 'Milk bread', category: 'Dairy', unit: '400 g', price_minor: 4200, on_hand: 3, art: 'dairy' },
  { id: 'dal', name: 'Toor dal', category: 'Staples', unit: '500 g', price_minor: 7200, on_hand: 8, art: 'staple' },
  { id: 'atta', name: 'Wheat flour', category: 'Staples', unit: '1 kg', price_minor: 6400, on_hand: 4, art: 'staple' },
  { id: 'salt', name: 'Iodised salt', category: 'Staples', unit: '1 kg', price_minor: 2700, on_hand: 9, art: 'staple' },
  { id: 'biscuits', name: 'Tea biscuits', category: 'Snacks', unit: '1 pack', price_minor: 2000, on_hand: 12, art: 'snack' },
  { id: 'potato', name: 'Potatoes', category: 'Vegetables', unit: '1 kg', price_minor: 3200, on_hand: 10, art: 'veg' },
  { id: 'chillies', name: 'Green chillies', category: 'Vegetables', unit: '100 g', price_minor: 1500, on_hand: 7, art: 'veg' },
  { id: 'spinach', name: 'Spinach', category: 'Vegetables', unit: '1 bunch', price_minor: 2500, on_hand: 4, art: 'veg' },
  { id: 'coriander', name: 'Coriander leaves', category: 'Vegetables', unit: '1 bunch', price_minor: 1000, on_hand: 5, art: 'veg' },
  { id: 'curd', name: 'Fresh curd', category: 'Dairy', unit: '500 g', price_minor: 4500, on_hand: 6, art: 'dairy' },
  { id: 'paneer', name: 'Paneer', category: 'Dairy', unit: '200 g', price_minor: 8500, on_hand: 4, art: 'dairy' },
  { id: 'eggs', name: 'Farm eggs', category: 'Dairy', unit: '6 pieces', price_minor: 4800, on_hand: 8, art: 'dairy' },
  { id: 'rice', name: 'Sona masoori rice', category: 'Staples', unit: '1 kg', price_minor: 7500, on_hand: 8, art: 'staple' },
  { id: 'basmati', name: 'Basmati rice', category: 'Staples', unit: '1 kg', price_minor: 12500, on_hand: 5, art: 'staple' },
  { id: 'sugar', name: 'Sugar', category: 'Staples', unit: '1 kg', price_minor: 4200, on_hand: 10, art: 'staple' },
  { id: 'chana-dal', name: 'Chana dal', category: 'Staples', unit: '500 g', price_minor: 6200, on_hand: 7, art: 'staple' },
  { id: 'oil', name: 'Sunflower oil', category: 'Staples', unit: '1 L', price_minor: 14500, on_hand: 4, art: 'staple' },
  { id: 'tea', name: 'Masala tea', category: 'Staples', unit: '250 g', price_minor: 5500, on_hand: 5, art: 'staple' },
  { id: 'chips', name: 'Salted potato chips', category: 'Snacks', unit: '1 pack', price_minor: 2500, on_hand: 9, art: 'snack' },
  { id: 'namkeen', name: 'Spicy namkeen', category: 'Snacks', unit: '200 g', price_minor: 4000, on_hand: 6, art: 'snack' }
];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}

const isoNow = () => new Date().toISOString();
const DEMO_SECRET='local-only-demo-secret-change-before-deploy';
const secret = () => process.env.KIRANA_PICKUP_CODE_SECRET || DEMO_SECRET;
const sha256 = value => createHash('sha256').update(value).digest('hex');
function codeDigest(orderId, value) {
  return createHmac('sha256', secret()).update(`${orderId}:${String(value).trim().toUpperCase()}`).digest('hex');
}
function makePickupCode(orderId) {
  const bytes = createHmac('sha256', secret()).update(`pickup:${orderId}`).digest();
  let result = '';
  for (let i = 0; result.length < 8; i += 1) result += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return result;
}
function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}
function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}
function localDate(date, timeZone) {
  const p = localParts(date, timeZone); return `${p.year}-${p.month}-${p.day}`;
}
function isCalendarDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
function localDateTimeToUtc(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const p = localParts(new Date(guess), timeZone);
    const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const correction = target - represented;
    if (!correction) break;
    guess += correction;
  }
  return new Date(guess).toISOString();
}
function minutesOf(value) { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; }
function timeOf(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }
function displayTime(iso, timeZone) {
  return new Intl.DateTimeFormat('en-IN', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}
function slotLabel(startsAt, endsAt, timeZone) {
  const start = displayTime(startsAt, timeZone), end = displayTime(endsAt, timeZone);
  const suffix = end.match(/\s(am|pm)$/i)?.[1] || '';
  return `${start}–${suffix ? end.replace(/\s(am|pm)$/i, '') : end} ${suffix}`.trim();
}

export function openDatabase(dbPath = process.env.KIRANA_DB_PATH || './data/kirana.sqlite') {
  if(process.env.NODE_ENV==='production'&&(!process.env.KIRANA_PICKUP_CODE_SECRET||
    process.env.KIRANA_PICKUP_CODE_SECRET===DEMO_SECRET||process.env.KIRANA_PICKUP_CODE_SECRET.startsWith('replace-with-')||
    process.env.KIRANA_PICKUP_CODE_SECRET.length<32))
    throw new Error('Production requires a unique KIRANA_PICKUP_CODE_SECRET of at least 32 characters.');
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode=WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', neighborhood TEXT NOT NULL,
      pickup_location TEXT NOT NULL, time_zone TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('shopper','seller')),
      display_name TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seller_memberships (
      store_id TEXT NOT NULL REFERENCES stores(id), user_id TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY(store_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS store_settings (
      store_id TEXT PRIMARY KEY REFERENCES stores(id), is_open INTEGER NOT NULL DEFAULT 1 CHECK(is_open IN (0,1)),
      service_days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]', updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS store_closures (
      store_id TEXT NOT NULL REFERENCES stores(id), closed_date TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(store_id,closed_date)
    );
    CREATE TABLE IF NOT EXISTS shopper_profiles (
      shopper_id TEXT PRIMARY KEY REFERENCES users(id), display_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shopper_baskets (
      shopper_id TEXT PRIMARY KEY REFERENCES users(id), store_id TEXT NOT NULL REFERENCES stores(id), updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS basket_items (
      shopper_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99), quoted_price_minor INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL, PRIMARY KEY(shopper_id,product_id)
    );
    CREATE TABLE IF NOT EXISTS saved_products (
      shopper_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id),
      created_at TEXT NOT NULL, PRIMARY KEY(shopper_id,product_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pickup_settings (
      store_id TEXT PRIMARY KEY REFERENCES stores(id), evening_start TEXT NOT NULL, evening_end TEXT NOT NULL,
      slot_minutes INTEGER NOT NULL CHECK(slot_minutes=30), capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 500),
      cutoff_minutes INTEGER NOT NULL CHECK(cutoff_minutes BETWEEN 0 AND 360), updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id), name TEXT NOT NULL, category TEXT NOT NULL,
      unit TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '',
      price_minor INTEGER NOT NULL CHECK(price_minor>0), on_hand INTEGER NOT NULL DEFAULT 0 CHECK(on_hand>=0),
      reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=on_hand), art TEXT NOT NULL DEFAULT 'veg',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_active_unique ON products(store_id,name COLLATE NOCASE) WHERE active=1;
    CREATE TABLE IF NOT EXISTS pickup_slots (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id), pickup_date TEXT NOT NULL,
      starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, starts_local TEXT NOT NULL, ends_local TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK(capacity>0), reserved_count INTEGER NOT NULL DEFAULT 0
        CHECK(reserved_count>=0 AND reserved_count<=capacity), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      UNIQUE(store_id,pickup_date,starts_at)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, public_label TEXT NOT NULL UNIQUE, shopper_id TEXT NOT NULL REFERENCES users(id),
      store_id TEXT NOT NULL REFERENCES stores(id), slot_id TEXT NOT NULL REFERENCES pickup_slots(id),
      status TEXT NOT NULL CHECK(status IN ('placed','packing','ready','collected','cancelled')),
      total_minor INTEGER NOT NULL CHECK(total_minor>=0), bag_label TEXT NOT NULL, pickup_location TEXT NOT NULL,
      pickup_code_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, placed_at TEXT NOT NULL,
      packing_at TEXT, ready_at TEXT, collected_at TEXT, cancelled_at TEXT, cancel_reason TEXT, cancel_actor TEXT
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL, product_name TEXT NOT NULL, unit TEXT NOT NULL,
      price_minor INTEGER NOT NULL CHECK(price_minor>0), quantity INTEGER NOT NULL CHECK(quantity>0)
    );
    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idempotency_records (
      shopper_id TEXT NOT NULL REFERENCES users(id), idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
      order_id TEXT NOT NULL REFERENCES orders(id), created_at TEXT NOT NULL, PRIMARY KEY(shopper_id,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_products_store_active ON products(store_id,active,name);
    CREATE INDEX IF NOT EXISTS idx_slots_store_date ON pickup_slots(store_id,pickup_date,active,starts_at);
    CREATE INDEX IF NOT EXISTS idx_orders_shopper ON orders(shopper_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_store_status ON orders(store_id,status,created_at DESC);
  `);
  const ensureColumn=(table,column,definition)=>{
    const existing=db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===column);
    if(!existing)db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  ensureColumn('products','description',"TEXT NOT NULL DEFAULT ''");
  ensureColumn('products','image_url',"TEXT NOT NULL DEFAULT ''");
  ensureColumn('basket_items','quoted_price_minor',"INTEGER NOT NULL DEFAULT 0");
  const now = isoNow();
  db.prepare(`INSERT OR IGNORE INTO stores (id,name,address,neighborhood,pickup_location,time_zone,active,created_at)
    VALUES (?,'Saathi Kirana','18 Sample Market Road','Sample neighbourhood','Green rack beside the front counter','Asia/Kolkata',1,?)`).run(PILOT_STORE, now);
  db.prepare(`INSERT OR IGNORE INTO users (id,role,display_name,created_at) VALUES ('demo-shopper','shopper','Demo shopper',?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO users (id,role,display_name,created_at) VALUES ('demo-seller','seller','Demo shopkeeper',?)`).run(now);
  db.prepare('INSERT OR IGNORE INTO seller_memberships (store_id,user_id) VALUES (?,?)').run(PILOT_STORE, 'demo-seller');
  db.prepare(`INSERT OR IGNORE INTO store_settings (store_id,is_open,service_days,updated_at) VALUES (?,1,'[0,1,2,3,4,5,6]',?)`).run(PILOT_STORE,now);
  db.prepare(`INSERT OR IGNORE INTO shopper_profiles (shopper_id,display_name,email,phone,updated_at) VALUES ('demo-shopper','Demo shopper','','',?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO pickup_settings (store_id,evening_start,evening_end,slot_minutes,capacity,cutoff_minutes,updated_at)
    VALUES (?,'17:30','19:30',30,8,30,?)`).run(PILOT_STORE, now);
  const insert = db.prepare(`INSERT OR IGNORE INTO products (id,store_id,name,category,unit,description,image_url,price_minor,on_hand,reserved,art,active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'',?,?,0,?,1,?,?)`);
  for (const item of SEED_PRODUCTS) insert.run(item.id,PILOT_STORE,item.name,item.category,item.unit,
    `Sample ${item.category.toLowerCase()} for your everyday shop.`,item.price_minor,item.on_hand,item.art,now,now);
  ensureSlots(db, PILOT_STORE, getCurrentStoreDate(db, PILOT_STORE));
  return db;
}

export function getUserById(db,id) {
  return db.prepare('SELECT id,role,display_name AS displayName FROM users WHERE id=?').get(id) || null;
}
export function createSession(db,userId,rawToken) {
  const user=getUserById(db,userId); if(!user)throw new AppError(404,'USER_NOT_FOUND','Sample account not found.');
  const created=isoNow(),expires=new Date(Date.now()+12*60*60*1000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(sha256(rawToken),userId,created,expires);
  return {user,expiresAt:expires};
}
export function getSessionUser(db,rawToken) {
  if(!rawToken)return null;
  const tokenHash=sha256(rawToken);
  const row=db.prepare(`SELECT u.id,u.role,u.display_name AS displayName,s.expires_at AS expiresAt
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(tokenHash);
  if(!row||Date.parse(row.expiresAt)<=Date.now()){if(row)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);return null;}
  return {id:row.id,role:row.role,displayName:row.displayName,expiresAt:row.expiresAt};
}
export function revokeSession(db,rawToken) { if(rawToken)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(rawToken)); }
export function isSellerMember(db,userId,storeId) {
  return Boolean(db.prepare('SELECT 1 FROM seller_memberships WHERE store_id=? AND user_id=?').get(storeId,userId));
}
function storeRow(db,storeId) {
  return db.prepare('SELECT id,name,address,neighborhood,pickup_location,time_zone,active FROM stores WHERE id=? AND active=1').get(storeId)||null;
}
export function listStores(db,{q=''}={}) {
  const search=String(q||'').trim().slice(0,80);
  return db.prepare(`SELECT s.id,s.name,s.address,s.neighborhood,s.pickup_location,s.time_zone,
      ss.is_open,ss.service_days FROM stores s LEFT JOIN store_settings ss ON ss.store_id=s.id
      WHERE s.active=1 AND (?='' OR s.name LIKE ? OR s.neighborhood LIKE ? OR s.address LIKE ?) ORDER BY s.name`)
    .all(search,`%${search}%`,`%${search}%`,`%${search}%`).map(store=>{
        const today=localDate(new Date(),store.time_zone),weekday=new Date(`${today}T12:00:00Z`).getUTCDay();
        const serviceDays=JSON.parse(store.service_days||'[0,1,2,3,4,5,6]');
        const closed=db.prepare('SELECT 1 FROM store_closures WHERE store_id=? AND closed_date=?').get(store.id,today);
        return {...store,is_open:Boolean(store.is_open&&serviceDays.includes(weekday)&&!closed),
          service_days:serviceDays,local_date:today};
      });
}
function mapProduct(row) {
  return {id:row.id,store_id:row.store_id,name:row.name,category:row.category,unit:row.unit,
    description:row.description||'',image_url:row.image_url||'',
    price_minor:Number(row.price_minor),on_hand:Number(row.on_hand),reserved:Number(row.reserved),
    available:Number(row.on_hand)-Number(row.reserved),art:row.art,active:Boolean(row.active),updated_at:row.updated_at};
}
export function getProduct(db,storeId,productId) {
  if(!storeRow(db,storeId))throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
  const row=db.prepare('SELECT * FROM products WHERE store_id=? AND id=? AND active=1').get(storeId,productId);
  if(!row)throw new AppError(404,'PRODUCT_NOT_FOUND','Item not found.');
  const product=mapProduct(row);
  return {id:product.id,store_id:product.store_id,name:product.name,category:product.category,unit:product.unit,
    description:product.description,image_url:product.image_url,price_minor:product.price_minor,
    available:product.available,art:product.art,active:product.active,updated_at:product.updated_at};
}
export function getProducts(db,storeId,{q='',category='',inStock='',minPrice='',maxPrice='',sort=''}={}) {
  if(!storeRow(db,storeId))throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
  const params=[storeId];let sql='SELECT * FROM products WHERE store_id=? AND active=1';
  if(category){sql+=' AND category=?';params.push(category);}
  if(q){const term=`%${String(q).slice(0,80)}%`;sql+=' AND (name LIKE ? OR category LIKE ? OR description LIKE ?)';params.push(term,term,term);}
  if(String(inStock)==='true')sql+=' AND on_hand-reserved>0';
  if(minPrice!==''){const min=Number(minPrice);if(!Number.isFinite(min)||min<0)throw new AppError(400,'INVALID_PRICE_FILTER','Minimum price must be a non-negative number.');sql+=' AND price_minor>=?';params.push(Math.round(min*100));}
  if(maxPrice!==''){const max=Number(maxPrice);if(!Number.isFinite(max)||max<0)throw new AppError(400,'INVALID_PRICE_FILTER','Maximum price must be a non-negative number.');sql+=' AND price_minor<=?';params.push(Math.round(max*100));}
  const orderBy={price_asc:'price_minor ASC,name COLLATE NOCASE ASC',price_desc:'price_minor DESC,name COLLATE NOCASE ASC',name:'name COLLATE NOCASE ASC'}[sort]||'category,name COLLATE NOCASE ASC';
  return db.prepare(sql+` ORDER BY ${orderBy}`).all(...params).map(row=>{
    const product=mapProduct(row);
    return {id:product.id,store_id:product.store_id,name:product.name,category:product.category,unit:product.unit,
      description:product.description,image_url:product.image_url,price_minor:product.price_minor,
      available:product.available,art:product.art,active:product.active,updated_at:product.updated_at};
  });
}
export function getSellerProducts(db,storeId) {
  if(!storeRow(db,storeId))throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
  return db.prepare('SELECT * FROM products WHERE store_id=? ORDER BY active DESC,category,name').all(storeId).map(mapProduct);
}
export function getSellerStores(db,userId) {
  return db.prepare(`SELECT s.id,s.name,s.address,s.neighborhood,s.pickup_location,s.time_zone,ss.is_open,ss.service_days
    FROM stores s JOIN seller_memberships m ON m.store_id=s.id LEFT JOIN store_settings ss ON ss.store_id=s.id
    WHERE m.user_id=? AND s.active=1 ORDER BY s.name`).all(userId).map(store=>({...store,
      is_open:Boolean(store.is_open),service_days:JSON.parse(store.service_days||'[0,1,2,3,4,5,6]')}));
}
export function updateStore(db,storeId,input) {
  if(!storeRow(db,storeId))throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
  const isOpen=input.is_open;
  if(typeof isOpen!=='boolean')throw new AppError(400,'INVALID_STORE_STATE','Store status must be open or closed.');
  let location;
  if(input.pickup_location!==undefined){
    location=String(input.pickup_location).trim();
    if(!location||location.length>120)throw new AppError(400,'INVALID_PICKUP_LOCATION','Pickup location must be 1 to 120 characters.');
  }
  const now=isoNow();db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('UPDATE store_settings SET is_open=?,updated_at=? WHERE store_id=?').run(Number(isOpen),now,storeId);
    if(location!==undefined)db.prepare('UPDATE stores SET pickup_location=? WHERE id=?').run(location,storeId);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  const row=db.prepare(`SELECT s.id,s.name,s.address,s.neighborhood,s.pickup_location,s.time_zone,ss.is_open,ss.service_days
    FROM stores s JOIN store_settings ss ON ss.store_id=s.id WHERE s.id=?`).get(storeId);
  return {...row,is_open:Boolean(row.is_open),service_days:JSON.parse(row.service_days)};
}
export function isStoreDateOpen(db,storeId,date) {
  const store=storeRow(db,storeId);if(!store)return false;
  const settings=db.prepare('SELECT is_open,service_days FROM store_settings WHERE store_id=?').get(storeId);
  if(!settings||!settings.is_open)return false;
  const weekday=new Date(`${date}T12:00:00Z`).getUTCDay();
  if(!JSON.parse(settings.service_days).includes(weekday))return false;
  return !db.prepare('SELECT 1 FROM store_closures WHERE store_id=? AND closed_date=?').get(storeId,date);
}
function settingsRow(db,storeId) { return db.prepare('SELECT * FROM pickup_settings WHERE store_id=?').get(storeId)||null; }
function ensureSlots(db,storeId,date) {
  const store=storeRow(db,storeId),settings=settingsRow(db,storeId);
  if(!store||!settings)return;
  const insert=db.prepare(`INSERT OR IGNORE INTO pickup_slots
    (id,store_id,pickup_date,starts_at,ends_at,starts_local,ends_local,capacity,reserved_count,active)
    VALUES (?,?,?,?,?,?,?, ?,0,1)
    ON CONFLICT(store_id,pickup_date,starts_at) DO UPDATE SET ends_at=excluded.ends_at,
      starts_local=excluded.starts_local,ends_local=excluded.ends_local,capacity=excluded.capacity,active=1
    WHERE pickup_slots.reserved_count=0`);
  for(let minute=minutesOf(settings.evening_start);minute+30<=minutesOf(settings.evening_end);minute+=30){
    const startsLocal=timeOf(minute),endsLocal=timeOf(minute+30);
    const startsAt=localDateTimeToUtc(date,startsLocal,store.time_zone),endsAt=localDateTimeToUtc(date,endsLocal,store.time_zone);
    const id=`${storeId}_${date}_${startsLocal.replace(':','')}`;
    insert.run(id,storeId,date,startsAt,endsAt,startsLocal,endsLocal,settings.capacity);
  }
}
export function getCurrentStoreDate(db,storeId,now=new Date()) {
  const store=storeRow(db,storeId);if(!store)throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
  return localDate(now,store.time_zone);
}
export function getPickupSlots(db,storeId,date) {
  const store=storeRow(db,storeId);const settings=settingsRow(db,storeId);
  if(!store||!settings)throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
  const localDay=date||localDate(new Date(),store.time_zone);
  if(!isStoreDateOpen(db,storeId,localDay))return [];
  ensureSlots(db,storeId,localDay);
  const today=localDate(new Date(),store.time_zone),cutoff=Date.now()+Number(settings.cutoff_minutes)*60000;
  return db.prepare('SELECT * FROM pickup_slots WHERE store_id=? AND pickup_date=? AND active=1 ORDER BY starts_at').all(storeId,localDay)
    .filter(slot=>(localDay>today||Date.parse(slot.starts_at)>cutoff)&&Number(slot.reserved_count)<Number(slot.capacity))
    .map(slot=>({id:slot.id,store_id:slot.store_id,pickup_date:slot.pickup_date,
      pickup_starts_at:slot.starts_at,pickup_ends_at:slot.ends_at,time_zone:store.time_zone,
      label:slotLabel(slot.starts_at,slot.ends_at,store.time_zone),capacity:Number(slot.capacity),
      reserved_count:Number(slot.reserved_count),remaining:Number(slot.capacity)-Number(slot.reserved_count)}));
}
export function getPickupSettings(db,storeId) {
  const store=storeRow(db,storeId),settings=settingsRow(db,storeId);
  if(!store||!settings)throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
  return {store_id:storeId,time_zone:store.time_zone,evening_start:settings.evening_start,evening_end:settings.evening_end,
    slot_minutes:Number(settings.slot_minutes),capacity:Number(settings.capacity),cutoff_minutes:Number(settings.cutoff_minutes),
    service_days:JSON.parse(db.prepare('SELECT service_days FROM store_settings WHERE store_id=?').get(storeId)?.service_days||'[0,1,2,3,4,5,6]'),
    closure_dates:db.prepare('SELECT closed_date FROM store_closures WHERE store_id=? ORDER BY closed_date').all(storeId).map(row=>row.closed_date)};
}
export function updatePickupSettings(db,storeId,input) {
  if(!storeRow(db,storeId))throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
  const start=String(input.evening_start||''),end=String(input.evening_end||''),capacity=Number(input.capacity),cutoff=Number(input.cutoff_minutes);
  const currentStoreSettings=db.prepare('SELECT service_days FROM store_settings WHERE store_id=?').get(storeId);
  const days=input.service_days===undefined?JSON.parse(currentStoreSettings?.service_days||'[0,1,2,3,4,5,6]'):input.service_days;
  const closures=input.closure_dates===undefined?db.prepare('SELECT closed_date FROM store_closures WHERE store_id=? ORDER BY closed_date').all(storeId).map(row=>row.closed_date):input.closure_dates;
  const timePattern=/^([01]\d|2[0-3]):[0-5]\d$/;
  if(!timePattern.test(start)||!timePattern.test(end)||minutesOf(end)<=minutesOf(start)||
    (input.slot_minutes!==undefined&&Number(input.slot_minutes)!==30)||!Number.isInteger(capacity)||capacity<1||capacity>500||
    !Number.isInteger(cutoff)||cutoff<0||cutoff>360||!Array.isArray(days)||!days.length||days.some(day=>!Number.isInteger(day)||day<0||day>6)||
    new Set(days).size!==days.length||!Array.isArray(closures)||closures.length>180||new Set(closures).size!==closures.length||closures.some(date=>!isCalendarDate(date)))
    throw new AppError(400,'INVALID_PICKUP_SETTINGS','Use valid evening hours, 30-minute slots, capacity from 1 to 500, and a cutoff from 0 to 360 minutes.');
  const today=getCurrentStoreDate(db,storeId),now=isoNow();
  db.exec('BEGIN IMMEDIATE');
  try{
    const booked=db.prepare('SELECT COUNT(*) AS count FROM pickup_slots WHERE store_id=? AND pickup_date>=? AND reserved_count>0').get(storeId,today);
    if(Number(booked.count)>0)throw new AppError(409,'SLOTS_ALREADY_RESERVED','Pickup settings cannot change while a slot has a booking.');
    if(closures.some(date=>db.prepare('SELECT 1 FROM pickup_slots WHERE store_id=? AND pickup_date=? AND reserved_count>0').get(storeId,date)))
      throw new AppError(409,'CLOSURE_HAS_RESERVATIONS','A closure date cannot be added while orders are booked for that date.');
    db.prepare('UPDATE pickup_slots SET active=0 WHERE store_id=? AND pickup_date>=? AND reserved_count=0').run(storeId,today);
    db.prepare('UPDATE pickup_settings SET evening_start=?,evening_end=?,capacity=?,cutoff_minutes=?,updated_at=? WHERE store_id=?')
      .run(start,end,capacity,cutoff,now,storeId);
    db.prepare('UPDATE store_settings SET service_days=?,updated_at=? WHERE store_id=?').run(JSON.stringify(days),now,storeId);
    db.prepare('DELETE FROM store_closures WHERE store_id=?').run(storeId);
    const addClosure=db.prepare('INSERT INTO store_closures (store_id,closed_date,reason) VALUES (?,?,?)');
    for(const date of closures)addClosure.run(storeId,date,'Seller closure');
    ensureSlots(db,storeId,today);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return getPickupSettings(db,storeId);
}

function getOrder(db,id,{includePickupCode=false}={}) {
  const row=db.prepare(`SELECT o.*,s.pickup_date,s.starts_at AS pickup_starts_at,s.ends_at AS pickup_ends_at,st.time_zone
    FROM orders o JOIN pickup_slots s ON s.id=o.slot_id JOIN stores st ON st.id=o.store_id WHERE o.id=?`).get(id);
  if(!row)return null;
  const order={id:row.id,public_label:row.public_label,store_id:row.store_id,slot_id:row.slot_id,
    status:row.status,total_minor:Number(row.total_minor),bag_label:row.bag_label,pickup_location:row.pickup_location,
    pickup_date:row.pickup_date,pickup_starts_at:row.pickup_starts_at,pickup_ends_at:row.pickup_ends_at,time_zone:row.time_zone,
    created_at:row.created_at,updated_at:row.updated_at,placed_at:row.placed_at,packing_at:row.packing_at,
    ready_at:row.ready_at,collected_at:row.collected_at,cancelled_at:row.cancelled_at,
    cancel_reason:row.cancel_reason,cancel_actor:row.cancel_actor,
    pickup_slot_label:slotLabel(row.pickup_starts_at,row.pickup_ends_at,row.time_zone),
    items:db.prepare('SELECT product_id,product_name AS name,unit,price_minor,quantity FROM order_items WHERE order_id=? ORDER BY id')
      .all(id).map(item=>({...item,price_minor:Number(item.price_minor),quantity:Number(item.quantity)})),
    events:db.prepare('SELECT status,note,created_at FROM order_events WHERE order_id=? ORDER BY id').all(id)};
  if(includePickupCode&&order.status!=='collected'&&order.status!=='cancelled')order.pickup_code=makePickupCode(id);
  return order;
}
export function getShopperOrder(db,id,shopperId) {
  const found=db.prepare('SELECT id FROM orders WHERE id=? AND shopper_id=?').get(id,shopperId);
  return found?getOrder(db,id,{includePickupCode:true}):null;
}
export function getShopperOrders(db,shopperId) {
  return db.prepare('SELECT id FROM orders WHERE shopper_id=? ORDER BY created_at DESC').all(shopperId)
    .map(({id})=>getOrder(db,id,{includePickupCode:true}));
}
export function getShopperProfile(db,shopperId) {
  const row=db.prepare('SELECT shopper_id,display_name,email,phone,updated_at FROM shopper_profiles WHERE shopper_id=?').get(shopperId);
  if(!row)throw new AppError(404,'PROFILE_NOT_FOUND','Shopper profile not found.');
  return row;
}
export function updateShopperProfile(db,shopperId,input) {
  const current=getShopperProfile(db,shopperId);
  const displayName=input.display_name===undefined?current.display_name:String(input.display_name).trim();
  if((input.email&&String(input.email).trim())||(input.phone&&String(input.phone).trim()))
    throw new AppError(400,'CONTACT_DETAILS_DISABLED','Email and phone details are not collected in this sample pilot.');
  const email='',phone='';
  if(!displayName||displayName.length>80)
    throw new AppError(400,'INVALID_PROFILE','Enter a display name of 1 to 80 characters.');
  const updatedAt=isoNow();
  db.prepare('UPDATE shopper_profiles SET display_name=?,email=?,phone=?,updated_at=? WHERE shopper_id=?')
    .run(displayName,email,phone,updatedAt,shopperId);
  db.prepare('UPDATE users SET display_name=? WHERE id=?').run(displayName,shopperId);
  return getShopperProfile(db,shopperId);
}
export function getShopperBasket(db,shopperId) {
  const basket=db.prepare('SELECT store_id,updated_at FROM shopper_baskets WHERE shopper_id=?').get(shopperId);
  if(!basket)return {shopper_id:shopperId,store_id:null,updated_at:null,items:[]};
  return {shopper_id:shopperId,store_id:basket.store_id,updated_at:basket.updated_at,
    items:db.prepare(`SELECT p.id AS product_id,p.name,p.unit,p.category,p.description,p.image_url,p.price_minor,
      bi.quoted_price_minor,
      MAX(0,p.on_hand-p.reserved) AS available,p.active,bi.quantity
      FROM basket_items bi JOIN products p ON p.id=bi.product_id
      WHERE bi.shopper_id=? AND p.store_id=? ORDER BY p.category,p.name`).all(shopperId,basket.store_id)
      .map(item=>({...item,price_minor:Number(item.price_minor),quoted_price_minor:Number(item.quoted_price_minor||item.price_minor),
        price_changed:Number(item.quoted_price_minor)>0&&Number(item.quoted_price_minor)!==Number(item.price_minor),
        available:Number(item.available),quantity:Number(item.quantity),active:Boolean(item.active)}))};
}
export function putShopperBasket(db,shopperId,{storeId,items}={}) {
  if(!getUserById(db,shopperId)||getUserById(db,shopperId).role!=='shopper')throw new AppError(403,'SHOPPER_REQUIRED','Shopper access is required.');
  if(!storeRow(db,String(storeId||'')))throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
  if(!Array.isArray(items)||items.length>50)throw new AppError(400,'INVALID_BASKET','A basket may contain up to 50 items.');
  const quantities=new Map(),quotes=new Map();
  for(const item of items){
    const productId=String(item.product_id||''),quantity=Number(item.quantity);
    const quotedPrice=item.expected_price_minor===undefined?null:Number(item.expected_price_minor);
    if(!productId||!Number.isInteger(quantity)||quantity<1||quantity>99)throw new AppError(400,'INVALID_BASKET_ITEM','Use a product id and a whole-number quantity from 1 to 99.');
    quantities.set(productId,(quantities.get(productId)||0)+quantity);
    if(quotedPrice!==null){if(!Number.isSafeInteger(quotedPrice)||quotedPrice<1)throw new AppError(400,'INVALID_BASKET_ITEM','Displayed price must be a positive integer in paise.');
      if(quotes.has(productId)&&quotes.get(productId)!==quotedPrice)throw new AppError(400,'INVALID_BASKET_ITEM','The same basket item has conflicting displayed prices.');quotes.set(productId,quotedPrice);}
  }
  if([...quantities.values()].some(quantity=>quantity>99))throw new AppError(400,'INVALID_BASKET_ITEM','A product quantity cannot exceed 99.');
  for(const productId of quantities.keys())if(!db.prepare('SELECT 1 FROM products WHERE id=? AND store_id=?').get(productId,storeId))
    throw new AppError(400,'MIXED_STORE_BASKET','Every basket item must belong to the selected shop.');
  const previousBasket=db.prepare('SELECT store_id FROM shopper_baskets WHERE shopper_id=?').get(shopperId);
  const previousQuotes=previousBasket?.store_id===storeId?new Map(db.prepare('SELECT product_id,quoted_price_minor FROM basket_items WHERE shopper_id=?').all(shopperId).map(row=>[row.product_id,Number(row.quoted_price_minor)])):new Map();
  const now=isoNow();db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare(`INSERT INTO shopper_baskets (shopper_id,store_id,updated_at) VALUES (?,?,?)
      ON CONFLICT(shopper_id) DO UPDATE SET store_id=excluded.store_id,updated_at=excluded.updated_at`).run(shopperId,storeId,now);
    db.prepare('DELETE FROM basket_items WHERE shopper_id=?').run(shopperId);
    const add=db.prepare('INSERT INTO basket_items (shopper_id,product_id,quantity,quoted_price_minor,updated_at) VALUES (?,?,?,?,?)');
    for(const [productId,quantity] of quantities){
      const current=db.prepare('SELECT price_minor FROM products WHERE id=? AND store_id=?').get(productId,storeId);
      add.run(shopperId,productId,quantity,quotes.get(productId)||previousQuotes.get(productId)||Number(current.price_minor),now);
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return getShopperBasket(db,shopperId);
}
export function getSavedProducts(db,shopperId) {
  return db.prepare(`SELECT p.id AS product_id,p.store_id,p.name,p.category,p.unit,p.description,p.image_url,p.price_minor,
      MAX(0,p.on_hand-p.reserved) AS available,p.art,s.created_at AS saved_at
    FROM saved_products s JOIN products p ON p.id=s.product_id WHERE s.shopper_id=? AND p.active=1 ORDER BY s.created_at DESC`)
    .all(shopperId).map(item=>({...item,price_minor:Number(item.price_minor),available:Number(item.available)}));
}
export function saveShopperProduct(db,shopperId,productId) {
  const product=db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(productId);
  if(!product)throw new AppError(404,'PRODUCT_NOT_FOUND','Item not found.');
  db.prepare('INSERT OR IGNORE INTO saved_products (shopper_id,product_id,created_at) VALUES (?,?,?)').run(shopperId,productId,isoNow());
  return getSavedProducts(db,shopperId);
}
export function unsaveShopperProduct(db,shopperId,productId) {
  db.prepare('DELETE FROM saved_products WHERE shopper_id=? AND product_id=?').run(shopperId,productId);
  return getSavedProducts(db,shopperId);
}
export function getOrderStoreId(db,id) { return db.prepare('SELECT store_id FROM orders WHERE id=?').get(id)?.store_id||null; }
export function getSellerOrders(db,storeId,{status='',date='',q=''}={}) {
  if(status&&!['placed','packing','ready','collected','cancelled'].includes(status))throw new AppError(400,'INVALID_STATUS_FILTER','Order status filter is not valid.');
  if(!storeRow(db,storeId))throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
  const values=[storeId];let sql='SELECT orders.id FROM orders JOIN pickup_slots ON pickup_slots.id=orders.slot_id WHERE orders.store_id=?';
  if(status){sql+=' AND orders.status=?';values.push(status);}
  if(date){sql+=' AND pickup_slots.pickup_date=?';values.push(date);}
  const term=String(q||'').trim().slice(0,80);
  if(term){sql+=' AND (orders.public_label LIKE ? OR orders.bag_label LIKE ? OR EXISTS (SELECT 1 FROM order_items WHERE order_items.order_id=orders.id AND order_items.product_name LIKE ?))';values.push(`%${term}%`,`%${term}%`,`%${term}%`);}
  sql+=' ORDER BY (SELECT starts_at FROM pickup_slots WHERE id=orders.slot_id),created_at';
  return db.prepare(sql).all(...values).map(({id})=>getOrder(db,id));
}
function canonical(value) {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function createOrder(db,{shopperId,storeId,slotId,items,idempotencyKey}={}) {
  const shopper=getUserById(db,shopperId);
  if(!shopper||shopper.role!=='shopper')throw new AppError(401,'SHOPPER_AUTH_REQUIRED','Sign in as a shopper to place an order.');
  if(!/^[A-Za-z0-9._~-]{16,128}$/.test(String(idempotencyKey||'')))throw new AppError(400,'IDEMPOTENCY_KEY_REQUIRED','A valid Idempotency-Key header is required.');
  if(!Array.isArray(items)||items.length<1||items.length>50)throw new AppError(400,'EMPTY_BASKET','Add at least one item to the basket.');
  const normalized=[];
  for(const item of items){
    const productId=String(item.product_id||''),quantity=Number(item.quantity);
    const expectedPrice=item.expected_price_minor===undefined?undefined:Number(item.expected_price_minor);
    if(!productId||!Number.isInteger(quantity)||quantity<1||quantity>99||
      (expectedPrice!==undefined&&(!Number.isSafeInteger(expectedPrice)||expectedPrice<1)))
      throw new AppError(400,'INVALID_ORDER_ITEM','Each item needs a product id, a whole-number quantity from 1 to 99, and a valid displayed price.');
    normalized.push({product_id:productId,quantity,expected_price_minor:expectedPrice});
  }
  const sorted=normalized.map(({product_id,quantity})=>({product_id,quantity})).sort((a,b)=>a.product_id.localeCompare(b.product_id));
  const payloadHash=sha256(canonical({store_id:storeId,slot_id:slotId,items:sorted}));
  db.exec('BEGIN IMMEDIATE');
  try{
    const prior=db.prepare('SELECT payload_hash,order_id FROM idempotency_records WHERE shopper_id=? AND idempotency_key=?').get(shopperId,idempotencyKey);
    if(prior){
      if(prior.payload_hash!==payloadHash)throw new AppError(409,'IDEMPOTENCY_KEY_REUSED','That retry key was used for a different basket.');
      db.exec('COMMIT');return getOrder(db,prior.order_id,{includePickupCode:true});
    }
    const store=storeRow(db,String(storeId||''));if(!store)throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
    const slot=db.prepare('SELECT * FROM pickup_slots WHERE id=? AND store_id=? AND active=1').get(String(slotId||''),store.id);
    const settings=settingsRow(db,store.id),today=localDate(new Date(),store.time_zone);
    if(!slot||!isStoreDateOpen(db,store.id,slot.pickup_date)||slot.pickup_date<today||Date.parse(slot.starts_at)<=Date.now()+Number(settings.cutoff_minutes)*60000)
      throw new AppError(409,'SLOT_UNAVAILABLE','That pickup slot is no longer bookable. Refresh the times and choose another.');
    if(Number(slot.reserved_count)>=Number(slot.capacity))throw new AppError(409,'SLOT_FULL','That pickup time is full. Choose another slot.');
    const quantities=new Map();for(const item of normalized)quantities.set(item.product_id,(quantities.get(item.product_id)||0)+item.quantity);
    if([...quantities.values()].some(quantity=>quantity>99))throw new AppError(400,'INVALID_ORDER_ITEM','Combined quantity for any one product cannot exceed 99.');
    const lines=[];let total=0;
    const expectedPrices=new Map();
    for(const item of normalized){
      if(item.expected_price_minor===undefined)continue;
      const previous=expectedPrices.get(item.product_id);
      if(previous!==undefined&&previous!==item.expected_price_minor)throw new AppError(400,'INVALID_ORDER_ITEM','The same item has conflicting displayed prices.');
      expectedPrices.set(item.product_id,item.expected_price_minor);
    }
    for(const [productId,quantity] of quantities){
      const product=db.prepare('SELECT * FROM products WHERE id=? AND store_id=? AND active=1').get(productId,store.id);
      if(!product)throw new AppError(409,'PRODUCT_UNAVAILABLE','An item is no longer available. Refresh the catalogue.');
      const expectedPrice=expectedPrices.get(productId);
      if(expectedPrice!==undefined&&expectedPrice!==Number(product.price_minor))
        throw new AppError(409,'PRICE_CHANGED',`${product.name}'s price changed. Review the updated basket before placing the order.`,{product_id:product.id,current_price_minor:Number(product.price_minor)});
      const available=Number(product.on_hand)-Number(product.reserved);
      if(available<quantity)throw new AppError(409,'INSUFFICIENT_STOCK',`${product.name} has only ${available} available. Update the basket and try again.`,{product_id:product.id,available});
      lines.push({product,quantity});total+=Number(product.price_minor)*quantity;
    }
    if(!Number.isSafeInteger(total)||total>25000000)throw new AppError(400,'BASKET_LIMIT','Basket total is over the sample pickup limit.');
    const id=randomUUID(),label=`KC-${randomUUID().replaceAll('-','').slice(0,6).toUpperCase()}`;
    const bagLabel=`BAG-${label.slice(-6)}`,now=isoNow(),pickupCode=makePickupCode(id);
    db.prepare(`INSERT INTO orders (id,public_label,shopper_id,store_id,slot_id,status,total_minor,bag_label,pickup_location,
      pickup_code_hash,created_at,updated_at,placed_at) VALUES (?,?,?,?,?,'placed',?,?,?,?,?,?,?)`)
      .run(id,label,shopperId,store.id,slot.id,total,bagLabel,store.pickup_location,codeDigest(id,pickupCode),now,now,now);
    const addItem=db.prepare('INSERT INTO order_items (order_id,product_id,product_name,unit,price_minor,quantity) VALUES (?,?,?,?,?,?)');
    const reserve=db.prepare(`UPDATE products SET reserved=reserved+?,updated_at=? WHERE id=? AND store_id=? AND active=1 AND on_hand-reserved>=?`);
    for(const {product,quantity} of lines){
      if(Number(reserve.run(quantity,now,product.id,store.id,quantity).changes)!==1)throw new AppError(409,'INSUFFICIENT_STOCK',`${product.name} stock changed. Refresh the basket and try again.`);
      addItem.run(id,product.id,product.name,product.unit,product.price_minor,quantity);
    }
    if(Number(db.prepare('UPDATE pickup_slots SET reserved_count=reserved_count+1 WHERE id=? AND active=1 AND reserved_count<capacity').run(slot.id).changes)!==1)
      throw new AppError(409,'SLOT_FULL','That pickup time just filled. Choose another slot.');
    db.prepare('INSERT INTO order_events (order_id,actor_id,status,note,created_at) VALUES (?,?,?,?,?)').run(id,shopperId,'placed','Shopper placed the order',now);
    db.prepare('INSERT INTO idempotency_records (shopper_id,idempotency_key,payload_hash,order_id,created_at) VALUES (?,?,?,?,?)')
      .run(shopperId,idempotencyKey,payloadHash,id,now);
    db.prepare('DELETE FROM basket_items WHERE shopper_id=?').run(shopperId);
    db.prepare('UPDATE shopper_baskets SET updated_at=? WHERE shopper_id=?').run(now,shopperId);
    db.exec('COMMIT');return getOrder(db,id,{includePickupCode:true});
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function cancelOrder(db,id,{actorId,role,reason=''}={}) {
  db.exec('BEGIN IMMEDIATE');
  try{
    const order=db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    if(!order||(role==='shopper'&&order.shopper_id!==actorId)||(role==='seller'&&!isSellerMember(db,actorId,order.store_id)))
      throw new AppError(404,'ORDER_NOT_FOUND','Order not found.');
    if(!['shopper','seller'].includes(role))throw new AppError(403,'FORBIDDEN','You cannot cancel this order.');
    if(order.status!=='placed')throw new AppError(409,'CANCELLATION_CLOSED','An order can only be cancelled before packing starts.');
    const now=isoNow();
    for(const item of db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(id)){
      const changed=db.prepare('UPDATE products SET reserved=reserved-?,updated_at=? WHERE id=? AND reserved>=?').run(item.quantity,now,item.product_id,item.quantity);
      if(Number(changed.changes)!==1)throw new AppError(409,'INVENTORY_INVARIANT','Reserved stock could not be released.');
    }
    if(Number(db.prepare('UPDATE pickup_slots SET reserved_count=reserved_count-1 WHERE id=? AND reserved_count>0').run(order.slot_id).changes)!==1)
      throw new AppError(409,'SLOT_INVARIANT','The pickup slot reservation could not be released.');
    const cleanReason=String(reason||'Cancelled before packing').slice(0,240);
    if(Number(db.prepare(`UPDATE orders SET status='cancelled',cancelled_at=?,updated_at=?,cancel_reason=?,cancel_actor=? WHERE id=? AND status='placed'`)
      .run(now,now,cleanReason,actorId,id).changes)!==1)throw new AppError(409,'ORDER_CONFLICT','The order changed. Refresh and try again.');
    db.prepare('INSERT INTO order_events (order_id,actor_id,status,note,created_at) VALUES (?,? ,\'cancelled\',?,?)').run(id,actorId,cleanReason,now);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return getOrder(db,id);
}
export function transitionSellerOrder(db,id,{actorId,storeId,nextStatus,bagLabel,pickupLocation,pickupCode}={}) {
  if(!isSellerMember(db,actorId,storeId))throw new AppError(403,'STORE_ACCESS_DENIED','You do not have access to this shop.');
  const allowed={placed:'packing',packing:'ready',ready:'collected'};
  db.exec('BEGIN IMMEDIATE');
  try{
    const order=db.prepare('SELECT * FROM orders WHERE id=? AND store_id=?').get(id,storeId);
    if(!order)throw new AppError(404,'ORDER_NOT_FOUND','Pickup order not found.');
    if(allowed[order.status]!==nextStatus)throw new AppError(409,'INVALID_ORDER_TRANSITION',`This order cannot move from ${order.status} to ${nextStatus}.`);
    const now=isoNow();let set='status=?,updated_at=?';const params=[nextStatus,now];
    if(nextStatus==='packing'){set+=',packing_at=?';params.push(now);}
    if(nextStatus==='ready'){
      const bag=String(bagLabel||'').trim(),location=String(pickupLocation||'').trim();
      if(!bag||bag.length>40||!location||location.length>120)throw new AppError(400,'INVALID_HANDOFF_DETAILS','Enter a bag label and pickup location.');
      set+=',ready_at=?,bag_label=?,pickup_location=?';params.push(now,bag,location);
    }
    if(nextStatus==='collected'){
      const supplied=codeDigest(id,pickupCode||'');
      if(!safeEqual(supplied,order.pickup_code_hash))throw new AppError(400,'INVALID_PICKUP_CODE','That pickup code does not match this order.');
      set+=',collected_at=?';params.push(now);
    }
    if(Number(db.prepare(`UPDATE orders SET ${set} WHERE id=? AND status=?`).run(...params,id,order.status).changes)!==1)
      throw new AppError(409,'ORDER_CONFLICT','The order changed. Refresh and try again.');
    if(nextStatus==='collected'){
      for(const item of db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(id)){
        const changed=db.prepare(`UPDATE products SET reserved=reserved-?,on_hand=on_hand-?,updated_at=?
          WHERE id=? AND on_hand>=? AND reserved>=?`).run(item.quantity,item.quantity,now,item.product_id,item.quantity,item.quantity);
        if(Number(changed.changes)!==1)throw new AppError(409,'INVENTORY_INVARIANT','The reserved stock could not be completed.');
      }
    }
    const notes={packing:'Shopkeeper started packing',ready:'Bag sealed and marked ready',collected:'Shopkeeper verified the pickup code and handed over the bag'};
    db.prepare('INSERT INTO order_events (order_id,actor_id,status,note,created_at) VALUES (?,?,?,?,?)').run(id,actorId,nextStatus,notes[nextStatus],now);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return getOrder(db,id);
}
function validateProduct(input,existing=null) {
  const p={name:input.name===undefined?existing?.name:String(input.name).trim(),
    category:input.category===undefined?existing?.category:String(input.category).trim(),
    unit:input.unit===undefined?existing?.unit:String(input.unit).trim(),
    description:input.description===undefined?(existing?.description||''):String(input.description).trim(),
    image_url:input.image_url===undefined?(existing?.image_url||''):String(input.image_url).trim(),
    price_minor:input.price_minor===undefined?Number(existing?.price_minor):Number(input.price_minor),
    on_hand:input.on_hand===undefined?Number(existing?.on_hand):Number(input.on_hand),
    active:input.active===undefined?Boolean(existing?.active):input.active};
  if(!p.name||p.name.length>50||!p.unit||p.unit.length>24||p.description.length>240||p.image_url.length>500||
    (p.image_url&&!/^https:\/\//i.test(p.image_url))||!CATEGORIES.has(p.category)||!Number.isSafeInteger(p.price_minor)||
    p.price_minor<1||p.price_minor>10000000||!Number.isInteger(p.on_hand)||p.on_hand<Number(existing?.reserved||0)||p.on_hand>9999||typeof p.active!=='boolean')
    throw new AppError(400,'INVALID_PRODUCT','Check the item name, unit, category, description, secure image URL, positive paise price, and stock (at least reserved stock).');
  p.art=p.category==='Dairy'?'dairy':p.category==='Staples'?'staple':p.category==='Snacks'?'snack':'veg';return p;
}
export function createProduct(db,storeId,input,{sellerId}={}) {
  if(!isSellerMember(db,sellerId,storeId))throw new AppError(403,'STORE_ACCESS_DENIED','You do not have access to this shop.');
  const p=validateProduct(input),id=`item-${randomUUID()}`,now=isoNow();
  try{db.prepare(`INSERT INTO products (id,store_id,name,category,unit,description,image_url,price_minor,on_hand,reserved,art,active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,0,?,1,?,?)`).run(id,storeId,p.name,p.category,p.unit,p.description,p.image_url,p.price_minor,p.on_hand,p.art,now,now);}
  catch(error){if(String(error.message).includes('UNIQUE'))throw new AppError(409,'DUPLICATE_PRODUCT','That active item name is already in the catalogue.');throw error;}
  return mapProduct(db.prepare('SELECT * FROM products WHERE id=?').get(id));
}
export function patchProduct(db,id,input,{sellerId}={}) {
  const row=db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if(!row)throw new AppError(404,'PRODUCT_NOT_FOUND','Item not found.');
  if(!isSellerMember(db,sellerId,row.store_id))throw new AppError(403,'STORE_ACCESS_DENIED','You do not have access to this shop.');
  const p=validateProduct(input,row),now=isoNow();
  try{db.prepare('UPDATE products SET name=?,category=?,unit=?,description=?,image_url=?,price_minor=?,on_hand=?,art=?,active=?,updated_at=? WHERE id=?')
    .run(p.name,p.category,p.unit,p.description,p.image_url,p.price_minor,p.on_hand,p.art,Number(p.active),now,id);}
  catch(error){if(String(error.message).includes('UNIQUE'))throw new AppError(409,'DUPLICATE_PRODUCT','That active item name is already in the catalogue.');throw error;}
  return mapProduct(db.prepare('SELECT * FROM products WHERE id=?').get(id));
}
export function resetDemo(db) {
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec('DELETE FROM idempotency_records;DELETE FROM order_events;DELETE FROM order_items;DELETE FROM orders;DELETE FROM pickup_slots;DELETE FROM products;');
    const now=isoNow();const insert=db.prepare(`INSERT INTO products (id,store_id,name,category,unit,price_minor,on_hand,reserved,art,active,created_at,updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?)`);
    for(const item of SEED_PRODUCTS)insert.run(item.id,PILOT_STORE,item.name,item.category,item.unit,item.price_minor,item.on_hand,item.art,now,now);
    db.prepare(`UPDATE pickup_settings SET evening_start='17:30',evening_end='19:30',slot_minutes=30,capacity=8,cutoff_minutes=30,updated_at=? WHERE store_id=?`).run(now,PILOT_STORE);
    ensureSlots(db,PILOT_STORE,getCurrentStoreDate(db,PILOT_STORE));
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function getPilotStoreId() { return PILOT_STORE; }
