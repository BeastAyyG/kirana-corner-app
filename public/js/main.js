// App bootstrap: shell chrome (headers + tab bars), route registration, boot.
import { BRAND, APP_VERSION } from './config.js';
import { state, bus, basketCount } from './state.js';
import { esc, icon, LOGO_BASKET, toast } from './ui.js';
import { route, startRouter, navigate, currentRoute } from './router.js';
import {
  loadSession, refreshStores, refreshCatalog, refreshSlots, refreshOrders, refreshSaved,
  refreshProfile, refreshSellerStores, startPolling, signOut,
} from './actions.js';
import { askConfirm } from './ui.js';

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

/* ---------- shell chrome ---------- */

const SHOPPER_TABS = [
  { hash: '#/home', icon: 'home', label: 'Home' },
  { hash: '#/categories', icon: 'grid', label: 'Categories' },
  { hash: '#/cart', icon: 'basket', label: 'Basket', badge: () => basketCount() },
  { hash: '#/orders', icon: 'receipt', label: 'Orders' },
  { hash: '#/account', icon: 'user', label: 'Account' },
];
const SELLER_TABS = [
  { hash: '#/seller', icon: 'store', label: 'Shop' },
  { hash: '#/seller/orders', icon: 'receipt', label: 'Orders', badge: () => state.seller.orders.filter(o => ['placed', 'packing', 'ready'].includes(o.status)).length },
  { hash: '#/seller/products', icon: 'box', label: 'Shelf' },
  { hash: '#/seller/settings', icon: 'gear', label: 'Settings' },
];

function chromeMode() {
  const hash = currentRoute();
  if (!state.session.user && (hash === '#/' || hash === '#/welcome')) return 'none';
  if (hash.startsWith('#/seller')) return state.session.user?.role === 'seller' ? 'seller' : 'none';
  return 'shopper';
}

export function renderChrome() {
  const mode = chromeMode();
  const app = document.getElementById('app');
  const header = document.getElementById('app-header');
  const tabbar = document.getElementById('app-tabbar');
  app.classList.toggle('seller-scope', mode === 'seller');

  if (mode === 'none') { header.hidden = true; tabbar.hidden = true; return; }

  // header
  header.hidden = false;
  const user = state.session.user;
  if (mode === 'seller') {
    const store = state.seller.store;
    header.className = 'app-header seller';
    header.innerHTML = `
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
  } else {
    const store = state.store;
    header.className = 'app-header';
    header.innerHTML = `
      <div class="header-row1">
        <button class="logo-lockup" data-go="#/home" aria-label="${esc(BRAND.name)} home">
          <span class="logo-mark">${LOGO_BASKET}</span>
          <span class="logo-text"><strong>${esc(BRAND.name)}</strong><small>SHOP NEARBY · PICK UP EASY</small></span>
        </button>
        <span class="header-spacer"></span>
        <button class="loc-pill" data-go="#/stores" aria-label="Choose your shop">
          ${icon('pin')}
          <span class="loc-copy">
            <span class="loc-name">${esc(store?.name || 'Choose a shop')}</span>
            <span class="loc-sub">${esc(store?.neighborhood || 'Tap to pick a neighbourhood shop')}</span>
          </span>
          ${icon('chevronDown')}
        </button>
      </div>
      <div class="header-row2">
        <button class="search-pill" data-go="#/search" aria-label="Search products">
          ${icon('search')}<span>Search milk, atta, veggies…</span>
        </button>
      </div>`;
  }

  // tab bar
  const tabs = mode === 'seller' ? SELLER_TABS : SHOPPER_TABS;
  tabbar.hidden = false;
  tabbar.innerHTML = tabs.map(tab => {
    const active = currentRoute() === tab.hash || (tab.hash === '#/home' && currentRoute() === '#/') || (tab.hash === '#/seller' && currentRoute() === '#/seller');
    const badgeValue = tab.badge ? tab.badge() : 0;
    return `<button class="tab ${active ? 'active' : ''}" data-go="${tab.hash}" aria-label="${tab.label}">
      ${icon(tab.icon)}<span>${tab.label}</span>
      ${badgeValue ? `<span class="tab-badge">${badgeValue > 99 ? '99+' : badgeValue}</span>` : ''}
    </button>`;
  }).join('');
}

/* ---------- global delegation ---------- */

function findProduct(productId) {
  return state.products.find(item => item.id === productId)
    || state.seller.products.find(item => item.id === productId);
}

document.addEventListener('click', async event => {
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

/* ---------- routes ---------- */

route('#/', { render: outlet => { navigate(state.session.user?.role === 'seller' ? '#/seller' : '#/welcome', { replace: true }); } });
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
