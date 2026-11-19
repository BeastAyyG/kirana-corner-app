// Basket quantity operations shared by every view (grid cards, PDP, cart).
import { state, setQty, queueBasketSync } from './state.js';
import { toast, syncAddControls } from './ui.js';

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
  syncAddControls(productId);
}