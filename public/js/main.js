// App bootstrap: shell chrome (bbnow header + tab bar + floating cluster),
// route registration, global delegation, boot.
import { BRAND, APP_VERSION } from './config.js';
import { state, bus, basketCount } from './state.js';
import { esc, icon, LOGO_BASKET, toast, askConfirm } from './ui.js';
import { handleImgError } from './art.js';
import { route, startRouter, navigate, currentRoute } from './router.js';
import {
  loadSession, refreshStores, refreshCatalog, refreshSlots, refreshOrders, refreshSaved,
  refreshProfile, refreshSellerStores, startPolling, signOut,
} from './actions.js';

import { renderWelcome } from './views/welcome.js';
import { renderHome } from './views/home.js';
import { renderCategories } from './views/categories.js';
import { renderBrowse } from './views/browse.js';
import { renderProduct } from './views/product.js';
import { renderStores } from './views/stores.js';
import { renderSearch } from './views/search.js';
import { renderCart } from './views/cart.js';
import { renderOrders } from './views/orders.js';
import { renderOrderDetail } from './views/order.js';
import { renderSaved } from './views/saved.js';
import { renderAccount } from './views/account.js';
import { renderSellerHome } from './views/seller-home.js';
import { renderSellerOrders } from './views/seller-orders.js';
import { renderSellerProducts } from './views/seller-products.js';
import { renderSellerSettings } from './views/seller-settings.js';

const HAS_VOICE = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

/* ---------- shell chrome ---------- */

const SHOPPER_TABS = [
  { hash: '#/home', icon: 'home', label: 'Home' },
  { hash: '#/categories', icon: 'grid', label: 'Categories' },
  { hash: '#/orders', icon: 'receipt', label: 'Orders' },
  { hash: '#/account', icon: 'user', label: 'Account' },
];
const SELLER_TABS = [
  { hash: '#/seller', icon: 'store', label: 'Shop' },
  { hash: '#/seller/orders', icon: 'receipt', label: 'Orders', badge: () => state.seller.orders.filter(o => ['placed', 'packing', 'ready'].includes(o.status)).length },
  { hash: '#/seller/products', icon: 'box', label: 'Shelf' },
  { hash: '#/seller/settings', icon: 'gear', label: 'Settings' },
];

// screens that carry the floating order/cart cluster (bbnow §5.7)
const CLUSTER_ROUTES = new Set(['#/home', '#/categories', '#/search', '#/saved']);
function clusterVisible() {
  const hash = currentRoute();
  return CLUSTER_ROUTES.has(hash) || hash.startsWith('#/c/');
}

function chromeMode() {
  const hash = currentRoute();
  if (!state.session.user && (hash === '#/' || hash === '#/welcome')) return 'none';
  if (hash.startsWith('#/seller')) return state.session.user?.role === 'seller' ? 'seller' : 'none';
  return 'shopper';
}

function activeOrder() {
  return state.orders.find(order => ['placed', 'packing', 'ready'].includes(order.status)) || null;
}

function shopperHeaderHtml() {
  const store = state.store;
  const open = Boolean(store?.is_open);
  const etaText = !store ? 'Choose a shop' : open ? 'Pickup in 30 min' : 'Shop closed';
  const etaIcon = open ? 'bolt' : 'clock';
  const addr = store ? `${store.name} · ${store.neighborhood}` : 'Tap to pick a neighbourhood shop';
  const count = basketCount();
  return `
    <div class="header-row1">
      <div class="eta-block">
        <span class="eta-line">${icon(etaIcon)}<span class="eta-strong">${esc(etaText)}</span></span>
        <button class="addr-row" data-go="#/stores" aria-label="Choose your shop">
          ${icon('home')}<span class="addr-text">${esc(addr)}</span>${icon('chevronDown', 'addr-chev')}
        </button>
      </div>
      <span class="header-spacer"></span>
      <button class="profile-btn" data-go="#/account" aria-label="Your account">${icon('user')}</button>
    </div>
    <div class="header-row2">
      <div class="search-pill">
        <button class="search-main" data-go="#/search" aria-label="Search products">
          ${icon('search')}<span>Search milk, atta, veggies…</span>
        </button>
        ${HAS_VOICE ? `<button class="mic-btn" data-mic aria-label="Search by voice">${icon('mic')}</button>` : ''}
      </div>
      <button class="list-btn" data-go="#/saved" aria-label="Saved lists and basket">
        ${icon('list')}
        ${count ? `<span class="badge-dot pop">${count > 99 ? '99+' : count}</span>` : ''}
      </button>
    </div>`;
}

