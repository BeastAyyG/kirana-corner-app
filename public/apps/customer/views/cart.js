// Basket: line items with steppers, Now/Later delivery, coupon picker, scheduled
// slot grid, and a live bill from POST /cart/quote. Proceeds to checkout.
import { api } from '../../_shared/api.js';
import { icon, billHtml, savingsPill, emptyState, esc, toast, sheet, stepperHtml } from '../../_shared/ui.js';
import { artFor } from '../../_shared/art.js';
import { money, moneyExact, isoDate, nextDate, dateLabel, slotRange } from '../../_shared/format.js';
import { state, bus, refreshCart, cartCount, cartTotal } from '../state.js';

const deliveryTypeApi = () => state.deliveryType === 'later' ? 'scheduled' : 'instant';

export async function cartView(outlet, params, query, { router }) {
  let quote = null;
  let quoteError = '';
  let slotDate = isoDate();
  let slots = [];
  let quoteSeq = 0;

  await refreshCart();

  function render() {
    if (!state.cart.items.length) {
      outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🧺', title: 'Your basket is empty', body: 'Add fresh groceries and they will show up here.', actionHtml: '<button class="btn btn-primary" data-nav="/browse">Start shopping</button>' })}</div>`;
      return;
    }
    outlet.innerHTML = `
      <div class="page has-cta">
        ${state.store ? `<div class="save-strip">${icon('bolt')} Delivery in ${esc(state.serviceability?.eta_minutes ?? 15)} min from ${esc(state.store.name)}</div>` : ''}
        <div class="cart-items" data-lines>${linesHtml()}</div>
        <div class="cart-delivery-head"><strong>${icon('truck')} Delivery type</strong><span>${state.deliveryType === 'later' ? 'Pick a slot' : 'As fast as possible'}</span></div>
        <div class="nowlater" data-nowlater>
          <button data-delivery="now" aria-pressed="${state.deliveryType !== 'later'}">${icon('bolt')} Now <small>${esc(state.serviceability?.eta_minutes ?? 15)} min</small></button>
          <button data-delivery="later" aria-pressed="${state.deliveryType === 'later'}">${icon('clock')} Later <small>Choose slot</small></button>
        </div>
        <div data-slot-section>${state.deliveryType === 'later' ? slotSectionHtml() : ''}</div>
        <button class="coupon-row" data-coupon>
          <span class="cp-ico">${icon('percent')}</span>
          <span class="cp-main"><strong>${state.couponCode ? esc(state.couponCode) + ' applied' : 'Apply coupon'}</strong><span>${state.couponCode ? 'Tap to change or remove' : `${state.coupons.length} offers available`}</span></span>
          ${state.couponCode ? `<span class="cp-remove" data-coupon-remove>${icon('close')}</span>` : icon('chevronRight', 'cp-go')}
        </button>
        <div data-bill>${quote ? billHtml(quote.bill) : '<div class="bill"><div class="bill-title">' + icon('receipt') + ' Bill details</div><p class="muted tiny">Calculating…</p></div>'}</div>
        ${quoteError ? `<div class="notice notice-error">${icon('alert')} ${esc(quoteError)}</div>` : ''}
        <button class="checkout-cta" data-checkout ${quoteError || !state.address ? 'disabled' : ''}>
          <span class="cta-copy"><strong data-cta-total>${money(quote?.bill?.grand_total_minor ?? cartTotal())}</strong><span>${cartCount()} item${cartCount() === 1 ? '' : 's'}${quote?.bill?.savings_minor ? ' · savings applied' : ''}</span></span>
          <span class="cta-go">Checkout ${icon('arrowRight')}</span>
        </button>
      </div>`;
    wire();
  }

  function linesHtml() {
    return state.cart.items.map(item => {
      const mrp = Number(item.mrp_minor || 0);
      const showMrp = mrp > item.price_minor;
      return `<div class="cart-line" data-line="${esc(item.id)}">
        <img class="cl-art" src="${esc(artFor(item))}" data-art-id="${esc(item.id)}" data-art-cat="${esc(item.category_id || '')}" alt="" loading="lazy">
        <div class="cl-main">
          <div class="cl-name">${esc(item.name)}</div>
          <div class="cl-sub">${esc(item.unit)}</div>
          <div class="cl-price"><strong>${money(item.price_minor)}</strong>${showMrp ? `<span class="mrp">${money(mrp)}</span>` : ''}</div>
          ${item.price_changed ? `<div class="warn-line">${icon('alert')} Price updated since you added it</div>` : ''}
        </div>
        <div class="cl-right">
          <div data-add-control="${esc(item.id)}" data-variant="tint">${stepperHtml(item, item.quantity, 'tint')}</div>
          <strong class="tiny">${moneyExact(item.line_total_minor ?? item.price_minor * item.quantity)}</strong>
        </div>
      </div>`;
    }).join('');
  }

  function slotSectionHtml() {
    const dates = [isoDate(), nextDate(isoDate()), nextDate(nextDate(isoDate()))];
    return `<div class="slot-section">
      <div class="ss-head"><strong>${icon('clock')} Choose a delivery slot</strong><span>Free cancellation</span></div>
      <div class="date-switch">${dates.map(d => `<button class="date-btn" data-slot-date="${d}" aria-pressed="${d === slotDate}">${esc(dateLabel(d))}<small>${esc(d.slice(8))}/${esc(d.slice(5, 7))}</small></button>`).join('')}</div>
      <div class="slot-grid" data-slot-grid>${slots.length ? slots.map(s => `
        <button class="slot-chip" data-slot="${esc(s.id)}" aria-pressed="${s.id === state.slotId}" ${s.remaining < 1 ? 'disabled' : ''}>
          ${esc(slotRange(s.starts_at, s.ends_at))}<small>${s.remaining < 1 ? 'Full' : s.remaining + ' left'}</small>
        </button>`).join('') : '<div class="slot-empty">Loading slots…</div>'}</div>
    </div>`;
  }

  function wire() {
    outlet.querySelectorAll('[data-delivery]').forEach(btn => btn.addEventListener('click', () => {
      state.deliveryType = btn.dataset.delivery === 'later' ? 'later' : 'now';
      if (state.deliveryType === 'later') loadSlots();
      render(); refreshQuote();
    }));
    outlet.querySelector('[data-coupon]')?.addEventListener('click', e => {
      if (e.target.closest('[data-coupon-remove]')) { state.couponCode = ''; render(); refreshQuote(); return; }
      openCoupons();
    });
    outlet.querySelector('[data-checkout]')?.addEventListener('click', () => {
      if (!state.address) { toast('Add a delivery address first', 'error'); router.navigate('/addresses'); return; }
      router.navigate('/checkout');
    });
    wireSlots();
  }

  function wireSlots() {
    outlet.querySelectorAll('[data-slot-date]').forEach(btn => btn.addEventListener('click', () => {
      slotDate = btn.dataset.slotDate; state.slotId = ''; loadSlots();
    }));
    outlet.querySelectorAll('[data-slot]').forEach(btn => btn.addEventListener('click', () => {
      state.slotId = btn.dataset.slot;
      outlet.querySelectorAll('[data-slot]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.slot === state.slotId)));
      refreshQuote();
    }));
  }

  async function loadSlots() {
    if (!state.store) return;
    try {
      const res = await api.slots(state.store.id, slotDate);
      slots = res.slots || [];
      const section = outlet.querySelector('[data-slot-section]');
      if (section && state.deliveryType === 'later') { section.innerHTML = slotSectionHtml(); wireSlots(); }
    } catch { slots = []; }
  }

  async function openCoupons() {
    const promise = sheet(`<div data-coupon-list>${state.coupons.length ? state.coupons.map(c => `
      <div class="coupon-card ${c.code === state.couponCode ? 'is-applied' : ''}">
        <div class="cu-top"><span class="cu-code">${esc(c.code)}</span><button class="cu-apply" data-apply-coupon="${esc(c.code)}">${c.code === state.couponCode ? 'Applied ✓' : 'Apply'}</button></div>
        <div class="cu-desc">${esc(c.description || '')}</div>
        <div class="cu-terms">${c.min_order_minor ? `Min order ${money(c.min_order_minor)}` : 'No minimum'}${c.per_user_limit ? ` · ${c.per_user_limit} use per customer` : ''}</div>
      </div>`).join('') : '<p class="muted">No coupons available right now.</p>'}</div>`, { title: 'Coupons & offers' });
    const host = document.getElementById('sheet-host');
    host.querySelectorAll('[data-apply-coupon]').forEach(btn => btn.addEventListener('click', () => {
      state.couponCode = btn.dataset.applyCoupon;
      host.querySelector('[data-sheet-close]')?.click();
      render(); refreshQuote();
      toast(`${state.couponCode} applied`, 'success');
    }));
    await promise;
  }

  async function refreshQuote() {
    if (!state.cart.items.length || !state.address) { quote = null; return; }
    const seq = ++quoteSeq;
    try {
      const res = await api.quote({
        address_id: state.address.id, coupon_code: state.couponCode,
        delivery_type: deliveryTypeApi(), tip_minor: 0,
      });
      if (seq !== quoteSeq) return;
      quote = res.quote || res;
      quoteError = '';
    } catch (error) {
      if (seq !== quoteSeq) return;
      quote = null;
      quoteError = error.message || 'Could not calculate bill';
    }
    const billHost = outlet.querySelector('[data-bill]');
    if (billHost) billHost.innerHTML = quote ? billHtml(quote.bill) : '';
    const total = outlet.querySelector('[data-cta-total]');
    if (total) total.textContent = money(quote?.bill?.grand_total_minor ?? cartTotal());
    const cta = outlet.querySelector('[data-checkout]');
    if (cta) cta.disabled = Boolean(quoteError) || !state.address;
    const errHost = outlet.querySelector('.notice-error');
    if (quoteError && !errHost) {
      const billEl = outlet.querySelector('[data-bill]');
      billEl?.insertAdjacentHTML('afterend', `<div class="notice notice-error">${icon('alert')} ${esc(quoteError)}</div>`);
    } else if (!quoteError && errHost) errHost.remove();
  }

  const offCart = bus.on('cart', () => { render(); refreshQuote(); });
  render();
  await refreshQuote();
  if (state.deliveryType === 'later') await loadSlots();
  return () => offCart();
}