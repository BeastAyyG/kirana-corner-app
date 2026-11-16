// Seller pickup queue: status tabs, search, date filter, per-status actions.
import { state } from '../state.js';
import { esc, icon, emptyState, statusChip, askConfirm, formSheet, toast } from '../ui.js';
import { onView } from '../router.js';
import { money, moneyExact, slotWhen, prettyCode } from '../format.js';
import { setQueueFilters, sellerStartPacking, sellerMarkReady, sellerCompletePickup, cancelOrder, refreshQueue } from '../actions.js';

const TABS = [
  { key: 'active', label: 'To do' },
  { key: 'placed', label: 'New' },
  { key: 'packing', label: 'Packing' },
  { key: 'ready', label: 'Ready' },
  { key: 'collected', label: 'Done' },
  { key: 'cancelled', label: 'Cancelled' },
];

function itemsSummary(order) {
  return order.items.map(item => `<div class="si"><span>${esc(item.name)} · ${esc(item.unit)}</span><strong>× ${item.quantity}</strong></div>`).join('');
}

export function renderSellerOrders(outlet) {
  const filters = state.seller.queueFilters;

  const draw = () => {
    if (state.session.user?.role !== 'seller') {
      outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🔐', title: 'Shopkeeper access only', body: 'Sign in with the shopkeeper account to see the pickup queue.', actionHtml: '<button class="btn btn-primary" data-go-signin>Sign in</button>' })}</div>`;
      outlet.querySelector('[data-go-signin]')?.addEventListener('click', () => { location.hash = '#/welcome'; });
      return;
    }
    if (!state.seller.store) {
      outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🏪', title: 'No shop linked', body: 'This account has no assigned shop yet.' })}</div>`;
      return;
    }
    const orders = state.seller.orders;
    const activeCount = orders.filter(order => ['placed', 'packing', 'ready'].includes(order.status)).length;

    outlet.innerHTML = `
      <div class="subbar">
        <h1>Pickup queue</h1>
        <span class="count-note">${activeCount} to do</span>
      </div>
      <div class="queue-tabs" role="tablist">
        ${TABS.map(tab => `<button class="chip ${filters.status === tab.key ? 'on' : ''}" data-queue-tab="${esc(tab.key)}" aria-pressed="${filters.status === tab.key}">${esc(tab.label)}</button>`).join('')}
      </div>
      <div class="chip-row">
        <input type="search" class="search-pill live" data-queue-search placeholder="Order, bag, or item…" value="${esc(filters.q)}" aria-label="Search queue">
        <input type="date" class="chip" data-queue-date value="${esc(filters.date)}" aria-label="Pickup date">
        ${filters.date ? '<button class="chip" data-clear-date>Any date</button>' : ''}
      </div>
      <div class="page">
        ${orders.length ? orders.map(order => {
          const isNew = state.seller.newOrderIds.has(order.id);
          return `<div class="seller-order-card ${isNew ? 'is-new' : ''}" data-order="${esc(order.id)}">
            <div class="so-top">
              <div>
                <div class="so-label">${esc(order.public_label)}</div>
                <div class="so-slot">${esc(slotWhen(order))} · ${order.items.reduce((sum, item) => sum + item.quantity, 0)} units</div>
              </div>
              ${statusChip(order.status)}
            </div>
            <div class="so-items">${itemsSummary(order)}</div>
            <div class="so-meta">
              <span>🛍️ ${esc(order.bag_label || 'Bag at packing')} · 📍 ${esc(order.pickup_location)}</span>
              <span class="so-total">${money(order.total_minor)}</span>
            </div>
            ${actionHtml(order)}
          </div>`;
        }).join('') : emptyState({ emoji: '🗂️', title: 'Nothing in this view', body: 'Orders appear here as shoppers check out. Filters can narrow the list.' })}
      </div>`;

    // tab + filter events
    outlet.querySelectorAll('[data-queue-tab]').forEach(button => {
      button.addEventListener('click', () => setQueueFilters({ status: button.dataset.queueTab }));
    });
    const search = outlet.querySelector('[data-queue-search]');
    if (search) {
      let timer;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => setQueueFilters({ q: search.value }), 250);
      });
    }
    const date = outlet.querySelector('[data-queue-date]');
    date?.addEventListener('change', () => setQueueFilters({ date: date.value || '' }));
    outlet.querySelector('[data-clear-date]')?.addEventListener('click', () => setQueueFilters({ date: '' }));
    bindOrderActions();
  };

  function actionHtml(order) {
    if (order.status === 'placed') {
      return `<div class="so-actions">
        <button class="btn btn-primary" data-start-packing="${esc(order.id)}">Start packing</button>
        <button class="btn btn-danger" data-seller-cancel="${esc(order.id)}">Cancel</button>
      </div>`;
    }
    if (order.status === 'packing') {
      return `<div class="so-actions">
        <button class="btn btn-primary" data-mark-ready="${esc(order.id)}">Seal bag & mark ready</button>
      </div>`;
    }
    if (order.status === 'ready') {
      return `<div class="code-input">
        <input data-code-input="${esc(order.id)}" placeholder="Pickup code" inputmode="text" autocomplete="one-time-code" maxlength="8" minlength="8" aria-label="Shopper pickup code">
        <button class="btn btn-primary" data-complete="${esc(order.id)}">Verify</button>
      </div>`;
    }
    if (order.status === 'collected') {
      return `<div class="notice notice-info">${icon('check')}<span>Handover complete${order.collected_at ? ` · ${esc(new Date(order.collected_at).toLocaleString('en-IN'))}` : ''}. Payment collected at counter: ${moneyExact(order.total_minor)}.</span></div>`;
    }
    if (order.status === 'cancelled') {
      return `<div class="notice notice-error">${icon('alert')}<span>${esc(order.cancel_reason || 'Cancelled before packing')}</span></div>`;
    }
    return '';
  }

  function bindOrderActions() {
    outlet.querySelectorAll('[data-start-packing]').forEach(button => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        await sellerStartPacking(button.dataset.startPacking);
      });
    });
    outlet.querySelectorAll('[data-mark-ready]').forEach(button => {
      button.addEventListener('click', async () => {
        const order = state.seller.orders.find(item => item.id === button.dataset.markReady);
        const result = await formSheet({
          title: 'Mark bag ready',
          submitLabel: 'Mark ready',
          note: 'The bag label and pickup point appear on the shopper’s order screen.',
          fields: [
            { name: 'bag_label', label: 'Bag label', value: order?.bag_label || `BAG-${String(order?.public_label || '').slice(-6)}`, required: true, attrs: 'maxlength="40"' },
            { name: 'pickup_location', label: 'Pickup point', value: state.seller.store?.pickup_location || '', required: true, attrs: 'maxlength="120"' },
          ],
        });
        if (!result) return;
        button.disabled = true;
        const ok = await sellerMarkReady(order.id, { bag_label: result.bag_label, pickup_location: result.pickup_location });
        if (!ok) button.disabled = false;
      });
    });
    outlet.querySelectorAll('[data-complete]').forEach(button => {
      button.addEventListener('click', async () => {
        const input = outlet.querySelector(`[data-code-input="${button.dataset.complete}"]`);
        const code = String(input?.value || '').trim().toUpperCase();
        if (code.length !== 8) { toast('Enter the 8-character pickup code'); input?.focus(); return; }
        button.disabled = true;
        const ok = await sellerCompletePickup(button.dataset.complete, code);
        if (!ok) { button.disabled = false; input?.focus(); }
      });
    });
    outlet.querySelectorAll('[data-seller-cancel]').forEach(button => {
      button.addEventListener('click', async () => {
        const ok = await askConfirm({
          title: 'Cancel this order?',
          message: 'Reserved stock and the slot go back to the shop. The shopper sees the cancellation immediately.',
          confirmLabel: 'Cancel order',
          danger: true,
        });
        if (!ok) return;
        await cancelOrder(button.dataset.sellerCancel, { seller: true });
      });
    });
  }

  onView('seller', draw);
  if (!state.seller.ordersLoaded) refreshQueue({ silent: true });
  draw();
}
