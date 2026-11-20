// Basket page (bbnow SmartBasket): packshot lines, tint steppers, savings strip,
// slot picker, bill card and sticky checkout CTA.
import { state, basketLines, basketTotal, basketCount, basketHasIssues, saveBasketLocal, queueBasketSync, setQty } from '../state.js';
import { esc, icon, askConfirm, emptyState, toast, productCardHtml } from '../ui.js';
import { navigate, onView } from '../router.js';
import { dateLabel, nextDate, moneyExact, money } from '../format.js';
import { chooseSlot, refreshSlots, placeOrder } from '../actions.js';
import { artFor } from '../art.js';

export async function renderCart(outlet) {
  if (!state.slots.length && state.store) await refreshSlots(state.store.local_date);

  const draw = () => {
    const lines = basketLines();
    const store = state.store;
    if (!lines.length) {
      outlet.innerHTML = `
        <div class="subbar"><h1>My Basket</h1></div>
        <div class="page">
          ${emptyState({
            image: '/img/categories/vegetables.webp',
            title: 'Your basket is empty',
            body: 'Browse the shelf and add items — then choose a 30-minute pickup slot.',
            actionHtml: '<button class="btn btn-primary" data-go-shop>Start shopping</button>',
          })}
          ${renderSlotSection()}
        </div>`;
      outlet.querySelector('[data-go-shop]')?.addEventListener('click', () => navigate('#/categories'));
      bindSlots();
      return;
    }

    const stale = lines.some(({ product, qty }) => !product.active || qty > product.available);
    const priceChanged = lines.some(({ product }) => state.quotes[product.id] && state.quotes[product.id] !== product.price_minor);
    const issues = basketHasIssues();
    const signedIn = state.session.user?.role === 'shopper';
    const slot = state.slots.find(item => item.id === state.slotId);
    const today = store?.local_date || '';
    const tomorrow = today ? nextDate(today) : '';
    const slotDateValid = state.slotDate === tomorrow ? tomorrow : today;
    const savings = lines.reduce((sum, { product, qty }) => {
      const mrp = Number(product.mrp_minor || 0);
      return sum + (mrp > product.price_minor ? (mrp - product.price_minor) * qty : 0);
    }, 0);

    outlet.innerHTML = `
      <div class="subbar">
        <h1>My Basket</h1>
        <span class="count-note">${basketCount()} item${basketCount() === 1 ? '' : 's'}</span>
        <button class="see-all" data-clear-basket>Clear</button>
      </div>
      <div class="page has-cta">
        ${savings > 0
          ? `<div class="save-strip">${icon('tag')}<span>You saved ${money(savings)} on this order</span></div>`
          : `<div class="save-strip">${icon('shield')}<span>Pay at the shop — no online payment needed</span></div>`}
        ${store && !store.is_open ? `<div class="notice notice-warn">${icon('alert')}<span><strong>${esc(store.name)} is closed right now.</strong> Keep editing the basket and order when it reopens.</span></div>` : ''}
        <div class="cart-items">
          ${lines.map(({ product, qty }) => {
            const quoted = state.quotes[product.id];
            const priceChangedLine = quoted && quoted !== product.price_minor;
            const over = qty > product.available;
            const mrp = Number(product.mrp_minor || 0);
            const showMrp = mrp > product.price_minor;
            return `<div class="cart-line">
              <img class="cl-art" src="${artFor(product)}" alt="" data-art-id="${esc(product.id)}" data-art-cat="${esc(product.category || '')}">
              <div class="cl-main">
                <div class="cl-name">${esc(product.name)}</div>
                <div class="cl-sub">${esc(product.unit)}</div>
                <div class="cl-price"><strong>${money(product.price_minor)}</strong>${showMrp ? `<span class="mrp">${money(mrp)}</span>` : ''}</div>
                ${over ? `<div class="warn-line">${icon('alert')} Only ${product.available} available — reduce quantity</div>` : ''}
                ${priceChangedLine ? `<div class="warn-line">${icon('alert')} Price changed from ${money(quoted)}</div>` : ''}
              </div>
              <div class="cl-right">
                <div class="stepper tint">
                  <button type="button" data-qty-minus="${esc(product.id)}" aria-label="Remove one ${esc(product.name)}">−</button>
                  <output>${qty}</output>
                  <button type="button" data-qty-plus="${esc(product.id)}" aria-label="Add one ${esc(product.name)}" ${qty >= product.available ? 'disabled' : ''}>+</button>
                </div>
                <span class="tiny muted">${money(product.price_minor * qty)}</span>
              </div>
            </div>`;
          }).join('')}
        </div>
        ${stale ? `<div class="notice notice-error">${icon('alert')}<span>Shelf stock changed. Fix the marked quantities before placing the order.</span></div>` : ''}
        ${priceChanged && !stale ? `<div class="notice notice-warn">${icon('alert')}<span>One or more prices changed — the bill below uses the latest prices.</span></div>` : ''}
        ${renderSlotSection(slotDateValid, today, tomorrow)}
        <div class="bill-card">
          <h3>Bill details</h3>
          <div class="bill-row"><span>Item total (${basketCount()} items)</span><span>${money(basketTotal())}</span></div>
          ${savings > 0 ? `<div class="bill-row"><span>Product savings</span><span class="b-save">− ${money(savings)}</span></div>` : ''}
          <div class="bill-row"><span>Service fee</span><span class="b-note">Free — neighbourhood pilot</span></div>
          <div class="bill-row total"><span>To pay at store</span><span>${moneyExact(basketTotal())}</span></div>
        </div>
        ${buyAgainHtml()}
        <button class="checkout-cta" data-place-order>
          <span class="cta-copy"><strong>${signedIn ? 'Place pickup order' : 'Sign in to order'}</strong><span>${slot ? `Slot: ${esc(slot.label)} · ${dateLabel(state.slotDate, today)}` : 'Choose a pickup slot'}</span></span>
          <span class="cta-go">${money(basketTotal())} ${icon('chevronRight')}</span>
        </button>
      </div>`;

    outlet.querySelector('[data-clear-basket]')?.addEventListener('click', async () => {
      const ok = await askConfirm({ title: 'Clear basket?', message: 'All items will be removed from your basket.', confirmLabel: 'Clear', danger: true });
      if (!ok) return;
      for (const id of Object.keys(state.basket)) setQty(id, 0);
      saveBasketLocal();
      queueBasketSync();
    });
    outlet.querySelector('[data-place-order]')?.addEventListener('click', placeOrderFlow);
    bindSlots();
    bindBuyAgain();
  };

  function buyAgainHtml() {
    const past = state.orders.find(order => order.status === 'collected' && order.items?.length);
    if (!past) return '';
    const items = past.items
      .map(item => state.products.find(product => product.id === item.product_id))
      .filter(product => product && product.active && product.available > 0)
      .slice(0, 8);
    if (!items.length) return '';
    return `
      <div class="section-title"><h2>Buy it again</h2><span class="tiny muted">from ${esc(past.public_label)}</span></div>
      <div class="hrail" data-buy-again>${items.map(product => productCardHtml(product, { qty: Number(state.basket[product.id] || 0), rail: true })).join('')}</div>`;
  }
  function bindBuyAgain() { /* add controls use global delegation + syncAddControls */ }

  function renderSlotSection(dateValid, today, tomorrow) {
    const store = state.store;
    const slots = state.slots;
    const day1 = today || store?.local_date || '';
    const day2 = day1 ? nextDate(day1) : '';
    const active = state.slotDate || day1;
    return `<div class="slot-section">
      <div class="ss-head"><strong>Choose a pickup slot</strong><span>${esc(store?.time_zone || 'shop local time')}</span></div>
      ${day1 ? `<div class="date-switch">
        <button class="date-btn" data-slot-date="${esc(day1)}" aria-pressed="${active === day1}"><small>${dateLabel(day1, day1).toUpperCase()}</small>${esc(day1)}</button>
        <button class="date-btn" data-slot-date="${esc(day2)}" aria-pressed="${active === day2}"><small>${dateLabel(day2, day1).toUpperCase()}</small>${esc(day2)}</button>
      </div>` : ''}
      ${slots.length
        ? `<div class="slot-grid">${slots.map(s => `
            <button class="slot-chip" data-pick-slot="${esc(s.id)}" aria-pressed="${state.slotId === s.id}" ${s.remaining < 1 ? 'disabled' : ''}>
              ${esc(s.label)}<small>${s.remaining} left</small>
            </button>`).join('')}</div>`
        : `<div class="slot-empty">No bookable slots on this date${active === day1 ? ' — try tomorrow' : ''}. The shop may be closed or fully booked.</div>`}
    </div>`;
  }

  function bindSlots() {
    outlet.querySelectorAll('[data-slot-date]').forEach(button => {
      button.addEventListener('click', () => {
        state.slotDate = button.dataset.slotDate;
        state.slotId = '';
        refreshSlots(state.slotDate);
      });
    });
    outlet.querySelectorAll('[data-pick-slot]').forEach(button => {
      button.addEventListener('click', () => chooseSlot(button.dataset.pickSlot));
    });
  }

  async function placeOrderFlow() {
    if (state.session.user?.role !== 'shopper') { navigate('#/welcome'); return; }
    if (!state.slotId) { toast('Choose a pickup slot first'); return; }
    if (basketHasIssues()) { toast('Fix the marked items before ordering'); return; }
    const slot = state.slots.find(item => item.id === state.slotId);
    const summary = basketLines().map(line => `${line.product.name} × ${line.qty}`).join(', ');
    const ok = await askConfirm({
      title: `Place order for ${dateLabel(state.slotDate, state.store?.local_date)}?`,
      message: `${summary}\n\nPickup: ${slot?.label} · ${state.store?.name}\nTotal ${money(basketTotal())} — pay at the shop.`,
      confirmLabel: 'Place order',
    });
    if (!ok) return;
    const result = await placeOrder();
    if (result.ok) navigate(`#/order/${result.order.id}?placed=1`);
  }

  onView('basket', draw);
  onView('slots', draw);
  onView('orders', draw);
  draw();
}