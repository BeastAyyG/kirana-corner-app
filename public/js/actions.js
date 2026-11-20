// All data loads and mutations live here; views render from state and listen
// on the bus. Errors surface as toasts; loads stay quiet where possible.
import { api, ApiError } from './api.js';
import { state, bus, loadBasketLocal, saveBasketLocal, queueBasketSync, syncBasketNow,
  setQty, savePrefs, loadPrefs, basketCount, basketLines, orderAttemptKey, clearOrderAttempt } from './state.js';
import { toast } from './ui.js';

function isAuthError(error) { return error instanceof ApiError && error.status === 401; }
function fail(error, fallback = 'Something went wrong. Try again.') {
  toast(error?.message || fallback, 'error');
}

/* ================= session ================= */

export async function loadSession() {
  try {
    const result = await api.session();
    state.session.user = result.user || null;
    state.session.demoAvailable = Boolean(result.demo_available);
  } catch {
    state.session.user = null;
    state.session.demoAvailable = true;
  } finally {
    state.session.ready = true;
  }
  loadPrefs();
  loadBasketLocal();
  bus.emit('session');
  return state.session.user;
}

export async function signInDemo(role) {
  try {
    const guestBasket = { ...state.basket };
    const guestQuotes = { ...state.quotes };
    const result = await api.demoSignIn(role);
    state.session.user = result.user;
    state.session.demoAvailable = true;
    loadBasketLocal();
    // carry the guest basket over so items added before signing in survive
    for (const [id, qty] of Object.entries(guestBasket)) {
      state.basket[id] = Math.max(Number(state.basket[id] || 0), Number(qty));
      if (state.quotes[id] === undefined && guestQuotes[id] !== undefined) state.quotes[id] = guestQuotes[id];
    }
    bus.emit('session');
    await afterSignIn(role);
    toast(`Signed in as ${role === 'seller' ? 'shopkeeper' : 'shopper'}`, 'success');
    return true;
  } catch (error) {
    fail(error, 'Sign-in failed. Try again.');
    return false;
  }
}

async function afterSignIn(role) {
  if (role === 'shopper') {
    await refreshStores();
    await refreshCatalog();
    if (basketCount()) await syncBasketNow();
    if (state.basket && Object.keys(state.basket).length) {
      // reconcile server basket with local for cross-device persistence
      await syncBasketNow();
    }
  } else {
    await refreshSellerStores();
    await Promise.all([refreshSellerProducts(), refreshQueue(), refreshSettings()]);
  }
}

export async function signOut() {
  try { await api.logout(); } catch { /* session already gone */ }
  state.session.user = null;
  state.orders = []; state.ordersLoaded = false;
  state.profile = null; state.saved = []; state.savedLoaded = false;
  state.seller.stores = []; state.seller.store = null; state.seller.storeId = '';
  state.seller.products = []; state.seller.productsLoaded = false;
  state.seller.orders = []; state.seller.ordersLoaded = false;
  state.seller.settings = null; state.seller.settingsLoaded = false;
  state.seller.seenOrderIds = new Set();
  state.seller.pickupCodeDrafts = new Map();
  loadBasketLocal();
  bus.emit('session');
  bus.emit('orders');
  bus.emit('basket');
}

/* ================= stores ================= */

export async function refreshStores(q = '') {
  try {
    const result = await api.stores(q);
    state.stores = result.stores || [];
    if (!state.store || !state.stores.some(store => store.id === state.store.id)) {
      state.store = state.stores.find(store => store.id === state.storeId) || state.stores[0] || null;
      state.storeId = state.store?.id || '';
    } else {
      const fresh = state.stores.find(store => store.id === state.store.id);
      if (fresh) state.store = fresh;
    }
    savePrefs();
    bus.emit('stores');
    return state.stores;
  } catch (error) {
    if (!isAuthError(error)) fail(error, 'Could not load shops.');
    return [];
  }
}

export async function selectStore(storeId) {
  if (state.store?.id === storeId) return;
  if (basketCount()) {
    const { askConfirm } = await import('./ui.js');
    const ok = await askConfirm({
      title: 'Switch shop?',
      message: 'Your basket only works with one shop at a time. Switching clears the current basket.',
      confirmLabel: 'Switch & clear',
      danger: true,
    });
    if (!ok) return false;
  }
  state.basket = {}; state.quotes = {};
  state.products = []; state.productsLoaded = false;
  state.slots = []; state.slotId = ''; state.slotDate = '';
  state.storeId = storeId;
  state.store = state.stores.find(store => store.id === storeId) || state.store;
  savePrefs();
  saveBasketLocal();
  bus.emit('basket');
  bus.emit('stores');
  await refreshCatalog();
  await refreshSlots();
  await syncBasketNow();
  return true;
}

