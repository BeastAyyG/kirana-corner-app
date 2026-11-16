import { AppError, config, isoNow, readJson } from './util.js';
import { openV2Database, isStoreStaff } from './db.js';
import { EventBus } from './events.js';
import * as auth from './auth.js';
import * as catalog from './catalog.js';
import * as cart from './cart.js';
import * as orders from './orders.js';
import * as rider from './rider.js';
import * as store from './store.js';
import * as admin from './admin.js';
import * as payments from './payments.js';
import { listAvailableCoupons } from './promotions.js';
import { sweepExpiredOffers } from './dispatch.js';

const SWEEP_INTERVAL_MS = 10_000;
const RATE_LIMIT_PER_MIN = 300;

export function createV2Context({ dbPath = process.env.KIRANA_V2_DB_PATH || './data/kirana-delivery.sqlite' } = {}) {
  const db = openV2Database(dbPath);
  const bus = new EventBus();
  const simulations = new Map();
  const timer = setInterval(() => {
    try { sweepExpiredOffers(db, bus); orders.sweepStalePendingPayments(db, bus); }
    catch (error) { console.error('v2 sweep error', error); }
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return {
    db, bus, simulations,
    close() {
      clearInterval(timer);
      for (const sim of simulations.values()) clearInterval(sim);
      simulations.clear();
      db.close();
    }
  };
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'
  });
  response.end(JSON.stringify(data));
}
function sendError(response, error) {
  const status = error instanceof AppError ? error.status : 500;
  if (status === 500) console.error(error);
  sendJson(response, status, {
    code: error.code || 'INTERNAL_ERROR',
    message: status === 500 ? 'Something went wrong. Try again.' : error.message,
    ...(error.details === undefined ? {} : { details: error.details })
  });
}

function bearerToken(request, url) {
  const header = request.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return url.searchParams.get('token') || '';
}
function requireUser(ctx, request, url, role = '') {
  const user = auth.getSessionUser(ctx.db, bearerToken(request, url));
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Sign in with your phone number to continue.');
  if (role && user.role !== role) throw new AppError(403, 'ROLE_FORBIDDEN', 'This action is not available for your account.');
  return user;
}

const rateBuckets = new Map();
function rateLimit(request) {
  const ip = request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > 60_000) { rateBuckets.set(ip, { start: now, count: 1 }); return; }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_PER_MIN) throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Slow down.');
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (!origin) return;
  const allowed = config.corsOrigins();
  if (allowed.includes(origin) || allowed.includes('*')) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'Origin');
    response.setHeader('access-control-allow-headers', 'authorization,content-type,idempotency-key');
    response.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
}

async function readRaw(request, maxBytes = 1024 * 1024) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) throw new AppError(413, 'BODY_TOO_LARGE', 'Request body is too large.');
  }
  return raw;
}

function handleStream(ctx, request, response, url) {
  const user = auth.getSessionUser(ctx.db, bearerToken(request, url));
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Sign in to open the event stream.');
  const orderId = url.searchParams.get('order_id') || '';
  const unsubs = [];
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
    connection: 'keep-alive', 'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff'
  });
  response.write('retry: 3000\n\n');
  response.write(`event: hello\ndata: ${JSON.stringify({ user_id: user.id, role: user.role, at: isoNow() })}\n\n`);
  unsubs.push(ctx.bus.subscribe(`user:${user.id}`, response));
  if (orderId) {
    const order = ctx.db.prepare('SELECT customer_id,store_id,rider_id FROM orders WHERE id=?').get(orderId);
    const allowed = order && (order.customer_id === user.id || order.rider_id === user.id || user.role === 'admin' ||
      (user.role === 'picker' && isStoreStaff(ctx.db, user.id, order.store_id)));
    if (!allowed) { response.end(); return; }
    unsubs.push(ctx.bus.subscribe(`order:${orderId}`, response));
  }
  if (user.role === 'picker')
    for (const row of ctx.db.prepare('SELECT store_id FROM store_staff WHERE user_id=?').all(user.id))
      unsubs.push(ctx.bus.subscribe(`store:${row.store_id}`, response));
  if (user.role === 'rider') unsubs.push(ctx.bus.subscribe(`rider:${user.id}`, response));
  const heartbeat = setInterval(() => { try { response.write(': hb\n\n'); } catch { /* closed */ } }, 15_000);
  heartbeat.unref();
  request.on('close', () => { clearInterval(heartbeat); for (const unsub of unsubs) unsub(); });
}

