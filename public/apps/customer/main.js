// Customer app shell: chrome (header / tab bar / floating cluster), hash routing,
// auth gate, and global delegated events. Views render into #outlet.
import { api, setToken } from '../_shared/api.js';
import { createRouter } from '../_shared/router.js';
import { icon, LOGO_BASKET, toast, syncAddControls, esc } from '../_shared/ui.js';
import { money } from '../_shared/format.js';
import { handleImgError } from '../_shared/art.js';
import { state, bus, bootstrap, hasSession, signOut, changeQty, cartQty, cartCount, cartTotal, getProduct } from './state.js';
import { authView } from './views/auth.js';
import { homeView } from './views/home.js';
import { browseView } from './views/browse.js';
import { productView } from './views/product.js';
import { cartView } from './views/cart.js';
import { checkoutView } from './views/checkout.js';
import { trackView } from './views/track.js';
import { ordersView } from './views/orders.js';
import { accountView, addressesView, savedView, notificationsView } from './views/account.js';

const outlet = document.getElementById('outlet');
const header = document.getElementById('app-header');
const tabbar = document.getElementById('app-tabbar');

const TABS = [
  { path: '/', label: 'Home', icon: 'home', match: p => p === '/' },
  { path: '/browse', label: 'Browse', icon: 'grid', match: p => p.startsWith('/browse') || p.startsWith('/search') },
  { path: '/orders', label: 'Orders', icon: 'receipt', match: p => p.startsWith('/orders') || p.startsWith('/track') },
  { path: '/account', label: 'Account', icon: 'user', match: p => p.startsWith('/account') || p.startsWith('/saved') || p.startsWith('/addresses') || p.startsWith('/notifications') },
];
const CLUSTER_PATHS = p => p === '/' || p.startsWith('/browse') || p.startsWith('/search');
const TAB_ROOTS = p => p === '/' || p.startsWith('/browse') || p.startsWith('/search') || p === '/orders' || p === '/account';

/* ---------- floating cluster ---------- */
let cluster = null;
function ensureCluster() {
  if (cluster) return cluster;
  cluster = document.createElement('div');
  cluster.className = 'float-cluster';
  cluster.hidden = true;
  document.getElementById('app').appendChild(cluster);
  return cluster;
}
function renderCluster(path) {
  const el = ensureCluster();
  const show = CLUSTER_PATHS(path) && state.user;
  const count = cartCount();
  const active = state.activeOrder;
  if (!show || (count === 0 && !active)) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const orderPill = active ? `
    <button class="order-pill" data-nav="/track/${esc(active.id)}">
      <span class="op-gauge"><strong>${active.eta_live_minutes ?? active.eta_promise_minutes ?? '•'}</strong><small>MIN</small></span>
      <span class="op-label">${esc(active.status === 'picked_up' ? 'Arriving soon' : 'Order in progress')}</span>
      ${icon('chevronRight', 'op-chev')}
    </button>` : '';
  const cartPill = count > 0 ? `
    <button class="cart-pill" data-nav="/cart">
      ${icon('basket')}<span class="cp-count">${count} item${count === 1 ? '' : 's'}</span>
      <span class="cp-total">${money(cartTotal())}</span>${icon('chevronRight', 'cp-arrow')}
    </button>` : '';
  el.innerHTML = orderPill + cartPill;
}

