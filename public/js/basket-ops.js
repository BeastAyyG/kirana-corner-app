// Basket quantity operations shared by every view (grid cards, PDP, cart).
import { state, setQty, queueBasketSync } from './state.js';
import { toast } from './ui.js';
import { money } from './format.js';

export function changeQty(productId, delta) {
  const product = state.products.find(item => item.id === productId);
  if (!product) return;
  const current = Number(state.basket[productId] || 0);
  const next = current + delta;
  if (next > product.available) {
    toast(`Only ${product.available} left on the shelf`);
    return;
  }
  setQty(productId, next, { priceMinor: product.price_minor, available: product.available });
  queueBasketSync();
  // refresh visible stepper/add buttons for this product without re-rendering the view
  document.querySelectorAll(`[data-stepper="${CSS.escape(productId)}"]`).forEach(node => {
    const minus = node.querySelector('[data-qty-minus]');
    const output = node.querySelector('output');
    const plus = node.querySelector('[data-qty-plus]');
    if (output) output.textContent = String(next);
    if (minus) minus.disabled = next <= 1;
    if (plus) plus.disabled = next >= product.available;
  });
  document.querySelectorAll(`[data-product-card="${CSS.escape(productId)}"] .p-foot`).forEach(foot => {
    const add = foot.querySelector('.add-btn');
    if (add && next > 0) {
      foot.innerHTML = `
        <div class="price"><strong>${money(product.price_minor)}</strong></div>
        <div class="stepper" data-stepper="${product.id}">
          <button type="button" data-qty-minus="${product.id}" aria-label="Remove one ${product.name}" ${next <= 1 ? 'disabled' : ''}>−</button>
          <output>${next}</output>
          <button type="button" data-qty-plus="${product.id}" aria-label="Add one ${product.name}" ${next >= product.available ? 'disabled' : ''}>+</button>
        </div>`;
    }
  });
}