function startSimulation(ctx, orderId) {
  if (config.isProduction()) throw new AppError(404, 'NOT_FOUND', 'Not found.');
  if (ctx.simulations.has(orderId)) throw new AppError(409, 'SIMULATION_RUNNING', 'A simulation is already running for this order.');
  const job = ctx.db.prepare(`SELECT * FROM rider_jobs WHERE order_id=? AND status='accepted'`).get(orderId);
  if (!job) throw new AppError(409, 'NO_ACTIVE_JOB', 'Order needs an accepted rider job before simulating.');
  const order = ctx.db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  const storeRow = ctx.db.prepare('SELECT lat,lng FROM stores WHERE id=?').get(order.store_id);
  const drop = JSON.parse(order.address_snapshot);
  const TOTAL_TICKS = 30, PICKUP_TICK = 3;
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    try {
      const progress = Math.min(1, tick / TOTAL_TICKS);
      const lat = storeRow.lat + (drop.lat - storeRow.lat) * progress;
      const lng = storeRow.lng + (drop.lng - storeRow.lng) * progress;
      rider.updateLocation(ctx.db, ctx.bus, job.rider_id, { lat, lng });
      if (tick === PICKUP_TICK) rider.pickupJob(ctx.db, ctx.bus, job.id, job.rider_id, '', { system: true });
      if (tick >= TOTAL_TICKS) {
        rider.deliverJob(ctx.db, ctx.bus, job.id, job.rider_id, { cash_collected: order.payment_method === 'cod', system: true });
        clearInterval(timer);
        ctx.simulations.delete(orderId);
      }
    } catch (error) {
      console.error('simulation error', error.message);
      clearInterval(timer);
      ctx.simulations.delete(orderId);
    }
  }, 1000);
  timer.unref();
  ctx.simulations.set(orderId, timer);
  return { started: true, order_id: orderId, duration_seconds: TOTAL_TICKS };
}

