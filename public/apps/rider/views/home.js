// Rider home: availability card, today's stats, live offer cards with a
// countdown ring, active jobs and recent completions. SSE + 10s poll fallback.
import { api, openStream } from '../../_shared/api.js';
import { icon, esc, toast, emptyState, askConfirm } from '../../_shared/ui.js';
import { money, dateTime } from '../../_shared/format.js';
import { state, bus, refreshJobs, refreshEarnings, offeredJobs, activeJobs, pastJobs } from '../state.js';
import { jobPayMinor, jobChip, paymentPill, tripLabel, offerExpiresAt, OFFER_WINDOW_MS, RING_RADIUS, RING_CIRC } from '../helpers.js';

const TICK_MS = 250;
const POLL_MS = 10000;
const URGENT_SECONDS = 15;
const PAST_LIMIT = 8;

export async function homeView(outlet, params, query, { router }) {
  let disposed = false;
  let lastJobsSig = '';
  let lastEarnSig = '';

  /* ---------- render ---------- */
  function presenceCard() {
    return `
      <div class="toggle-card">
        <div class="toggle-row">
          <div class="tg-main">
            <strong>${state.online ? "You're online" : "You're offline"}</strong>
            <span>${state.online ? 'New delivery offers will pop up here automatically.' : 'Go online to receive delivery offers near your store.'}</span>
          </div>
          <button class="switch" role="switch" aria-checked="${state.online}" data-online-toggle aria-label="${state.online ? 'Go offline' : 'Go online'}"></button>
        </div>
        <div class="presence-strip ${state.online ? 'online' : 'offline'}">
          ${icon(state.online ? 'location' : 'clock')}
          ${state.online ? 'Sharing your location with live orders while on duty.' : 'Your location is not shared while off duty.'}
        </div>
      </div>`;
  }

  function statRow() {
    const today = state.earnings?.today || { deliveries: 0, total_minor: 0, tips_minor: 0 };
    return `
      <div class="rider-stat-row">
        <div class="stat-tile accent-ready"><strong>${today.deliveries}</strong><span>Deliveries</span></div>
        <div class="stat-tile"><strong>${money(today.total_minor)}</strong><span>Today</span></div>
        <div class="stat-tile accent-cash"><strong>${money(today.tips_minor)}</strong><span>Tips</span></div>
      </div>`;
  }

  function countdownRing(job) {
    const remain = Math.max(0, offerExpiresAt(job) - Date.now());
    const secs = Math.ceil(remain / 1000);
    const offset = RING_CIRC * (1 - remain / OFFER_WINDOW_MS);
    return `
      <svg class="oc-ring ${secs <= URGENT_SECONDS ? 'is-urgent' : ''}" data-offer-ring="${esc(job.id)}" data-expires="${offerExpiresAt(job)}"
        viewBox="0 0 46 46" width="46" height="46" role="img" aria-label="Offer expires in ${secs} seconds">
        <circle class="oc-track" cx="23" cy="23" r="${RING_RADIUS}" fill="none" stroke-width="4.5"/>
        <circle class="oc-arc" cx="23" cy="23" r="${RING_RADIUS}" fill="none" stroke-width="4.5" stroke-linecap="round"
          stroke-dasharray="${RING_CIRC.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 23 23)"/>
        <text class="oc-num" x="23" y="27.5" text-anchor="middle">${secs}</text>
      </svg>`;
  }

  function offerCard(job) {
    const cod = job.payment_method === 'cod';
    const expired = offerExpiresAt(job) <= Date.now();
    return `
      <article class="offer-card ${expired ? 'is-expired' : ''}" data-offer-card="${esc(job.id)}">
        <div class="of-head">
          <div><strong>New delivery</strong><span class="of-id">${esc(job.public_label || job.order_id)} · ${esc(tripLabel(job))} trip</span></div>
          <span class="of-pay">${money(jobPayMinor(job))}<small>You earn</small></span>
        </div>
        <div class="of-body">
          <div class="offer-route">
            <div class="offer-stop">
              <span class="os-dot store"></span>
              <div class="os-main"><strong>${esc(job.store?.name || 'Store')}</strong><span>${esc(job.store?.address || '')}</span></div>
            </div>
            <i class="os-line"></i>
            <div class="offer-stop">
              <span class="os-dot home"></span>
              <div class="os-main"><strong>${esc(job.drop?.receiver_name || 'Customer')}</strong><span>${esc(job.drop?.full_address || '')}</span></div>
            </div>
          </div>
          <div class="offer-meta">
            <span class="pill pill-green">${icon('navigation')} ${esc(tripLabel(job))}</span>
            ${paymentPill(job)}
            ${cod ? `<span class="pill pill-amber">${icon('cash')} Collect ${money(job.cash_to_collect_minor)}</span>` : ''}
            ${Number(job.tip_minor || 0) > 0 ? `<span class="pill pill-green">${icon('gift')} ${money(job.tip_minor)} tip</span>` : ''}
          </div>
          <div class="offer-countdown">
            ${countdownRing(job)}
            <div class="oc-copy"><strong>${expired ? 'Offer expired' : `Accept within ${Math.ceil(Math.max(0, offerExpiresAt(job) - Date.now()) / 1000)}s`}</strong>Offers go to the next rider when the timer runs out.</div>
          </div>
        </div>
        <div class="offer-actions">
          <button class="btn btn-outline" data-decline="${esc(job.id)}" ${expired ? 'disabled' : ''}>${icon('close')} Decline</button>
          <button class="btn btn-primary" data-accept="${esc(job.id)}" ${expired ? 'disabled' : ''}>${icon('check')} Accept</button>
        </div>
      </article>`;
  }

  function activeCard(job) {
    return `
      <div class="job-card is-active" role="button" tabindex="0" data-nav="/job/${esc(job.id)}" aria-label="Open delivery ${esc(job.public_label || job.id)}">
        <div class="jc-top"><span class="jc-label">${esc(job.public_label || job.id)}</span>${jobChip(job.status)}</div>
        <div class="jc-route">${icon('store')}<span>${esc(job.store?.name || 'Store')}</span>${icon('arrowRight')}<span>${esc(job.drop?.receiver_name || 'Customer')}</span></div>
        <div class="jc-foot">
          <span class="jc-pay">${money(jobPayMinor(job))}</span>
          <span class="jc-meta">${paymentPill(job)}${job.payment_method === 'cod' ? `<span class="pill pill-amber">${icon('cash')} ${money(job.cash_to_collect_minor)}</span>` : ''}<span class="chev">${icon('chevronRight')}</span></span>
        </div>
      </div>`;
  }

  function pastRow(job) {
    return `
      <div class="row-card">
        <div class="row-main">
          <div class="row-title">${esc(job.public_label || job.id)}</div>
          <div class="row-sub">${esc(dateTime(job.delivered_at))} · ${esc(job.store?.name || '')}</div>
        </div>
        <span class="past-pay">+${money(jobPayMinor(job))}</span>
      </div>`;
  }

  function render() {
    if (disposed) return;
    lastJobsSig = state.jobs.map(j => `${j.id}:${j.status}`).join('|');
    lastEarnSig = JSON.stringify(state.earnings?.today || {});
    const offers = offeredJobs();
    const active = activeJobs();
    const past = pastJobs().slice(0, PAST_LIMIT);
    let body;
    if (!state.online && !active.length && !offers.length) {
      body = `<div class="spacer-16"></div>${emptyState({ emoji: '🛌', title: "You're offline", body: 'Go online to start receiving delivery offers from your home store.', actionHtml: `<button class="btn btn-primary" data-online-toggle>${icon('bolt')} Go online</button>` })}`;
    } else {
      body = `
        ${offers.length ? `<div class="section-title"><h2>${icon('bolt')} Incoming offers</h2><span class="pill pill-amber">${offers.length} live</span></div>${offers.map(offerCard).join('')}` : ''}
        ${active.length ? `<div class="section-title"><h2>${icon('bike')} Active deliveries</h2></div>${active.map(activeCard).join('')}` : ''}
        ${state.online && !offers.length && !active.length ? `<div class="spacer-16"></div><div class="is-waiting">${emptyState({ emoji: '📡', title: 'Waiting for offers…', body: 'Stay online — packed orders near your store are assigned to the nearest rider first.' })}</div>` : ''}
        ${past.length ? `<div class="section-title"><h2>${icon('check')} Recent deliveries</h2><button class="see-all" data-nav="/earnings">Earnings ${icon('chevronRight')}</button></div>${past.map(pastRow).join('')}` : ''}`;
    }
    outlet.innerHTML = `<div class="page">${presenceCard()}${statRow()}${body}</div>`;
    wire();
  }

  /* ---------- interactions ---------- */
  function wire() {
    outlet.querySelectorAll('[data-accept]').forEach(btn => btn.addEventListener('click', () => accept(btn)));
    outlet.querySelectorAll('[data-decline]').forEach(btn => btn.addEventListener('click', () => decline(btn)));
    outlet.querySelectorAll('.job-card[role="button"]').forEach(card => {
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.navigate(card.dataset.nav); }
      });
    });
  }

  async function accept(btn) {
    const id = btn.dataset.accept;
    const card = btn.closest('.offer-card');
    card?.querySelectorAll('button').forEach(b => { b.disabled = true; });
    btn.innerHTML = `${icon('refresh')} Accepting…`;
    btn.classList.add('pop');
    try {
      const res = await api.acceptJob(id);
      toast(`Accepted ${res.job?.public_label || 'delivery'} — head to the store`, 'success');
      await refreshJobs();
      if (!disposed) router.navigate(`/job/${id}`);
    } catch (error) {
      toast(error.code === 'JOB_EXPIRED' ? 'That offer expired — another rider is being assigned.' : (error.message || 'Could not accept'), 'error');
      await refreshJobs();
      if (!disposed) render();
    }
  }

  async function decline(btn) {
    const id = btn.dataset.decline;
    const ok = await askConfirm({ title: 'Decline this offer?', message: 'The order will be offered to the next nearest rider.', confirmLabel: 'Decline offer', cancelLabel: 'Keep it', danger: true });
    if (!ok || disposed) return;
    btn.disabled = true;
    try {
      await api.declineJob(id);
      toast('Offer declined', 'default');
    } catch (error) {
      toast(error.message || 'Could not decline', 'error');
    }
    await refreshJobs();
    if (!disposed) render();
  }

  /* ---------- countdown ring tick (SVG attributes only) ---------- */
  function tickCountdowns() {
    if (disposed) return;
    const now = Date.now();
    let anyExpired = false;
    outlet.querySelectorAll('[data-offer-ring]').forEach(ring => {
      const expires = Number(ring.dataset.expires);
      const remain = Math.max(0, expires - now);
      const secs = Math.ceil(remain / 1000);
      const arc = ring.querySelector('.oc-arc');
      arc?.setAttribute('stroke-dashoffset', (RING_CIRC * (1 - remain / OFFER_WINDOW_MS)).toFixed(2));
      const num = ring.querySelector('.oc-num');
      if (num) num.textContent = String(secs);
      ring.classList.toggle('is-urgent', secs <= URGENT_SECONDS);
      const card = ring.closest('.offer-card');
      const copy = card?.querySelector('.oc-copy strong');
      if (copy) copy.textContent = secs > 0 ? `Accept within ${secs}s` : 'Offer expired';
      if (secs <= 0 && card && !card.dataset.expiredSeen) {
        card.dataset.expiredSeen = '1';
        card.classList.add('is-expired');
        card.querySelectorAll('button').forEach(b => { b.disabled = true; });
        anyExpired = true;
      }
    });
    if (anyExpired) refreshJobs();
  }

  /* ---------- live wiring ---------- */
  // Re-render only when the data actually changed so the 10s poll doesn't
  // replay card animations or reset focus on every tick.
  const offJobs = bus.on('jobs', () => {
    const sig = state.jobs.map(j => `${j.id}:${j.status}`).join('|');
    if (sig !== lastJobsSig) render();
  });
  const offEarnings = bus.on('earnings', () => {
    const sig = JSON.stringify(state.earnings?.today || {});
    if (sig !== lastEarnSig) render();
  });
  const offOnline = bus.on('online', render);
  const stream = openStream({
    events: ['job.offered', 'job.expired', 'availability', 'notification'],
    onEvent: name => {
      if (disposed) return;
      if (name === 'job.offered') {
        refreshJobs();
        toast('New delivery offer!', 'success');
      } else if (name === 'job.expired' || name === 'notification') {
        refreshJobs();
      } else if (name === 'availability') {
        refreshJobs();
      }
    },
  });
  const poll = setInterval(() => { if (!disposed) refreshJobs(); }, POLL_MS);
  const tick = setInterval(tickCountdowns, TICK_MS);

  render();
  refreshEarnings();

  return () => {
    disposed = true;
    stream?.close();
    clearInterval(poll);
    clearInterval(tick);
    offJobs(); offEarnings(); offOnline();
  };
}