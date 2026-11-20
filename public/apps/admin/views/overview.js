// Operations overview: today's KPIs, orders-by-status bars, role breakdown and
// a store snapshot. Polls every 15s (order events are not pushed to admins
// globally); the router runs the returned cleanup on navigation.
import { icon, statusChip, esc, toast, spinner } from '../../_shared/ui.js';
import { money, statusText } from '../../_shared/format.js';
import { state, refreshOverview, refreshStores } from '../state.js';

const POLL_MS = 15000;
const ALL_STATUSES = ['placed', 'packing', 'packed', 'rider_assigned', 'picked_up', 'delivered', 'cancelled'];
const ROLE_META = [
  { role: 'customer', label: 'Customers', icon: 'user', tone: 'tone-blue' },
  { role: 'picker', label: 'Pickers', icon: 'box', tone: 'tone-amber' },
  { role: 'rider', label: 'Riders', icon: 'bike', tone: 'tone-green' },
  { role: 'admin', label: 'Admins', icon: 'shield', tone: 'tone-save' },
];

export async function overviewView(outlet) {
  let alive = true;
  let fetching = false;

  function statCard(label, value, delta, iconName, tone, deltaCls = '') {
    return `<div class="admin-stat">
      <span class="as-ico ${tone}">${icon(iconName)}</span>
      <span class="as-label">${esc(label)}</span>
      <span class="as-value">${esc(value)}</span>
      <span class="as-delta ${deltaCls}">${esc(delta)}</span>
    </div>`;
  }

  function bodyHtml() {
    const ov = state.overview;
    if (!ov) return '';
    const today = ov.today || {};
    const byStatus = today.orders_by_status || {};
    const totalOrders = ALL_STATUSES.reduce((n, s) => n + Number(byStatus[s] || 0), 0);
    const liveOrders = totalOrders - Number(byStatus.delivered || 0) - Number(byStatus.cancelled || 0);
    const roles = ov.users_by_role || {};
    const maxCount = Math.max(1, ...ALL_STATUSES.map(s => Number(byStatus[s] || 0)));
    const dateLine = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    return `
      <div class="admin-head">
        <div>
          <h1>Operations overview</h1>
          <div class="ah-sub"><span class="live-dot"></span>${esc(dateLine)} · auto-refreshes every 15s</div>
        </div>
        <div class="ah-actions">
          <button class="btn btn-outline refresh-btn" data-refresh>${icon('refresh')} Refresh</button>
        </div>
      </div>

      <div class="admin-stats">
        ${statCard('GMV today', money(today.gmv_minor), `${today.delivered || 0} delivered orders`, 'cash', 'tone-save', 'good')}
        ${statCard('Delivered', String(today.delivered || 0), 'completed today', 'check', 'tone-green')}
        ${statCard('Avg delivery', `${today.avg_delivery_minutes ?? 0} min`, 'placed → delivered', 'bolt', 'tone-blue')}
        ${statCard('Riders online', String(ov.riders_online || 0), `${roles.rider || 0} riders on staff`, 'bike', 'tone-green')}
        ${statCard('Stores open', String(ov.stores_open || 0), `${state.stores.length} in the network`, 'store', 'tone-amber')}
        ${statCard('Pending payments', String(ov.pending_payments || 0), ov.pending_payments ? 'needs attention' : 'all settled', 'wallet', ov.pending_payments ? 'tone-red' : 'tone-blue', ov.pending_payments ? 'warn' : '')}
        ${statCard('Orders today', String(totalOrders), `${liveOrders} in flight right now`, 'receipt', 'tone-blue')}
      </div>

      <div class="ov-grid">
        <div class="admin-card">
          <div class="ac-head"><h2>${icon('list')} Orders by status</h2><span class="count-note">${totalOrders} today</span></div>
          ${ALL_STATUSES.map(s => {
            const n = Number(byStatus[s] || 0);
            const pct = Math.round((n / maxCount) * 100);
            return `<div class="ov-status-row">
              ${statusChip(s)}
              <svg class="ov-bar" viewBox="0 0 100 6" preserveAspectRatio="none" role="img" aria-label="${esc(statusText(s))}: ${n}">
                <rect class="ov-track" width="100" height="6" rx="3"></rect>
                <rect class="fill-${s}" width="${pct}" height="6" rx="3"></rect>
              </svg>
              <strong>${n}</strong>
            </div>`;
          }).join('')}
        </div>
        <div class="admin-card">
          <div class="ac-head"><h2>${icon('user')} Users by role</h2><span class="count-note">${Object.values(roles).reduce((n, v) => n + Number(v || 0), 0)} accounts</span></div>
          <div class="ov-roles">
            ${ROLE_META.map(meta => `
              <div class="ov-role">
                <span class="as-ico ${meta.tone}">${icon(meta.icon)}</span>
                <strong>${Number(roles[meta.role] || 0)}</strong>
                <span>${meta.label}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="admin-card">
        <div class="ac-head"><h2>${icon('store')} Store snapshot</h2><button class="mini-btn" data-nav="/stores">Manage stores ${icon('arrowRight')}</button></div>
        ${state.stores.length ? state.stores.map(store => `
          <div class="ov-store">
            <div class="ovs-main">
              <strong>${esc(store.name)}</strong>
              <span>${esc(store.city)} · prep ${store.prep_time_minutes} min · radius ${store.radius_km} km</span>
            </div>
            <div class="ovs-pills">
              <span class="pill ${store.is_open ? 'pill-green' : 'pill-gray'}">${store.is_open ? 'Open' : 'Closed'}</span>
              <span class="pill ${store.accepting_orders ? 'pill-blue' : 'pill-amber'}">${store.accepting_orders ? 'Accepting' : 'Paused'}</span>
              <span class="pill ${store.active ? 'pill-green' : 'pill-red'}">${store.active ? 'Active' : 'Suspended'}</span>
            </div>
          </div>`).join('') : '<div class="empty"><h3>No stores yet</h3><p>Add your first store to start taking orders.</p></div>'}
      </div>`;
  }

  function render() {
    if (!alive) return;
    if (!state.overview) { outlet.innerHTML = spinner('Loading overview…'); return; }
    outlet.innerHTML = bodyHtml();
    outlet.querySelector('[data-refresh]')?.addEventListener('click', () => load(true));
  }

  async function load(manual = false) {
    if (fetching) return;
    fetching = true;
    const btn = outlet.querySelector('[data-refresh]');
    btn?.classList.add('spinning');
    try {
      await Promise.all([refreshOverview(), refreshStores()]);
    } catch (error) {
      if (manual) toast(error.message || 'Could not refresh overview', 'error');
    }
    fetching = false;
    btn?.classList.remove('spinning');
    render();
  }

  render();
  if (!state.overview) await load();
  const timer = setInterval(() => load(false), POLL_MS);
  return () => { alive = false; clearInterval(timer); };
}