function sellerHeaderHtml() {
  const store = state.seller.store;
  const user = state.session.user;
  return `
    <div class="header-row1">
      <button class="logo-lockup" data-go="#/seller">
        <span class="logo-mark">${LOGO_BASKET}</span>
        <span class="logo-text"><strong>${esc(BRAND.partnerName)}</strong><small>SHOPKEEPER APP</small></span>
      </button>
      <span class="header-spacer"></span>
      <button class="loc-pill" data-go="#/seller/settings" aria-label="Shop settings">
        ${icon('store')}
        <span class="loc-copy">
          <span class="loc-name">${esc(store?.name || 'No shop linked')}</span>
          <span class="loc-sub">${store?.is_open ? 'Open for pickup' : 'Closed'}</span>
        </span>
      </button>
      ${user ? `<button class="icon-btn" data-signout aria-label="Sign out">${icon('logout')}</button>` : ''}
    </div>`;
}

function clusterHtml() {
  const order = activeOrder();
  const count = basketCount();
  if (!order && !count) return '';
  const statusLabel = order ? ({ placed: 'Order placed', packing: 'Packing your bag', ready: 'Ready for pickup' }[order.status] || 'Order') : '';
  return `
    ${order ? `<button class="order-pill" data-go="#/order/${esc(order.id)}" aria-label="Track your order">
      <span class="op-gauge">${icon('bag')}</span>
      <span class="op-label">${esc(statusLabel)}</span>
      ${icon('chevronRight', 'op-chev')}
    </button>` : '<span></span>'}
    ${count ? `<button class="cart-pill" data-go="#/cart" aria-label="View basket, ${count} items">
      ${icon('basket')}<span class="cp-count">${count}</span>${icon('arrowRight', 'cp-arrow')}
    </button>` : ''}`;
}

function ensureClusterHost() {
  let host = document.getElementById('float-cluster');
  if (!host) {
    host = document.createElement('div');
    host.id = 'float-cluster';
    host.className = 'float-cluster';
    host.hidden = true;
    document.getElementById('app').appendChild(host);
  }
  return host;
}

export function renderChrome() {
  const mode = chromeMode();
  const app = document.getElementById('app');
  const header = document.getElementById('app-header');
  const tabbar = document.getElementById('app-tabbar');
  const cluster = ensureClusterHost();
  app.classList.toggle('seller-scope', mode === 'seller');

  if (mode === 'none') {
    header.hidden = true; tabbar.hidden = true; cluster.hidden = true;
    return;
  }

  header.hidden = false;
  if (mode === 'seller') {
    header.className = 'app-header seller';
    header.innerHTML = sellerHeaderHtml();
  } else {
    header.className = 'app-header';
    header.innerHTML = shopperHeaderHtml();
  }

  const tabs = mode === 'seller' ? SELLER_TABS : SHOPPER_TABS;
  tabbar.hidden = false;
  tabbar.innerHTML = tabs.map(tab => {
    const active = currentRoute() === tab.hash || (tab.hash === '#/home' && currentRoute() === '#/');
    const badgeValue = tab.badge ? tab.badge() : 0;
    return `<button class="tab ${active ? 'active' : ''}" data-go="${tab.hash}" aria-label="${tab.label}">
      <span class="tab-ico">${icon(tab.icon)}</span><span>${tab.label}</span>
      ${badgeValue ? `<span class="tab-badge">${badgeValue > 99 ? '99+' : badgeValue}</span>` : ''}
    </button>`;
  }).join('');

  // floating cluster only on shopper shopping screens
  if (mode === 'shopper' && clusterVisible()) {
    const html = clusterHtml();
    cluster.innerHTML = html;
    cluster.hidden = !html;
  } else {
    cluster.hidden = true;
  }
}

/* ---------- global delegation ---------- */

