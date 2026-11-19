// Admin app shell: persistent desktop chrome (dark-green side nav + main),
// hash routing with an admin-only guard, delegated events, notification SSE,
// and the CSP-safe image fallback. Views render into #outlet.
import { api, openStream } from '../_shared/api.js';
import { createRouter } from '../_shared/router.js';
import { icon, LOGO_BASKET, toast, esc, askConfirm } from '../_shared/ui.js';
import { handleImgError } from '../_shared/art.js';
import { state, bus, bootstrap, hasSession, signOut } from './state.js';
import { authView } from './views/auth.js';
import { overviewView } from './views/overview.js';
import { ordersView } from './views/orders.js';
import { storesView } from './views/stores.js';
import { usersView } from './views/users.js';
import { couponsView } from './views/coupons.js';
import { auditView } from './views/audit.js';

const app = document.getElementById('app');
const outlet = document.getElementById('outlet');
const header = document.getElementById('app-header');
const tabbar = document.getElementById('app-tabbar');

const NAV = [
  { path: '/', label: 'Overview', icon: 'grid' },
  { path: '/orders', label: 'Orders', icon: 'receipt' },
  { path: '/stores', label: 'Stores', icon: 'store' },
  { path: '/users', label: 'Users', icon: 'user' },
  { path: '/coupons', label: 'Coupons', icon: 'gift' },
  { path: '/audit', label: 'Audit log', icon: 'shield' },
];

/* ---------- persistent layout ---------- */
let layout = null;
let side = null;

function buildLayout() {
  if (layout) return;
  layout = document.createElement('div');
  layout.className = 'admin-layout';
  side = document.createElement('aside');
  side.className = 'admin-side';
  const main = document.createElement('div');
  main.className = 'admin-main';
  main.appendChild(outlet);
  layout.append(side, main);
  app.appendChild(layout);
}

function teardownLayout() {
  if (!layout) return;
  app.insertBefore(outlet, tabbar);
  layout.remove();
  layout = null;
  side = null;
}

function renderSide(path) {
  const name = state.user?.name || 'Ops Admin';
  const initial = name.charAt(0).toUpperCase();
  side.innerHTML = `
    <div class="as-logo"><span class="logo-mark">${LOGO_BASKET}</span><strong>Kirana Ops</strong></div>
    ${NAV.map(item => `
      <button class="admin-nav ${item.path === path ? 'active' : ''}" data-nav="${item.path}" aria-current="${item.path === path ? 'page' : 'false'}">
        ${icon(item.icon)}<span>${item.label}</span>
      </button>`).join('')}
    <div class="as-foot">
      <div class="as-user">
        <span class="as-avatar">${esc(initial)}</span>
        <div><strong>${esc(name)}</strong><small>Administrator</small></div>
      </div>
      <button class="as-signout" data-signout>${icon('logout')} Sign out</button>
    </div>`;
}

function renderChrome(path) {
  header.hidden = true; header.innerHTML = '';
  tabbar.hidden = true; tabbar.innerHTML = '';
  if (!state.user || path === '/auth') { teardownLayout(); return; }
  buildLayout();
  renderSide(path);
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
  if (!state.user || state.user.role !== 'admin') { router.navigate('/auth', { replace: true }); return; }
  return handler(outlet, params, query, { router, path });
};

router
  .add('/auth', (p, q) => authView(outlet, p, q, { router }))
  .add('/', guard(overviewView))
  .add('/orders', guard(ordersView))
  .add('/stores', guard(storesView))
  .add('/users', guard(usersView))
  .add('/coupons', guard(couponsView))
  .add('/audit', guard(auditView));

/* ---------- global delegated events ---------- */
function wireGlobal() {
  app.addEventListener('click', async event => {
    const nav = event.target.closest('[data-nav]');
    if (nav) { event.preventDefault(); router.navigate(nav.dataset.nav); return; }
    const back = event.target.closest('[data-back]');
    if (back) { event.preventDefault(); if (history.length > 1) history.back(); else router.navigate('/'); return; }
    const out = event.target.closest('[data-signout]');
    if (out) {
      event.preventDefault();
      const ok = await askConfirm({ title: 'Sign out?', message: 'You will need an OTP to sign back in.', confirmLabel: 'Sign out' });
      if (!ok) return;
      try { await api.logout(); } catch { /* session may already be gone */ }
      signOut();
      router.navigate('/auth', { replace: true });
    }
  });
  // CSP-safe image fallback (capture phase: error events don't bubble)
  app.addEventListener('error', event => {
    const img = event.target;
    if (img?.tagName === 'IMG' && img.dataset.artId !== undefined) handleImgError(img);
  }, true);
}

/* ---------- notification SSE (user:<adminId> channel) ---------- */
let notifyStream = null;
function startNotifyStream() {
  if (notifyStream || !state.user) return;
  notifyStream = openStream({
    events: ['notification'],
    onEvent: (name, data) => {
      if (name === 'notification' && data?.title) toast(data.title, 'default');
    },
  });
}
function stopNotifyStream() {
  notifyStream?.close();
  notifyStream = null;
}

/* ---------- init ---------- */
async function init() {
  wireGlobal();
  if (hasSession()) {
    try { await bootstrap(); } catch { signOut(); }
  }
  router.start();
  startNotifyStream();
  bus.on('ready', startNotifyStream);
  bus.on('signout', stopNotifyStream);
}
init();

export { router };