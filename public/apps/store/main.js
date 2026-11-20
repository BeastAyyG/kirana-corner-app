// Store / picker app shell: dark-green seller chrome, hash routing, role gate,
// delegated events, 10s queue polling (new orders are NOT pushed to pickers)
// and a global SSE stream for low-stock alerts. Views render into #outlet.
import { openStream } from '../_shared/api.js';
import { createRouter } from '../_shared/router.js';
import { icon, toast, esc, sheet } from '../_shared/ui.js';
import { handleImgError } from '../_shared/art.js';
import { state, bus, bootstrap, hasSession, signOut, selectStore, newOrderCount } from './state.js';
import { authView } from './views/auth.js';
import { queueView } from './views/queue.js';
import { orderView } from './views/order.js';
import { inventoryView } from './views/inventory.js';
import { metricsView } from './views/metrics.js';
import { settingsView } from './views/settings.js';

const outlet = document.getElementById('outlet');
const header = document.getElementById('app-header');
const tabbar = document.getElementById('app-tabbar');

const QUEUE_POLL_MS = 10000;

const TABS = [
  { path: '/', label: 'Queue', icon: 'receipt', match: p => p === '/' || p.startsWith('/order') },
  { path: '/inventory', label: 'Inventory', icon: 'box', match: p => p.startsWith('/inventory') },
  { path: '/metrics', label: 'Metrics', icon: 'wallet', match: p => p.startsWith('/metrics') },
  { path: '/settings', label: 'Settings', icon: 'gear', match: p => p.startsWith('/settings') },
];
const TAB_ROOTS = p => p === '/' || p === '/inventory' || p === '/metrics' || p === '/settings';

/* ---------- header ---------- */
function storePill() {
  const s = state.store;
  if (!s) return '<span class="pill pill-gray">No store</span>';
  if (!s.is_open) return '<span class="pill pill-gray">Closed</span>';
  if (!s.accepting_orders) return '<span class="pill pill-amber">Open · paused</span>';
  return '<span class="pill pill-green">Open · accepting</span>';
}
function sellerHeader() {
  const name = state.store?.name || 'Kirana Corner';
  const picker = state.user?.name || 'Picker';
  const switcher = state.stores.length > 1
    ? `<button class="icon-btn store-switch-btn" data-store-switch aria-label="Switch store">${icon('chevronDown')}</button>` : '';
  return `
    <div class="header-row1">
      <span class="logo-mark">${icon('store')}</span>
      <span class="seller-id"><strong>${esc(name)}</strong><small>Picker · ${esc(picker)}</small></span>
      <span class="header-spacer"></span>
      <span class="head-pills">${storePill()}</span>
      ${switcher}
    </div>`;
}
function detailHeader(title) {
  return `<div class="header-row1 detail-head">
    <button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button>
    <h1 class="head-title">${esc(title)}</h1>
  </div>`;
}
function renderChrome(path) {
  if (!state.user || path === '/auth') {
    header.hidden = true; header.innerHTML = '';
    tabbar.hidden = true; tabbar.innerHTML = '';
    return;
  }
  header.hidden = false;
  header.className = 'app-header seller';
  header.innerHTML = path.startsWith('/order') ? detailHeader('Pick & pack') : sellerHeader();
  if (TAB_ROOTS(path)) {
    const fresh = newOrderCount();
    tabbar.hidden = false;
    tabbar.innerHTML = TABS.map(tab => `
      <button class="tab ${tab.match(path) ? 'active' : ''}" data-nav="${tab.path}" aria-current="${tab.match(path) ? 'page' : 'false'}">
        <span class="tab-ico">${icon(tab.icon)}${tab.path === '/' && fresh ? `<span class="tab-badge">${fresh}</span>` : ''}</span>
        <span>${tab.label}</span>
      </button>`).join('');
  } else {
    tabbar.hidden = true; tabbar.innerHTML = '';
  }
}

/* ---------- store switcher ---------- */
async function openStoreSheet() {
  const promise = sheet(`
    <div class="store-sheet">
      ${state.stores.map(s => `
        <button class="addr-card" data-store-id="${esc(s.id)}" aria-pressed="${s.id === state.store?.id}">
          <span class="ad-ico">${icon('store')}</span>
          <span class="ad-main"><strong>${esc(s.name)}</strong><span>${esc(s.address)} · ${esc(s.city)}</span></span>
          <span class="ad-check">${icon('check')}</span>
        </button>`).join('')}
    </div>`, { title: 'Switch store' });
  const host = document.getElementById('sheet-host');
  host.querySelectorAll('[data-store-id]').forEach(btn => btn.addEventListener('click', () => {
    selectStore(btn.dataset.storeId);
    host.querySelector('[data-sheet-close]')?.click();
    renderChrome(router.current?.path || '/');
    router.refresh();
  }));
  await promise;
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
  if (!state.user || state.user.role !== 'picker') { router.navigate('/auth', { replace: true }); return; }
  return handler(outlet, params, query, { router, path });
};
router
  .add('/auth', (p, q) => authView(outlet, p, q, { router }))
  .add('/', guard(queueView))
  .add('/order/:id', guard(orderView))
  .add('/inventory', guard(inventoryView))
  .add('/metrics', guard(metricsView))
  .add('/settings', guard(settingsView));

/* ---------- global delegated events ---------- */
function wireGlobal() {
  const app = document.getElementById('app');
  app.addEventListener('click', event => {
    const nav = event.target.closest('[data-nav]');
    if (nav) { event.preventDefault(); router.navigate(nav.dataset.nav); return; }
    const back = event.target.closest('[data-back]');
    if (back) { event.preventDefault(); if (history.length > 1) history.back(); else router.navigate('/'); return; }
    const switcher = event.target.closest('[data-store-switch]');
    if (switcher) { event.preventDefault(); openStoreSheet(); }
  });
  // CSP-safe image fallback (capture phase: error events don't bubble)
  app.addEventListener('error', event => {
    const img = event.target;
    if (img?.tagName === 'IMG' && img.dataset.artId !== undefined) handleImgError(img);
  }, true);

  bus.on('queue', () => { if (router.current) renderChrome(router.current.path); });
  bus.on('store', () => { if (router.current) renderChrome(router.current.path); });
}

/* ---------- queue polling (pickers are not pushed new orders) ---------- */
function startPolling() {
  setInterval(() => {
    if (state.user && router.current?.path === '/') bus.emit('queue-tick');
  }, QUEUE_POLL_MS);
}

/* ---------- global SSE: low-stock alerts ---------- */
let stream = null;
function openGlobalStream() {
  if (!state.user || stream) return;
  stream = openStream({
    events: ['notification', 'inventory.low_stock'],
    onEvent: (name, data) => {
      if (name === 'inventory.low_stock') {
        toast(`${data?.name || 'An item'} is running low (${data?.available ?? 0} left)`, 'default', 3200);
        bus.emit('low-stock', data);
      } else if (name === 'notification') {
        bus.emit('queue-tick');
      }
    },
  });
}

/* ---------- init ---------- */
async function init() {
  wireGlobal();
  if (hasSession()) {
    try { await bootstrap(); }
    catch { signOut(); }
  }
  router.start();
  openGlobalStream();
  startPolling();
  bus.on('ready', openGlobalStream);
  bus.on('signout', () => { if (stream) { stream.close(); stream = null; } });
}
init();

export { router };