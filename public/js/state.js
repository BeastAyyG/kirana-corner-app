// Central app state with a tiny pub/sub. Views subscribe to topics they care
// about and re-render; mutations live in actions.js on top of this store.
import { api, newRequestId } from './api.js';

const listeners = new Map();
export const bus = {
  on(topic, fn) {
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic).add(fn);
    return () => listeners.get(topic)?.delete(fn);
  },
  emit(topic, payload) {
    for (const fn of listeners.get(topic) || []) {
      try { fn(payload); } catch (error) { console.error(topic, error); }
    }
  },
};

const BASKET_KEY = id => `kc-basket:${id}`;
const QUOTES_KEY = id => `kc-quotes:${id}`;

export const state = {
  session: { user: null, demoAvailable: true, ready: false },
  // shopper
  stores: [], store: null, storeId: '',
  products: [], productsLoaded: false,
  filters: { category: 'All', q: '', inStock: false, minPrice: '', maxPrice: '', sort: '' },
  basket: {}, quotes: {}, basketSynced: false,
  slots: [], slotDate: '', slotId: '',
  orders: [], ordersLoaded: false,
  saved: [], savedLoaded: false,
  profile: null,
  // seller
  seller: {
    stores: [], store: null, storeId: '',
    products: [], productsLoaded: false,
    orders: [], ordersLoaded: false,
    queueFilters: { status: 'active', q: '', date: '' },
    settings: null, settingsLoaded: false,
    seenOrderIds: new Set(), newOrderIds: new Set(),
  },
};

/* ---------- persistence ---------- */
function loadLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function saveLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
export function loadBasketLocal() {
  const id = state.session.user?.id || 'guest';
  state.basket = loadLocal(BASKET_KEY(id), {});
  state.quotes = loadLocal(QUOTES_KEY(id), {});
  state.basketSynced = false;
}
export function saveBasketLocal() {
  const id = state.session.user?.id || 'guest';
  saveLocal(BASKET_KEY(id), state.basket);
  saveLocal(QUOTES_KEY(id), state.quotes);
}
export function loadPrefs() {
  state.storeId = loadLocal('kc-store-id', '');
  state.seller.storeId = loadLocal('kc-seller-store', '');
  state.slotId = loadLocal('kc-slot', '');
  state.slotDate = loadLocal('kc-slot-date', '');
}
export function savePrefs() {
  saveLocal('kc-store-id', state.storeId);
  saveLocal('kc-seller-store', state.seller.storeId);
  saveLocal('kc-slot', state.slotId);
  saveLocal('kc-slot-date', state.slotDate);
}

/* ---------- basket helpers ---------- */
export function basketLines() {
  return Object.entries(state.basket)
    .map(([id, qty]) => ({ product: state.products.find(p => p.id === id), qty: Number(qty) }))
    .filter(line => line.product && line.qty > 0);
}
export function basketCount() {
  return Object.values(state.basket).reduce((sum, qty) => sum + Number(qty || 0), 0);
}
export function basketTotal() {
  return basketLines().reduce((sum, line) => sum + line.qty * (state.quotes[line.product.id] ?? line.product.price_minor), 0);
}
export function basketHasIssues() {
  return basketLines().some(({ product, qty }) =>
    !product.active || qty > product.available ||
    (state.quotes[product.id] && state.quotes[product.id] !== product.price_minor));
}

export function setQty(productId, qty, { priceMinor, available } = {}) {
  const next = Number(qty);
  if (next <= 0) {
    delete state.basket[productId];
    delete state.quotes[productId];
  } else {
    if (state.quotes[productId] === undefined && priceMinor) state.quotes[productId] = priceMinor;
    state.basket[productId] = next;
  }
  saveBasketLocal();
  bus.emit('basket');
}

/* ---------- server basket sync (signed-in shoppers) ---------- */
let syncTimer = null;
export function queueBasketSync() {
  if (!state.session.user || state.session.user.role !== 'shopper' || !state.store) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncBasketNow, 350);
}
export async function syncBasketNow() {
  if (!state.session.user || state.session.user.role !== 'shopper' || !state.store) return;
  const items = Object.entries(state.basket).map(([product_id, quantity]) => ({
    product_id,
    quantity,
    expected_price_minor: state.quotes[product_id],
  }));
  try {
    const result = await api.putBasket(state.store.id, items);
    state.basketSynced = true;
    if (result.basket.store_id === state.store.id) {
      for (const item of result.basket.items) {
        if (state.basket[item.product_id] !== item.quantity) state.basket[item.product_id] = item.quantity;
        if (item.quoted_price_minor) state.quotes[item.product_id] = item.quoted_price_minor;
      }
    }
    saveBasketLocal();
    bus.emit('basket');
  } catch (error) {
    if (error.status === 401) bus.emit('auth:expired');
  }
}

/* ---------- idempotent order attempt ---------- */
const ATTEMPT_KEY = 'kc-order-attempt';
export function orderAttemptKey() {
  const signature = JSON.stringify({
    store_id: state.store?.id, slot_id: state.slotId,
    items: basketLines().map(line => [line.product.id, line.qty]),
  });
  try {
    const saved = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) || 'null');
    if (saved?.signature === signature && saved.key) return saved.key;
    const key = newRequestId();
    sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ signature, key }));
    return key;
  } catch { return newRequestId(); }
}
export function clearOrderAttempt() {
  try { sessionStorage.removeItem(ATTEMPT_KEY); } catch { /* ignore */ }
}
