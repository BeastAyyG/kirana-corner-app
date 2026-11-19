// Order history: Active / Past segmented list. Each card opens live tracking;
// Reorder refills the basket from a previous order in one tap.
import { api } from '../../_shared/api.js';
import { icon, statusChip, emptyState, esc, toast, spinner } from '../../_shared/ui.js';
import { artFor } from '../../_shared/art.js';
import { money, dateShort, dateTime, isLive, isTerminal } from '../../_shared/format.js';
import { state, bus, setCart } from '../state.js';

export async function ordersView(outlet, params, query, { router }) {
  let tab = 'active';
  let orders = [];
  let loading = true;

  const live = () => orders.filter(o => isLive(o.status));
  const past = () => orders.filter(o => isTerminal(o.status));

  async function load() {
    try {
      const res = await api.orders();
      orders = res.orders || [];
      state.orders = orders;
    } catch (error) {
      orders = [];
      toast(error.message || 'Could not load orders', 'error');
    }
    loading = false;
    render();
  }

  function slotLine(o) {
    if (o.delivery_type === 'scheduled' && o.slot) return `Scheduled · ${dateTime(o.slot.starts_at)}`;
    const mins = o.eta_live_minutes ?? o.eta_promise_minutes;
    return `Instant · ${mins ? mins + ' min' : '—'}`;
  }

  function orderCard(o) {
    const thumbs = o.items.slice(0, 4).map(it =>
      `<img src="${esc(artFor({ id: it.product_id, image_url: it.image_url }))}" data-art-id="${esc(it.product_id)}" data-art-cat="" alt="" loading="lazy">`).join('');
    const more = o.items.length > 4 ? `<span class="oc-more">+${o.items.length - 4}</span>` : '';
    const names = o.items.slice(0, 3).map(it => esc(it.name)).join(', ') + (o.items.length > 3 ? '…' : '');
    return `<div class="order-card" data-open-order="${esc(o.id)}" role="button" tabindex="0" aria-label="View order ${esc(o.public_label || o.id)}">
      <div class="oc-top"><span class="oc-label">${esc(o.public_label || o.id)}</span>${statusChip(o.status)}</div>
      <div class="oc-slot">${esc(slotLine(o))} · ${esc(dateShort(o.created_at))}</div>
      <div class="oc-thumbs">${thumbs}${more}</div>
      <div class="oc-items">${names}</div>
      <div class="oc-foot">
        <span class="oc-total">${money(o.bill?.grand_total_minor)}</span>
        <button class="oc-reorder" data-reorder="${esc(o.id)}">${icon('refresh')} Reorder</button>
      </div>
    </div>`;
  }

  function emptyHtml() {
    return tab === 'active'
      ? emptyState({ emoji: '🛵', title: 'No active orders', body: 'Your live deliveries will appear here the moment you place an order.', actionHtml: '<button class="btn btn-primary" data-nav="/browse">Start shopping</button>' })
      : emptyState({ emoji: '🧾', title: 'No past orders', body: 'Delivered and cancelled orders will show up here.', actionHtml: '<button class="btn btn-primary" data-nav="/browse">Start shopping</button>' });
  }

  function render() {
    if (loading) { outlet.innerHTML = `<div class="page">${spinner('Loading your orders…')}</div>`; return; }
    const list = tab === 'active' ? live() : past();
    outlet.innerHTML = `
      <div class="page">
        <div class="seg">
          <button data-tab="active" aria-pressed="${tab === 'active'}">Active${live().length ? ` · ${live().length}` : ''}</button>
          <button data-tab="past" aria-pressed="${tab === 'past'}">Past${past().length ? ` · ${past().length}` : ''}</button>
        </div>
        <div data-order-list>${list.length ? list.map(orderCard).join('') : emptyHtml()}</div>
      </div>`;
    wire();
  }

  function wire() {
    outlet.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => { tab = btn.dataset.tab; render(); }));
    outlet.querySelectorAll('[data-open-order]').forEach(card => {
      const open = () => router.navigate(`/track/${card.dataset.openOrder}`);
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    outlet.querySelectorAll('[data-reorder]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); reorder(btn); }));
  }

  async function reorder(btn) {
    const id = btn.dataset.reorder;
    btn.disabled = true;
    try {
      const res = await api.reorder(id);
      setCart(res.cart);
      if (res.skipped?.length) toast(`${res.skipped.length} item(s) adjusted or unavailable`, 'default');
      else toast('Items added to your basket', 'success');
      router.navigate('/cart');
    } catch (error) {
      toast(error.message || 'Could not reorder', 'error');
      btn.disabled = false;
    }
  }

  const offRefresh = bus.on('orders-refresh', load);
  const offOrder = bus.on('order', load);
  await load();
  return () => { offRefresh(); offOrder(); };
}