function startVoiceSearch() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice search is not supported here — type instead'); return; }
  const rec = new SR();
  rec.lang = 'en-IN';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  toast('Listening… say a product name');
  rec.onresult = event => {
    const text = event.results?.[0]?.[0]?.transcript || '';
    if (text.trim()) navigate(`#/search?q=${encodeURIComponent(text.trim())}`);
  };
  rec.onerror = () => toast('Could not hear that — try typing instead', 'error');
  try { rec.start(); } catch { /* recognition already running */ }
}

document.addEventListener('click', async event => {
  const mic = event.target.closest('[data-mic]');
  if (mic) { event.preventDefault(); startVoiceSearch(); return; }
  const go = event.target.closest('[data-go]');
  if (go) { navigate(go.dataset.go); return; }
  const signout = event.target.closest('[data-signout]');
  if (signout) {
    const ok = await askConfirm({ title: 'Sign out?', message: 'You will need to sign in again to see your orders.', confirmLabel: 'Sign out', danger: true });
    if (ok) { await signOut(); navigate('#/welcome', { replace: true }); }
    return;
  }
  const plus = event.target.closest('[data-qty-plus]');
  if (plus) {
    const { changeQty } = await import('./basket-ops.js');
    changeQty(plus.dataset.qtyPlus, +1);
    return;
  }
  const minus = event.target.closest('[data-qty-minus]');
  if (minus) {
    const { changeQty } = await import('./basket-ops.js');
    changeQty(minus.dataset.qtyMinus, -1);
    return;
  }
  const save = event.target.closest('[data-toggle-save]');
  if (save) {
    const { toggleSaved } = await import('./actions.js');
    if (state.session.user?.role !== 'shopper') {
      toast('Sign in as a shopper to save items');
      navigate('#/welcome');
      return;
    }
    const isSaved = state.saved.some(item => item.product_id === save.dataset.toggleSave);
    await toggleSaved(save.dataset.toggleSave, !isSaved);
    return;
  }
  const open = event.target.closest('[data-open-product]');
  if (open) { navigate(`#/p/${open.dataset.openProduct}`); return; }
});

// CSP-safe image fallback: capture phase catches error events that do not bubble.
document.addEventListener('error', event => {
  const img = event.target;
  if (img && img.tagName === 'IMG') handleImgError(img);
}, true);

/* ---------- routes ---------- */

route('#/', { render: () => { navigate(state.session.user?.role === 'seller' ? '#/seller' : '#/welcome', { replace: true }); } });
route('#/welcome', renderWelcome);
route('#/home', renderHome);
route('#/categories', renderCategories);
route('#/c/:category', renderBrowse);
route('#/p/:productId', renderProduct);
route('#/stores', renderStores);
route('#/search', renderSearch);
route('#/cart', renderCart);
route('#/orders', renderOrders);
route('#/order/:orderId', renderOrderDetail);
route('#/saved', renderSaved);
route('#/account', renderAccount);
route('#/seller', renderSellerHome);
route('#/seller/orders', renderSellerOrders);
route('#/seller/products', renderSellerProducts);
route('#/seller/settings', renderSellerSettings);

bus.on('session', renderChrome);
bus.on('stores', renderChrome);
bus.on('seller', renderChrome);
bus.on('basket', renderChrome);
bus.on('orders', renderChrome);
window.addEventListener('hashchange', renderChrome);

/* ---------- boot ---------- */

async function boot() {
  renderChrome();
  await loadSession();
  const user = state.session.user;
  if (user?.role === 'shopper') {
    await refreshStores();
    await refreshCatalog();
    await Promise.all([refreshOrders(), refreshSaved(), refreshProfile()]);
    startPolling();
    navigate('#/home', { replace: true });
  } else if (user?.role === 'seller') {
    await refreshSellerStores();
    startPolling();
    navigate('#/seller', { replace: true });
  } else {
    await refreshStores();
    await refreshCatalog();
    startPolling();
    navigate('#/welcome', { replace: true });
  }
  startRouter(document.getElementById('outlet'));
  renderChrome();
}

boot().catch(error => {
  console.error(error);
  toast('The app failed to start. Refresh the page.', 'error');
});

/* ---------- PWA ---------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline shell unavailable */ });
  });
}