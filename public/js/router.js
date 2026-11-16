// Minimal hash router. Views export render(outlet, params). Per-view bus
// subscriptions go through onView() and are dropped automatically on navigation.
import { bus } from './state.js';

const routes = [];
let current = null;
let outletEl = null;
let viewListeners = [];

/** Subscribe to a state topic for the lifetime of the current view. */
export function onView(topic, fn) {
  const off = bus.on(topic, fn);
  viewListeners.push(off);
}

export function route(pattern, view) {
  // pattern like '#/p/:id' → capture :params
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, part => {
    keys.push(part.slice(1));
    return '([^/]+)';
  }) + '$');
  routes.push({ regex, keys, view });
}

export function navigate(hash, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) handle(); // replaceState does not fire hashchange
}

export function back() { history.back(); }

function currentHash() {
  return location.hash || '#/';
}

async function handle() {
  const hash = currentHash().split('?')[0];
  const query = new URLSearchParams((currentHash().split('?')[1] || ''));
  const match = routes.find(route => route.regex.test(hash));
  const outlet = outletEl;
  if (!outlet) return;
  viewListeners.forEach(off => off());
  viewListeners = [];
  current?.cleanup?.();
  current = null;
  window.scrollTo(0, 0);
  if (!match) {
    outlet.innerHTML = '<div class="empty"><div class="empty-art">🧭</div><h3>Page not found</h3><p>That screen does not exist. Head back to the home screen.</p><button class="btn btn-primary" data-nav-home>Go home</button></div>';
    outlet.querySelector('[data-nav-home]')?.addEventListener('click', () => navigate('#/home'));
    return;
  }
  const params = {};
  const values = hash.match(match.regex);
  match.keys.forEach((key, i) => { params[key] = decodeURIComponent(values[i + 1]); });
  current = { cleanup: null };
  const view = typeof match.view === 'function' ? { render: match.view } : match.view;
  try {
    const maybe = view.render(outlet, { ...params, query });
    if (maybe && typeof maybe.then === 'function') await maybe;
  } catch (error) {
    console.error('view render failed', error);
    outlet.innerHTML = '<div class="empty"><div class="empty-art">⚠️</div><h3>Could not load this screen</h3><p>Try again in a moment.</p></div>';
  }
  if (current) current.cleanup = view.cleanup || null;
}

export function startRouter(outlet) {
  outletEl = outlet;
  window.addEventListener('hashchange', handle);
  handle();
}

export function currentRoute() { return currentHash().split('?')[0]; }