/* ---------- header ---------- */
function shopperHeader() {
  const eta = state.serviceability;
  const etaText = eta?.serviceable ? (eta.promise || `${eta.eta_minutes} min`) : 'Set delivery location';
  const addr = state.address;
  const addrText = addr ? (addr.label ? `${addr.label} · ${addr.line1}` : addr.line1) : 'Add a delivery address';
  return `
    <div class="header-row1">
      <button class="eta-block" data-nav="/addresses" aria-label="Change delivery address">
        <span class="eta-line">${icon('bolt')}<span class="eta-strong">${esc(etaText)}</span></span>
        <span class="addr-row">${icon('pin')}<span class="addr-text">${esc(addrText)}</span>${icon('chevronDown', 'addr-chev')}</span>
      </button>
      <span class="header-spacer"></span>
      <button class="profile-btn" data-nav="/account" aria-label="Your account">${icon('user')}</button>
    </div>
    <div class="header-row2">
      <button class="search-pill" data-nav="/search" aria-label="Search products">
        ${icon('search')}<span>Search "milk", "atta", "snacks"…</span>
      </button>
      <button class="list-btn" data-nav="/saved" aria-label="Saved items">${icon('heart')}${state.saved.size ? `<span class="badge-dot">${state.saved.size}</span>` : ''}</button>
    </div>`;
}
function titleHeader(title, { back = false, action = '' } = {}) {
  return `<div class="header-row1 detail-head">
    ${back ? `<button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button>` : `<span class="logo-mark">${LOGO_BASKET}</span>`}
    <h1 class="head-title">${esc(title)}</h1>${action}
  </div>`;
}
function renderChrome(path) {
  if (!state.user || path === '/auth') { header.hidden = true; header.innerHTML = ''; tabbar.hidden = true; tabbar.innerHTML = ''; renderCluster(path); return; }
  header.hidden = false;
  if (path === '/' || path.startsWith('/browse') || path.startsWith('/search')) {
    header.className = 'app-header shopper';
    header.innerHTML = shopperHeader();
  } else if (path === '/orders') {
    header.className = 'app-header';
    header.innerHTML = titleHeader('Your orders', { action: `<button class="icon-btn" data-nav="/notifications" aria-label="Notifications">${icon('chat')}</button>` });
  } else if (path === '/account') {
    header.className = 'app-header';
    header.innerHTML = titleHeader('Your account');
  } else if (path.startsWith('/product')) {
    header.className = 'app-header';
    header.innerHTML = titleHeader('Product details', { back: true, action: `<button class="icon-btn" data-nav="/cart" aria-label="Cart">${icon('basket')}</button>` });
  } else if (path === '/cart') {
    header.className = 'app-header';
    header.innerHTML = titleHeader('Your basket', { back: true });
  } else if (path === '/checkout') {
    header.className = 'app-header';
    header.innerHTML = titleHeader('Checkout', { back: true });
  } else if (path.startsWith('/track')) {
    header.className = 'app-header';
    header.innerHTML = titleHeader('Track order', { back: true, action: `<button class="icon-btn" data-nav="/orders" aria-label="All orders">${icon('receipt')}</button>` });
  } else if (path === '/saved') {
    header.className = 'app-header';
    header.innerHTML = titleHeader('Saved items', { back: true });
  } else if (path === '/addresses') {
    header.className = 'app-header';
    header.innerHTML = titleHeader('Delivery addresses', { back: true });
  } else if (path === '/notifications') {
    header.className = 'app-header';
    header.innerHTML = titleHeader('Notifications', { back: true });
  } else {
    header.className = 'app-header shopper';
    header.innerHTML = shopperHeader();
  }
  // tab bar only on tab roots
  if (TAB_ROOTS(path)) {
    tabbar.hidden = false;
    tabbar.innerHTML = TABS.map(tab => `
      <button class="tab ${tab.match(path) ? 'active' : ''}" data-nav="${tab.path}" aria-current="${tab.match(path) ? 'page' : 'false'}">
        <span class="tab-ico">${icon(tab.icon)}${tab.path === '/orders' && state.activeOrder ? '<span class="tab-badge">1</span>' : ''}</span>
        <span>${tab.label}</span>
      </button>`).join('');
  } else {
    tabbar.hidden = true; tabbar.innerHTML = '';
  }
  renderCluster(path);
}

