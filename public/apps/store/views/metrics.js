// Today at a glance: orders, GMV, pending, cancellations, packing speed,
// shortage refunds and low-stock count, plus a live status breakdown and a
// "needs attention" lane built from the current queue.
import { api } from '../../_shared/api.js';
import { icon, statusChip, emptyState, esc, toast, spinner } from '../../_shared/ui.js';
import { money, moneyExact, dateShort } from '../../_shared/format.js';
import { state } from '../state.js';

const READY_STATUSES = ['packed', 'rider_assigned', 'picked_up'];

export async function metricsView(outlet, params, query, { router }) {
  if (!state.store) {
    outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🏬', title: 'No store assigned', body: 'This picker account is not staffed on any store yet.' })}</div>`;
    return;
  }

  let dead = false;
  let loading = true;

  function statCard(label, value, { fit = false, delta = '', deltaCls = '' } = {}) {
    return `<div class="admin-stat">
      <span class="as-label">${esc(label)}</span>
      <span class="as-value ${fit ? 'fit' : ''}">${esc(value)}</span>
      ${delta ? `<span class="as-delta ${deltaCls}">${delta}</span>` : ''}
    </div>`;
  }

  function bodyHtml(metrics, orders) {
    const t = metrics?.today || {};
    const avg = t.avg_pack_minutes === null || t.avg_pack_minutes === undefined ? '—' : `${t.avg_pack_minutes} min`;
    const count = statuses => orders.filter(o => statuses.includes(o.status)).length;
    const fresh = count(['placed']);
    const packing = count(['packing']);
    const ready = count(READY_STATUSES);
    const done = count(['delivered', 'cancelled']);
    const attention = orders.filter(o => o.status === 'placed' || o.status === 'packing');
    return `
      <div class="admin-stats">
        ${statCard('Orders today', String(t.orders ?? 0), { delta: `${t.pending ?? 0} pending now` })}
        ${statCard('GMV (delivered)', money(t.gmv_minor), { fit: true, delta: 'paid + COD collected' })}
        ${statCard('Pending', String(t.pending ?? 0), { delta: 'new + packing', deltaCls: (t.pending ?? 0) > 0 ? 'warn' : '' })}
        ${statCard('Cancelled', String(t.cancelled ?? 0), { delta: t.cancelled ? 'watch refusals' : 'clean sheet', deltaCls: t.cancelled ? 'bad' : '' })}
        ${statCard('Avg pack time', avg, { delta: 'start → ready' })}
        ${statCard('Shortage refunds', moneyExact(t.shortage_refunds_minor), { fit: true, delta: 'auto-refunded at pack', deltaCls: (t.shortage_refunds_minor ?? 0) > 0 ? 'warn' : '' })}
        ${statCard('Low stock items', String(metrics?.low_stock_count ?? 0), { delta: '<button class="as-delta link" data-nav="/inventory">Restock now →</button>', deltaCls: (metrics?.low_stock_count ?? 0) > 0 ? 'warn' : '' })}
      </div>
      <div class="section-title"><h2>${icon('sort')} Queue breakdown</h2><span class="muted tiny">${orders.length} orders</span></div>
      <div class="stat-grid metrics-break">
        <div class="stat-tile accent-new"><strong>${fresh}</strong><span>New</span></div>
        <div class="stat-tile"><strong>${packing}</strong><span>Packing</span></div>
        <div class="stat-tile accent-ready"><strong>${ready}</strong><span>Ready / out</span></div>
        <div class="stat-tile"><strong>${done}</strong><span>Done</span></div>
      </div>
      <div class="section-title"><h2>${icon('bolt')} Needs attention</h2></div>
      ${attention.length ? attention.map(o => `
        <div class="seller-order-card ${o.status === 'placed' ? 'is-new' : ''}">
          <div class="so-top"><span class="so-label">${esc(o.public_label || o.id)}</span>${statusChip(o.status)}</div>
          <div class="so-meta"><span>${o.items.length} lines · ${esc(o.customer?.name || 'Customer')}</span><span class="so-total">${money(o.bill?.grand_total_minor)}</span></div>
          <div class="so-actions"><button class="btn ${o.status === 'placed' ? 'btn-primary' : 'btn-outline'}" data-nav="/order/${esc(o.id)}">${o.status === 'placed' ? 'Start packing' : 'Continue picking'}</button></div>
        </div>`).join('')
      : emptyState({ emoji: '🎉', title: 'All caught up', body: 'No new or packing orders right now. The queue refreshes itself.' })}`;
  }

  function renderBody(html) {
    const host = outlet.querySelector('[data-metrics-body]');
    if (host) host.innerHTML = html;
  }

  async function load() {
    if (dead) return;
    renderBody(spinner('Crunching today’s numbers…'));
    try {
      const [mRes, qRes] = await Promise.all([
        api.storeMetrics(state.store.id),
        api.storeQueue(state.store.id, {}),
      ]);
      if (dead) return;
      state.metrics = mRes.metrics || null;
      state.queue = qRes.orders || [];
      loading = false;
      renderBody(bodyHtml(state.metrics, state.queue));
    } catch (error) {
      if (dead) return;
      loading = false;
      renderBody(emptyState({ emoji: '📡', title: 'Could not load metrics', body: error.message || 'Check your connection and try again.', actionHtml: '<button class="btn btn-primary" data-metrics-retry>Retry</button>' }));
      toast(error.message || 'Could not load metrics', 'error');
    }
  }

  outlet.innerHTML = `
    <div class="page">
      <div class="section-title">
        <h2>${icon('wallet')} Today · ${esc(dateShort(new Date().toISOString()))}</h2>
        <button class="see-circle" data-metrics-refresh aria-label="Refresh metrics">${icon('refresh')}</button>
      </div>
      <div data-metrics-body></div>
    </div>`;
  outlet.querySelector('[data-metrics-refresh]').addEventListener('click', load);
  outlet.querySelector('[data-metrics-body]').addEventListener('click', event => {
    if (event.target.closest('[data-metrics-retry]')) load();
  });
  await load();
  return () => { dead = true; };
}