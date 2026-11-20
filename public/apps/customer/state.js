// Central customer state + tiny pub/sub. Views read `state` and subscribe to
// the bus for cross-view updates (cart badge, order status, address changes).
import { api, getToken, setToken } from '../_shared/api.js';

const listeners = new Map();
export const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  },
  emit(event, payload) { listeners.get(event)?.forEach(fn => { try { fn(payload); } catch { /* isolate */ } }); },
};

export const state = {
  user: null,
  ready: false,
  store: null,            // serviceable store object
  serviceability: null,   // {eta_minutes, eta_range, promise, distance_km}
  address: null,          // selected delivery address
  addresses: [],
  categories: [],
  products: new Map(),    // id → product (cache across PLP/PDP/cart)
  cart: { store_id: '', items: [], items_total_minor: 0, savings_minor: 0 },
  saved: new Set(),       // product ids
  coupons: [],
  couponCode: '',
  deliveryType: 'now',    // 'now' | 'later'
  slotId: '',
  orders: [],
  activeOrder: null,
};

export function cacheProducts(list) {
  for (const p of list || []) state.products.set(p.id, p);
}
export function getProduct(id) { return state.products.get(id) || null; }
export function cartQty(id) {
  const line = state.cart.items.find(i => i.id === id);
  return line ? line.quantity : 0;
}
export function cartCount() { return state.cart.items.reduce((n, i) => n + i.quantity, 0); }
export function cartTotal() { return state.cart.items_total_minor || 0; }

export function setCart(cart) {
  state.cart = cart || { store_id: '', items: [], items_total_minor: 0, savings_minor: 0 };
  cacheProducts(state.cart.items);
  bus.emit('cart', state.cart);
}

/** Add / set quantity through the API, then refresh the cart. */
export async function changeQty(productId, delta) {
  const storeId = state.store?.id || state.cart.store_id;
  if (!storeId) return;
  const current = cartQty(productId);
  const next = current + delta;
  if (current === 0 && next > 0) {
    const cart = await api.addItem(storeId, productId, 1);
    setCart(cart.cart || cart);
  } else {
    const cart = await api.setItemQty(productId, Math.max(0, next));
    setCart(cart.cart || cart);
  }
  return state.cart;
}

export async function refreshCart() {
  try {
    const res = await api.cart();
    setCart(res.cart || res);
  } catch { /* empty cart is fine */ }
}

export async function refreshSaved() {
  try {
    const res = await api.saved();
    const list = res.products || res.saved || res.items || [];
    state.saved = new Set(list.map(i => i.product_id || i.id));
    cacheProducts(list);
    bus.emit('saved', state.saved);
  } catch { /* ignore */ }
}

export function setAddress(address) {
  state.address = address;
  bus.emit('address', address);
}

/** Resolve the serviceable store + ETA from an address's coordinates. */
export async function resolveServiceability(address) {
  if (!address?.lat || !address?.lng) return null;
  const res = await api.serviceability(address.lat, address.lng);
  state.serviceability = res;
  if (res.serviceable && res.store) {
    state.store = res.store;
    bus.emit('store', res.store);
  }
  return res;
}

export async function bootstrap() {
  const me = await api.me();
  state.user = me.user || me;
  const [addrRes, catRes, couponRes] = await Promise.all([
    api.addresses().catch(() => ({ addresses: [] })),
    api.categories().catch(() => ({ categories: [] })),
    api.coupons().catch(() => ({ coupons: [] })),
  ]);
  state.addresses = addrRes.addresses || [];
  state.categories = catRes.categories || [];
  state.coupons = couponRes.coupons || [];
  state.address = state.addresses.find(a => a.is_default) || state.addresses[0] || null;
  await refreshCart();
  await refreshSaved();
  if (state.address) await resolveServiceability(state.address);
  state.ready = true;
  bus.emit('ready', state);
  return state;
}

export function signOut() {
  setToken('');
  state.user = null; state.ready = false; state.store = null; state.address = null;
  state.addresses = []; state.cart = { store_id: '', items: [], items_total_minor: 0, savings_minor: 0 };
  state.saved = new Set(); state.orders = []; state.activeOrder = null;
  bus.emit('signout');
}

export function hasSession() { return Boolean(getToken()); }