/* ---------- router ---------- */
const router = createRouter({
  fallback: '/',
  onNavigate: ({ path }) => {
    renderChrome(path);
    outlet.classList.remove('page-enter');
    void outlet.offsetWidth;
    outlet.classList.add('page-enter');
    window.scrollTo(0, 0);
  },
});
const guard = handler => async (params, query, path) => {
  if (!state.user) { router.navigate('/auth', { replace: true }); return; }
  return handler(outlet, params, query, { router, path });
};
router
  .add('/auth', (p, q) => authView(outlet, p, q, { router }))
  .add('/', guard(homeView))
  .add('/browse', guard(browseView))
  .add('/browse/:cat', guard(browseView))
  .add('/search', guard(browseView))
  .add('/product/:id', guard(productView))
  .add('/cart', guard(cartView))
  .add('/checkout', guard(checkoutView))
  .add('/track/:id', guard(trackView))
  .add('/orders', guard(ordersView))
  .add('/account', guard(accountView))
  .add('/addresses', guard(addressesView))
  .add('/saved', guard(savedView))
  .add('/notifications', guard(notificationsView));

/* ---------- global delegated events ---------- */
function wireGlobal() {
  const app = document.getElementById('app');
  app.addEventListener('click', async event => {
    const nav = event.target.closest('[data-nav]');
    if (nav) { event.preventDefault(); router.navigate(nav.dataset.nav); return; }
    const back = event.target.closest('[data-back]');
    if (back) { event.preventDefault(); if (history.length > 1) history.back(); else router.navigate('/'); return; }
    const open = event.target.closest('[data-open-product]');
    if (open) { event.preventDefault(); router.navigate(`/product/${open.dataset.openProduct}`); return; }
    const plus = event.target.closest('[data-qty-plus]');
    const minus = event.target.closest('[data-qty-minus]');
    if (plus || minus) {
      event.preventDefault();
      const id = (plus || minus).dataset.qtyPlus || (plus || minus).dataset.qtyMinus;
      const delta = plus ? 1 : -1;
      const btn = plus || minus;
      btn.disabled = true;
      try {
        await changeQty(id, delta);
        const product = getProduct(id) || state.cart.items.find(i => i.id === id);
        if (product) syncAddControls(id, product, cartQty(id));
        renderCluster(router.current?.path || '/');
        bus.emit('qty', { id, qty: cartQty(id) });
      } catch (error) {
        toast(error.message || 'Could not update basket', 'error');
        btn.disabled = false;
      }
      return;
    }
  });
  // CSP-safe image fallback (capture phase: error events don't bubble)
  app.addEventListener('error', event => {
    const img = event.target;
    if (img?.tagName === 'IMG' && img.dataset.artId !== undefined) handleImgError(img);
  }, true);

  bus.on('cart', () => renderCluster(router.current?.path || '/'));
  bus.on('saved', () => { if (router.current) renderChrome(router.current.path); });
  bus.on('store', () => { if (router.current) renderChrome(router.current.path); });
  bus.on('address', () => { if (router.current) renderChrome(router.current.path); });
  bus.on('order', order => { state.activeOrder = order; renderCluster(router.current?.path || '/'); });
}

/* ---------- active order polling (lightweight) ---------- */
let orderTimer = null;
async function pollActiveOrder() {
  if (!state.user) return;
  try {
    const res = await api.orders();
    const list = res.orders || [];
    const live = list.find(o => !['delivered', 'cancelled'].includes(o.status));
    state.activeOrder = live || null;
    renderCluster(router.current?.path || '/');
    if (router.current?.path === '/orders') bus.emit('orders-refresh');
  } catch { /* ignore */ }
}

/* ---------- init ---------- */
async function init() {
  wireGlobal();
  if (hasSession()) {
    try { await bootstrap(); }
    catch { signOut(); }
  }
  router.start();
  if (state.user) {
    pollActiveOrder();
    orderTimer = setInterval(pollActiveOrder, 15000);
  }
  bus.on('ready', () => {
    pollActiveOrder();
    if (!orderTimer) orderTimer = setInterval(pollActiveOrder, 15000);
  });
  bus.on('signout', () => { if (orderTimer) { clearInterval(orderTimer); orderTimer = null; } });
}
init();

export { router };