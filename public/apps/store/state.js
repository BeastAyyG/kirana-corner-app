// Central picker state + tiny pub/sub (mirrors the customer app pattern).
// Views read `state` and subscribe to the bus for cross-view updates.
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
  stores: [],        // stores this picker is staffed on
  store: null,       // selected store
  queue: [],         // last fetched order queue (all statuses)
  metrics: null,
  inventory: [],
  categories: [],
};

/** Load session + stores + categories. Non-picker tokens are cleared so the
 *  shared 'kc-v2-token' key never causes 403 loops across the sibling apps. */
export async function bootstrap() {
  const me = await api.me();
  const user = me.user || me;
  if (user?.role !== 'picker') {
    setToken('');
    state.user = null;
    state.ready = false;
    return state;
  }
  state.user = user;
  const [storeRes, catRes] = await Promise.all([
    api.storeStores(),
    api.categories().catch(() => ({ categories: [] })),
  ]);
  state.stores = storeRes.stores || [];
  const keep = state.store && state.stores.find(s => s.id === state.store.id);
  state.store = keep || state.stores[0] || null;
  state.categories = catRes.categories || [];
  state.ready = true;
  bus.emit('ready', state);
  return state;
}

export function selectStore(storeId) {
  const next = state.stores.find(s => s.id === storeId);
  if (!next || next.id === state.store?.id) return;
  state.store = next;
  state.queue = [];
  state.metrics = null;
  state.inventory = [];
  bus.emit('store', next);
}

export async function refreshQueue(params = {}) {
  if (!state.store) return [];
  const res = await api.storeQueue(state.store.id, params);
  state.queue = res.orders || [];
  bus.emit('queue', state.queue);
  return state.queue;
}

export async function refreshMetrics() {
  if (!state.store) return null;
  const res = await api.storeMetrics(state.store.id);
  state.metrics = res.metrics || null;
  return state.metrics;
}

export async function refreshInventory(params = {}) {
  if (!state.store) return [];
  const res = await api.inventory(state.store.id, params);
  state.inventory = res.products || [];
  return state.inventory;
}

export function newOrderCount() {
  return state.queue.filter(o => o.status === 'placed').length;
}

export function signOut() {
  setToken('');
  state.user = null; state.ready = false;
  state.stores = []; state.store = null;
  state.queue = []; state.metrics = null; state.inventory = [];
  bus.emit('signout');
}

export function hasSession() { return Boolean(getToken()); }