/* ================= catalog ================= */

export function catalogFiltersQuery() {
  const filters = state.filters;
  return {
    q: filters.q.trim(),
    category: filters.category === 'All' ? '' : filters.category,
    in_stock: filters.inStock ? 'true' : '',
    min_price: filters.minPrice,
    max_price: filters.maxPrice,
    sort: filters.sort,
  };
}

export async function refreshCatalog({ silent = true } = {}) {
  if (!state.store) return;
  try {
    const result = await api.products(state.store.id, catalogFiltersQuery());
    state.products = result.products || [];
    state.productsLoaded = true;
    // drop basket items that vanished
    let changed = false;
    for (const id of Object.keys(state.basket)) {
      const product = state.products.find(item => item.id === id);
      if (!product || !product.active) { delete state.basket[id]; delete state.quotes[id]; changed = true; }
    }
    if (changed) { saveBasketLocal(); bus.emit('basket'); }
    bus.emit('catalog');
  } catch (error) {
    if (!silent || !isAuthError(error)) fail(error, 'Could not load the shelf.');
  }
}

export function setFilters(partial) {
  Object.assign(state.filters, partial);
  return refreshCatalog();
}

/* ================= slots ================= */

export async function refreshSlots(date) {
  if (!state.store) return;
  state.slotDate = date || state.slotDate || state.store.local_date;
  try {
    const result = await api.slots(state.store.id, state.slotDate);
    state.slots = result.slots || [];
    if (state.slotId && !state.slots.some(slot => slot.id === state.slotId)) state.slotId = '';
    savePrefs();
    bus.emit('slots');
  } catch (error) {
    state.slots = [];
    bus.emit('slots');
    if (!isAuthError(error)) fail(error, 'Could not load pickup times.');
  }
}

export function chooseSlot(slotId) {
  state.slotId = slotId;
  savePrefs();
  clearOrderAttempt();
  bus.emit('slots');
  bus.emit('basket');
}

/* ================= orders ================= */

export async function placeOrder() {
  const lines = basketLines();
  if (!lines.length || !state.slotId) return { ok: false };
  const key = orderAttemptKey();
  try {
    const result = await api.placeOrder({
      store_id: state.store.id,
      slot_id: state.slotId,
      items: lines.map(line => ({
        product_id: line.product.id,
        quantity: line.qty,
        expected_price_minor: state.quotes[line.product.id] ?? line.product.price_minor,
      })),
    }, key);
    state.basket = {}; state.quotes = {};
    state.slotId = '';
    saveBasketLocal();
    savePrefs();
    clearOrderAttempt();
    bus.emit('basket');
    await refreshOrders({ silent: true });
    return { ok: true, order: result.order };
  } catch (error) {
    if (error.status === 409) {
      // stock/price/slot changed — reconcile everything
      await Promise.all([refreshCatalog(), refreshSlots()]);
      bus.emit('basket');
    }
    fail(error);
    return { ok: false, error };
  }
}

export async function refreshOrders({ silent = true } = {}) {
  if (state.session.user?.role !== 'shopper') return;
  try {
    const result = await api.shopperOrders();
    state.orders = result.orders || [];
    state.ordersLoaded = true;
    bus.emit('orders');
  } catch (error) {
    if (!silent || !isAuthError(error)) fail(error, 'Could not load your orders.');
  }
}

export async function refreshOrder(orderId) {
  const result = await api.order(orderId);
  return result.order;
}

export async function cancelOrder(orderId, { seller = false } = {}) {
  try {
    await api.cancelOrder(orderId, seller ? 'Cancelled by the shop' : 'Cancelled before packing');
    toast('Order cancelled — stock and slot released.', 'success');
    if (seller) await refreshQueue({ silent: true });
    else await refreshOrders({ silent: true });
    return true;
  } catch (error) {
    fail(error);
    if (seller) await refreshQueue({ silent: true });
    return false;
  }
}

