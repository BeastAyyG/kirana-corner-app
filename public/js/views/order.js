// Order detail: timeline, pickup code card, items, bill, cancel / reorder.
import { state } from '../state.js';
import { esc, icon, statusChip, askConfirm, emptyState, skeletonCards } from '../ui.js';
import { navigate, onView } from '../router.js';
import { api } from '../api.js';
import { money, moneyExact, slotWhen, relativeTime, prettyCode, statusText } from '../format.js';
import { cancelOrder, reorder, refreshOrders } from '../actions.js';

const STEPS = ['placed', 'packing', 'ready', 'collected'];

function timelineHtml(status) {
  if (status === 'cancelled') {
    return '<div class="notice notice-error">This order was cancelled. Reserved stock and the slot were released.</div>';
  }
  const current = STEPS.indexOf(status);
  return `<div class="timeline">${STEPS.map((step, i) => {
    const labels = { placed: 'Placed', packing: 'Packing', ready: 'Ready', collected: 'Picked up' };
    return `<div class="t-step ${i <= current ? 'done' : ''}">${labels[step]}</div>`;
  }).join('')}</div>`;
}

export async function renderOrderDetail(outlet, { orderId, query }) {
  const justPlaced = query.get('placed') === '1';
  outlet.innerHTML = `<div class="subbar"><button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button><h1>Order</h1></div><div class="page">${skeletonCards(2)}</div>`;
  outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());

  let order;
  try {
    order = await api.order(orderId).then(result => result.order);
  } catch {
    outlet.innerHTML = `<div class="subbar"><h1>Order</h1></div>
      ${emptyState({ emoji: '🔎', title: 'Order not found', body: 'It may belong to a different account.', actionHtml: '<button class="btn btn-primary" data-go-orders>My orders</button>' })}`;
    outlet.querySelector('[data-go-orders]')?.addEventListener('click', () => navigate('#/orders'));
    return;
  }

  const draw = () => {
    const canCancel = order.status === 'placed';
    const showCode = order.pickup_code && order.status !== 'collected' && order.status !== 'cancelled';
    outlet.innerHTML = `
      <div class="subbar">
        <button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button>
        <h1>${esc(order.public_label)}</h1>
        ${statusChip(order.status)}
      </div>
      ${justPlaced ? `<div class="notice notice-info">${icon('check')}<span><strong>Order placed!</strong> The shop will pack one labeled bag for your slot. Show the pickup code at handover.</span></div>` : ''}
      <div class="page">
        ${timelineHtml(order.status)}
        <div class="spacer-8"></div>
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
            <div class="kv-row"><span class="v" data-left>${esc(item.name)} · ${esc(item.unit)} × ${item.quantity}</span><span class="v">${money(item.price_minor * item.quantity)}</span></div>`).join('')}
          <div class="kv-row"><span class="k">Total</span><span class="v big">${moneyExact(order.total_minor)}</span></div>
        </div>
        <div class="spacer-16"></div>
        <div class="flex-between" data-actions>
          ${canCancel ? '<button class="btn btn-danger" data-cancel-order>Cancel order</button>' : '<span></span>'}
          <button class="btn btn-outline" data-reorder-order>${icon('refresh')} Order again</button>
        </div>
        <div class="spacer-16"></div>
        <div class="notice notice-info">${icon('store')}<span>Collect from <strong>${esc(order.pickup_location)}</strong> during ${esc(order.pickup_slot_label)}. Pay ${moneyExact(order.total_minor)} at the counter.</span></div>
      </div>`;

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
      if (done) {
        order = { ...order, status: 'cancelled', cancel_reason: 'Cancelled before packing' };
        draw();
      }
    });
    outlet.querySelector('[data-reorder-order]')?.addEventListener('click', async () => {
      if (!state.orders.some(item => item.id === order.id)) await refreshOrders({ silent: true });
      const ok = await reorder(order.id);
      if (ok) navigate('#/cart');
    });
  };

  draw();
  // live status updates while the shop packs
  onView('orders', async () => {
    try {
      const fresh = state.orders.find(item => item.id === order.id);
      if (fresh) { order = fresh; draw(); }
    } catch { /* keep the snapshot */ }
  });
}
