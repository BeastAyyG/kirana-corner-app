// Tiny hash router shared by the v2 apps. Patterns use :param segments.
// A route handler may return a cleanup function; the router runs it before the
// next navigation so views can unsubscribe from SSE / timers / buses.

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const query = {};
  if (queryPart) new URLSearchParams(queryPart).forEach((v, k) => { query[k] = v; });
  const segments = pathPart.split('/').filter(Boolean);
  return { path: '/' + segments.join('/'), segments, query };
}

function match(pattern, segments) {
  const parts = pattern.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(segments[i]);
    else if (parts[i] !== segments[i]) return null;
  }
  return params;
}

export function createRouter({ onNavigate, fallback = '/' } = {}) {
  const routes = [];
  let cleanup = null;
  let current = null;
  let started = false;

  function resolve() {
    const { path, segments, query } = parseHash();
    for (const route of routes) {
      const params = match(route.pattern, segments);
      if (params) return { route, params, query, path };
    }
    return null;
  }

  async function render() {
    const found = resolve();
    if (!found) { navigate(fallback, { replace: true }); return; }
    if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
    current = found;
    const result = await found.route.handler(found.params, found.query, found.path);
    if (typeof result === 'function') cleanup = result;
    onNavigate?.(found);
  }

  function navigate(path, { replace = false } = {}) {
    const target = '#' + (path.startsWith('/') ? path : '/' + path);
    if (replace) history.replaceState(null, '', target);
    else location.hash = target;
    if (replace) render();
  }

  function start() {
    if (started) return;
    started = true;
    window.addEventListener('hashchange', render);
    render();
  }

  return {
    add(pattern, handler) { routes.push({ pattern, handler }); return this; },
    navigate, start,
    get current() { return current; },
    refresh() { render(); },
  };
}