export async function reorder(orderId) {
  const order = state.orders.find(item => item.id === orderId);
  if (!order) return false;
  if (order.store_id !== state.store?.id) {
    await selectStore(order.store_id);
  }
  let added = 0;
  for (const item of order.items) {
    const product = state.products.find(row => row.id === item.product_id);
    if (!product || product.available <= 0 || !product.active) continue;
    const next = Math.min(Number(state.basket[product.id] || 0) + item.quantity, product.available);
    state.basket[product.id] = next;
    if (state.quotes[product.id] === undefined) state.quotes[product.id] = product.price_minor;
    added += 1;
  }
  saveBasketLocal();
  bus.emit('basket');
  if (!added) { toast('Those items are unavailable right now.', 'error'); return false; }
  queueBasketSync();
  toast('Items added at today’s prices — pick a new slot.', 'success');
  return true;
}

/* ================= saved ================= */

export async function refreshSaved({ silent = true } = {}) {
  if (state.session.user?.role !== 'shopper') return;
  try {
    const result = await api.saved();
    state.saved = result.products || [];
    state.savedLoaded = true;
    bus.emit('saved');
  } catch (error) {
    if (!silent || !isAuthError(error)) fail(error);
  }
}

export async function toggleSaved(productId, save) {
  if (state.session.user?.role !== 'shopper') return;
  try {
    const result = save ? await api.saveProduct(productId) : await api.unsaveProduct(productId);
    state.saved = result.products || [];
    state.savedLoaded = true;
    bus.emit('saved');
    bus.emit('catalog');
    toast(save ? 'Saved to your list' : 'Removed from saved items', 'success');
  } catch (error) {
    fail(error);
  }
}

/* ================= profile ================= */

export async function refreshProfile({ silent = true } = {}) {
  if (state.session.user?.role !== 'shopper') return;
  try {
    const result = await api.profile();
    state.profile = result.profile;
    bus.emit('profile');
  } catch (error) {
    if (!silent || !isAuthError(error)) fail(error);
  }
}

