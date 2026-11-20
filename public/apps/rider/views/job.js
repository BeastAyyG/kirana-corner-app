// Active delivery workspace: live route, store & drop stop cards with external
// maps navigation, pickup-code confirmation, delivery OTP entry, COD cash
// toggle and the delivered success state. SSE on the order channel + poll.
import { api, openStream } from '../../_shared/api.js';
import { icon, esc, toast, routeCard, emptyState, spinner } from '../../_shared/ui.js';
import { money, dateTime, phonePretty } from '../../_shared/format.js';
import { state, bus, refreshJobs, refreshEarnings } from '../state.js';
import { jobPayMinor, jobChip, paymentPill, tripLabel, tripKm, etaMinutes, haversineKm, navigateTo } from '../helpers.js';

const POLL_MS = 12000;
const OTP_LENGTH = 4;

export async function jobView(outlet, params, query, { router }) {
  const id = params.id;
  outlet.innerHTML = `<div class="page">${spinner('Loading delivery…')}</div>`;

  let job = state.jobs.find(j => j.id === id) || null;
  if (!job) {
    await refreshJobs();
    job = state.jobs.find(j => j.id === id) || null;
  }
  if (!job) {
    outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🔍', title: 'Delivery not found', body: 'This job may have been reassigned or removed.', actionHtml: '<button class="btn btn-primary" data-nav="/">Back to jobs</button>' })}</div>`;
    return;
  }

  let disposed = false;
  let riderLoc = state.rider?.location || null;
  let otpDigits = ['', '', '', ''];
  let cashFlag = false;
  let showManual = false;
  let busy = false;

  /* ---------- route ---------- */
  function progress() {
    if (job.status === 'delivered') return 1;
    if (job.status === 'picked_up') {
      const total = tripKm(job);
      if (riderLoc && total > 0) {
        const left = haversineKm(riderLoc.lat, riderLoc.lng, job.drop?.lat, job.drop?.lng);
        return Math.max(0.5, Math.min(0.98, 0.5 + 0.48 * (1 - left / total)));
      }
      return 0.5;
    }
    return 0.05;
  }
  function routeHtml() {
    const live = job.status === 'accepted' || job.status === 'picked_up';
    const etaText = job.status === 'delivered' ? 'Delivered'
      : job.status === 'picked_up' ? `~${etaMinutes(job)} min to drop`
      : `${tripLabel(job)} trip`;
    return routeCard({
      storeName: job.store?.name || 'Store',
      addressLabel: job.drop?.receiver_name || 'Customer',
      progress: progress(),
      riderName: state.rider?.name || state.user?.name || '',
      etaText, live,
    });
  }
  function updateRoute() {
    const host = outlet.querySelector('.route-card');
    if (host) host.outerHTML = routeHtml();
  }

  /* ---------- pieces ---------- */
  function stopCards() {
    const store = job.store || {};
    const drop = job.drop || {};
    return `
      <div class="stop-card">
        <span class="sc-step">Stop 1 · Pickup</span>
        <div class="sc-head">
          <span class="sc-ico store">${icon('store')}</span>
          <div class="sc-main"><strong>${esc(store.name || 'Store')}</strong><span>${esc(store.address || '')}</span></div>
        </div>
        <button class="navigate-btn" data-navigate="store">${icon('navigation')} Navigate to store</button>
      </div>
      <div class="stop-card">
        <span class="sc-step">Stop 2 · Drop-off</span>
        <div class="sc-head">
          <span class="sc-ico home">${icon('home')}</span>
          <div class="sc-main"><strong>${esc(drop.receiver_name || 'Customer')}</strong><span>${esc(drop.full_address || '')}</span>${drop.receiver_phone ? `<span>${esc(phonePretty(drop.receiver_phone))}</span>` : ''}</div>
          ${drop.receiver_phone ? `<a class="sc-call" href="tel:${esc(drop.receiver_phone)}" aria-label="Call customer">${icon('phone')}</a>` : ''}
        </div>
        <button class="navigate-btn" data-navigate="drop">${icon('navigation')} Navigate to customer</button>
      </div>
      ${job.delivery_instructions ? `<div class="notice notice-info">${icon('alert')} <span>${esc(job.delivery_instructions)}</span></div>` : ''}`;
  }

  function summaryCard() {
    const cod = job.payment_method === 'cod';
    return `
      <div class="kv-list">
        <div class="kv-row"><span class="k">Order</span><span class="v">${esc(job.public_label || job.order_id)}</span></div>
        <div class="kv-row"><span class="k">You earn</span><span class="v big">${money(jobPayMinor(job))}${Number(job.tip_minor || 0) > 0 ? ` <span class="pill pill-green">${icon('gift')} incl. ${money(job.tip_minor)} tip</span>` : ''}</span></div>
        <div class="kv-row"><span class="k">Payment</span><span class="v">${paymentPill(job)}</span></div>
        ${cod ? `<div class="kv-row"><span class="k">Cash to collect</span><span class="v big">${money(job.cash_to_collect_minor)}</span></div>` : ''}
        <div class="kv-row"><span class="k">Trip distance</span><span class="v">${esc(tripLabel(job))}</span></div>
        ${job.accepted_at ? `<div class="kv-row"><span class="k">Accepted</span><span class="v">${esc(dateTime(job.accepted_at))}</span></div>` : ''}
      </div>`;
  }

  function pickupStage() {
    return `
      <div class="section-title"><h2>${icon('scan')} Confirm pickup</h2></div>
      <div class="code-card">
        <div class="cc-label">Pickup code — show / collect at store</div>
        <div class="cc-code">${esc(job.pickup_code || '······')}</div>
        <div class="cc-note">Collect the sealed bag for ${esc(job.public_label || 'this order')} from the counter</div>
      </div>
      <div class="spacer-8"></div>
      <button class="btn btn-primary block" data-pickup ${busy ? 'disabled' : ''}>${icon('box')} Confirm pickup</button>
      <div class="manual-code">
        <button class="mc-toggle" data-manual-toggle>${icon('edit')} ${showManual ? 'Hide manual entry' : 'Store gave you a different code? Enter it manually'}</button>
        ${showManual ? `
          <div class="code-input">
            <input type="text" inputmode="text" maxlength="6" data-manual-code placeholder="6-CHAR CODE" autocomplete="off" aria-label="Pickup code from the store">
            <button class="btn btn-outline" data-pickup-manual ${busy ? 'disabled' : ''}>Confirm</button>
          </div>` : ''}
      </div>
      <div class="demo-hint">${icon('bolt')} Demo: the code above is issued to you by the API, so you can confirm pickup yourself. In production the store reads it from the packed order.</div>`;
  }

  function deliverStage() {
    const cod = job.payment_method === 'cod';
    const ready = otpDigits.every(d => d !== '') && (!cod || cashFlag);
    return `
      <div class="section-title"><h2>${icon('shield')} Delivery OTP</h2></div>
      <div class="otp-entry" data-otp-entry>
        ${otpDigits.map((d, i) => `<input type="tel" inputmode="numeric" maxlength="1" data-delivery-digit="${i}" value="${esc(d)}" aria-label="Delivery OTP digit ${i + 1}">`).join('')}
      </div>
      <p class="otp-hint">Ask the customer to read the 4-digit code from their Track screen in the Kirana Corner customer app.</p>
      ${cod ? `
        <div class="toggle-card">
          <div class="toggle-row">
            <div class="tg-main">
              <strong>Cash collected · ${money(job.cash_to_collect_minor)}</strong>
              <span>${cashFlag ? 'Cash in hand — you can complete the delivery.' : 'Collect the exact cash before handing over the bag.'}</span>
            </div>
            <button class="switch" role="switch" aria-checked="${cashFlag}" data-cash-toggle aria-label="Cash collected"></button>
          </div>
        </div>` : ''}
      <div class="spacer-8"></div>
      <button class="btn btn-primary block" data-deliver ${busy || !ready ? 'disabled' : ''}>${icon('check')} Complete delivery${cod && !cashFlag ? ' (collect cash first)' : ''}</button>`;
  }

  function deliveredStage() {
    const cod = job.payment_method === 'cod';
    return `
      <div class="done-card">
        <span class="dn-check">${icon('check')}</span>
        <h2>Delivered!</h2>
        <span class="dn-label">${esc(job.public_label || job.id)} · ${esc(job.drop?.receiver_name || 'Customer')} · ${esc(dateTime(job.delivered_at))}</span>
        <span class="dn-pay">${money(jobPayMinor(job))}<small>Credited to your earnings</small></span>
        ${cod ? `<span class="dn-cash">${icon('cash')} ${job.cash_collected ? `${money(job.cash_to_collect_minor)} cash collected — deposit at the store` : 'No cash collected'}</span>` : ''}
      </div>
      <div class="spacer-16"></div>
      <button class="btn btn-primary block" data-nav="/">${icon('bike')} Back to jobs</button>
      <div class="spacer-8"></div>
      <button class="btn btn-ghost block" data-nav="/earnings">${icon('wallet')} View earnings</button>`;
  }

  function inactiveStage() {
    const copy = {
      offered: 'This offer is still waiting for your response on the Jobs screen.',
      declined: 'You declined this offer. It went to another rider.',
      expired: 'This offer expired before it was accepted.',
      cancelled: 'This order was cancelled.',
    }[job.status] || 'This job is no longer active.';
    return `<div class="notice notice-warn">${icon('alert')} <span>${esc(copy)}</span></div>
      <div class="spacer-8"></div>
      <button class="btn btn-primary block" data-nav="/">${icon('bike')} Back to jobs</button>`;
  }

  /* ---------- render ---------- */
  function render() {
    if (disposed) return;
    const showRoute = ['accepted', 'picked_up', 'delivered'].includes(job.status);
    outlet.innerHTML = `
      <div class="page">
        <div class="flex-between">
          <span class="jc-label">${esc(job.public_label || job.id)}</span>
          ${jobChip(job.status)}
        </div>
        ${showRoute ? `<div class="spacer-8"></div>${routeHtml()}` : ''}
        ${job.status === 'accepted' ? pickupStage() : ''}
        ${job.status === 'picked_up' ? deliverStage() : ''}
        ${job.status === 'delivered' ? deliveredStage() : ''}
        ${['accepted', 'picked_up'].includes(job.status) ? stopCards() : ''}
        ${!['offered'].includes(job.status) ? `<div class="section-title"><h2>${icon('receipt')} Delivery summary</h2></div>${summaryCard()}` : ''}
        ${['offered', 'declined', 'expired', 'cancelled'].includes(job.status) ? inactiveStage() : ''}
      </div>`;
    wire();
  }

  /* ---------- interactions ---------- */
  function wire() {
    outlet.querySelectorAll('[data-navigate]').forEach(btn => btn.addEventListener('click', () => {
      const target = btn.dataset.navigate === 'store' ? job.store : job.drop;
      if (typeof target?.lat === 'number' && typeof target?.lng === 'number') navigateTo(target.lat, target.lng);
      else toast('No coordinates available for this stop', 'error');
    }));
    outlet.querySelector('[data-pickup]')?.addEventListener('click', () => confirmPickup(job.pickup_code || ''));
    outlet.querySelector('[data-manual-toggle]')?.addEventListener('click', () => { showManual = !showManual; render(); });
    outlet.querySelector('[data-pickup-manual]')?.addEventListener('click', () => {
      const code = (outlet.querySelector('[data-manual-code]')?.value || '').trim().toUpperCase();
      if (code.length !== 6) { toast('Enter the 6-character pickup code', 'error'); return; }
      confirmPickup(code);
    });
    const entry = outlet.querySelector('[data-otp-entry]');
    if (entry) {
      const inputs = [...entry.querySelectorAll('input')];
      inputs.forEach((input, i) => {
        input.addEventListener('input', () => {
          input.value = input.value.replace(/\D/g, '').slice(0, 1);
          otpDigits[i] = input.value;
          if (input.value && i < inputs.length - 1) inputs[i + 1].focus();
          syncDeliverButton();
        });
        input.addEventListener('keydown', e => {
          if (e.key === 'Backspace' && !input.value && i > 0) inputs[i - 1].focus();
        });
        input.addEventListener('paste', e => {
          const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, OTP_LENGTH);
          if (text.length === OTP_LENGTH) {
            e.preventDefault();
            inputs.forEach((inp, j) => { inp.value = text[j]; otpDigits[j] = text[j]; });
            inputs[OTP_LENGTH - 1].focus();
            syncDeliverButton();
          }
        });
      });
    }
    outlet.querySelector('[data-cash-toggle]')?.addEventListener('click', event => {
      cashFlag = !cashFlag;
      event.currentTarget.setAttribute('aria-checked', String(cashFlag));
      const copy = outlet.querySelector('.toggle-card .tg-main span');
      if (copy) copy.textContent = cashFlag ? 'Cash in hand — you can complete the delivery.' : 'Collect the exact cash before handing over the bag.';
      syncDeliverButton();
    });
    outlet.querySelector('[data-deliver]')?.addEventListener('click', completeDelivery);
  }

  function syncDeliverButton() {
    const btn = outlet.querySelector('[data-deliver]');
    if (!btn) return;
    const cod = job.payment_method === 'cod';
    const ready = otpDigits.every(d => d !== '') && (!cod || cashFlag);
    btn.disabled = busy || !ready;
    btn.innerHTML = `${icon('check')} Complete delivery${cod && !cashFlag ? ' (collect cash first)' : ''}`;
  }

  async function confirmPickup(code) {
    if (busy) return;
    if (!code) { toast('Pickup code unavailable — refresh the job', 'error'); return; }
    busy = true;
    const btn = outlet.querySelector('[data-pickup]');
    if (btn) { btn.disabled = true; btn.innerHTML = `${icon('refresh')} Confirming…`; }
    try {
      const res = await api.pickupJob(id, code);
      job = res.job || job;
      otpDigits = ['', '', '', ''];
      cashFlag = false;
      toast('Pickup confirmed — ride safe!', 'success');
      await Promise.all([refreshJobs(), refreshEarnings()]);
      busy = false;
      render();
    } catch (error) {
      busy = false;
      toast(error.code === 'INVALID_PICKUP_CODE' ? 'That pickup code does not match. Ask the store for the code on the order.' : (error.message || 'Could not confirm pickup'), 'error');
      render();
    }
  }

  async function completeDelivery() {
    if (busy) return;
    const code = otpDigits.join('');
    if (code.length !== OTP_LENGTH) { toast('Enter the 4-digit delivery OTP', 'error'); return; }
    const cod = job.payment_method === 'cod';
    if (cod && !cashFlag) { toast(`Collect ${money(job.cash_to_collect_minor)} in cash first`, 'error'); return; }
    busy = true;
    const btn = outlet.querySelector('[data-deliver]');
    if (btn) { btn.disabled = true; btn.innerHTML = `${icon('refresh')} Completing…`; }
    try {
      const res = await api.deliverJob(id, { delivery_otp: code, cash_collected: cod ? cashFlag : false });
      job = res.job || job;
      toast(`Delivered! ${money(jobPayMinor(job))} credited`, 'success');
      await Promise.all([refreshJobs(), refreshEarnings()]);
      busy = false;
      render();
    } catch (error) {
      busy = false;
      if (error.code === 'INVALID_DELIVERY_OTP') {
        toast('Wrong OTP — ask the customer to read it again from their Track screen.', 'error', 3600);
        otpDigits = ['', '', '', ''];
        render();
        const entry = outlet.querySelector('[data-otp-entry]');
        entry?.classList.add('shake');
        entry?.querySelector('input')?.focus();
      } else {
        toast(error.message || 'Could not complete delivery', 'error');
        syncDeliverButton();
      }
    }
  }

  /* ---------- live wiring ---------- */
  async function refetch() {
    if (disposed) return;
    await refreshJobs();
    const fresh = state.jobs.find(j => j.id === id);
    if (!fresh) return;
    const changed = fresh.status !== job.status || fresh.pickup_code !== job.pickup_code;
    job = fresh;
    if (changed && !busy) render();
  }

  render();
  const stream = openStream({
    orderId: job.order_id,
    events: ['order.status', 'rider.location', 'order.cancelled'],
    onEvent: (name, data) => {
      if (disposed) return;
      if (name === 'rider.location' && data) {
        riderLoc = { lat: data.lat, lng: data.lng };
        updateRoute();
        return;
      }
      if (name === 'order.status' || name === 'order.cancelled') refetch();
    },
  });
  const poll = setInterval(refetch, POLL_MS);
  const offOnline = bus.on('online', () => { /* presence changes don't alter this job */ });

  return () => {
    disposed = true;
    stream?.close();
    clearInterval(poll);
    offOnline();
  };
}