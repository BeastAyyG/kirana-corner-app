// Product detail page (PDP).
import { state } from '../state.js';
import { esc, icon, productCardHtml, emptyState, stepperHtml } from '../ui.js';
import { navigate, onView } from '../router.js';
import { api } from '../api.js';
import { money } from '../format.js';
import { artFor } from '../art.js';

export async function renderProduct(outlet, { productId }) {
  const draw = product => {
    const qty = Number(state.basket[product.id] || 0);
    const saved = state.saved.some(item => item.product_id === product.id);
    const similar = state.products.filter(item => item.category === product.category && item.id !== product.id).slice(0, 6);
    const out = product.available < 1;
    outlet.innerHTML = `
      <div class="subbar">
        <button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button>
        <h1>${esc(product.category)}</h1>
        <button class="icon-btn p-save-top ${saved ? 'on' : ''}" data-toggle-save="${esc(product.id)}" aria-label="Save item" aria-pressed="${saved}">${icon('heart')}</button>
      </div>
      <div class="pdp-art"><img src="${product.image_url || artFor(product)}" alt="${esc(product.name)}"></div>
      <div class="pdp-body">
        <h1>${esc(product.name)}</h1>
        <div class="flex-between">
          <span class="pill pill-gray">${esc(product.unit)}</span>
          ${out ? '<span class="pill pill-red">Out of stock</span>'
            : product.available <= 3 ? `<span class="pill pill-amber">Only ${product.available} left</span>`
            : `<span class="pill pill-green">${product.available} in stock</span>`}
        </div>
        <div class="pdp-price-row">
          <div class="price"><strong>${money(product.price_minor)}</strong><span class="tiny muted">pay at store</span></div>
          ${out ? '' : qty
            ? stepperHtml(product, qty)
            : `<button class="add-btn" data-qty-plus="${esc(product.id)}">ADD</button>`}
        </div>
        <p class="pdp-desc">${esc(product.description || 'Stocked by your neighbourhood kirana. Ask the shopkeeper at pickup for anything else you need.')}</p>
        <div class="pdp-points">
          <div class="pdp-point"><span class="dot">${icon('check')}</span><span>Reserved for you in a labeled bag once ordered</span></div>
          <div class="pdp-point"><span class="dot">${icon('check')}</span><span>Collect during your chosen 30-minute pickup slot</span></div>
          <div class="pdp-point"><span class="dot">${icon('check')}</span><span>Pay the shop directly at handover — no online payment</span></div>
        </div>
        ${similar.length ? `<div class="section-title"><h2>More in ${esc(product.category)}</h2></div>
          <div class="hrail">${similar.map(item => productCardHtml(item, {
            qty: Number(state.basket[item.id] || 0),
            saved: state.saved.some(row => row.product_id === item.id),
            rail: true,
          })).join('')}</div>` : ''}
      </div>
      ${!out ? `<div class="pdp-cta">
        <div class="grow"><strong>${money(product.price_minor)} · ${esc(product.unit)}</strong><span>${product.available} on the shelf at ${esc(state.store?.name || 'the shop')}</span></div>
        ${qty
          ? stepperHtml(product, qty)
          : `<button class="add-btn" data-qty-plus="${esc(product.id)}">ADD</button>`}
      </div>` : ''}`;

    outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());
  };

  let product = state.products.find(item => item.id === productId);
  if (!product) {
    try {
      const result = await api.product(state.store.id, productId);
      product = result.product;
    } catch {
      outlet.innerHTML = `<div class="subbar"><button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button><h1>Item</h1></div>
        ${emptyState({ emoji: '🔎', title: 'Item not found', body: 'It may have been removed from the shelf. Browse the categories instead.', actionHtml: '<button class="btn btn-primary" data-go-home>Go home</button>' })}`;
      outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());
      outlet.querySelector('[data-go-home]')?.addEventListener('click', () => navigate('#/home'));
      return;
    }
  }
  draw(product);
  onView('basket', () => draw(product));
  onView('saved', () => draw(product));
}
