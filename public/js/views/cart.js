// Basket page: lines, slot picker, bill, checkout CTA (BB "SmartBasket" style).
import { state, basketLines, basketTotal, basketCount, basketHasIssues, saveBasketLocal, queueBasketSync, setQty } from '../state.js';
import { esc, icon, askConfirm, emptyState, toast } from '../ui.js';
import { navigate, onView } from '../router.js';
import { dateLabel, nextDate, moneyExact, money } from '../format.js';
import { chooseSlot, refreshSlots, placeOrder } from '../actions.js';

export async function renderCart(outlet) {
  // ensure slot data for the current date
  if (!state.slots.length && state.store) await refreshSlots(state.store.local_date);

  const draw = () => {
    const lines = basketLines();
    const store = state.store;
    if (!lines.length) {
      outlet.innerHTML = `
        <div class="subbar"><h1>My Basket</h1></div>
        <div class="page">
          ${emptyState({
            emoji: '🧺',
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
    const slotDateValid = state.slotDate && state.slotDate === today ? today : (state.slotDate === tomorrow ? tomorrow : today);

    outlet.innerHTML = `
      <div class="subbar">
        <h1>My Basket</h1>
        <span class="count-note">${basketCount()} item${basketCount() === 1 ? '' : 's'}</span>
        <button class="see-all" data-clear-basket>Clear</button>
      </div>
      <div class="page has-cta">
        ${store && !store.is_open ? `<div class="notice notice-warn">${icon('alert')}<span><strong>${esc(store.name)} is closed right now.</strong> You can keep editing the basket and order when it reopens.</span></div>` : ''}
        ${lines.map(({ product, qty }) => {
          const quoted = state.quotes[product.id];
          const priceChangedLine = quoted && quoted !== product.price_minor;
          const over = qty > product.available;
          return `<div class="cart-line">
            <div class="cl-main">
              <div class="cl-name">${esc(product.name)}</div>
              <div class="cl-sub">${esc(product.unit)} · ${money(product.price_minor)} each</div>
              ${over ? `<div class="warn-line">${icon('alert')} Only ${product.available} available — reduce quantity</div>` : ''}
              ${priceChangedLine ? `<div class="warn-line">${icon('alert')} Price changed from ${money(quoted)}</div>` : ''}
            </div>
            <div class="cl-right">
              <span class="cl-total">${money(product.price_minor * qty)}</span>
              <div class="stepper" data-stepper="${esc(product.id)}">
                <button type="button" data-qty-minus="${esc(product.id)}" aria-label="Remove one ${esc(product.name)}" ${qty <= 1 ? 'disabled' : ''}>−</button>
                <output>${qty}</output>
                <button type="button" data-qty-plus="${esc(product.id)}" aria-label="Add one ${esc(product.name)}" ${qty >= product.available ? 'disabled' : ''}>+</button>
              </div>
            </div>
          </div>`;
        }).join('')}
        ${stale ? `<div class="notice notice-error">${icon('alert')}<span>Shelf stock changed. Fix the marked quantities before placing the order.</span></div>` : ''}
        ${priceChanged && !stale ? `<div class="notice notice-warn">${icon('alert')}<span>One or more prices changed — the bill below uses the latest prices.</span></div>` : ''}
        ${renderSlotSection(slotDateValid, today, tomorrow)}
        <div class="bill-card">
          <h3>Bill details</h3>
          <div class="bill-row"><span>Item total (${basketCount()} items)</span><span>${money(basketTotal())}</span></div>
          <div class="bill-row"><span>Service fee</span><span class="b-note">Free — neighbourhood pilot</span></div>
          <div class="bill-row total"><span>To pay at store</span><span>${moneyExact(basketTotal())}</span></div>
        </div>
        <button class="checkout-cta" data-place-order ${issues || !slot || !signedIn ? '' : ''}>
          <span class="cta-copy"><strong>${signedIn ? 'Place pickup order' : 'Sign in to order'}</strong><span>${slot ? `Slot: ${esc(slot.label)} · ${dateLabel(state.slotDate, today)}` : 'Choose a pickup slot'}</span></span>
          <span class="cta-go">${money(basketTotal())} ${icon('chevronRight')}</span>
        </button>
      </div>`;

    // line events
    outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());
    outlet.querySelector('[data-clear-basket]')?.addEventListener('click', async () => {
      const ok = await askConfirm({ title: 'Clear basket?', message: 'All items will be removed from your basket.', confirmLabel: 'Clear', danger: true });
      if (!ok) return;
      for (const id of Object.keys(state.basket)) setQty(id, 0);
      saveBasketLocal();
      queueBasketSync();
    });
    outlet.querySelector('[data-place-order]')?.addEventListener('click', placeOrderFlow);
    bindSlots();
  };

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
    if (state.session.user?.role !== 'shopper') {
      navigate('#/welcome');
      return;
    }
    if (!state.slotId) { toast('Choose a pickup slot first'); return; }
    if (basketHasIssues()) { toast('Fix the marked items before ordering'); return; }
    const slot = state.slots.find(item => item.id === state.slotId);
    const summary = `${basketLines().map(line => `${line.product.name} × ${line.qty}`).join(', ')}`;
    const ok = await askConfirm({
      title: `Place order for ${state.slotDate}?`,
      message: `${summary}\n\nPickup: ${slot?.label} · ${state.store?.name}\nTotal ${money(basketTotal())} — pay at the shop.`,
      confirmLabel: 'Place order',
    });
    if (!ok) return;
    const result = await placeOrder();
    if (result.ok) navigate(`#/order/${result.order.id}?placed=1`);
  }

  onView('basket', draw);
  onView('slots', draw);
  draw();
}