export async function handleV2Request(ctx, request, response, url) {
  const method = request.method || 'GET';
  const path = url.pathname.replace(/^\/api\/v2/, '') || '/';
  applyCors(request, response);
  if (method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  try {
    rateLimit(request);
    const body = ['POST', 'PUT', 'PATCH'].includes(method) && !path.startsWith('/payments/webhook')
      ? await readJson(request) : {};
    const match = pattern => path.match(pattern);
    let m;

    // ---- public ----
    if (method === 'POST' && path === '/auth/otp/request') return sendJson(response, 200, await auth.requestOtp(ctx.db, body));
    if (method === 'POST' && path === '/auth/otp/verify')
      return sendJson(response, 200, await auth.verifyOtp(ctx.db, { ...body, userAgent: request.headers['user-agent'] || '' }));
    if (method === 'GET' && path === '/categories') return sendJson(response, 200, { categories: catalog.listCategories(ctx.db) });
    if (method === 'GET' && path === '/stores') return sendJson(response, 200, { stores: catalog.listStores(ctx.db) });
    if (method === 'POST' && path === '/serviceability') return sendJson(response, 200, catalog.checkServiceability(ctx.db, body));
    if (method === 'GET' && (m = match(/^\/stores\/([^/]+)\/products$/)))
      return sendJson(response, 200, catalog.getProducts(ctx.db, m[1], {
        q: url.searchParams.get('q') || '', category: url.searchParams.get('category') || '',
        inStock: url.searchParams.get('in_stock') || '', sort: url.searchParams.get('sort') || '',
        page: url.searchParams.get('page') || 1, pageSize: url.searchParams.get('page_size') || 40
      }));
    if (method === 'GET' && (m = match(/^\/stores\/([^/]+)\/products\/([^/]+)$/)))
      return sendJson(response, 200, { product: catalog.getProduct(ctx.db, m[1], m[2]) });
    if (method === 'GET' && (m = match(/^\/stores\/([^/]+)\/search$/)))
      return sendJson(response, 200, { products: catalog.searchProducts(ctx.db, m[1], url.searchParams.get('q') || '') });
    if (method === 'GET' && (m = match(/^\/stores\/([^/]+)\/delivery-slots$/)))
      return sendJson(response, 200, { slots: catalog.getDeliverySlots(ctx.db, m[1], url.searchParams.get('date') || '') });
    if (method === 'POST' && (m = match(/^\/payments\/webhook\/([^/]+)$/))) {
      const raw = await readRaw(request);
      const signature = request.headers['x-razorpay-signature'] || request.headers['x-kirana-signature'] || '';
      return sendJson(response, 200, payments.handleWebhook(ctx.db, ctx.bus, m[1], signature, raw));
    }

    // ---- any authenticated role ----
    if (method === 'GET' && path === '/auth/me') return sendJson(response, 200, { user: requireUser(ctx, request, url) });
    if (method === 'PATCH' && path === '/auth/me')
      return sendJson(response, 200, { user: auth.updateProfile(ctx.db, requireUser(ctx, request, url).id, body) });
    if (method === 'POST' && path === '/auth/logout') {
      auth.revokeSession(ctx.db, bearerToken(request, url));
      return sendJson(response, 200, { ok: true });
    }
    if (method === 'GET' && path === '/events/stream') return handleStream(ctx, request, response, url);
    if (method === 'GET' && path === '/notifications') {
      const user = requireUser(ctx, request, url);
      const rows = ctx.db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(user.id);
      return sendJson(response, 200, { notifications: rows.map(row => ({ ...row, read: Boolean(row.read_at) })) });
    }
    if (method === 'POST' && (m = match(/^\/notifications\/([^/]+)\/read$/))) {
      const user = requireUser(ctx, request, url);
      ctx.db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?').run(isoNow(), m[1], user.id);
      return sendJson(response, 200, { ok: true });
    }
    if (method === 'POST' && path === '/notifications/read-all') {
      const user = requireUser(ctx, request, url);
      ctx.db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(isoNow(), user.id);
      return sendJson(response, 200, { ok: true });
    }

    // ---- customer ----
    if (path === '/addresses' && method === 'GET')
      return sendJson(response, 200, { addresses: catalog.listAddresses(ctx.db, requireUser(ctx, request, url, 'customer').id) });
    if (path === '/addresses' && method === 'POST')
      return sendJson(response, 201, { address: catalog.createAddress(ctx.db, requireUser(ctx, request, url, 'customer').id, body) });
    if ((m = match(/^\/addresses\/([^/]+)$/)) && method === 'PATCH')
      return sendJson(response, 200, { address: catalog.updateAddress(ctx.db, requireUser(ctx, request, url, 'customer').id, m[1], body) });
    if ((m = match(/^\/addresses\/([^/]+)$/)) && method === 'DELETE')
      return sendJson(response, 200, catalog.deleteAddress(ctx.db, requireUser(ctx, request, url, 'customer').id, m[1]));
    if (path === '/cart' && method === 'GET')
      return sendJson(response, 200, { cart: cart.getCart(ctx.db, requireUser(ctx, request, url, 'customer').id) });
    if (path === '/cart' && method === 'PUT')
      return sendJson(response, 200, { cart: cart.putCart(ctx.db, requireUser(ctx, request, url, 'customer').id, body) });
    if (path === '/cart' && method === 'DELETE')
      return sendJson(response, 200, { cart: cart.clearCart(ctx.db, requireUser(ctx, request, url, 'customer').id) });
    if (path === '/cart/items' && method === 'POST')
      return sendJson(response, 200, { cart: cart.addCartItem(ctx.db, requireUser(ctx, request, url, 'customer').id, body) });
    if ((m = match(/^\/cart\/items\/([^/]+)$/)) && method === 'PATCH')
      return sendJson(response, 200, { cart: cart.setCartItemQuantity(ctx.db, requireUser(ctx, request, url, 'customer').id, m[1], body.quantity) });
    if (path === '/cart/quote' && method === 'POST')
      return sendJson(response, 200, { quote: cart.quoteCart(ctx.db, requireUser(ctx, request, url, 'customer').id, body) });
    if (path === '/coupons' && method === 'GET')
      return sendJson(response, 200, { coupons: listAvailableCoupons(ctx.db, requireUser(ctx, request, url, 'customer').id) });
    if (path === '/saved' && method === 'GET')
      return sendJson(response, 200, { products: catalog.listSaved(ctx.db, requireUser(ctx, request, url, 'customer').id) });
    if ((m = match(/^\/saved\/([^/]+)\/([^/]+)$/)) && method === 'PUT')
      return sendJson(response, 200, { products: catalog.saveProduct(ctx.db, requireUser(ctx, request, url, 'customer').id, m[1], m[2]) });
    if ((m = match(/^\/saved\/([^/]+)\/([^/]+)$/)) && method === 'DELETE')
      return sendJson(response, 200, { products: catalog.unsaveProduct(ctx.db, requireUser(ctx, request, url, 'customer').id, m[1], m[2]) });
    if (path === '/orders' && method === 'POST') {
      const user = requireUser(ctx, request, url, 'customer');
      const result = await orders.createOrder(ctx.db, ctx.bus, {
        userId: user.id, addressId: body.address_id, items: body.items || null, storeId: body.store_id || null,
        couponCode: body.coupon_code || '', tipMinor: body.tip_minor ?? 0, paymentMethod: body.payment_method || 'cod',
        deliveryInstructions: body.delivery_instructions || '', deliveryType: body.delivery_type || 'instant',
        slotId: body.slot_id || null, idempotencyKey: request.headers['idempotency-key']
      });
      return sendJson(response, 201, result);
    }
    if (path === '/orders' && method === 'GET')
      return sendJson(response, 200, { orders: orders.listCustomerOrders(ctx.db, requireUser(ctx, request, url, 'customer').id, { status: url.searchParams.get('status') || '' }) });
    if ((m = match(/^\/orders\/([^/]+)$/)) && method === 'GET') {
      const user = requireUser(ctx, request, url);
      const order = ctx.db.prepare('SELECT customer_id,store_id,rider_id FROM orders WHERE id=?').get(m[1]);
      if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      const allowed = order.customer_id === user.id || order.rider_id === user.id || user.role === 'admin' ||
        (user.role === 'picker' && isStoreStaff(ctx.db, user.id, order.store_id));
      if (!allowed) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      return sendJson(response, 200, { order: orders.getOrderView(ctx.db, m[1], user) });
    }
    if ((m = match(/^\/orders\/([^/]+)\/cancel$/)) && method === 'POST') {
      const user = requireUser(ctx, request, url);
      return sendJson(response, 200, { order: orders.cancelOrder(ctx.db, ctx.bus, m[1], { actorId: user.id, role: user.role, reason: body.reason || '' }) });
    }
    if ((m = match(/^\/orders\/([^/]+)\/reorder$/)) && method === 'POST')
      return sendJson(response, 200, orders.reorder(ctx.db, requireUser(ctx, request, url, 'customer').id, m[1]));
    if ((m = match(/^\/orders\/([^/]+)\/rate$/)) && method === 'POST')
      return sendJson(response, 200, { order: orders.rateOrder(ctx.db, ctx.bus, m[1], requireUser(ctx, request, url, 'customer').id, body) });
    if ((m = match(/^\/orders\/([^/]+)\/pay$/)) && method === 'POST') {
      const user = requireUser(ctx, request, url, 'customer');
      const order = ctx.db.prepare('SELECT * FROM orders WHERE id=? AND customer_id=?').get(m[1], user.id);
      if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      if (order.payment_method !== 'online' || !['pending', 'failed'].includes(order.payment_status))
        throw new AppError(409, 'PAYMENT_NOT_RETRYABLE', 'This order does not need a payment retry.');
      return sendJson(response, 200, { payment: await payments.createPaymentIntent(ctx.db, order) });
    }
    if ((m = match(/^\/payments\/([^/]+)\/confirm$/)) && method === 'POST') {
      requireUser(ctx, request, url);
      return sendJson(response, 200, payments.confirmMockPayment(ctx.db, ctx.bus, m[1]));
    }

    // ---- picker / store ----
    if (path === '/store/stores' && method === 'GET') {
      const user = requireUser(ctx, request, url, 'picker');
      const rows = ctx.db.prepare(`SELECT s.* FROM stores s JOIN store_staff m ON m.store_id=s.id WHERE m.user_id=? AND s.active=1`).all(user.id);
      return sendJson(response, 200, { stores: rows.map(row => catalog.publicStore(row)) });
    }
    if ((m = match(/^\/store\/([^/]+)\/queue$/)) && method === 'GET')
      return sendJson(response, 200, { orders: store.storeQueue(ctx.db, m[1], requireUser(ctx, request, url, 'picker').id, { status: url.searchParams.get('status') || '', q: url.searchParams.get('q') || '' }) });
    if ((m = match(/^\/store\/([^/]+)\/orders\/([^/]+)$/)) && method === 'GET')
      return sendJson(response, 200, { order: store.storeOrder(ctx.db, m[1], m[2], requireUser(ctx, request, url, 'picker').id) });
    if ((m = match(/^\/store\/orders\/([^/]+)\/start-packing$/)) && method === 'POST')
      return sendJson(response, 200, { order: orders.startPacking(ctx.db, ctx.bus, m[1], requireUser(ctx, request, url, 'picker').id) });
    if ((m = match(/^\/store\/orders\/([^/]+)\/items\/(\d+)\/pick$/)) && method === 'POST')
      return sendJson(response, 200, { order: orders.pickItem(ctx.db, ctx.bus, m[1], Number(m[2]), body.picked_quantity, requireUser(ctx, request, url, 'picker').id) });
    if ((m = match(/^\/store\/orders\/([^/]+)\/pack$/)) && method === 'POST')
      return sendJson(response, 200, { order: orders.packOrder(ctx.db, ctx.bus, m[1], requireUser(ctx, request, url, 'picker').id) });
    if ((m = match(/^\/store\/([^/]+)\/inventory$/)) && method === 'GET')
      return sendJson(response, 200, { products: store.listInventory(ctx.db, m[1], requireUser(ctx, request, url, 'picker').id, { low: url.searchParams.get('low') || '' }) });
    if ((m = match(/^\/store\/([^/]+)\/inventory\/([^/]+)\/adjust$/)) && method === 'POST')
      return sendJson(response, 200, { product: store.adjustInventory(ctx.db, ctx.bus, m[1], m[2], body, requireUser(ctx, request, url, 'picker').id) });
    if ((m = match(/^\/store\/([^/]+)\/products$/)) && method === 'POST')
      return sendJson(response, 201, { product: store.createStoreProduct(ctx.db, m[1], body, requireUser(ctx, request, url, 'picker').id) });
    if ((m = match(/^\/store\/([^/]+)\/products\/([^/]+)$/)) && method === 'PATCH')
      return sendJson(response, 200, { product: store.updateStoreProduct(ctx.db, m[1], m[2], body, requireUser(ctx, request, url, 'picker').id) });
    if ((m = match(/^\/store\/([^/]+)\/settings$/)) && method === 'GET') {
      const user = requireUser(ctx, request, url, 'picker');
      if (!isStoreStaff(ctx.db, user.id, m[1])) throw new AppError(403, 'STORE_ACCESS_DENIED', 'You do not have access to this store.');
      return sendJson(response, 200, { store: catalog.publicStore(ctx.db.prepare('SELECT * FROM stores WHERE id=?').get(m[1])) });
    }
    if ((m = match(/^\/store\/([^/]+)\/settings$/)) && method === 'PUT')
      return sendJson(response, 200, { store: store.updateStoreSettings(ctx.db, m[1], body, requireUser(ctx, request, url, 'picker').id) });
    if ((m = match(/^\/store\/([^/]+)\/metrics$/)) && method === 'GET')
      return sendJson(response, 200, { metrics: store.storeMetrics(ctx.db, m[1], requireUser(ctx, request, url, 'picker').id) });

    // ---- rider ----
    if (path === '/rider/me' && method === 'GET')
      return sendJson(response, 200, { rider: rider.getRiderMe(ctx.db, requireUser(ctx, request, url, 'rider').id) });
    if (path === '/rider/availability' && method === 'POST')
      return sendJson(response, 200, { rider: rider.setAvailability(ctx.db, ctx.bus, requireUser(ctx, request, url, 'rider').id, body.online) });
    if (path === '/rider/location' && method === 'POST')
      return sendJson(response, 200, rider.updateLocation(ctx.db, ctx.bus, requireUser(ctx, request, url, 'rider').id, body));
    if (path === '/rider/jobs' && method === 'GET')
      return sendJson(response, 200, { jobs: rider.listJobs(ctx.db, requireUser(ctx, request, url, 'rider').id, { status: url.searchParams.get('status') || '' }) });
    if ((m = match(/^\/rider\/jobs\/([^/]+)\/accept$/)) && method === 'POST')
      return sendJson(response, 200, { job: rider.acceptJob(ctx.db, ctx.bus, m[1], requireUser(ctx, request, url, 'rider').id) });
    if ((m = match(/^\/rider\/jobs\/([^/]+)\/decline$/)) && method === 'POST')
      return sendJson(response, 200, rider.declineJob(ctx.db, ctx.bus, m[1], requireUser(ctx, request, url, 'rider').id));
    if ((m = match(/^\/rider\/jobs\/([^/]+)\/pickup$/)) && method === 'POST')
      return sendJson(response, 200, rider.pickupJob(ctx.db, ctx.bus, m[1], requireUser(ctx, request, url, 'rider').id, body.pickup_code));
    if ((m = match(/^\/rider\/jobs\/([^/]+)\/deliver$/)) && method === 'POST')
      return sendJson(response, 200, rider.deliverJob(ctx.db, ctx.bus, m[1], requireUser(ctx, request, url, 'rider').id, body));
    if (path === '/rider/earnings' && method === 'GET')
      return sendJson(response, 200, { earnings: rider.earnings(ctx.db, requireUser(ctx, request, url, 'rider').id) });

    // ---- admin ----
    if (path === '/admin/overview' && method === 'GET') {
      requireUser(ctx, request, url, 'admin');
      return sendJson(response, 200, { overview: admin.overview(ctx.db) });
    }
    if (path === '/admin/stores' && method === 'GET') {
      requireUser(ctx, request, url, 'admin');
      return sendJson(response, 200, { stores: admin.listStoresAdmin(ctx.db) });
    }
    if (path === '/admin/stores' && method === 'POST')
      return sendJson(response, 201, { store: admin.createStore(ctx.db, body, requireUser(ctx, request, url, 'admin').id) });
    if ((m = match(/^\/admin\/stores\/([^/]+)$/)) && method === 'PATCH')
      return sendJson(response, 200, { store: admin.updateStoreAdmin(ctx.db, m[1], body, requireUser(ctx, request, url, 'admin').id) });
    if (path === '/admin/users' && method === 'GET') {
      requireUser(ctx, request, url, 'admin');
      return sendJson(response, 200, { users: admin.listUsers(ctx.db, { role: url.searchParams.get('role') || '' }) });
    }
    if (path === '/admin/users' && method === 'POST')
      return sendJson(response, 201, { user: admin.createStaffUser(ctx.db, body, requireUser(ctx, request, url, 'admin').id) });
    if ((m = match(/^\/admin\/users\/([^/]+)$/)) && method === 'PATCH')
      return sendJson(response, 200, { user: admin.setUserActive(ctx.db, m[1], body.active, requireUser(ctx, request, url, 'admin').id) });
    if (path === '/admin/coupons' && method === 'GET') {
      requireUser(ctx, request, url, 'admin');
      return sendJson(response, 200, { coupons: admin.listCouponsAdmin(ctx.db) });
    }
    if (path === '/admin/coupons' && method === 'POST')
      return sendJson(response, 201, { coupon: admin.createCoupon(ctx.db, body, requireUser(ctx, request, url, 'admin').id) });
    if ((m = match(/^\/admin\/coupons\/([^/]+)$/)) && method === 'PATCH')
      return sendJson(response, 200, { coupon: admin.updateCoupon(ctx.db, m[1], body, requireUser(ctx, request, url, 'admin').id) });
    if (path === '/admin/orders' && method === 'GET') {
      requireUser(ctx, request, url, 'admin');
      return sendJson(response, 200, { orders: admin.listAllOrders(ctx.db, { status: url.searchParams.get('status') || '', store_id: url.searchParams.get('store_id') || '' }) });
    }
    if ((m = match(/^\/admin\/orders\/([^/]+)\/cancel$/)) && method === 'POST')
      return sendJson(response, 200, { order: orders.cancelOrder(ctx.db, ctx.bus, m[1], { actorId: requireUser(ctx, request, url, 'admin').id, role: 'admin', reason: body.reason || 'Cancelled by ops' }) });
    if (path === '/admin/audit' && method === 'GET') {
      requireUser(ctx, request, url, 'admin');
      return sendJson(response, 200, { events: admin.auditLog(ctx.db, { limit: url.searchParams.get('limit') || 100 }) });
    }

    // ---- dev tools ----
    if ((m = match(/^\/dev\/orders\/([^/]+)\/simulate$/)) && method === 'POST') {
      const user = requireUser(ctx, request, url);
      const order = ctx.db.prepare('SELECT customer_id FROM orders WHERE id=?').get(m[1]);
      if (!order || (order.customer_id !== user.id && user.role !== 'admin')) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      return sendJson(response, 200, startSimulation(ctx, m[1]));
    }

    throw new AppError(404, 'NOT_FOUND', 'Not found.');
  } catch (error) {
    if (!response.headersSent) sendError(response, error);
    else response.end();
  }
}