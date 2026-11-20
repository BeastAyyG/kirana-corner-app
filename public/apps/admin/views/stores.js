// Store network: searchable table, create / edit via form sheets, and
// activate / suspend toggles with confirmation. All mutations re-fetch the
// admin list so pills and payouts stay truthful.
import { api } from '../../_shared/api.js';
import { icon, esc, toast, spinner, emptyState, askConfirm, formSheet } from '../../_shared/ui.js';
import { money } from '../../_shared/format.js';
import { state, refreshStores } from '../state.js';

export async function storesView(outlet) {
  let alive = true;
  let search = '';
  let loading = !state.stores.length;
  let fetching = false;

  function filtered() {
    const q = search.trim().toLowerCase();
    if (!q) return state.stores;
    return state.stores.filter(s =>
      s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) ||
      (s.city || '').toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q));
  }

  function rowHtml(s) {
    return `<tr>
      <td><div class="t-main">${esc(s.name)}</div><div class="t-sub">${esc(s.id)}</div></td>
      <td><div class="t-main">${esc(s.city)}</div><div class="t-sub">${esc(s.pincode)}</div></td>
      <td><div class="row-actions">
        <span class="pill ${s.is_open ? 'pill-green' : 'pill-gray'}">${s.is_open ? 'Open' : 'Closed'}</span>
        <span class="pill ${s.accepting_orders ? 'pill-blue' : 'pill-amber'}">${s.accepting_orders ? 'Accepting' : 'Paused'}</span>
      </div></td>
      <td class="num">${s.radius_km} km</td>
      <td class="num">${s.prep_time_minutes} min</td>
      <td class="num">${money(s.rider_payout_minor)}</td>
      <td><span class="pill ${s.active ? 'pill-green' : 'pill-red'}">${s.active ? 'Active' : 'Suspended'}</span></td>
      <td><div class="row-actions">
        <button class="mini-btn" data-edit-store="${esc(s.id)}">${icon('edit')} Edit</button>
        <button class="mini-btn ${s.active ? 'danger' : ''}" data-toggle-store="${esc(s.id)}">${icon(s.active ? 'close' : 'check')} ${s.active ? 'Suspend' : 'Activate'}</button>
      </div></td>
    </tr>`;
  }

  function renderTable() {
    if (!alive) return;
    const host = outlet.querySelector('[data-stores-table]');
    const note = outlet.querySelector('[data-count]');
    if (!host) return;
    if (loading) { host.innerHTML = spinner('Loading stores…'); return; }
    const list = filtered();
    if (note) note.textContent = `${list.length} of ${state.stores.length} stores`;
    if (!list.length) {
      host.innerHTML = emptyState({ emoji: '🏬', title: search ? 'No matching stores' : 'No stores yet', body: search ? 'Try a different name, id or city.' : 'Add your first store to open the network for deliveries.', actionHtml: search ? '' : '<button class="btn btn-primary" data-add-store>Add store</button>' });
      return;
    }
    host.innerHTML = `<table class="admin-table t-wide">
      <thead><tr><th>Store</th><th>City</th><th>Status</th><th>Radius</th><th>Prep</th><th>Rider payout</th><th>Active</th><th>Actions</th></tr></thead>
      <tbody>${list.map(rowHtml).join('')}</tbody>
    </table>`;
  }

  function render() {
    outlet.innerHTML = `
      <div class="admin-head">
        <div><h1>Store network</h1><div class="ah-sub">Service areas, prep times and rider payouts</div></div>
        <div class="ah-actions">
          <button class="btn btn-outline refresh-btn" data-refresh>${icon('refresh')} Refresh</button>
          <button class="btn btn-primary" data-add-store>${icon('plus')} Add store</button>
        </div>
      </div>
      <div class="admin-toolbar">
        <div class="admin-search">${icon('search')}<input type="search" data-search placeholder="Search name, id, city or address…" value="${esc(search)}" aria-label="Search stores"></div>
        <span class="count-note" data-count></span>
      </div>
      <div class="admin-card"><div class="table-wrap" data-stores-table></div></div>`;
    outlet.querySelector('[data-search]')?.addEventListener('input', e => { search = e.target.value; renderTable(); });
    outlet.querySelector('[data-refresh]')?.addEventListener('click', () => load(true));
    renderTable();
  }

  async function load(manual = false) {
    if (fetching) return;
    fetching = true;
    const btn = outlet.querySelector('[data-refresh]');
    btn?.classList.add('spinning');
    try { await refreshStores(); }
    catch (error) { if (manual) toast(error.message || 'Could not load stores', 'error'); }
    fetching = false;
    loading = false;
    btn?.classList.remove('spinning');
    renderTable();
  }

  /* ---------- create / edit ---------- */
  const num = (value, fallback) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };

  // Backend gap: PATCH /admin/stores/:id resolves the store with active=1, so
  // suspended stores 404. Surface that clearly instead of a raw "not found".
  function storeErrorMessage(error, store) {
    if (error.code === 'STORE_NOT_FOUND' && store && !store.active) {
      return 'The server blocks changes to suspended stores — reactivation needs a backend fix.';
    }
    return error.message || 'Could not update the store';
  }

  async function addStore() {
    const values = await formSheet({
      title: 'Add store',
      submitLabel: 'Create store',
      note: 'The id is slugified to lowercase letters, numbers and dashes. Coordinates drive serviceability.',
      fields: [
        { name: 'id', label: 'Store id', required: true, placeholder: 'saathi-indiranagar', attrs: 'maxlength="40" autocomplete="off"' },
        { name: 'name', label: 'Store name', required: true, placeholder: 'Saathi Kirana — Indiranagar', attrs: 'maxlength="80"' },
        { name: 'address', label: 'Street address', required: true, placeholder: '100 Feet Road, Indiranagar', attrs: 'maxlength="160"' },
        { name: 'city', label: 'City', required: true, placeholder: 'Bengaluru', attrs: 'maxlength="60"' },
        { name: 'pincode', label: 'Pincode', required: true, placeholder: '560038', attrs: 'maxlength="6" inputmode="numeric"' },
        { name: 'lat', label: 'Latitude', required: true, type: 'number', placeholder: '12.9784', attrs: 'step="any" min="-90" max="90"' },
        { name: 'lng', label: 'Longitude', required: true, type: 'number', placeholder: '77.6408', attrs: 'step="any" min="-180" max="180"' },
        { name: 'radius_km', label: 'Delivery radius (km)', type: 'number', value: '3', attrs: 'step="0.5" min="0.5" max="15"' },
        { name: 'prep_time_minutes', label: 'Prep time (minutes)', type: 'number', value: '8', attrs: 'step="1" min="1" max="120"' },
      ],
    });
    if (!values) return;
    if (!/^\d{6}$/.test(values.pincode)) { toast('Pincode must be exactly 6 digits', 'error'); return; }
    try {
      await api.adminCreateStore({
        id: values.id, name: values.name, address: values.address, city: values.city, pincode: values.pincode,
        lat: num(values.lat, 0), lng: num(values.lng, 0),
        radius_km: num(values.radius_km, 3), prep_time_minutes: Math.round(num(values.prep_time_minutes, 8)),
      });
      toast('Store created', 'success');
      await load(false);
    } catch (error) {
      toast(error.message || 'Could not create the store', 'error');
    }
  }

  async function editStore(id) {
    const store = state.stores.find(s => s.id === id);
    if (!store) return;
    const values = await formSheet({
      title: `Edit ${store.name}`,
      submitLabel: 'Save changes',
      fields: [
        { name: 'name', label: 'Store name', required: true, value: store.name, attrs: 'maxlength="80"' },
        { name: 'address', label: 'Street address', required: true, value: store.address, attrs: 'maxlength="160"' },
        { name: 'lat', label: 'Latitude', required: true, type: 'number', value: String(store.lat), attrs: 'step="any" min="-90" max="90"' },
        { name: 'lng', label: 'Longitude', required: true, type: 'number', value: String(store.lng), attrs: 'step="any" min="-180" max="180"' },
        { name: 'active', label: 'Availability', options: ['Active', 'Suspended'], value: store.active ? 'Active' : 'Suspended' },
      ],
    });
    if (!values) return;
    try {
      await api.adminUpdateStore(id, {
        name: values.name, address: values.address,
        lat: num(values.lat, store.lat), lng: num(values.lng, store.lng),
        active: values.active === 'Active',
      });
      toast('Store updated', 'success');
      await load(false);
    } catch (error) {
      toast(storeErrorMessage(error, store), 'error');
    }
  }

  async function toggleStore(id) {
    const store = state.stores.find(s => s.id === id);
    if (!store) return;
    const suspending = store.active;
    const ok = await askConfirm({
      title: suspending ? `Suspend ${store.name}?` : `Activate ${store.name}?`,
      message: suspending ? 'The store stops accepting new orders immediately. Existing orders are unaffected.' : 'The store rejoins the network and can accept orders again.',
      confirmLabel: suspending ? 'Suspend store' : 'Activate store',
      danger: suspending,
    });
    if (!ok) return;
    try {
      await api.adminUpdateStore(id, { active: !suspending });
      toast(suspending ? 'Store suspended' : 'Store activated', 'success');
      await load(false);
    } catch (error) {
      toast(storeErrorMessage(error, store), 'error');
    }
  }

  /* ---------- delegated actions ---------- */
  function onClick(event) {
    if (event.target.closest('[data-add-store]')) { event.preventDefault(); addStore(); return; }
    const edit = event.target.closest('[data-edit-store]');
    if (edit) { event.preventDefault(); editStore(edit.dataset.editStore); return; }
    const toggle = event.target.closest('[data-toggle-store]');
    if (toggle) { event.preventDefault(); toggleStore(toggle.dataset.toggleStore); }
  }

  render();
  outlet.addEventListener('click', onClick);
  await load();
  return () => { alive = false; outlet.removeEventListener('click', onClick); };
}