export async function updateProfile(displayName) {
  try {
    const result = await api.updateProfile({ display_name: displayName });
    state.profile = result.profile;
    bus.emit('profile');
    toast('Profile saved', 'success');
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

/* ================= seller ================= */

export async function refreshSellerStores() {
  if (state.session.user?.role !== 'seller') return [];
  try {
    const result = await api.sellerStores();
    state.seller.stores = result.stores || [];
    if (!state.seller.stores.length) {
      state.seller.store = null;
      state.seller.storeId = '';
      bus.emit('seller');
      return [];
    }
    const current = state.seller.stores.find(store => store.id === state.seller.storeId) || state.seller.stores[0];
    state.seller.store = current;
    state.seller.storeId = current.id;
    savePrefs();
    bus.emit('seller');
    return state.seller.stores;
  } catch (error) {
    if (!isAuthError(error)) fail(error, 'Could not load your shops.');
    return [];
  }
}

export async function selectSellerStore(storeId) {
  if (state.seller.storeId === storeId) return;
  state.seller.storeId = storeId;
  state.seller.store = state.seller.stores.find(store => store.id === storeId) || state.seller.store;
  state.seller.products = []; state.seller.productsLoaded = false;
  state.seller.orders = []; state.seller.ordersLoaded = false;
  state.seller.settings = null; state.seller.settingsLoaded = false;
  state.seller.seenOrderIds = new Set();
  state.seller.pickupCodeDrafts = new Map();
  savePrefs();
  bus.emit('seller');
  await Promise.all([refreshSellerProducts(), refreshQueue(), refreshSettings()]);
}

export async function refreshSellerProducts({ silent = true } = {}) {
  if (!state.seller.store) return;
  try {
    const result = await api.sellerProducts(state.seller.store.id);
    state.seller.products = result.products || [];
    state.seller.productsLoaded = true;
    bus.emit('seller');
  } catch (error) {
    if (!silent || !isAuthError(error)) fail(error, 'Could not load catalogue.');
  }
}

export async function sellerAdjustStock(productId, delta) {
  const product = state.seller.products.find(item => item.id === productId);
  if (!product) return;
  try {
    await api.sellerPatchProduct(productId, { on_hand: product.on_hand + delta });
    await refreshSellerProducts();
  } catch (error) {
    fail(error);
  }
}

export async function sellerToggleActive(productId) {
  const product = state.seller.products.find(item => item.id === productId);
  if (!product) return;
  try {
    await api.sellerPatchProduct(productId, { active: !product.active });
    await refreshSellerProducts();
    toast(product.active ? 'Hidden from shoppers' : 'Visible to shoppers again', 'success');
  } catch (error) {
    fail(error);
  }
}

export async function sellerSaveProduct(productId, body) {
  try {
    if (productId) {
      await api.sellerPatchProduct(productId, body);
      toast('Item updated', 'success');
    } else {
      await api.sellerCreateProduct(state.seller.store.id, body);
      toast('Item added to your shelf', 'success');
    }
    await refreshSellerProducts();
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

export async function refreshQueue({ silent = true } = {}) {
  if (!state.seller.store) return;
  const filters = state.seller.queueFilters;
  const apiFilters = {
    q: filters.q.trim(),
    date: filters.date,
    status: filters.status === 'active' ? '' : filters.status,
  };
  // "active" pseudo-tab needs all statuses; filter client-side
  try {
    const result = await api.sellerOrders(state.seller.store.id, apiFilters);
    let orders = result.orders || [];
    if (filters.status === 'active') orders = orders.filter(order => ['placed', 'packing', 'ready'].includes(order.status));
    // track arrivals for the new-order badge/toast
    const previous = state.seller.seenOrderIds;
    const arrived = orders.filter(order => order.status === 'placed' && !previous.has(order.id));
    state.seller.newOrderIds = new Set(arrived.map(order => order.id));
    if (previous.size === 0 && orders.length) {
      for (const order of orders) previous.add(order.id);
    } else if (arrived.length) {
      for (const order of arrived) previous.add(order.id);
      toast(`New order ${arrived[0].public_label} received`, 'success');
    }
    state.seller.orders = orders;
    state.seller.ordersLoaded = true;
    bus.emit('seller');
  } catch (error) {
    if (!silent || !isAuthError(error)) fail(error, 'Could not load the order queue.');
  }
}

export function setQueueFilters(partial) {
  Object.assign(state.seller.queueFilters, partial);
  return refreshQueue();
}

export async function sellerStartPacking(orderId) {
  try {
    await api.sellerStartPacking(orderId);
    toast('Packing started', 'success');
    await refreshQueue({ silent: true });
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

export async function sellerMarkReady(orderId, body) {
  try {
    await api.sellerMarkReady(orderId, body);
    toast('Bag marked ready for pickup', 'success');
    await refreshQueue({ silent: true });
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

export async function sellerCompletePickup(orderId, pickupCode) {
  try {
    await api.sellerCompletePickup(orderId, pickupCode);
    toast('Handover complete — order collected', 'success');
    await refreshQueue({ silent: true });
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

export async function refreshSettings({ silent = true } = {}) {
  if (!state.seller.store) return;
  try {
    const result = await api.sellerPickupSettings(state.seller.store.id);
    state.seller.settings = result.settings;
    state.seller.settingsLoaded = true;
    bus.emit('seller');
  } catch (error) {
    if (!silent || !isAuthError(error)) fail(error, 'Could not load pickup settings.');
  }
}

export async function saveSettings(body) {
  try {
    const result = await api.sellerUpdatePickupSettings(state.seller.store.id, body);
    state.seller.settings = result.settings;
    bus.emit('seller');
    toast('Pickup settings saved', 'success');
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

export async function sellerUpdateStore(body) {
  try {
    const result = await api.sellerUpdateStore(state.seller.store.id, body);
    state.seller.store = result.store;
    const match = state.seller.stores.find(store => store.id === result.store.id);
    if (match) Object.assign(match, result.store);
    bus.emit('seller');
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

export async function resetDemoData() {
  try {
    await api.resetDemo();
    toast('Sample data reset', 'success');
    state.seller.products = []; state.seller.productsLoaded = false;
    state.seller.orders = []; state.seller.ordersLoaded = false;
    await Promise.all([refreshSellerProducts({ silent: true }), refreshQueue({ silent: true }), refreshSellerStores()]);
  } catch (error) {
    fail(error);
  }
}

/* ================= background refresh ================= */

let pollTimer = null;
export function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    const user = state.session.user;
    if (!user) {
      refreshCatalog();
      refreshSlots();
      return;
    }
    if (user.role === 'shopper') {
      refreshCatalog();
      refreshSlots();
      refreshOrders();
    } else {
      refreshQueue();
    }
  }, 6000);
}
export function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
