// Promotions: coupon ledger with create / edit / pause flows. Money inputs are
// entered in rupees and converted to integer paise; windows use datetime-local
// inputs converted to ISO. Value rules: flat ≤ ₹10,000, percent ≤ 90.
import { api } from '../../_shared/api.js';
import { icon, esc, toast, spinner, emptyState, askConfirm, formSheet } from '../../_shared/ui.js';
import { money, dateShort } from '../../_shared/format.js';
import { state, refreshCoupons } from '../state.js';

const TYPE_PILL = { flat: 'pill-green', percent: 'pill-blue', free_delivery: 'pill-amber' };
const TYPE_LABEL = { flat: 'Flat off', percent: 'Percent off', free_delivery: 'Free delivery' };

function localInputValue(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function toIso(local) {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
function rupeesToPaise(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}
function valueLabel(c) {
  if (c.type === 'flat') return money(c.value);
  if (c.type === 'percent') return `${c.value}%`;
  return 'Free delivery';
}
function statePill(c) {
  const now = Date.now();
  if (!c.active) return '<span class="pill pill-gray">Paused</span>';
  if (Date.parse(c.ends_at) < now) return '<span class="pill pill-red">Expired</span>';
  if (Date.parse(c.starts_at) > now) return '<span class="pill pill-blue">Scheduled</span>';
  return '<span class="pill pill-green">Live</span>';
}

export async function couponsView(outlet) {
  let alive = true;
  let search = '';
  let loading = true;
  let fetching = false;

  function filtered() {
    const q = search.trim().toLowerCase();
    if (!q) return state.coupons;
    return state.coupons.filter(c =>
      c.code.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q) || c.type.includes(q));
  }

  function rowHtml(c) {
    return `<tr>
      <td><span class="code-tag">${esc(c.code)}</span><div class="t-sub">${esc(c.description || '')}</div></td>
      <td><span class="pill ${TYPE_PILL[c.type] || 'pill-gray'}">${esc(TYPE_LABEL[c.type] || c.type)}</span></td>
      <td class="num">${esc(valueLabel(c))}</td>
      <td class="num">${money(c.min_order_minor)}</td>
      <td class="num">${Number(c.max_discount_minor || 0) > 0 ? money(c.max_discount_minor) : '—'}</td>
      <td class="t-sub">${esc(dateShort(c.starts_at))} → ${esc(dateShort(c.ends_at))}</td>
      <td class="num">${c.used_count} / ${c.usage_limit}<div class="t-sub">${c.per_user_limit} per user</div></td>
      <td>${statePill(c)}</td>
      <td><div class="row-actions">
        <button class="mini-btn" data-edit-coupon="${esc(c.id)}">${icon('edit')} Edit</button>
        <button class="mini-btn ${c.active ? 'danger' : ''}" data-toggle-coupon="${esc(c.id)}">${icon(c.active ? 'close' : 'check')} ${c.active ? 'Pause' : 'Activate'}</button>
      </div></td>
    </tr>`;
  }

  function renderTable() {
    if (!alive) return;
    const host = outlet.querySelector('[data-coupons-table]');
    const note = outlet.querySelector('[data-count]');
    if (!host) return;
    if (loading) { host.innerHTML = spinner('Loading coupons…'); return; }
    const list = filtered();
    if (note) note.textContent = `${list.length} of ${state.coupons.length} coupons`;
    if (!list.length) {
      host.innerHTML = emptyState({ emoji: '🎟️', title: search ? 'No matching coupons' : 'No coupons yet', body: search ? 'Try a different code or description.' : 'Create a welcome offer to drive first orders.', actionHtml: search ? '' : '<button class="btn btn-primary" data-new-coupon>New coupon</button>' });
      return;
    }
    host.innerHTML = `<table class="admin-table t-wide">
      <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Min order</th><th>Max discount</th><th>Window</th><th>Used</th><th>State</th><th>Actions</th></tr></thead>
      <tbody>${list.map(rowHtml).join('')}</tbody>
    </table>`;
  }

  function render() {
    outlet.innerHTML = `
      <div class="admin-head">
        <div><h1>Coupons</h1><div class="ah-sub">Offers, usage caps and validity windows</div></div>
        <div class="ah-actions">
          <button class="btn btn-outline refresh-btn" data-refresh>${icon('refresh')} Refresh</button>
          <button class="btn btn-primary" data-new-coupon>${icon('plus')} New coupon</button>
        </div>
      </div>
      <div class="admin-toolbar">
        <div class="admin-search">${icon('search')}<input type="search" data-search placeholder="Search code or description…" value="${esc(search)}" aria-label="Search coupons"></div>
        <span class="count-note" data-count></span>
      </div>
      <div class="admin-card"><div class="table-wrap" data-coupons-table></div></div>`;
    outlet.querySelector('[data-search]')?.addEventListener('input', e => { search = e.target.value; renderTable(); });
    outlet.querySelector('[data-refresh]')?.addEventListener('click', () => load(true));
    renderTable();
  }

  async function load(manual = false) {
    if (fetching) return;
    fetching = true;
    const btn = outlet.querySelector('[data-refresh]');
    btn?.classList.add('spinning');
    try { await refreshCoupons(); }
    catch (error) { if (manual) toast(error.message || 'Could not load coupons', 'error'); }
    fetching = false;
    loading = false;
    btn?.classList.remove('spinning');
    renderTable();
  }

  /* ---------- create ---------- */
  async function newCoupon() {
    const now = new Date();
    const monthLater = new Date(now.getTime() + 30 * 86400000);
    const values = await formSheet({
      title: 'New coupon',
      submitLabel: 'Create coupon',
      note: 'Money fields are in rupees. Percent value is capped at 90. Free delivery ignores the value field.',
      fields: [
        { name: 'code', label: 'Code', required: true, placeholder: 'WELCOME50', attrs: 'maxlength="20" autocomplete="off"' },
        { name: 'type', label: 'Type', options: ['flat', 'percent', 'free_delivery'], value: 'flat' },
        { name: 'value', label: 'Value', required: true, value: '50', hint: 'Rupees for flat · percent (0–90) for percent · ignored for free delivery', attrs: 'inputmode="decimal"' },
        { name: 'min_order_rupees', label: 'Minimum order (₹)', value: '199', attrs: 'inputmode="decimal"' },
        { name: 'max_discount_rupees', label: 'Max discount (₹)', value: '50', hint: 'Caps percent discounts · 0 = no cap', attrs: 'inputmode="decimal"' },
        { name: 'starts_at', label: 'Starts', required: true, type: 'datetime-local', value: localInputValue(now) },
        { name: 'ends_at', label: 'Ends', required: true, type: 'datetime-local', value: localInputValue(monthLater) },
        { name: 'usage_limit', label: 'Total usage limit', type: 'number', value: '10000', attrs: 'min="1" step="1"' },
        { name: 'per_user_limit', label: 'Per-user limit', type: 'number', value: '1', attrs: 'min="1" step="1"' },
        { name: 'description', label: 'Description', placeholder: '₹50 off your first order above ₹199', attrs: 'maxlength="160"' },
      ],
    });
    if (!values) return;

    const code = values.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 3) { toast('Code needs at least 3 letters or digits', 'error'); return; }
    const startsAt = toIso(values.starts_at);
    const endsAt = toIso(values.ends_at);
    if (!startsAt || !endsAt) { toast('Enter valid start and end times', 'error'); return; }
    if (Date.parse(endsAt) <= Date.parse(startsAt)) { toast('End time must be after the start time', 'error'); return; }

    let value = 0;
    if (values.type === 'percent') {
      value = Math.round(Number(values.value));
      if (!Number.isSafeInteger(value) || value < 0 || value > 90) { toast('Percent value must be a whole number from 0 to 90', 'error'); return; }
    } else if (values.type === 'flat') {
      value = rupeesToPaise(values.value);
      if (!Number.isSafeInteger(value) || value > 1000000) { toast('Enter a valid flat discount in rupees (up to ₹10,000)', 'error'); return; }
    }
    const minOrder = rupeesToPaise(values.min_order_rupees || '0');
    const maxDiscount = rupeesToPaise(values.max_discount_rupees || '0');
    if (!Number.isSafeInteger(minOrder) || !Number.isSafeInteger(maxDiscount)) { toast('Enter valid rupee amounts', 'error'); return; }
    const usageLimit = Math.round(Number(values.usage_limit || '10000'));
    const perUserLimit = Math.round(Number(values.per_user_limit || '1'));
    if (!Number.isSafeInteger(usageLimit) || usageLimit < 1 || !Number.isSafeInteger(perUserLimit) || perUserLimit < 1) { toast('Usage limits must be whole numbers of at least 1', 'error'); return; }

    try {
      await api.adminCreateCoupon({
        code, type: values.type, value,
        min_order_minor: minOrder, max_discount_minor: maxDiscount,
        starts_at: startsAt, ends_at: endsAt,
        usage_limit: usageLimit, per_user_limit: perUserLimit,
        description: values.description,
      });
      toast(`Coupon ${code} created`, 'success');
      await load(false);
    } catch (error) {
      toast(error.message || 'Could not create the coupon', 'error');
    }
  }

  /* ---------- edit / toggle ---------- */
  async function editCoupon(id) {
    const coupon = state.coupons.find(c => c.id === id);
    if (!coupon) return;
    const values = await formSheet({
      title: `Edit ${coupon.code}`,
      submitLabel: 'Save changes',
      note: 'Type, value and window are fixed after creation. Pause and recreate to change them.',
      fields: [{ name: 'description', label: 'Description', value: coupon.description || '', attrs: 'maxlength="160"' }],
    });
    if (!values) return;
    try {
      await api.adminUpdateCoupon(id, { description: values.description });
      toast('Coupon updated', 'success');
      await load(false);
    } catch (error) {
      toast(error.message || 'Could not update the coupon', 'error');
    }
  }

  async function toggleCoupon(id) {
    const coupon = state.coupons.find(c => c.id === id);
    if (!coupon) return;
    const pausing = coupon.active;
    const ok = await askConfirm({
      title: pausing ? `Pause ${coupon.code}?` : `Activate ${coupon.code}?`,
      message: pausing ? 'Customers can no longer apply this code. Existing orders keep their discount.' : 'The code becomes applyable again within its validity window.',
      confirmLabel: pausing ? 'Pause coupon' : 'Activate coupon',
      danger: pausing,
    });
    if (!ok) return;
    try {
      await api.adminUpdateCoupon(id, { active: !pausing });
      toast(pausing ? 'Coupon paused' : 'Coupon activated', 'success');
      await load(false);
    } catch (error) {
      toast(error.message || 'Could not update the coupon', 'error');
    }
  }

  /* ---------- delegated actions ---------- */
  function onClick(event) {
    if (event.target.closest('[data-new-coupon]')) { event.preventDefault(); newCoupon(); return; }
    const edit = event.target.closest('[data-edit-coupon]');
    if (edit) { event.preventDefault(); editCoupon(edit.dataset.editCoupon); return; }
    const toggle = event.target.closest('[data-toggle-coupon]');
    if (toggle) { event.preventDefault(); toggleCoupon(toggle.dataset.toggleCoupon); }
  }

  render();
  outlet.addEventListener('click', onClick);
  await load();
  return () => { alive = false; outlet.removeEventListener('click', onClick); };
}