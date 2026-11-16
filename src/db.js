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
  { id: 'biscuits', name: 'Tea biscuits', category: 'Snacks', unit: '1 pack', price_minor: 2000, on_hand: 12, art: 'snack' }
];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}

const isoNow = () => new Date().toISOString();
const secret = () => process.env.KIRANA_PICKUP_CODE_SECRET || 'local-only-demo-secret-change-before-deploy';
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
      unit TEXT NOT NULL, price_minor INTEGER NOT NULL CHECK(price_minor>0), on_hand INTEGER NOT NULL DEFAULT 0 CHECK(on_hand>=0),
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
  const now = isoNow();
  db.prepare(`INSERT OR IGNORE INTO stores (id,name,address,neighborhood,pickup_location,time_zone,active,created_at)
    VALUES (?,'Saathi Kirana','','Sample neighbourhood','Green rack beside the front counter','Asia/Kolkata',1,?)`).run(PILOT_STORE, now);
  db.prepare(`INSERT OR IGNORE INTO users (id,role,display_name,created_at) VALUES ('demo-shopper','shopper','Demo shopper',?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO users (id,role,display_name,created_at) VALUES ('demo-seller','seller','Demo shopkeeper',?)`).run(now);
  db.prepare('INSERT OR IGNORE INTO seller_memberships (store_id,user_id) VALUES (?,?)').run(PILOT_STORE, 'demo-seller');
  db.prepare(`INSERT OR IGNORE INTO pickup_settings (store_id,evening_start,evening_end,slot_minutes,capacity,cutoff_minutes,updated_at)
    VALUES (?,'17:30','19:30',30,8,30,?)`).run(PILOT_STORE, now);
  if (Number(db.prepare('SELECT COUNT(*) AS count FROM products WHERE store_id=?').get(PILOT_STORE).count) === 0) {
    const insert = db.prepare(`INSERT INTO products (id,store_id,name,category,unit,price_minor,on_hand,reserved,art,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,0,?,1,?,?)`);
    for (const item of SEED_PRODUCTS) insert.run(item.id,PILOT_STORE,item.name,item.category,item.unit,item.price_minor,item.on_hand,item.art,now,now);
  }
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
export function listStores(db) {
  return db.prepare('SELECT id,name,address,neighborhood,pickup_location,time_zone FROM stores WHERE active=1 ORDER BY name')
    .all().map(store=>({...store,local_date:localDate(new Date(),store.time_zone)}));
}
function mapProduct(row) {
  return {id:row.id,store_id:row.store_id,name:row.name,category:row.category,unit:row.unit,
    price_minor:Number(row.price_minor),on_hand:Number(row.on_hand),reserved:Number(row.reserved),
    available:Number(row.on_hand)-Number(row.reserved),art:row.art,active:Boolean(row.active),updated_at:row.updated_at};
}
export function getProducts(db,storeId,{q='',category=''}={}) {
  if(!storeRow(db,storeId))throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
  const params=[storeId];let sql='SELECT * FROM products WHERE store_id=? AND active=1';
  if(category){sql+=' AND category=?';params.push(category);}
  if(q){const term=`%${String(q).slice(0,80)}%`;sql+=' AND (name LIKE ? OR category LIKE ?)';params.push(term,term);}
  return db.prepare(sql+' ORDER BY category,name').all(...params).map(row=>{
    const product=mapProduct(row);
    return {id:product.id,store_id:product.store_id,name:product.name,category:product.category,unit:product.unit,
      price_minor:product.price_minor,available:product.available,art:product.art,active:product.active,updated_at:product.updated_at};
  });
}
export function getSellerProducts(db,storeId) {
  if(!storeRow(db,storeId))throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
  return db.prepare('SELECT * FROM products WHERE store_id=? ORDER BY active DESC,category,name').all(storeId).map(mapProduct);
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
    slot_minutes:Number(settings.slot_minutes),capacity:Number(settings.capacity),cutoff_minutes:Number(settings.cutoff_minutes)};
}
export function updatePickupSettings(db,storeId,input) {
  if(!storeRow(db,storeId))throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
  const start=String(input.evening_start||''),end=String(input.evening_end||''),capacity=Number(input.capacity),cutoff=Number(input.cutoff_minutes);
  const timePattern=/^([01]\d|2[0-3]):[0-5]\d$/;
  if(!timePattern.test(start)||!timePattern.test(end)||minutesOf(end)<=minutesOf(start)||
    (input.slot_minutes!==undefined&&Number(input.slot_minutes)!==30)||!Number.isInteger(capacity)||capacity<1||capacity>500||
    !Number.isInteger(cutoff)||cutoff<0||cutoff>360)
    throw new AppError(400,'INVALID_PICKUP_SETTINGS','Use valid evening hours, 30-minute slots, capacity from 1 to 500, and a cutoff from 0 to 360 minutes.');
  const today=getCurrentStoreDate(db,storeId),now=isoNow();
  db.exec('BEGIN IMMEDIATE');
  try{
    const booked=db.prepare('SELECT COUNT(*) AS count FROM pickup_slots WHERE store_id=? AND pickup_date>=? AND reserved_count>0').get(storeId,today);
    if(Number(booked.count)>0)throw new AppError(409,'SLOTS_ALREADY_RESERVED','Pickup settings cannot change while a slot has a booking.');
    db.prepare('UPDATE pickup_slots SET active=0 WHERE store_id=? AND pickup_date>=? AND reserved_count=0').run(storeId,today);
    db.prepare('UPDATE pickup_settings SET evening_start=?,evening_end=?,capacity=?,cutoff_minutes=?,updated_at=? WHERE store_id=?')
      .run(start,end,capacity,cutoff,now,storeId);
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
export function getOrderStoreId(db,id) { return db.prepare('SELECT store_id FROM orders WHERE id=?').get(id)?.store_id||null; }
export function getSellerOrders(db,storeId,status='') {
  if(status&&!['placed','packing','ready','collected','cancelled'].includes(status))throw new AppError(400,'INVALID_STATUS_FILTER','Order status filter is not valid.');
  if(!storeRow(db,storeId))throw new AppError(404,'STORE_NOT_FOUND','Shop not found.');
  const values=[storeId];let sql='SELECT id FROM orders WHERE store_id=?';if(status){sql+=' AND status=?';values.push(status);}
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
    if(!slot||slot.pickup_date<today||Date.parse(slot.starts_at)<=Date.now()+Number(settings.cutoff_minutes)*60000)
      throw new AppError(409,'SLOT_UNAVAILABLE','That pickup slot is no longer bookable. Refresh the times and choose another.');
    if(Number(slot.reserved_count)>=Number(slot.capacity))throw new AppError(409,'SLOT_FULL','That pickup time is full. Choose another slot.');
    const quantities=new Map();for(const item of normalized)quantities.set(item.product_id,(quantities.get(item.product_id)||0)+item.quantity);
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
    price_minor:input.price_minor===undefined?Number(existing?.price_minor):Number(input.price_minor),
    on_hand:input.on_hand===undefined?Number(existing?.on_hand):Number(input.on_hand),
    active:input.active===undefined?Boolean(existing?.active):input.active};
  if(!p.name||p.name.length>50||!p.unit||p.unit.length>24||!CATEGORIES.has(p.category)||!Number.isSafeInteger(p.price_minor)||
    p.price_minor<1||p.price_minor>10000000||!Number.isInteger(p.on_hand)||p.on_hand<Number(existing?.reserved||0)||p.on_hand>9999||typeof p.active!=='boolean')
    throw new AppError(400,'INVALID_PRODUCT','Check the item name, unit, category, positive paise price, and stock (at least reserved stock).');
  p.art=p.category==='Dairy'?'dairy':p.category==='Staples'?'staple':p.category==='Snacks'?'snack':'veg';return p;
}
export function createProduct(db,storeId,input,{sellerId}={}) {
  if(!isSellerMember(db,sellerId,storeId))throw new AppError(403,'STORE_ACCESS_DENIED','You do not have access to this shop.');
  const p=validateProduct(input),id=`item-${randomUUID()}`,now=isoNow();
  try{db.prepare(`INSERT INTO products (id,store_id,name,category,unit,price_minor,on_hand,reserved,art,active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,0,?,1,?,?)`).run(id,storeId,p.name,p.category,p.unit,p.price_minor,p.on_hand,p.art,now,now);}
  catch(error){if(String(error.message).includes('UNIQUE'))throw new AppError(409,'DUPLICATE_PRODUCT','That active item name is already in the catalogue.');throw error;}
  return mapProduct(db.prepare('SELECT * FROM products WHERE id=?').get(id));
}
export function patchProduct(db,id,input,{sellerId}={}) {
  const row=db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if(!row)throw new AppError(404,'PRODUCT_NOT_FOUND','Item not found.');
  if(!isSellerMember(db,sellerId,row.store_id))throw new AppError(403,'STORE_ACCESS_DENIED','You do not have access to this shop.');
  const p=validateProduct(input,row),now=isoNow();
  try{db.prepare('UPDATE products SET name=?,category=?,unit=?,price_minor=?,on_hand=?,art=?,active=?,updated_at=? WHERE id=?')
    .run(p.name,p.category,p.unit,p.price_minor,p.on_hand,p.art,Number(p.active),now,id);}
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
