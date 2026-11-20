// Live order tracking: ETA gauge, animated SVG route card driven by SSE
// rider.location, six-step timeline, delivery OTP, rider card, bill and actions.
import { api, openStream } from '../../_shared/api.js';
import { icon, etaGauge, routeCard, statusChip, otpDisplay, billHtml, emptyState, esc, toast, sheet, spinner, askConfirm } from '../../_shared/ui.js';
import { artFor } from '../../_shared/art.js';
import { money, dateTime, dateLabel, slotRange, stepIndex, DELIVERY_STEPS, isTerminal } from '../../_shared/format.js';
import { state, bus } from '../state.js';

function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const BASE_PROGRESS = { placed: 0.04, packing: 0.14, packed: 0.3, rider_assigned: 0.45, picked_up: 0.6, delivered: 1, cancelled: 0 };

export async function trackView(outlet, params, query, { router }) {
  const id = params.id;
  outlet.innerHTML = spinner('Loading order…');
  let order;
  try { order = (await api.order(id)).order; }
  catch {
    outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🔍', title: 'Order not found', body: 'It may have been removed.', actionHtml: '<button class="btn btn-primary" data-nav="/orders">Your orders</button>' })}</div>`;
    return;
  }

  let riderLoc = order.rider?.location || null;
  let stream = null;

  function progress() {
    if (order.status === 'delivered') return 1;
    if (order.status === 'picked_up' && riderLoc && order.store && order.address) {
      const total = haversine(order.store.lat, order.store.lng, order.address.lat, order.address.lng) || 1;
      const left = haversine(riderLoc.lat, riderLoc.lng, order.address.lat, order.address.lng);
      return Math.max(0.6, Math.min(0.98, 0.6 + 0.38 * (1 - left / total)));
    }
    return BASE_PROGRESS[order.status] ?? 0.04;
  }

  function render() {
    const idx = stepIndex(order.status);
    const cancelled = order.status === 'cancelled';
    const eta = order.eta_live_minutes ?? order.eta_promise_minutes ?? state.serviceability?.eta_minutes ?? 15;
    const live = !isTerminal(order.status);
    const scheduled = order.delivery_type === 'scheduled' && order.slot && live;
    const slotWindow = scheduled ? `${dateLabel(order.slot.slot_date)} · ${slotRange(order.slot.starts_at, order.slot.ends_at)}` : '';
    outlet.innerHTML = `
      <div class="page">
        <div class="track-hero">
          ${etaGauge({ progress: progress(), centerTop: cancelled ? '✕' : order.status === 'delivered' ? '✓' : scheduled ? '🕑' : String(eta), centerSub: cancelled ? 'cancelled' : order.status === 'delivered' ? 'delivered' : scheduled ? 'scheduled' : 'min left', color: cancelled ? 'var(--bb-red)' : 'var(--bb-green)' })}
          <div class="th-copy">
            <h2>${esc(order.public_label || 'Order')}</h2>
            ${statusChip(order.status)}
            <p>${cancelled ? esc(order.cancel_reason || 'This order was cancelled.') : order.status === 'delivered' ? 'Delivered. Enjoy your groceries!' : scheduled ? `Scheduled for ${esc(slotWindow)}` : `Arriving in about ${eta} minutes`}</p>
          </div>
        </div>

        ${!cancelled ? routeCard({
          storeName: order.store?.name || 'Store', addressLabel: order.address?.label || 'Home',
          progress: progress(), riderName: order.rider?.name || '', live,
          etaText: order.status === 'delivered' ? 'Delivered' : `${eta} min`,
        }) : ''}

        ${order.rider && !cancelled ? riderCardHtml() : ''}

        ${!cancelled ? `<div class="section-title"><h2>${icon('list')} Order progress</h2></div>
        <div class="timeline six">${DELIVERY_STEPS.map((s, i) => `<div class="t-step ${i <= idx ? 'done' : ''}">${esc(s.label)}</div>`).join('')}</div>` : ''}

        ${order.delivery_otp && live && order.status !== 'placed' ? `<div class="code-card">
          <div class="cc-label">Delivery OTP — share with your rider</div>
          ${otpDisplay(order.delivery_otp)}
          <div class="cc-note">Read this code aloud when your rider arrives</div>
        </div>` : ''}

        ${order.status === 'placed' ? `<button class="btn btn-danger block" data-cancel>${icon('close')} Cancel order</button>` : ''}
        ${order.status === 'delivered' && !order.rating ? `<button class="btn btn-primary block" data-rate>${icon('star')} Rate your order</button>` : ''}
        ${order.rating ? `<div class="save-strip">${icon('star')} You rated this order ${order.rating}/5</div>` : ''}
        ${live && order.rider && ['rider_assigned', 'picked_up'].includes(order.status) ? `<button class="btn btn-ghost block" data-simulate>${icon('bike')} Simulate delivery (demo)</button>` : ''}
        ${live && !order.rider ? `<div class="demo-hint">${icon('bolt')} Demo: pack this order in the Store app and accept it in the Rider app, then simulate the live delivery here.</div>` : ''}

        <div class="section-title"><h2>${icon('basket')} Items</h2></div>
        <div class="cart-items">${order.items.map(it => `
          <div class="cart-line">
            <img class="cl-art" src="${esc(artFor(it))}" data-art-id="${esc(it.id)}" data-art-cat="${esc(it.category_id || '')}" alt="" loading="lazy">
            <div class="cl-main"><div class="cl-name">${esc(it.name)}</div><div class="cl-sub">${esc(it.unit)} · Qty ${it.quantity}</div></div>
            <div class="cl-right"><strong class="tiny">${money(it.line_total_minor ?? it.price_minor * it.quantity)}</strong></div>
          </div>`).join('')}</div>

        ${billHtml(order.bill, { compact: false })}

        <div class="section-title"><h2>${icon('pin')} Delivery details</h2></div>
        <div class="kv-list">
          <div class="kv-row"><span class="k">Address</span><span class="v">${esc(order.address?.full_address || order.address?.line1 || '')}</span></div>
          <div class="kv-row"><span class="k">Payment</span><span class="v">${order.payment_method === 'cod' ? 'Cash on delivery' : 'Paid online'} · ${esc(order.payment_status)}</span></div>
          <div class="kv-row"><span class="k">Placed</span><span class="v">${esc(dateTime(order.placed_at || order.created_at))}</span></div>
          ${order.delivery_instructions ? `<div class="kv-row"><span class="k">Instructions</span><span class="v">${esc(order.delivery_instructions)}</span></div>` : ''}
        </div>
      </div>`;
    wire();
  }

  function riderCardHtml() {
    const r = order.rider;
    const initial = (r.name || 'R').charAt(0).toUpperCase();
    return `<div class="rider-card">
      <span class="rd-avatar">${esc(initial)}</span>
      <div class="rd-main"><strong>${esc(r.name || 'Your rider')}</strong>
        <div class="rd-pills"><span class="pill pill-green">${icon('bike')} ${esc(r.vehicle || 'Bike')}</span>${order.status === 'delivered' ? '<span class="pill pill-green">Delivered</span>' : order.status === 'picked_up' ? '<span class="pill pill-amber">On the way</span>' : '<span class="pill pill-blue">Heading to store</span>'}</div>
      </div>
      ${r.phone ? `<a class="rd-call" href="tel:${esc(r.phone)}" aria-label="Call rider">${icon('phone')}</a>` : ''}
    </div>`;
  }

  function wire() {
    outlet.querySelector('[data-cancel]')?.addEventListener('click', async () => {
      const ok = await askConfirm({ title: 'Cancel order?', message: 'This will cancel your order. Any online payment is refunded.', confirmLabel: 'Cancel order', danger: true });
      if (!ok) return;
      try { const res = await api.cancelOrder(id, 'Changed my mind'); order = res.order; render(); toast('Order cancelled', 'success'); bus.emit('order', null); }
      catch (error) { toast(error.message || 'Could not cancel', 'error'); }
    });
    outlet.querySelector('[data-rate]')?.addEventListener('click', openRate);
    outlet.querySelector('[data-simulate]')?.addEventListener('click', async e => {
      const btn = e.currentTarget; btn.disabled = true; btn.innerHTML = `${icon('refresh')} Simulating…`;
      try { await api.simulate(id); toast('Delivery simulation started', 'success'); }
      catch (error) { toast(error.message || 'Simulation unavailable', 'error'); }
      setTimeout(() => { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = `${icon('bike')} Simulate delivery (demo)`; } }, 32000);
    });
  }

  async function openRate() {
    let rating = 5;
    const promise = sheet(`
      <div class="rate-stars" data-stars>${[1, 2, 3, 4, 5].map(n => `<button data-star="${n}" class="${n <= rating ? 'on' : ''}" aria-label="${n} star">${icon('star')}</button>`).join('')}</div>
      <div class="field"><textarea data-rate-comment rows="2" placeholder="Tell us more (optional)"></textarea></div>
      <button class="btn btn-primary block" data-rate-submit>Submit rating</button>`, { title: 'Rate your order' });
    const host = document.getElementById('sheet-host');
    host.querySelectorAll('[data-star]').forEach(btn => btn.addEventListener('click', () => {
      rating = Number(btn.dataset.star);
      host.querySelectorAll('[data-star]').forEach(b => b.classList.toggle('on', Number(b.dataset.star) <= rating));
    }));
    host.querySelector('[data-rate-submit]')?.addEventListener('click', async () => {
      const comment = host.querySelector('[data-rate-comment]')?.value || '';
      try {
        const res = await api.rateOrder(id, rating, comment);
        order = res.order; host.querySelector('[data-sheet-close]')?.click();
        render(); toast('Thanks for your feedback!', 'success');
      } catch (error) { toast(error.message || 'Could not submit rating', 'error'); }
    });
    await promise;
  }

  function updateRoute() {
    const host = outlet.querySelector('.route-card');
    if (!host) return;
    const eta = order.eta_live_minutes ?? order.eta_promise_minutes ?? 15;
    host.outerHTML = routeCard({
      storeName: order.store?.name || 'Store', addressLabel: order.address?.label || 'Home',
      progress: progress(), riderName: order.rider?.name || '', live: !isTerminal(order.status),
      etaText: order.status === 'delivered' ? 'Delivered' : `${eta} min`,
    });
  }

  async function refetch() {
    try { order = (await api.order(id)).order; riderLoc = order.rider?.location || riderLoc; render(); }
    catch { /* keep last */ }
  }

  render();
  stream = openStream({
    orderId: id,
    events: ['order.status', 'order.placed', 'order.cancelled', 'order.rated', 'order.item_picked', 'rider.location'],
    onEvent: (name, data) => {
      if (name === 'rider.location') { riderLoc = { lat: data.lat, lng: data.lng }; updateRoute(); return; }
      if (name === 'order.status' || name === 'order.placed' || name === 'order.cancelled' || name === 'order.rated') {
        if (data?.status) order.status = data.status;
        refetch();
        if (data?.status === 'delivered') { state.activeOrder = null; bus.emit('order', null); }
      }
    },
  });
  // gentle fallback refresh in case SSE drops
  const poll = setInterval(refetch, 12000);
  return () => { stream?.close(); clearInterval(poll); };
}