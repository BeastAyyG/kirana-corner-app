// Order detail / tracking (bbnow): ETA-style progress gauge, timeline, pickup
// code card, items, bill, cancel / reorder. v1 is pickup (no rider map).
import { state } from '../state.js';
import { esc, icon, statusChip, askConfirm, emptyState, skeletonCards, etaGauge } from '../ui.js';
import { navigate, onView } from '../router.js';
import { api } from '../api.js';
import { money, moneyExact, slotWhen, relativeTime, prettyCode, statusText } from '../format.js';
import { cancelOrder, reorder, refreshOrders } from '../actions.js';

const STEPS = ['placed', 'packing', 'ready', 'collected'];
const STEP_LABEL = { placed: 'Placed', packing: 'Packing', ready: 'Ready', collected: 'Done' };
const GAUGE_CIRC = 2 * Math.PI * 50;

function timelineHtml(status) {
  if (status === 'cancelled') {
    return '<div class="notice notice-error">This order was cancelled. Reserved stock and the slot were released.</div>';
  }
  const current = STEPS.indexOf(status);
  return `<div class="timeline">${STEPS.map((step, i) =>
    `<div class="t-step ${i <= current ? 'done' : ''}">${STEP_LABEL[step]}</div>`).join('')}</div>`;
}

function heroHtml(order) {
  if (order.status === 'cancelled') {
    return `<div class="track-hero"><div class="th-copy"><h2>Order cancelled</h2><p>${esc(order.cancel_reason || 'This order was cancelled.')}</p></div></div>`;
  }
  const idx = Math.max(0, STEPS.indexOf(order.status));
  const progress = (idx + 1) / STEPS.length;
  const color = order.status === 'ready' || order.status === 'collected' ? 'var(--bb-green)' : 'var(--bb-green-dark)';
  return `<div class="track-hero">
    ${etaGauge({ progress: 0, centerTop: `${idx + 1}/${STEPS.length}`, centerSub: STEP_LABEL[order.status], color })}
    <div class="th-copy">
      <h2>${esc(statusText(order.status))}</h2>
      <p>${esc(slotWhen(order))}</p>
      <p>${esc(order.pickup_location)}</p>
    </div>
  </div>`;
}

export async function renderOrderDetail(outlet, { orderId, query }) {
  const justPlaced = query.get('placed') === '1';
  outlet.innerHTML = `<div class="subbar"><button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button><h1>Order</h1></div><div class="page">${skeletonCards(2)}</div>`;
  outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());

  let order;
  try {
    order = (await api.order(orderId)).order;
  } catch {
    outlet.innerHTML = `<div class="subbar"><h1>Order</h1></div>
      ${emptyState({ emoji: '🔎', title: 'Order not found', body: 'It may belong to a different account.', actionHtml: '<button class="btn btn-primary" data-go-orders>My orders</button>' })}`;
    outlet.querySelector('[data-go-orders]')?.addEventListener('click', () => navigate('#/orders'));
    return;
  }

  const draw = () => {
    const canCancel = order.status === 'placed';
    const showCode = order.pickup_code && order.status !== 'collected' && order.status !== 'cancelled';
    const idx = Math.max(0, STEPS.indexOf(order.status));
    const targetOffset = GAUGE_CIRC * (1 - (idx + 1) / STEPS.length);
    outlet.innerHTML = `
      <div class="subbar">
        <button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button>
        <h1>${esc(order.public_label)}</h1>
        ${statusChip(order.status)}
      </div>
      ${justPlaced ? `<div class="pad-x"><div class="notice notice-info">${icon('check')}<span><strong>Order placed!</strong> The shop will pack one labeled bag for your slot. Show the pickup code at handover.</span></div></div>` : ''}
      <div class="page">
        ${heroHtml(order)}
        <div class="spacer-16"></div>
        ${timelineHtml(order.status)}
        <div class="spacer-16"></div>
        ${showCode ? `
          <div class="code-card">
            <span class="cc-label">Show this code at pickup</span>
            <div class="cc-code">${esc(prettyCode(order.pickup_code))}</div>
            <span class="cc-note">The shopkeeper verifies this code before handing over the bag</span>
          </div>` : ''}
        <div class="spacer-16"></div>
        <div class="kv-list">
          <div class="kv-row"><span class="k">Pickup</span><span class="v">${esc(slotWhen(order))}</span></div>
          <div class="kv-row"><span class="k">Pickup point</span><span class="v">${esc(order.pickup_location)}</span></div>
          <div class="kv-row"><span class="k">Bag</span><span class="v">${esc(order.bag_label || 'Assigned at packing')}</span></div>
          <div class="kv-row"><span class="k">Placed</span><span class="v">${esc(relativeTime(order.placed_at))}</span></div>
          ${order.status === 'cancelled' && order.cancel_reason ? `<div class="kv-row"><span class="k">Cancel reason</span><span class="v">${esc(order.cancel_reason)}</span></div>` : ''}
        </div>
        <div class="section-title"><h2>Items</h2><span class="tiny muted">pay at store</span></div>
        <div class="kv-list">
          ${order.items.map(item => `
            <div class="kv-row"><span class="v">${esc(item.name)} · ${esc(item.unit)} × ${item.quantity}</span><span class="v">${money(item.price_minor * item.quantity)}</span></div>`).join('')}
          <div class="kv-row"><span class="k">Total</span><span class="v big">${moneyExact(order.total_minor)}</span></div>
        </div>
        <div class="spacer-16"></div>
        <div class="flex-between">
          ${canCancel ? '<button class="btn btn-danger" data-cancel-order>Cancel order</button>' : '<span></span>'}
          <button class="btn btn-outline" data-reorder-order>${icon('refresh')} Order again</button>
        </div>
        <div class="spacer-16"></div>
        <div class="notice notice-info">${icon('store')}<span>Collect from <strong>${esc(order.pickup_location)}</strong> during ${esc(order.pickup_slot_label)}. Pay ${moneyExact(order.total_minor)} at the counter.</span></div>
      </div>`;

    // animate the gauge arc from empty to its progress on mount
    const arc = outlet.querySelector('.gauge-arc');
    if (arc && order.status !== 'cancelled') {
      requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', targetOffset.toFixed(2))));
    }

    outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());
    outlet.querySelector('[data-cancel-order]')?.addEventListener('click', async () => {
      const ok = await askConfirm({
        title: 'Cancel this order?',
        message: 'Only orders that have not started packing can be cancelled. Reserved stock and your slot go back to the shop.',
        confirmLabel: 'Cancel order',
        danger: true,
      });
      if (!ok) return;
      const done = await cancelOrder(order.id);
      if (done) { order = { ...order, status: 'cancelled', cancel_reason: 'Cancelled before packing' }; draw(); }
    });
    outlet.querySelector('[data-reorder-order]')?.addEventListener('click', async () => {
      if (!state.orders.some(item => item.id === order.id)) await refreshOrders({ silent: true });
      const ok = await reorder(order.id);
      if (ok) navigate('#/cart');
    });
  };

  draw();
  onView('orders', () => {
    const fresh = state.orders.find(item => item.id === order.id);
    if (fresh && fresh.status !== order.status) { order = fresh; draw(); }
  });
}