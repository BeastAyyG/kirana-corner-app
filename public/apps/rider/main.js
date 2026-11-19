// Rider app shell: dark-green top bar, 3-tab chrome, hash routing, role gate,
// delegated events, availability toggle and the online location ping.
import { api } from '../_shared/api.js';
import { createRouter } from '../_shared/router.js';
import { icon, toast, esc } from '../_shared/ui.js';
import { money } from '../_shared/format.js';
import { handleImgError } from '../_shared/art.js';
import { state, bus, bootstrap, hasSession, signOut, setOnline, refreshJobs, refreshEarnings, offeredJobs } from './state.js';
import { authView } from './views/auth.js';
import { homeView } from './views/home.js';
import { jobView } from './views/job.js';
import { earningsView } from './views/earnings.js';
import { accountView } from './views/account.js';

const outlet = document.getElementById('outlet');
const header = document.getElementById('app-header');
const tabbar = document.getElementById('app-tabbar');

const TABS = [
  { path: '/', label: 'Jobs', icon: 'bike', match: p => p === '/' || p.startsWith('/job') },
  { path: '/earnings', label: 'Earnings', icon: 'wallet', match: p => p.startsWith('/earnings') },
  { path: '/account', label: 'Account', icon: 'user', match: p => p.startsWith('/account') },
];
const TAB_ROOTS = p => p === '/' || p === '/earnings' || p === '/account';

/* ---------- chrome ---------- */
function riderTopBar() {
  const rider = state.rider;
  const initial = (rider?.name || state.user?.name || 'R').charAt(0).toUpperCase();
  const today = state.earnings?.today;
  return `
    <div class="rt-row">
      <span class="rt-avatar">${esc(initial)}</span>
      <div class="rt-id">
        <strong>${esc(rider?.name || state.user?.name || 'Rider')}</strong>
        <span class="rt-sub">
          <span class="pill pill-green">${icon('bike')} ${esc(rider?.vehicle || 'Bike')}</span>
          <span class="rt-presence ${state.online ? 'on' : ''}"><i></i>${state.online ? 'Online' : 'Offline'}</span>
        </span>
      </div>
      <button class="rt-earn" data-nav="/earnings" aria-label="Today's earnings">${icon('wallet')} ${money(today?.total_minor || 0)}</button>
      <span class="rt-toggle">
        <button class="switch" role="switch" aria-checked="${state.online}" data-online-toggle aria-label="${state.online ? 'Go offline' : 'Go online'}"></button>
        <small>${state.online ? 'On duty' : 'Off duty'}</small>
      </span>
    </div>`;
}
function titleBar(title, { back = false, action = '' } = {}) {
  return `<div class="header-row1 detail-head">
    ${back ? `<button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button>` : ''}
    <h1 class="head-title">${esc(title)}</h1>${action}
  </div>`;
}
function renderChrome(path) {
  if (!state.user || path === '/auth') {
    header.hidden = true; header.innerHTML = ''; header.className = 'app-header';
    tabbar.hidden = true; tabbar.innerHTML = '';
    return;
  }
  header.hidden = false;
  if (path === '/') {
    header.className = 'app-header rider-top';
    header.innerHTML = riderTopBar();
  } else if (path.startsWith('/job/')) {
    header.className = 'app-header';
    const job = state.jobs.find(j => j.id === path.slice(5));
    header.innerHTML = titleBar(job?.public_label ? `Delivery · ${job.public_label}` : 'Active delivery', { back: true });
  } else if (path === '/earnings') {
    header.className = 'app-header';
    header.innerHTML = titleBar('Earnings', { action: `<button class="icon-btn" data-refresh-earnings aria-label="Refresh earnings">${icon('refresh')}</button>` });
  } else if (path === '/account') {
    header.className = 'app-header';
    header.innerHTML = titleBar('Rider account');
  } else {
    header.className = 'app-header rider-top';
    header.innerHTML = riderTopBar();
  }
  if (TAB_ROOTS(path)) {
    const offers = offeredJobs().length;
    tabbar.hidden = false;
    tabbar.innerHTML = TABS.map(tab => `
      <button class="tab ${tab.match(path) ? 'active' : ''}" data-nav="${tab.path}" aria-current="${tab.match(path) ? 'page' : 'false'}">
        <span class="tab-ico">${icon(tab.icon)}${tab.path === '/' && offers ? `<span class="tab-badge">${offers}</span>` : ''}</span>
        <span>${tab.label}</span>
      </button>`).join('');
  } else {
    tabbar.hidden = true; tabbar.innerHTML = '';
  }
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
  if (!state.user || state.user.role !== 'rider') { router.navigate('/auth', { replace: true }); return; }
  return handler(outlet, params, query, { router, path });
};
router
  .add('/auth', (p, q) => authView(outlet, p, q, { router }))
  .add('/', guard(homeView))
  .add('/job/:id', guard(jobView))
  .add('/earnings', guard(earningsView))
  .add('/account', guard(accountView));

