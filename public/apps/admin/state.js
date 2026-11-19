// Central admin state + tiny pub/sub (same pattern as the customer app).
// Views read `state` and call refresh helpers; the bus notifies chrome.
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
  overview: null,
  stores: [],
  users: [],
  coupons: [],
  orders: [],
  audit: [],
};

/** Load the session. Non-admin tokens are cleared immediately so the shared
 *  token key never causes 403 loops across the sibling apps. */
export async function bootstrap() {
  const me = await api.me();
  const user = me.user || me;
  if (!user || user.role !== 'admin') {
    setToken('');
    state.user = null;
    state.ready = false;
    bus.emit('signout');
    return state;
  }
  state.user = user;
  const [overviewRes, storesRes] = await Promise.all([api.adminOverview(), api.adminStores()]);
  state.overview = overviewRes.overview || null;
  state.stores = storesRes.stores || [];
  state.ready = true;
  bus.emit('ready', state);
  return state;
}

export async function refreshOverview() {
  const res = await api.adminOverview();
  state.overview = res.overview || null;
  bus.emit('overview', state.overview);
  return state.overview;
}

export async function refreshStores() {
  const res = await api.adminStores();
  state.stores = res.stores || [];
  bus.emit('stores', state.stores);
  return state.stores;
}

export async function refreshUsers(role = '') {
  const res = await api.adminUsers(role);
  state.users = res.users || [];
  bus.emit('users', state.users);
  return state.users;
}

export async function refreshCoupons() {
  const res = await api.adminCoupons();
  state.coupons = res.coupons || [];
  bus.emit('coupons', state.coupons);
  return state.coupons;
}

export async function refreshOrders(params = {}) {
  const res = await api.adminOrders(params);
  state.orders = res.orders || [];
  bus.emit('orders', state.orders);
  return state.orders;
}

export async function refreshAudit(limit = 100) {
  const res = await api.adminAudit(limit);
  state.audit = res.events || [];
  bus.emit('audit', state.audit);
  return state.audit;
}

export function signOut() {
  setToken('');
  state.user = null;
  state.ready = false;
  state.overview = null;
  state.stores = [];
  state.users = [];
  state.coupons = [];
  state.orders = [];
  state.audit = [];
  bus.emit('signout');
}

export function hasSession() { return Boolean(getToken()); }