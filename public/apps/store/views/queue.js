// Picker queue: filter chips (All / New / Packing / Ready / Done), server-side
// search, status-grouped order cards and a 10s live refresh driven by main.js.
import { api } from '../../_shared/api.js';
import { icon, statusChip, emptyState, esc, toast, spinner } from '../../_shared/ui.js';
import { money, dateLabel, slotRange, relativeTime } from '../../_shared/format.js';
import { state, bus } from '../state.js';

const GROUPS = [
  { key: 'new', label: 'New', title: 'New orders', icon: 'bolt', statuses: ['placed'] },
  { key: 'packing', label: 'Packing', title: 'Being picked', icon: 'box', statuses: ['packing'] },
  { key: 'ready', label: 'Ready', title: 'Ready / out for delivery', icon: 'bike', statuses: ['packed', 'rider_assigned', 'picked_up'] },
  { key: 'done', label: 'Done', title: 'Completed', icon: 'check', statuses: ['delivered', 'cancelled'] },
];
const EMPTY_COPY = {
  all: { emoji: '🧺', title: 'Queue is clear', body: 'New paid orders land here automatically — the queue refreshes every 10 seconds.' },
  new: { emoji: '🧾', title: 'No new orders', body: 'As soon as a customer pays (or places a COD order), it appears here.' },
  packing: { emoji: '📦', title: 'Nothing being picked', body: 'Start packing a new order and it moves into this lane.' },
  ready: { emoji: '🛵', title: 'No packed orders waiting', body: 'Packed orders wait here until a rider picks them up.' },
  done: { emoji: '✅', title: 'No completed orders yet', body: 'Delivered and cancelled orders show up here.' },
};
const SEARCH_DEBOUNCE_MS = 350;