/* ---------- location ping (online only) ---------- */
const PING_INTERVAL_MS = 20000;
let pingTimer = null;
let pingBusy = false;
let fallbackCoords = null;

async function ensureFallbackCoords() {
  if (fallbackCoords) return fallbackCoords;
  const known = state.rider?.location;
  if (known && typeof known.lat === 'number') {
    fallbackCoords = { lat: known.lat, lng: known.lng };
    return fallbackCoords;
  }
  const active = state.jobs.find(j => j.status === 'accepted' || j.status === 'picked_up');
  if (active && typeof active.store?.lat === 'number') {
    fallbackCoords = { lat: active.store.lat, lng: active.store.lng };
    return fallbackCoords;
  }
  try {
    const res = await api.stores();
    const stores = res.stores || [];
    const home = stores.find(s => s.id === state.rider?.home_store_id) || stores[0];
    if (home && typeof home.lat === 'number') fallbackCoords = { lat: home.lat, lng: home.lng };
  } catch { /* no fallback available — skip this ping */ }
  return fallbackCoords;
}
async function sendCoords(lat, lng) {
  try {
    await api.riderLocation(lat, lng);
    if (state.rider) state.rider = { ...state.rider, location: { lat, lng, at: new Date().toISOString() } };
  } catch { /* transient network — next ping retries */ }
  finally { pingBusy = false; }
}
async function pingFallback() {
  const coords = await ensureFallbackCoords();
  if (coords) await sendCoords(coords.lat, coords.lng);
  else pingBusy = false;
}
function pingLocation() {
  if (pingBusy || !state.online || !state.user) return;
  pingBusy = true;
  if (navigator.geolocation) {
    // Never block on the permission prompt: on denial/timeout we fall back to
    // the home-store / last-known coordinates so tracking keeps working.
    navigator.geolocation.getCurrentPosition(
      position => {
        fallbackCoords = { lat: position.coords.latitude, lng: position.coords.longitude };
        sendCoords(fallbackCoords.lat, fallbackCoords.lng);
      },
      () => { pingFallback(); },
      { timeout: 8000, maximumAge: 20000 },
    );
  } else {
    pingFallback();
  }
}
function startPing() {
  if (pingTimer) return;
  pingLocation();
  pingTimer = setInterval(pingLocation, PING_INTERVAL_MS);
}
function stopPing() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

/* ---------- global delegated events ---------- */
function wireGlobal() {
  const app = document.getElementById('app');
  app.addEventListener('click', async event => {
    const nav = event.target.closest('[data-nav]');
    if (nav) { event.preventDefault(); router.navigate(nav.dataset.nav); return; }
    const back = event.target.closest('[data-back]');
    if (back) { event.preventDefault(); if (history.length > 1) history.back(); else router.navigate('/'); return; }
    const toggle = event.target.closest('[data-online-toggle]');
    if (toggle) {
      event.preventDefault();
      if (toggle.disabled) return;
      document.querySelectorAll('[data-online-toggle]').forEach(btn => { btn.disabled = true; });
      try {
        const online = await setOnline(!state.online);
        toast(online ? 'You are online — offers incoming' : 'You are offline. Take a break!', online ? 'success' : 'default');
      } catch (error) {
        toast(error.message || 'Could not change availability', 'error');
      } finally {
        document.querySelectorAll('[data-online-toggle]').forEach(btn => { btn.disabled = false; });
        if (router.current) renderChrome(router.current.path);
      }
      return;
    }
    const refresh = event.target.closest('[data-refresh-earnings]');
    if (refresh) { event.preventDefault(); bus.emit('refresh-earnings'); }
  });
  // CSP-safe image fallback (capture phase: error events don't bubble)
  app.addEventListener('error', event => {
    const img = event.target;
    if (img?.tagName === 'IMG' && img.dataset.artId !== undefined) handleImgError(img);
  }, true);

  bus.on('online', online => {
    if (router.current) renderChrome(router.current.path);
    if (online) startPing(); else stopPing();
  });
  bus.on('jobs', () => { if (router.current) renderChrome(router.current.path); });
  bus.on('earnings', () => { if (router.current) renderChrome(router.current.path); });
  bus.on('profile', () => { if (router.current) renderChrome(router.current.path); });
  bus.on('signout', () => { stopPing(); fallbackCoords = null; });
}

/* ---------- init ---------- */
async function init() {
  wireGlobal();
  if (hasSession()) {
    try { await bootstrap(); }
    catch (error) {
      signOut();
      if (error?.code === 'NOT_RIDER') toast(error.message, 'error', 4200);
    }
  }
  router.start();
  if (state.user && state.online) startPing();
  bus.on('ready', () => {
    if (state.online) startPing();
    refreshEarnings();
  });
}
init();

export { router };