// Shopper orders list with Active / History segments and packshot stacks.
import { state } from '../state.js';
import { esc, icon, emptyState, statusChip } from '../ui.js';
import { navigate, onView } from '../router.js';
import { money, slotWhen } from '../format.js';
import { artFor } from '../art.js';

function thumbsHtml(order) {
  const shown = order.items.slice(0, 4);
  const extra = order.items.length - shown.length;
  return `<div class="oc-thumbs">
    ${shown.map(item => {
      const product = state.products.find(p => p.id === item.product_id) || { id: item.product_id };
      return `<img src="${artFor(product)}" alt="" loading="lazy" data-art-id="${esc(item.product_id)}">`;
    }).join('')}
    ${extra > 0 ? `<span class="oc-more">+${extra} more</span>` : ''}
  </div>`;
}

export function renderOrders(outlet) {
  let tab = 'active';

  const draw = () => {
    if (state.session.user?.role !== 'shopper') {
      outlet.innerHTML = `
        <div class="subbar"><h1>Your orders</h1></div>
        <div class="page">
          ${emptyState({
            emoji: '👤',
            title: 'Sign in to see your orders',
            body: 'Orders you place appear here with their pickup codes.',
            actionHtml: '<button class="btn btn-primary" data-go-signin>Sign in</button>',
          })}
        </div>`;
      outlet.querySelector('[data-go-signin]')?.addEventListener('click', () => navigate('#/welcome'));
      return;
    }

    const orders = state.orders;
    const active = orders.filter(order => ['placed', 'packing', 'ready'].includes(order.status));
    const past = orders.filter(order => ['collected', 'cancelled'].includes(order.status));
    const list = tab === 'active' ? active : past;

    outlet.innerHTML = `
      <div class="subbar"><h1>Your orders</h1></div>
      <div class="seg" role="tablist">
        <button role="tab" data-tab="active" aria-pressed="${tab === 'active'}">Active (${active.length})</button>
        <button role="tab" data-tab="past" aria-pressed="${tab === 'past'}">History (${past.length})</button>
      </div>
      <div class="page">
        ${list.length ? list.map(order => `
          <button class="order-card" data-open-order="${esc(order.id)}">
            <div class="oc-top">
              <div>
                <div class="oc-label">${esc(order.public_label)}</div>
                <div class="oc-slot">${esc(slotWhen(order))}</div>
              </div>
              ${statusChip(order.status)}
            </div>
            ${thumbsHtml(order)}
            <div class="oc-items">${order.items.map(item => `${esc(item.name)} × ${item.quantity}`).join(' · ')}</div>
            <div class="oc-foot">
              <span class="oc-total">${money(order.total_minor)}</span>
              <span class="oc-reorder">${order.status === 'placed' ? 'View code' : 'View details'} ${icon('chevronRight')}</span>
            </div>
          </button>`).join('')
        : emptyState({
            emoji: tab === 'active' ? '🛍️' : '🗂️',
            title: tab === 'active' ? 'No active orders' : 'No past orders yet',
            body: tab === 'active' ? 'Place an order from your basket and track it here.' : 'Collected and cancelled orders move here.',
            actionHtml: tab === 'active' ? '<button class="btn btn-primary" data-go-shop>Shop now</button>' : '',
          })}
      </div>`;

    outlet.querySelectorAll('[data-tab]').forEach(button => {
      button.addEventListener('click', () => { tab = button.dataset.tab; draw(); });
    });
    outlet.querySelectorAll('[data-open-order]').forEach(button => {
      button.addEventListener('click', () => navigate(`#/order/${button.dataset.openOrder}`));
    });
    outlet.querySelector('[data-go-shop]')?.addEventListener('click', () => navigate('#/categories'));
  };

  onView('orders', draw);
  draw();
}