export async function queueView(outlet, params, query, { router }) {
  if (!state.store) {
    outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🏬', title: 'No store assigned', body: 'This picker account is not staffed on any store yet. Ask an admin to add you.' })}</div>`;
    return;
  }

  let tab = 'all';
  let q = '';
  let orders = [];
  let loading = true;
  let dead = false;
  let searchTimer = null;

  const inGroup = (o, g) => g.statuses.includes(o.status);
  const groupOrders = g => orders.filter(o => inGroup(o, g));

  function slotLine(o) {
    if (o.delivery_type === 'scheduled' && o.slot) {
      return `${icon('clock')} ${esc(dateLabel(o.slot.slot_date))} · ${esc(slotRange(o.slot.starts_at, o.slot.ends_at))}`;
    }
    const mins = o.eta_promise_minutes;
    return `${icon('bolt')} ${mins ? `${mins} min promise` : 'Instant'} · ${esc(relativeTime(o.placed_at || o.created_at))}`;
  }

  function actionFor(o) {
    if (o.status === 'placed') return `<button class="btn btn-primary" data-nav="/order/${esc(o.id)}">${icon('box')} Start packing</button>`;
    if (o.status === 'packing') return `<button class="btn btn-primary" data-nav="/order/${esc(o.id)}">${icon('check')} Continue picking</button>`;
    if (['packed', 'rider_assigned', 'picked_up'].includes(o.status)) return `<button class="btn btn-outline" data-nav="/order/${esc(o.id)}">View</button>`;
    return `<button class="btn btn-ghost" data-nav="/order/${esc(o.id)}">View</button>`;
  }

  function orderCard(o) {
    const lines = o.items.slice(0, 4).map(it => `<div class="si">${esc(it.name)}<span>×${it.quantity}</span></div>`).join('');
    const more = o.items.length > 4 ? `<div class="si more">+${o.items.length - 4} more item${o.items.length - 4 === 1 ? '' : 's'}</div>` : '';
    const cod = o.payment_method === 'cod' ? ' · COD' : '';
    return `
      <div class="seller-order-card ${o.status === 'placed' ? 'is-new' : ''}" data-open-order="${esc(o.id)}" role="button" tabindex="0" aria-label="Open order ${esc(o.public_label || o.id)}">
        <div class="so-top"><span class="so-label">${esc(o.public_label || o.id)}</span>${statusChip(o.status)}</div>
        <div class="so-slot">${slotLine(o)}</div>
        <div class="so-items">${lines}${more}</div>
        <div class="so-meta"><span>${esc(o.customer?.name || 'Customer')}${cod}</span><span class="so-total">${money(o.bill?.grand_total_minor)}</span></div>
        <div class="so-actions">${actionFor(o)}</div>
      </div>`;
  }

  function emptyHtml() {
    if (q && !orders.length) {
      return emptyState({ emoji: '🔍', title: 'No matches', body: `Nothing in the queue matches “${q}”.`, actionHtml: '<button class="btn btn-outline" data-clear-q>Clear search</button>' });
    }
    const copy = EMPTY_COPY[tab] || EMPTY_COPY.all;
    return emptyState(copy);
  }

  function sectionHtml(g) {
    const list = groupOrders(g);
    if (!list.length) return '';
    return `<div class="section-title"><h2>${icon(g.icon)} ${esc(g.title)} · ${list.length}</h2></div>${list.map(orderCard).join('')}`;
  }

  function updateTabs() {
    const host = outlet.querySelector('[data-qtabs]');
    if (!host) return;
    const chips = [{ key: 'all', label: 'All', count: orders.length },
      ...GROUPS.map(g => ({ key: g.key, label: g.label, count: groupOrders(g).length }))];
    host.innerHTML = chips.map(c => `
      <button class="chip" data-qtab="${c.key}" aria-pressed="${tab === c.key}">${esc(c.label)}${c.count ? ` · ${c.count}` : ''}</button>`).join('');
  }

  function updateList() {
    const host = outlet.querySelector('[data-qlist]');
    if (!host) return;
    if (loading) { host.innerHTML = spinner('Loading the queue…'); return; }
    if (!orders.length) { host.innerHTML = emptyHtml(); return; }
    if (tab === 'all') {
      const html = GROUPS.map(sectionHtml).join('');
      host.innerHTML = html || emptyHtml();
      return;
    }
    const g = GROUPS.find(x => x.key === tab);
    const list = groupOrders(g);
    host.innerHTML = list.length ? list.map(orderCard).join('') : emptyHtml();
  }

  function updateNote() {
    const note = outlet.querySelector('[data-qnote]');
    if (!note) return;
    note.textContent = q
      ? `${orders.length} result${orders.length === 1 ? '' : 's'} for “${q}” · live refresh every 10s`
      : `${orders.length} order${orders.length === 1 ? '' : 's'} in queue · live refresh every 10s`;
  }

  function renderShell() {
    outlet.innerHTML = `
      <div class="page">
        <div class="queue-tabs" data-qtabs></div>
        <div class="queue-toolbar">
          <label class="search-pill live">${icon('search')}<input data-qsearch type="search" placeholder="Search order label or item…" value="${esc(q)}" aria-label="Search orders"></label>
        </div>
        <p class="queue-note" data-qnote></p>
        <div data-qlist></div>
      </div>`;
    outlet.querySelector('[data-qtabs]').addEventListener('click', event => {
      const chip = event.target.closest('[data-qtab]');
      if (!chip) return;
      tab = chip.dataset.qtab;
      updateTabs(); updateList();
    });
    outlet.querySelector('[data-qsearch]').addEventListener('input', event => {
      const value = event.target.value;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { q = value.trim(); load(); }, SEARCH_DEBOUNCE_MS);
    });
    const listHost = outlet.querySelector('[data-qlist]');
    listHost.addEventListener('click', event => {
      if (event.target.closest('[data-clear-q]')) {
        q = '';
        const input = outlet.querySelector('[data-qsearch]');
        if (input) input.value = '';
        load();
        return;
      }
      if (event.target.closest('[data-nav]')) return; // global handler navigates
      const card = event.target.closest('[data-open-order]');
      if (card) router.navigate(`/order/${card.dataset.openOrder}`);
    });
    listHost.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest('[data-open-order]');
      if (card) { event.preventDefault(); router.navigate(`/order/${card.dataset.openOrder}`); }
    });
  }

  async function load() {
    if (dead) return;
    try {
      const res = await api.storeQueue(state.store.id, { q });
      if (dead) return;
      orders = res.orders || [];
      state.queue = orders;
      bus.emit('queue', orders);
    } catch (error) {
      if (dead) return;
      if (loading) toast(error.message || 'Could not load the queue', 'error');
    }
    loading = false;
    updateTabs(); updateList(); updateNote();
  }

  renderShell();
  updateTabs(); updateList(); updateNote();
  const offTick = bus.on('queue-tick', load);
  await load();
  return () => { dead = true; offTick(); if (searchTimer) clearTimeout(searchTimer); };
}