// Packing detail: customer / payment summary, pickup code, aisle-guided pick
// list with full-pick taps, steppers and short picks, live progress, shortage
// refund preview and the start-packing → mark-ready flow. SSE keeps the order
// fresh; picks re-render rows in place so the picker never loses scroll.
import { api, openStream } from '../../_shared/api.js';
import { icon, statusChip, emptyState, esc, toast, spinner, askConfirm, formSheet, billHtml } from '../../_shared/ui.js';
import { artFor } from '../../_shared/art.js';
import { money, dateLabel, slotRange, dateTime, phonePretty, isTerminal } from '../../_shared/format.js';
import { state } from '../state.js';

const REFETCH_DEBOUNCE_MS = 400;
const FALLBACK_POLL_MS = 15000;

export async function orderView(outlet, params, query, { router }) {
  const id = params.id;
  if (!state.store) {
    outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🏬', title: 'No store selected', body: 'Pick a store first.', actionHtml: '<button class="btn btn-primary" data-nav="/">Back to queue</button>' })}</div>`;
    return;
  }
  outlet.innerHTML = `<div class="page">${spinner('Loading order…')}</div>`;
  let order;
  try { order = (await api.storeOrder(state.store.id, id)).order; }
  catch {
    outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🔍', title: 'Order not found', body: 'It may belong to another store or have been removed.', actionHtml: '<button class="btn btn-primary" data-nav="/">Back to queue</button>' })}</div>`;
    return;
  }

  let dead = false;
  let actionBusy = false;
  const busyItems = new Set();
  let stream = null;
  let pollTimer = null;
  let refetchTimer = null;

  const itemById = itemId => order.items.find(it => String(it.id) === String(itemId));
  const totalQty = () => order.items.reduce((n, it) => n + it.quantity, 0);
  const doneCount = () => order.items.filter(it => it.picked_quantity !== null).length;
  const shortages = () => order.items
    .filter(it => it.picked_quantity !== null && it.picked_quantity < it.quantity)
    .map(it => ({ it, short: it.quantity - it.picked_quantity, refund: (it.quantity - it.picked_quantity) * it.price_minor }));
  const refundTotal = () => shortages().reduce((n, s) => n + s.refund, 0);
  const widthBucket = pct => Math.min(100, Math.max(0, Math.round(pct / 5) * 5));

  function progressHtml() {
    const total = order.items.length;
    const done = doneCount();
    const pct = total ? (done / total) * 100 : 0;
    return `<div class="pp-bar"><div class="pp-fill pw-${widthBucket(pct)}" data-pp-fill></div></div>
      <span class="pp-label" data-pp-label>${done}/${total} picked</span>`;
  }

  function shortNoteHtml() {
    const list = shortages();
    if (!list.length || order.status !== 'packing') return '';
    const names = list.map(s => `${esc(s.it.name)} (−${s.short})`).join(', ');
    return `<div class="notice notice-warn">${icon('alert')}<span><strong>${list.length} short pick${list.length === 1 ? '' : 's'}:</strong> ${names}. ${money(refundTotal())} will be refunded when you mark ready.</span></div>`;
  }

  function rowHtml(it) {
    const picked = it.picked_quantity;
    const isFull = picked !== null && picked === it.quantity;
    const isShort = picked !== null && picked < it.quantity;
    const cls = isFull ? 'is-picked' : isShort ? 'is-short' : '';
    const check = isFull ? icon('check') : isShort ? icon('alert') : '';
    const loc = it.aisle
      ? `<span class="aisle">Aisle ${esc(it.aisle)}</span>${it.shelf ? `<span>Shelf ${esc(it.shelf)}</span>` : ''}`
      : '<span>Location not set</span>';
    let controls;
    if (order.status === 'packing') {
      const stepper = picked === null
        ? `<button class="btn btn-primary pk-pick" data-pick-full="${it.id}">Pick</button>`
        : `<div class="stock-stepper">
            <button data-pick-minus="${it.id}" aria-label="Pick one less ${esc(it.name)}" ${picked <= 0 ? 'disabled' : ''}>−</button>
            <output>${picked}</output>
            <button data-pick-plus="${it.id}" aria-label="Pick one more ${esc(it.name)}" ${picked >= it.quantity ? 'disabled' : ''}>+</button>
          </div>`;
      controls = `${stepper}<button class="pk-short-btn" data-pick-short="${it.id}">Short</button>`;
    } else if (picked !== null) {
      controls = `<span class="pk-done ${isShort ? 'short' : ''}">${picked}/${it.quantity} picked</span>`;
      if (it.refunded_minor > 0) controls += `<span class="pk-refund">−${money(it.refunded_minor)} refunded</span>`;
    } else {
      controls = '';
    }
    return `
      <div class="pick-row ${cls}" data-pick-row="${it.id}">
        <span class="pk-check">${check}</span>
        <img class="pk-art" src="${esc(artFor({ id: it.product_id, image_url: it.image_url }))}" data-art-id="${esc(it.product_id)}" data-art-cat="" alt="" loading="lazy">
        <div class="pk-main">
          <div class="pk-name">${esc(it.name)}<small>${esc(it.unit)}</small></div>
          <div class="pk-loc">${loc}</div>
        </div>
        <div class="pk-qty"><span class="pk-need">×${it.quantity}</span>${controls}</div>
      </div>`;
  }

  function summaryHtml() {
    const c = order.customer || {};
    const cod = order.payment_method === 'cod';
    const pay = cod
      ? `<span class="pill pill-amber">COD · collect ${money(order.bill?.cod_due_minor)}</span>`
      : `<span class="pill pill-green">Paid online</span>`;
    const eta = order.delivery_type === 'scheduled' && order.slot
      ? `${dateLabel(order.slot.slot_date)} · ${slotRange(order.slot.starts_at, order.slot.ends_at)}`
      : `${order.eta_promise_minutes ?? '—'} min promise`;
    return `
      <div class="settings-card">
        <div class="sum-top">
          <div class="sum-main"><strong>${esc(c.name || 'Customer')}</strong><span>${esc(phonePretty(c.phone))}</span></div>
          ${c.phone ? `<a class="rd-call" href="tel:${esc(c.phone)}" aria-label="Call customer">${icon('phone')}</a>` : ''}
        </div>
        <p class="sum-addr">${esc(order.address?.full_address || order.address?.line1 || '')}</p>
        <div class="kv-list">
          <div class="kv-row"><span class="k">Payment</span><span class="v">${pay} <span class="muted tiny">${esc(order.payment_status)}</span></span></div>
          <div class="kv-row"><span class="k">${order.delivery_type === 'scheduled' ? 'Slot' : 'ETA'}</span><span class="v">${esc(eta)}</span></div>
          <div class="kv-row"><span class="k">Placed</span><span class="v">${esc(dateTime(order.placed_at || order.created_at))}</span></div>
          ${order.delivery_instructions ? `<div class="kv-row"><span class="k">Instructions</span><span class="v">${esc(order.delivery_instructions)}</span></div>` : ''}
        </div>
      </div>`;
  }

  function riderHtml() {
    const r = order.rider;
    if (!r || isTerminal(order.status)) return '';
    return `<div class="rider-card">
      <span class="rd-avatar">${esc((r.name || 'R').charAt(0).toUpperCase())}</span>
      <div class="rd-main"><strong>${esc(r.name || 'Rider')}</strong>
        <div class="rd-pills"><span class="pill pill-blue">${icon('bike')} ${esc(r.vehicle || 'Bike')}</span>
        <span class="pill ${order.status === 'picked_up' ? 'pill-amber' : 'pill-green'}">${order.status === 'picked_up' ? 'On the way' : 'Heading to store'}</span></div>
      </div>
      ${r.phone ? `<a class="rd-call" href="tel:${esc(r.phone)}" aria-label="Call rider">${icon('phone')}</a>` : ''}
    </div>`;
  }

  function ctaHtml() {
    if (order.status === 'placed') {
      return `<button class="btn btn-primary block" data-start>${icon('box')} Start packing</button>
        <p class="cta-note">${order.items.length} lines · ${totalQty()} units · payment ${esc(order.payment_status)}</p>`;
    }
    if (order.status === 'packing') {
      const list = shortages();
      const note = list.length
        ? `${list.length} short pick${list.length === 1 ? '' : 's'} · ${money(refundTotal())} auto-refund`
        : 'Unpicked items default to full quantity';
      return `<button class="btn btn-primary block" data-pack>${icon('check')} Mark ready · ${totalQty()} units</button>
        <p class="cta-note">${esc(note)}</p>`;
    }
    if (order.status === 'cancelled') {
      return `<div class="notice notice-error">${icon('close')}<span>Cancelled${order.cancel_reason ? ` — ${esc(order.cancel_reason)}` : ''}.</span></div>
        <button class="btn btn-ghost block" data-nav="/">Back to queue</button>`;
    }
    const msg = order.status === 'delivered' ? 'Delivered. Nice work!'
      : order.status === 'picked_up' ? 'Rider has picked up this order.'
      : order.rider ? 'Packed — rider is on the way to the store.'
      : 'Packed — dispatch is offering this order to riders.';
    return `<div class="notice notice-info">${icon('check')}<span>${esc(msg)}</span></div>
      <button class="btn btn-ghost block" data-nav="/">Back to queue</button>`;
  }

  function render() {
    const live = !isTerminal(order.status);
    outlet.innerHTML = `
      <div class="page has-cta">
        <div class="section-title"><h2>${icon('receipt')} ${esc(order.public_label || 'Order')}</h2>${statusChip(order.status)}</div>
        ${summaryHtml()}
        ${live && order.pickup_code ? `<div class="code-card order-code">
          <div class="cc-label">Pickup code — read to rider</div>
          <div class="cc-code">${esc(order.pickup_code)}</div>
          <div class="cc-note">The rider enters this code at pickup</div>
        </div>` : ''}
        <div class="section-title"><h2>${icon('list')} Pick list</h2><span class="muted tiny">${order.items.length} lines</span></div>
        <div class="pick-progress" data-pp>${progressHtml()}</div>
        <div data-short-note>${shortNoteHtml()}</div>
        <div class="pick-list ${order.status === 'packing' ? 'is-active' : ''}" data-pick-list>
          ${order.items.map(rowHtml).join('')}
        </div>
        ${riderHtml()}
        ${billHtml(order.bill)}
        <div class="pack-cta" data-cta>${ctaHtml()}</div>
      </div>`;
  }

  /** In-place refresh after a pick: rows, progress, shortage note and CTA only.
   *  The progress fill element persists so its width transition animates. */
  function refreshPickUi() {
    const listHost = outlet.querySelector('[data-pick-list]');
    if (listHost) listHost.innerHTML = order.items.map(rowHtml).join('');
    const total = order.items.length;
    const done = doneCount();
    const pct = total ? (done / total) * 100 : 0;
    const fill = outlet.querySelector('[data-pp-fill]');
    if (fill) fill.className = `pp-fill pw-${widthBucket(pct)}`;
    const label = outlet.querySelector('[data-pp-label]');
    if (label) label.textContent = `${done}/${total} picked`;
    const note = outlet.querySelector('[data-short-note]');
    if (note) note.innerHTML = shortNoteHtml();
    const cta = outlet.querySelector('[data-cta]');
    if (cta) cta.innerHTML = ctaHtml();
  }

  async function pickItem(itemId, quantity) {
    const key = String(itemId);
    if (busyItems.has(key) || dead) return;
    busyItems.add(key);
    try {
      const res = await api.pickItem(id, Number(itemId), quantity);
      if (dead) return;
      order = res.order;
      refreshPickUi();
      outlet.querySelector(`[data-pick-row="${key}"] .stock-stepper output`)?.classList.add('pop');
    } catch (error) {
      if (!dead) toast(error.message || 'Could not update the pick', 'error');
    } finally {
      busyItems.delete(key);
    }
  }

  async function openShortSheet(itemId) {
    const it = itemById(itemId);
    if (!it || order.status !== 'packing') return;
    const values = await formSheet({
      title: `Short pick — ${it.name}`,
      submitLabel: 'Save picked quantity',
      note: `Ordered ×${it.quantity}. Missing units are auto-refunded when you mark the order ready.`,
      fields: [{
        name: 'picked', label: 'Picked quantity', type: 'number', required: true,
        value: String(it.picked_quantity ?? Math.max(0, it.quantity - 1)),
        attrs: `min="0" max="${it.quantity - 1}" step="1" inputmode="numeric"`,
        hint: `Between 0 and ${it.quantity - 1}`,
      }],
    });
    if (!values) return;
    const picked = Number(values.picked);
    if (!Number.isInteger(picked) || picked < 0 || picked >= it.quantity) {
      toast(`Enter a whole number between 0 and ${it.quantity - 1}`, 'error');
      return;
    }
    await pickItem(it.id, picked);
  }

  async function startPacking() {
    if (actionBusy) return;
    actionBusy = true;
    try {
      const res = await api.startPacking(id);
      if (dead) return;
      order = res.order;
      render();
      toast('Packing started — pick each item', 'success');
    } catch (error) {
      if (!dead) toast(error.message || 'Could not start packing', 'error');
    } finally {
      actionBusy = false;
    }
  }

  async function packOrder() {
    if (actionBusy) return;
    const list = shortages();
    if (list.length) {
      const ok = await askConfirm({
        title: 'Pack with shortages?',
        message: `${list.length} item${list.length === 1 ? '' : 's'} short. ${money(refundTotal())} will be refunded to the customer automatically.`,
        confirmLabel: 'Mark ready',
      });
      if (!ok) return;
    }
    actionBusy = true;
    try {
      await api.packOrder(id);
      if (dead) return;
      toast(list.length ? `Packed with shortages · ${money(refundTotal())} refunded` : 'Order packed — dispatching a rider', 'success');
      router.navigate('/');
    } catch (error) {
      if (!dead) toast(error.message || 'Could not pack the order', 'error');
    } finally {
      actionBusy = false;
    }
  }

  /* One delegated listener on the persistent outlet handles every control,
     including rows re-rendered in place. Removed in cleanup. */
  function onClick(event) {
    if (dead) return;
    const full = event.target.closest('[data-pick-full]');
    if (full) { const it = itemById(full.dataset.pickFull); if (it) pickItem(it.id, it.quantity); return; }
    const minus = event.target.closest('[data-pick-minus]');
    const plus = event.target.closest('[data-pick-plus]');
    if (minus || plus) {
      const it = itemById((minus || plus).dataset.pickMinus || (minus || plus).dataset.pickPlus);
      if (!it || it.picked_quantity === null) return;
      const next = Math.max(0, Math.min(it.quantity, it.picked_quantity + (plus ? 1 : -1)));
      if (next !== it.picked_quantity) pickItem(it.id, next);
      return;
    }
    const short = event.target.closest('[data-pick-short]');
    if (short) { openShortSheet(short.dataset.pickShort); return; }
    if (event.target.closest('[data-start]')) { startPacking(); return; }
    if (event.target.closest('[data-pack]')) { packOrder(); return; }
    if (event.target.closest('button, a, .stock-stepper')) return;
    const row = event.target.closest('[data-pick-row]');
    if (row && order.status === 'packing') {
      const it = itemById(row.dataset.pickRow);
      if (it && it.picked_quantity !== it.quantity) pickItem(it.id, it.quantity);
    }
  }

  async function refetch() {
    if (dead) return;
    try {
      const res = await api.storeOrder(state.store.id, id);
      if (dead) return;
      order = res.order;
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
      if (isTerminal(order.status) && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    } catch { /* keep last good view */ }
  }
  function scheduleRefetch() {
    if (refetchTimer) clearTimeout(refetchTimer);
    refetchTimer = setTimeout(refetch, REFETCH_DEBOUNCE_MS);
  }

  render();
  outlet.addEventListener('click', onClick);
  stream = openStream({
    orderId: id,
    events: ['order.status', 'order.item_picked', 'order.cancelled'],
    onEvent: () => scheduleRefetch(),
  });
  if (!isTerminal(order.status)) pollTimer = setInterval(refetch, FALLBACK_POLL_MS);

  return () => {
    dead = true;
    outlet.removeEventListener('click', onClick);
    stream?.close();
    if (pollTimer) clearInterval(pollTimer);
    if (refetchTimer) clearTimeout(refetchTimer);
  };
}