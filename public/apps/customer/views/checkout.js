// Checkout: address selection, payment method (COD / online mock), rider tip,
// delivery instructions, live bill, and idempotent order placement.
import { api, newIdempotencyKey } from '../../_shared/api.js';
import { icon, billHtml, emptyState, esc, toast, formSheet, askConfirm } from '../../_shared/ui.js';
import { money, dateLabel, slotRange } from '../../_shared/format.js';
import { state, bus, refreshCart, cartCount, setAddress, resolveServiceability } from '../state.js';

const TIPS = [0, 1000, 2000, 3000];
const deliveryTypeApi = () => state.deliveryType === 'later' ? 'scheduled' : 'instant';

export async function checkoutView(outlet, params, query, { router }) {
  await refreshCart();
  if (!state.cart.items.length) { router.navigate('/cart', { replace: true }); return; }

  let addressId = state.address?.id || '';
  let paymentMethod = 'cod';
  let tipMinor = 0;
  let instructions = '';
  let quote = null;
  let placing = false;
  let quoteSeq = 0;
  let slotLabel = '';

  function render() {
    outlet.innerHTML = `
      <div class="page has-cta">
        <div class="co-section">
          <h3>${icon('pin')} Deliver to <button class="co-edit" data-add-address>+ Add new</button></h3>
          <div data-addresses>${addressesHtml()}</div>
        </div>
        <div class="co-section">
          <h3>${icon('truck')} Delivery</h3>
          <div class="kv-list"><div class="kv-row"><span class="k">Type</span><span class="v">${state.deliveryType === 'later' ? 'Scheduled' : 'Instant (Now)'}</span></div>
          ${state.deliveryType === 'later' && state.slotId ? `<div class="kv-row"><span class="k">Slot</span><span class="v" data-slot-label>${esc(slotLabel || 'Loading…')}</span></div>` : `<div class="kv-row"><span class="k">ETA</span><span class="v">${esc(state.serviceability?.eta_minutes ?? 15)} min</span></div>`}</div>
        </div>
        <div class="co-section">
          <h3>${icon('wallet')} Payment method</h3>
          <button class="pay-row" data-pay="cod" aria-pressed="${paymentMethod === 'cod'}">
            <span class="py-ico">${icon('cash')}</span><span class="py-main"><strong>Cash on delivery</strong><span>Pay when your order arrives</span></span><span class="py-radio"></span>
          </button>
          <button class="pay-row" data-pay="online" aria-pressed="${paymentMethod === 'online'}">
            <span class="py-ico">${icon('card')}</span><span class="py-main"><strong>Pay online</strong><span>UPI / card · instant confirmation</span></span><span class="py-radio"></span>
          </button>
        </div>
        <div class="co-section">
          <h3>${icon('bike')} Tip your rider</h3>
          <div class="tip-row">${TIPS.map(t => `<button class="tip-chip" data-tip="${t}" aria-pressed="${t === tipMinor}">${t === 0 ? 'No tip' : money(t)}</button>`).join('')}</div>
        </div>
        <div class="co-section">
          <h3>${icon('chat')} Delivery instructions</h3>
          <div class="field"><textarea data-instructions rows="2" maxlength="240" placeholder="e.g. Ring the bell, leave at the door">${esc(instructions)}</textarea></div>
        </div>
        <div data-bill>${quote ? billHtml(quote.bill) : ''}</div>
        <button class="checkout-cta" data-place ${placing ? 'disabled' : ''}>
          <span class="cta-copy"><strong data-place-total>${money(quote?.bill?.grand_total_minor ?? 0)}</strong><span>${cartCount()} item${cartCount() === 1 ? '' : 's'} · ${paymentMethod === 'cod' ? 'Pay on delivery' : 'Pay online'}</span></span>
          <span class="cta-go">${placing ? 'Placing…' : 'Place order'} ${icon('check')}</span>
        </button>
      </div>`;
    wire();
  }

  function addressesHtml() {
    if (!state.addresses.length) return emptyState({ emoji: '📍', title: 'No address yet', body: 'Add a delivery address to continue.' });
    return state.addresses.map(a => `
      <button class="addr-card" data-address="${esc(a.id)}" aria-pressed="${a.id === addressId}">
        <span class="ad-ico">${icon(a.label === 'Work' ? 'store' : 'home')}</span>
        <span class="ad-main"><span class="ad-label">${esc(a.label || 'Address')}${a.is_default ? '<span class="pill pill-green">Default</span>' : ''}</span>
        <span class="ad-line">${esc(a.full_address || [a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', '))}</span></span>
        <span class="ad-check">${icon('check')}</span>
      </button>`).join('');
  }

  function wire() {
    outlet.querySelectorAll('[data-address]').forEach(btn => btn.addEventListener('click', async () => {
      addressId = btn.dataset.address;
      const addr = state.addresses.find(a => a.id === addressId);
      setAddress(addr);
      await resolveServiceability(addr);
      render(); refreshQuote();
    }));
    outlet.querySelector('[data-add-address]')?.addEventListener('click', addAddress);
    outlet.querySelectorAll('[data-pay]').forEach(btn => btn.addEventListener('click', () => {
      paymentMethod = btn.dataset.pay;
      outlet.querySelectorAll('[data-pay]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pay === paymentMethod)));
      const sub = outlet.querySelector('[data-place] .cta-copy span');
      if (sub) sub.textContent = `${cartCount()} item${cartCount() === 1 ? '' : 's'} · ${paymentMethod === 'cod' ? 'Pay on delivery' : 'Pay online'}`;
    }));
    outlet.querySelectorAll('[data-tip]').forEach(btn => btn.addEventListener('click', () => {
      tipMinor = Number(btn.dataset.tip);
      outlet.querySelectorAll('[data-tip]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.tip) === tipMinor)));
      refreshQuote();
    }));
    outlet.querySelector('[data-instructions]')?.addEventListener('input', e => { instructions = e.target.value; });
    outlet.querySelector('[data-place]')?.addEventListener('click', placeOrder);
  }

  async function addAddress() {
    const values = await formSheet({
      title: 'Add delivery address', submitLabel: 'Save address',
      fields: [
        { name: 'label', label: 'Label', value: 'Home', placeholder: 'Home / Work' },
        { name: 'receiver_name', label: 'Receiver name', value: state.user?.name || '', required: true },
        { name: 'receiver_phone', label: 'Receiver phone', value: state.user?.phone || '', required: true },
        { name: 'line1', label: 'Address line 1', required: true, placeholder: 'Flat, building, street' },
        { name: 'line2', label: 'Address line 2', placeholder: 'Area, landmark' },
        { name: 'city', label: 'City', value: 'Bengaluru', required: true },
        { name: 'pincode', label: 'Pincode', value: '560034', required: true },
      ],
      note: 'Demo addresses are geocoded near Koramangala so a store can deliver.',
    });
    if (!values) return;
    try {
      // Demo geocode: jitter around the default address so serviceability resolves.
      const base = state.addresses[0] || { lat: 12.939, lng: 77.621 };
      const res = await api.createAddress({ ...values, lat: base.lat + (Math.random() - 0.5) * 0.004, lng: base.lng + (Math.random() - 0.5) * 0.004, is_default: state.addresses.length === 0 });
      const addr = res.address || res;
      state.addresses.push(addr);
      addressId = addr.id; setAddress(addr);
      await resolveServiceability(addr);
      render(); refreshQuote();
      toast('Address added', 'success');
    } catch (error) { toast(error.message || 'Could not add address', 'error'); }
  }

  async function refreshQuote() {
    if (!addressId) return;
    const seq = ++quoteSeq;
    try {
      const res = await api.quote({ address_id: addressId, coupon_code: state.couponCode, delivery_type: deliveryTypeApi(), tip_minor: tipMinor });
      if (seq !== quoteSeq) return;
      quote = res.quote || res;
    } catch (error) {
      if (seq !== quoteSeq) return;
      quote = null; toast(error.message || 'Could not calculate bill', 'error');
    }
    const billHost = outlet.querySelector('[data-bill]');
    if (billHost) billHost.innerHTML = quote ? billHtml(quote.bill) : '';
    const total = outlet.querySelector('[data-place-total]');
    if (total) total.textContent = money(quote?.bill?.grand_total_minor ?? 0);
  }

  async function resolveSlotLabel() {
    if (state.deliveryType !== 'later' || !state.slotId) return;
    const date = state.slotId.split('_').find(p => /^\d{4}-\d{2}-\d{2}$/.test(p));
    if (!date || !state.store) return;
    try {
      const res = await api.slots(state.store.id, date);
      const slot = (res.slots || []).find(s => s.id === state.slotId);
      if (!slot) return;
      slotLabel = `${dateLabel(date)} · ${slotRange(slot.starts_at, slot.ends_at)}`;
      const el = outlet.querySelector('[data-slot-label]');
      if (el) el.textContent = slotLabel;
    } catch { /* keep fallback */ }
  }

  async function placeOrder() {
    if (placing) return;
    if (!addressId) { toast('Select a delivery address', 'error'); return; }
    if (state.deliveryType === 'later' && !state.slotId) { toast('Choose a delivery slot in your basket', 'error'); router.navigate('/cart'); return; }
    if (paymentMethod === 'online') {
      const ok = await askConfirm({ title: 'Pay online', message: `Confirm mock payment of ${money(quote?.bill?.grand_total_minor ?? 0)}? This is a demo gateway — no real money moves.`, confirmLabel: 'Pay now' });
      if (!ok) return;
    }
    placing = true;
    const btn = outlet.querySelector('[data-place]');
    if (btn) { btn.disabled = true; btn.querySelector('.cta-go').innerHTML = `Placing… ${icon('refresh')}`; }
    try {
      const res = await api.createOrder({
        address_id: addressId, store_id: state.cart.store_id, coupon_code: state.couponCode,
        tip_minor: tipMinor, payment_method: paymentMethod, delivery_instructions: instructions,
        delivery_type: deliveryTypeApi(), slot_id: state.deliveryType === 'later' ? state.slotId : null,
      }, newIdempotencyKey());
      const order = res.order;
      if (paymentMethod === 'online' && res.payment?.payment_id) {
        await api.confirmPayment(res.payment.payment_id);
      }
      await refreshCart();
      state.activeOrder = order;
      bus.emit('order', order);
      toast('Order placed!', 'success');
      router.navigate(`/track/${order.id}`, { replace: true });
    } catch (error) {
      placing = false;
      if (btn) { btn.disabled = false; btn.querySelector('.cta-go').innerHTML = `Place order ${icon('check')}`; }
      toast(error.message || 'Could not place order', 'error');
    }
  }

  render();
  await refreshQuote();
  resolveSlotLabel();
}