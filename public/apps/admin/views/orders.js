// Order desk: filterable table (status / store / text search), a detail drawer
// with items, bill, address, rider, pickup code and event timeline, live SSE
// updates per open order, admin cancel with reason, and a 15s list poll.
import { api, openStream } from '../../_shared/api.js';
import { icon, esc, toast, spinner, statusChip, emptyState, billHtml, askConfirm, formSheet, sheet } from '../../_shared/ui.js';
import { artFor } from '../../_shared/art.js';
import { money, dateTime, dateLabel, slotRange, relativeTime, phonePretty, distanceLabel, statusText, stepIndex, DELIVERY_STEPS, isLive } from '../../_shared/format.js';
import { state, refreshOrders, refreshStores } from '../state.js';

const POLL_MS = 15000;
const STATUS_OPTIONS = [
  ['', 'All statuses'], ['placed', 'Placed'], ['packing', 'Packing'], ['packed', 'Packed'],
  ['rider_assigned', 'Rider assigned'], ['picked_up', 'Out for delivery'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'],
];

export async function ordersView(outlet, params, query) {
  let alive = true;
  let status = query.status || '';
  let storeId = query.store_id || '';
  let search = '';
  let loading = true;
  let fetching = false;
  let detailOrder = null;
  let detailStream = null;
  let sheetOpen = false;

  if (!state.stores.length) { try { await refreshStores(); } catch { /* filters still work */ } }

  /* ---------- data ---------- */
  async function load(manual = false) {
    if (fetching) return;
    fetching = true;
    const btn = outlet.querySelector('[data-refresh]');
    btn?.classList.add('spinning');
    try {
      await refreshOrders({ status, store_id: storeId });
    } catch (error) {
      if (manual) toast(error.message || 'Could not load orders', 'error');
    }
    fetching = false;
    loading = false;
    btn?.classList.remove('spinning');
    renderTable();
  }

  function filtered() {
    const q = search.trim().toLowerCase();
    if (!q) return state.orders;
    return state.orders.filter(o =>
      (o.public_label || '').toLowerCase().includes(q) ||
      (o.customer?.name || '').toLowerCase().includes(q) ||
      (o.customer?.phone || '').toLowerCase().includes(q));
  }

  /* ---------- table ---------- */
  function slotLine(o) {
    if (o.delivery_type === 'scheduled' && o.slot) return `${dateLabel(o.slot.slot_date)} · ${slotRange(o.slot.starts_at, o.slot.ends_at)}`;
    const mins = o.eta_live_minutes ?? o.eta_promise_minutes;
    return mins ? `Instant · ${mins} min` : 'Instant';
  }

  function payPill(o) {
    const method = o.payment_method === 'cod' ? '<span class="pill pill-amber">COD</span>' : '<span class="pill pill-blue">Online</span>';
    const st = o.payment_status || '';
    const cls = st === 'paid' ? 'pill-green' : st === 'refunded' ? 'pill-gray' : st === 'failed' ? 'pill-red' : 'pill-amber';
    return `${method} <span class="pill ${cls}">${esc(st || '—')}</span>`;
  }

  function rowHtml(o) {
    return `<tr>
      <td><div class="t-main">${esc(o.public_label || o.id)}</div><div class="t-sub">${o.items.length} item${o.items.length === 1 ? '' : 's'}</div></td>
      <td><div class="t-main">${esc(o.store?.name || '—')}</div><div class="t-sub">${esc(o.store?.city || '')}</div></td>
      <td><div class="t-main">${esc(o.customer?.name || 'Guest')}</div><div class="t-sub">${esc(phonePretty(o.customer?.phone))}</div></td>
      <td>${statusChip(o.status)}</td>
      <td class="num">${money(o.bill?.grand_total_minor)}</td>
      <td>${payPill(o)}</td>
      <td class="t-sub">${esc(slotLine(o))}</td>
      <td class="t-sub">${esc(relativeTime(o.created_at))}</td>
      <td><div class="row-actions">
        <button class="mini-btn" data-view-order="${esc(o.id)}">${icon('receipt')} View</button>
        ${isLive(o.status) ? `<button class="mini-btn danger" data-cancel-order="${esc(o.id)}">${icon('close')} Cancel</button>` : ''}
      </div></td>
    </tr>`;
  }

  function renderTable() {
    if (!alive) return;
    const host = outlet.querySelector('[data-orders-table]');
    const note = outlet.querySelector('[data-count]');
    if (!host) return;
    if (loading) { host.innerHTML = spinner('Loading orders…'); return; }
    const list = filtered();
    if (note) note.textContent = `${list.length} of ${state.orders.length} orders`;
    if (!list.length) {
      host.innerHTML = emptyState({ emoji: '🧾', title: search ? 'No matching orders' : 'No orders here', body: search ? 'Try a different label, customer name or phone.' : 'Orders will appear as customers check out. Adjust the filters or refresh.' });
      return;
    }
    host.innerHTML = `<table class="admin-table t-wide">
      <thead><tr><th>Label</th><th>Store</th><th>Customer</th><th>Status</th><th>Total</th><th>Payment</th><th>Slot / ETA</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>${list.map(rowHtml).join('')}</tbody>
    </table>`;
  }

  function render() {
    outlet.innerHTML = `
      <div class="admin-head">
        <div><h1>Order desk</h1><div class="ah-sub">Live operations · newest first · auto-refreshes every 15s</div></div>
        <div class="ah-actions"><button class="btn btn-outline refresh-btn" data-refresh>${icon('refresh')} Refresh</button></div>
      </div>
      <div class="admin-toolbar">
        <select class="admin-select" data-filter-status aria-label="Filter by status">
          ${STATUS_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === status ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <select class="admin-select" data-filter-store aria-label="Filter by store">
          <option value="">All stores</option>
          ${state.stores.map(s => `<option value="${esc(s.id)}" ${s.id === storeId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
        <div class="admin-search">${icon('search')}<input type="search" data-search placeholder="Search label, customer or phone…" value="${esc(search)}" aria-label="Search orders"></div>
        <span class="count-note" data-count></span>
      </div>
      <div class="admin-card"><div class="table-wrap" data-orders-table></div></div>`;
    outlet.querySelector('[data-filter-status]')?.addEventListener('change', e => { status = e.target.value; loading = true; renderTable(); load(); });
    outlet.querySelector('[data-filter-store]')?.addEventListener('change', e => { storeId = e.target.value; loading = true; renderTable(); load(); });
    outlet.querySelector('[data-search]')?.addEventListener('input', e => { search = e.target.value; renderTable(); });
    outlet.querySelector('[data-refresh]')?.addEventListener('click', () => load(true));
    renderTable();
  }

  /* ---------- detail drawer ---------- */
  function detailHtml(o) {
    const idx = stepIndex(o.status);
    const cancelled = o.status === 'cancelled';
    return `
      <div class="od-top">
        ${statusChip(o.status)}
        <span class="pill ${o.delivery_type === 'scheduled' ? 'pill-blue' : 'pill-green'}">${o.delivery_type === 'scheduled' ? 'Scheduled' : 'Instant'}</span>
        ${payPill(o)}
      </div>
      <div class="kv-list">
        <div class="kv-row"><span class="k">Customer</span><span class="v">${esc(o.customer?.name || 'Guest')} · ${esc(phonePretty(o.customer?.phone))}</span></div>
        <div class="kv-row"><span class="k">Store</span><span class="v">${esc(o.store?.name || '—')}</span></div>
        <div class="kv-row"><span class="k">Placed</span><span class="v">${esc(dateTime(o.placed_at || o.created_at))}</span></div>
        <div class="kv-row"><span class="k">${o.delivery_type === 'scheduled' ? 'Slot' : 'ETA'}</span><span class="v">${esc(slotLine(o))}</span></div>
        ${o.distance_km != null ? `<div class="kv-row"><span class="k">Distance</span><span class="v">${esc(distanceLabel(o.distance_km))}</span></div>` : ''}
        <div class="kv-row"><span class="k">Deliver to</span><span class="v">${esc(o.address?.receiver_name || '')} · ${esc(o.address?.full_address || o.address?.line1 || '—')}</span></div>
        ${o.delivery_instructions ? `<div class="kv-row"><span class="k">Instructions</span><span class="v">${esc(o.delivery_instructions)}</span></div>` : ''}
        ${cancelled ? `<div class="kv-row"><span class="k">Cancel reason</span><span class="v">${esc(o.cancel_reason || '—')}</span></div>` : ''}
        ${o.rating ? `<div class="kv-row"><span class="k">Rating</span><span class="v">${o.rating}/5${o.rating_comment ? ` · ${esc(o.rating_comment)}` : ''}</span></div>` : ''}
      </div>

      ${o.pickup_code && isLive(o.status) ? `<div class="code-card">
        <div class="cc-label">Store pickup code</div>
        <div class="cc-code">${esc(o.pickup_code)}</div>
        <div class="cc-note">The rider collects this order with this code</div>
      </div>` : ''}

      <h3 class="od-h">${icon('basket')} Items · ${o.items.length}</h3>
      <div class="od-items">
        ${o.items.map(it => `
          <div class="cart-line">
            <img class="cl-art" src="${esc(artFor({ id: it.product_id, image_url: it.image_url }))}" data-art-id="${esc(it.product_id)}" data-art-cat="" alt="" loading="lazy">
            <div class="cl-main">
              <div class="cl-name">${esc(it.name)}</div>
              <div class="cl-sub">${esc(it.brand || '')}${it.brand ? ' · ' : ''}${esc(it.unit)} × ${it.quantity}</div>
              ${it.picked_quantity != null ? `<div class="od-picked">Picked ${it.picked_quantity}/${it.quantity}</div>` : ''}
              ${Number(it.refunded_minor || 0) > 0 ? `<div class="od-refund">Refunded ${money(it.refunded_minor)}</div>` : ''}
            </div>
            <div class="cl-right"><strong class="tiny">${money(it.price_minor * it.quantity)}</strong></div>
          </div>`).join('')}
      </div>

      ${billHtml(o.bill)}

      ${o.rider ? `<h3 class="od-h">${icon('bike')} Rider</h3>
      <div class="rider-card">
        <span class="rd-avatar">${esc((o.rider.name || 'R').charAt(0).toUpperCase())}</span>
        <div class="rd-main"><strong>${esc(o.rider.name || 'Rider')}</strong>
          <div class="rd-pills"><span class="pill pill-green">${icon('bike')} ${esc(o.rider.vehicle || 'bike')}</span><span class="pill pill-gray">${esc(phonePretty(o.rider.phone))}</span></div>
        </div>
        ${o.rider.phone ? `<a class="rd-call" href="tel:${esc(o.rider.phone)}" aria-label="Call rider">${icon('phone')}</a>` : ''}
      </div>` : ''}

      <h3 class="od-h">${icon('list')} Progress</h3>
      ${!cancelled ? `<div class="timeline six">${DELIVERY_STEPS.map((s, i) => `<div class="t-step ${i <= idx ? 'done' : ''}">${esc(s.label)}</div>`).join('')}</div>` : ''}
      <div class="od-events">
        ${(o.events || []).map(ev => `
          <div class="od-event">
            <span class="oe-dot"></span>
            <div class="oe-main"><strong>${esc(statusText(ev.status))}</strong>${ev.note ? `<span>${esc(ev.note)}</span>` : ''}</div>
            <time>${esc(dateTime(ev.created_at))}</time>
          </div>`).join('')}
      </div>

      ${isLive(o.status) ? `<button class="btn btn-danger block od-cancel" data-sheet-cancel-order="${esc(o.id)}">${icon('close')} Cancel this order</button>` : ''}`;
  }

  function wireSheetBody() {
    const body = document.querySelector('#sheet-host .sheet-body');
    body?.querySelector('[data-sheet-cancel-order]')?.addEventListener('click', e => cancelFlow(e.currentTarget.dataset.sheetCancelOrder));
  }

  async function refetchDetail() {
    if (!sheetOpen || !detailOrder) return;
    try {
      const res = await api.order(detailOrder.id);
      detailOrder = res.order || detailOrder;
      const body = document.querySelector('#sheet-host .sheet-body');
      if (body && sheetOpen) { body.innerHTML = detailHtml(detailOrder); wireSheetBody(); }
    } catch { /* keep last snapshot */ }
  }

  function closeDetail() {
    detailStream?.close();
    detailStream = null;
    sheetOpen = false;
    detailOrder = null;
  }

  async function openDetail(id) {
    const order = state.orders.find(o => o.id === id);
    if (!order) return;
    detailOrder = order;
    sheetOpen = true;
    const promise = sheet(detailHtml(order), { title: `Order ${order.public_label || order.id}` });
    wireSheetBody();
    const stream = openStream({
      orderId: id,
      events: ['order.status', 'order.cancelled'],
      onEvent: () => { refetchDetail(); load(false); },
    });
    detailStream = stream;
    promise.then(() => {
      stream.close();
      if (detailStream === stream) { detailStream = null; sheetOpen = false; detailOrder = null; }
    });
    refetchDetail();
  }

  /* ---------- cancel ---------- */
  async function cancelFlow(id) {
    const order = state.orders.find(o => o.id === id) || detailOrder;
    const ok = await askConfirm({
      title: `Cancel ${order?.public_label || 'order'}?`,
      message: 'The customer is notified and any online payment is refunded. This cannot be undone.',
      confirmLabel: 'Cancel order', danger: true,
    });
    if (!ok) return;
    const values = await formSheet({
      title: 'Cancel reason',
      submitLabel: 'Confirm cancellation',
      fields: [{ name: 'reason', label: 'Reason shown to the customer', required: true, placeholder: 'e.g. Items out of stock' }],
      note: 'The reason is stored on the order and in the audit log.',
    });
    if (!values) return;
    try {
      await api.adminCancelOrder(id, values.reason);
      toast('Order cancelled', 'success');
      await load(false);
      if (sheetOpen && detailOrder?.id === id) refetchDetail();
    } catch (error) {
      toast(error.message || 'Could not cancel the order', 'error');
    }
  }

  /* ---------- delegated row actions ---------- */
  function onClick(event) {
    const view = event.target.closest('[data-view-order]');
    if (view) { event.preventDefault(); openDetail(view.dataset.viewOrder); return; }
    const cancel = event.target.closest('[data-cancel-order]');
    if (cancel) { event.preventDefault(); cancelFlow(cancel.dataset.cancelOrder); }
  }

  render();
  outlet.addEventListener('click', onClick);
  await load();
  const timer = setInterval(() => load(false), POLL_MS);
  return () => {
    alive = false;
    clearInterval(timer);
    outlet.removeEventListener('click', onClick);
    if (sheetOpen) document.querySelector('#sheet-host [data-sheet-close]')?.click();
    closeDetail();
  };
}