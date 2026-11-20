// Typed wrapper around the Kirana Corner /api/v1 endpoints.
import { API_BASE } from './config.js';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, headers = {}, idempotencyKey } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, payload.code || 'REQUEST_FAILED',
      payload.message || 'Something went wrong. Try again.', payload.details);
  }
  return payload;
}

export function newRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

const qs = params => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== '' && value !== undefined && value !== null) search.set(key, String(value));
  }
  return search.size ? `?${search.toString()}` : '';
};
const seg = value => encodeURIComponent(String(value));

export const api = {
  session: () => request('/auth/session'),
  demoSignIn: role => request('/auth/demo', { method: 'POST', body: { role } }),
  logout: () => request('/auth/logout', { method: 'POST' }),

  stores: (q = '') => request(`/stores${qs({ q })}`),
  products: (storeId, filters = {}) => request(`/stores/${seg(storeId)}/products${qs(filters)}`),
  product: (storeId, productId) => request(`/stores/${seg(storeId)}/products/${seg(productId)}`),
  slots: (storeId, date) => request(`/stores/${seg(storeId)}/pickup-slots${qs({ date })}`),

  placeOrder: (body, idempotencyKey) => request('/orders', { method: 'POST', body, idempotencyKey }),
  shopperOrders: (status = '') => request(`/shopper/me/orders${qs({ status })}`),
  order: orderId => request(`/orders/${seg(orderId)}`),
  cancelOrder: (orderId, reason) => request(`/orders/${seg(orderId)}/cancel`, { method: 'POST', body: { reason: reason || 'Cancelled before packing' } }),

  profile: () => request('/shopper/me'),
  updateProfile: body => request('/shopper/me', { method: 'PATCH', body }),
  basket: () => request('/shopper/basket'),
  putBasket: (storeId, items) => request('/shopper/basket', { method: 'PUT', body: { store_id: storeId, items } }),
  saved: () => request('/shopper/me/saved-products'),
  saveProduct: productId => request(`/shopper/me/saved-products/${seg(productId)}`, { method: 'PUT' }),
  unsaveProduct: productId => request(`/shopper/me/saved-products/${seg(productId)}`, { method: 'DELETE' }),

  sellerStores: () => request('/seller/stores'),
  sellerUpdateStore: (storeId, body) => request(`/seller/stores/${seg(storeId)}`, { method: 'PATCH', body }),
  sellerProducts: storeId => request(`/seller/stores/${seg(storeId)}/products`),
  sellerCreateProduct: (storeId, body) => request(`/seller/stores/${seg(storeId)}/products`, { method: 'POST', body }),
  sellerPatchProduct: (productId, body) => request(`/seller/products/${seg(productId)}`, { method: 'PATCH', body }),
  sellerOrders: (storeId, filters = {}) => request(`/seller/stores/${seg(storeId)}/orders${qs(filters)}`),
  sellerPickupSettings: storeId => request(`/seller/stores/${seg(storeId)}/pickup-settings`),
  sellerUpdatePickupSettings: (storeId, body) => request(`/seller/stores/${seg(storeId)}/pickup-settings`, { method: 'PUT', body }),
  sellerStartPacking: orderId => request(`/seller/orders/${seg(orderId)}/start-packing`, { method: 'POST', body: {} }),
  sellerMarkReady: (orderId, body) => request(`/seller/orders/${seg(orderId)}/mark-ready`, { method: 'POST', body }),
  sellerCompletePickup: (orderId, pickupCode) => request(`/seller/orders/${seg(orderId)}/complete-pickup`, { method: 'POST', body: { pickup_code: String(pickupCode || '').trim().toUpperCase() } }),
  resetDemo: () => request('/demo/reset', { method: 'POST', body: {} }),
};
