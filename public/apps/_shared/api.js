// Kirana delivery (v2) API client. Bearer-token OTP sessions, JSON envelope,
// and an SSE helper. Shared by the customer / store / rider / admin apps.
const BASE = '/api/v2';
const TOKEN_KEY = 'kc-v2-token';

let token = '';
try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* private mode */ }

export function setToken(value) {
  token = value || '';
  try { value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
export function getToken() { return token; }

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || 'Request failed');
    this.status = status; this.code = code; this.details = details;
  }
}

async function req(method, path, body, opts = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  let response;
  try {
    response = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'NETWORK', 'You appear to be offline. Check your connection.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.code || 'ERROR', data.message, data.details);
  return data;
}

const qs = params => {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : '';
};

export const api = {
  raw: req,
  // auth
  requestOtp: phone => req('POST', '/auth/otp/request', { phone }),
  verifyOtp: (phone, code, name = '') => req('POST', '/auth/otp/verify', { phone, code, name }),
  me: () => req('GET', '/auth/me'),
  updateProfile: name => req('PATCH', '/auth/me', { name }),
  logout: () => req('POST', '/auth/logout'),
  // catalog (public)
  categories: () => req('GET', '/categories'),
  stores: () => req('GET', '/stores'),
  serviceability: (lat, lng) => req('POST', '/serviceability', { lat, lng }),
  products: (storeId, params = {}) => req('GET', `/stores/${storeId}/products${qs(params)}`),
  product: (storeId, pid) => req('GET', `/stores/${storeId}/products/${pid}`),
  search: (storeId, q) => req('GET', `/stores/${storeId}/search${qs({ q })}`),
  slots: (storeId, date) => req('GET', `/stores/${storeId}/delivery-slots${qs({ date })}`),
  // customer
  addresses: () => req('GET', '/addresses'),
  createAddress: a => req('POST', '/addresses', a),
  updateAddress: (id, a) => req('PATCH', `/addresses/${id}`, a),
  deleteAddress: id => req('DELETE', `/addresses/${id}`),
  cart: () => req('GET', '/cart'),
  putCart: (store_id, items) => req('PUT', '/cart', { store_id, items }),
  clearCart: () => req('DELETE', '/cart'),
  addItem: (store_id, product_id, quantity = 1) => req('POST', '/cart/items', { store_id, product_id, quantity }),
  setItemQty: (pid, quantity) => req('PATCH', `/cart/items/${pid}`, { quantity }),
  quote: body => req('POST', '/cart/quote', body),
  coupons: () => req('GET', '/coupons'),
  saved: () => req('GET', '/saved'),
  save: (storeId, pid) => req('PUT', `/saved/${storeId}/${pid}`),
  unsave: (storeId, pid) => req('DELETE', `/saved/${storeId}/${pid}`),
  createOrder: (body, key) => req('POST', '/orders', body, { idempotencyKey: key }),
  orders: (status = '') => req('GET', `/orders${qs({ status })}`),
  order: id => req('GET', `/orders/${id}`),
  cancelOrder: (id, reason = '') => req('POST', `/orders/${id}/cancel`, { reason }),
  reorder: id => req('POST', `/orders/${id}/reorder`),
  rateOrder: (id, rating, comment = '') => req('POST', `/orders/${id}/rate`, { rating, comment }),
  payOrder: id => req('POST', `/orders/${id}/pay`),
  confirmPayment: pid => req('POST', `/payments/${pid}/confirm`),
  notifications: () => req('GET', '/notifications'),
  readNotification: id => req('POST', `/notifications/${id}/read`),
  readAllNotifications: () => req('POST', '/notifications/read-all'),
  simulate: id => req('POST', `/dev/orders/${id}/simulate`),
  // store / picker
  storeStores: () => req('GET', '/store/stores'),
  storeQueue: (storeId, params = {}) => req('GET', `/store/${storeId}/queue${qs(params)}`),
  storeOrder: (storeId, oid) => req('GET', `/store/${storeId}/orders/${oid}`),
  startPacking: oid => req('POST', `/store/orders/${oid}/start-packing`),
  pickItem: (oid, itemId, picked_quantity) => req('POST', `/store/orders/${oid}/items/${itemId}/pick`, { picked_quantity }),
  packOrder: oid => req('POST', `/store/orders/${oid}/pack`),
  inventory: (storeId, params = {}) => req('GET', `/store/${storeId}/inventory${qs(params)}`),
  adjustInventory: (storeId, pid, body) => req('POST', `/store/${storeId}/inventory/${pid}/adjust`, body),
  createStoreProduct: (storeId, body) => req('POST', `/store/${storeId}/products`, body),
  updateStoreProduct: (storeId, pid, body) => req('PATCH', `/store/${storeId}/products/${pid}`, body),
  storeSettings: storeId => req('GET', `/store/${storeId}/settings`),
  updateStoreSettings: (storeId, body) => req('PUT', `/store/${storeId}/settings`, body),
  storeMetrics: storeId => req('GET', `/store/${storeId}/metrics`),
  // rider
  riderMe: () => req('GET', '/rider/me'),
  riderAvailability: online => req('POST', '/rider/availability', { online }),
  riderLocation: (lat, lng) => req('POST', '/rider/location', { lat, lng }),
  riderJobs: (status = '') => req('GET', `/rider/jobs${qs({ status })}`),
  acceptJob: id => req('POST', `/rider/jobs/${id}/accept`),
  declineJob: id => req('POST', `/rider/jobs/${id}/decline`),
  pickupJob: (id, pickup_code = '') => req('POST', `/rider/jobs/${id}/pickup`, { pickup_code }),
  deliverJob: (id, body = {}) => req('POST', `/rider/jobs/${id}/deliver`, body),
  riderEarnings: () => req('GET', '/rider/earnings'),
  // admin
  adminOverview: () => req('GET', '/admin/overview'),
  adminStores: () => req('GET', '/admin/stores'),
  adminCreateStore: body => req('POST', '/admin/stores', body),
  adminUpdateStore: (id, body) => req('PATCH', `/admin/stores/${id}`, body),
  adminUsers: (role = '') => req('GET', `/admin/users${qs({ role })}`),
  adminCreateUser: body => req('POST', '/admin/users', body),
  adminSetUserActive: (id, active) => req('PATCH', `/admin/users/${id}`, { active }),
  adminCoupons: () => req('GET', '/admin/coupons'),
  adminCreateCoupon: body => req('POST', '/admin/coupons', body),
  adminUpdateCoupon: (id, body) => req('PATCH', `/admin/coupons/${id}`, body),
  adminOrders: (params = {}) => req('GET', `/admin/orders${qs(params)}`),
  adminCancelOrder: (id, reason = '') => req('POST', `/admin/orders/${id}/cancel`, { reason }),
  adminAudit: (limit = 100) => req('GET', `/admin/audit${qs({ limit })}`),
};

/** Open an SSE stream. `events` is the list of named events to listen for.
 *  onEvent(name, data, payload). Returns the EventSource (call .close() to stop). */
export function openStream({ orderId = '', events = [], onEvent, onError } = {}) {
  const url = `${BASE}/events/stream?token=${encodeURIComponent(token)}${orderId ? `&order_id=${encodeURIComponent(orderId)}` : ''}`;
  const source = new EventSource(url);
  const names = new Set(['hello', 'notification', ...events]);
  const handler = e => {
    try { const payload = JSON.parse(e.data); onEvent?.(payload.event, payload.data, payload); } catch { /* ignore */ }
  };
  names.forEach(name => source.addEventListener(name, handler));
  source.onerror = e => onError?.(e);
  return source;
}

/** Idempotency key for checkout (16–128 url-safe chars). */
export function newIdempotencyKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}