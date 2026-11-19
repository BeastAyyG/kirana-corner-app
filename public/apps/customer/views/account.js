// Account hub + delivery addresses + saved items + notifications.
// All four are customer tab-root / detail screens sharing the v2 UI kit.
import { api } from '../../_shared/api.js';
import { icon, esc, toast, formSheet, askConfirm, emptyState, productCardHtml, spinner, sheet } from '../../_shared/ui.js';
import { phonePretty, relativeTime } from '../../_shared/format.js';
import { state, bus, setAddress, resolveServiceability, refreshSaved, cartQty, getProduct, signOut } from '../state.js';

/* ============================ Account ============================ */
export async function accountView(outlet, params, query, { router }) {
  function render() {
    const u = state.user || {};
    const initial = (u.name || 'K').trim().charAt(0).toUpperCase();
    const savedCount = state.saved.size;
    outlet.innerHTML = `
      <div class="page">
        <div class="acct-head">
          <div class="acct-avatar">${esc(initial)}</div>
          <div class="a-main"><strong>${esc(u.name || 'Kirana shopper')}</strong><span>${esc(phonePretty(u.phone))}</span></div>
          <button class="icon-btn" data-edit-profile aria-label="Edit name">${icon('edit')}</button>
        </div>
        <div class="acct-rows">
          <button class="acct-row" data-nav="/addresses"><span class="a-icon">${icon('pin')}</span><span class="a-main"><strong>Delivery addresses</strong><span>${state.addresses.length} saved</span></span>${icon('chevronRight')}</button>
          <button class="acct-row" data-nav="/saved"><span class="a-icon">${icon('heart')}</span><span class="a-main"><strong>Saved items</strong><span>${savedCount} item${savedCount === 1 ? '' : 's'}</span></span>${icon('chevronRight')}</button>
          <button class="acct-row" data-nav="/notifications"><span class="a-icon">${icon('chat')}</span><span class="a-main"><strong>Notifications</strong><span>Order updates & offers</span></span>${icon('chevronRight')}</button>
          <button class="acct-row" data-about><span class="a-icon">${icon('shield')}</span><span class="a-main"><strong>About Kirana Corner</strong><span>Version & demo info</span></span>${icon('chevronRight')}</button>
        </div>
        <div class="acct-rows">
          <button class="acct-row danger" data-signout><span class="a-icon">${icon('logout')}</span><span class="a-main"><strong>Sign out</strong><span>Switch to another account</span></span>${icon('chevronRight')}</button>
        </div>
      </div>`;
    wire();
  }

  function wire() {
    outlet.querySelector('[data-edit-profile]')?.addEventListener('click', editProfile);
    outlet.querySelector('[data-about]')?.addEventListener('click', about);
    outlet.querySelector('[data-signout]')?.addEventListener('click', signOutFlow);
  }

  async function editProfile() {
    const values = await formSheet({
      title: 'Edit profile', submitLabel: 'Save',
      fields: [{ name: 'name', label: 'Your name', value: state.user?.name || '', required: true, placeholder: 'e.g. Ayyappa' }],
    });
    if (!values) return;
    try {
      const res = await api.updateProfile(values.name);
      state.user = res.user || res;
      render();
      toast('Profile updated', 'success');
    } catch (error) { toast(error.message || 'Could not update profile', 'error'); }
  }

  function about() {
    sheet(`
      <div class="kv-list">
        <div class="kv-row"><span class="k">App</span><span class="v">Kirana Corner</span></div>
        <div class="kv-row"><span class="k">Experience</span><span class="v">Delivery (v2)</span></div>
        <div class="kv-row"><span class="k">Mode</span><span class="v">Demo build</span></div>
      </div>
      <p class="muted tiny">Kirana Corner connects neighbourhood shops with nearby shoppers. Order groceries, track your rider live, and pay on delivery or online. This demo uses sample data — no real money moves.</p>`,
      { title: 'About Kirana Corner' });
  }

  async function signOutFlow() {
    const ok = await askConfirm({ title: 'Sign out?', message: 'You can sign back in with your phone number anytime.', confirmLabel: 'Sign out', danger: true });
    if (!ok) return;
    try { await api.logout(); } catch { /* local sign-out still proceeds */ }
    signOut();
    router.navigate('/auth', { replace: true });
  }

  const offSaved = bus.on('saved', render);
  render();
  return () => offSaved();
}

/* ============================ Addresses ============================ */
function addressFields(a = {}) {
  return [
    { name: 'label', label: 'Label', value: a.label || 'Home', placeholder: 'Home / Work' },
    { name: 'receiver_name', label: 'Receiver name', value: a.receiver_name || state.user?.name || '', required: true },
    { name: 'receiver_phone', label: 'Receiver phone', value: a.receiver_phone || state.user?.phone || '', required: true },
    { name: 'line1', label: 'Address line 1', value: a.line1 || '', required: true, placeholder: 'Flat, building, street' },
    { name: 'line2', label: 'Address line 2', value: a.line2 || '', placeholder: 'Area, landmark' },
    { name: 'city', label: 'City', value: a.city || 'Bengaluru', required: true },
    { name: 'pincode', label: 'Pincode', value: a.pincode || '560034', required: true },
  ];
}
function demoLatLng() {
  const base = state.addresses[0] || state.store || { lat: 12.939, lng: 77.621 };
  return { lat: base.lat + (Math.random() - 0.5) * 0.004, lng: base.lng + (Math.random() - 0.5) * 0.004 };
}

export async function addressesView(outlet, params, query, { router }) {
  async function load() {
    try { const res = await api.addresses(); state.addresses = res.addresses || []; }
    catch { /* keep cached */ }
    render();
  }

  function addrCard(a) {
    const selected = state.address?.id === a.id;
    const line = a.full_address || [a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', ');
    return `<div class="addr-card" data-select="${esc(a.id)}" aria-pressed="${selected}" role="button" tabindex="0">
      <span class="ad-ico">${icon(a.label === 'Work' ? 'store' : 'home')}</span>
      <span class="ad-main">
        <span class="ad-label">${esc(a.label || 'Address')}${a.is_default ? '<span class="pill pill-green">Default</span>' : ''}</span>
        <span class="ad-line">${esc(line)}</span>
        <span class="ad-line">${esc(a.receiver_name || '')} · ${esc(phonePretty(a.receiver_phone))}</span>
        <span class="addr-actions">
          <button class="mini-btn" data-edit="${esc(a.id)}">${icon('edit')} Edit</button>
          <button class="mini-btn" data-default="${esc(a.id)}" ${a.is_default ? 'disabled' : ''}>${icon('check')} Set default</button>
          <button class="mini-btn danger" data-del="${esc(a.id)}">${icon('trash')} Delete</button>
        </span>
      </span>
      <span class="ad-check">${icon('check')}</span>
    </div>`;
  }

  function render() {
    outlet.innerHTML = `
      <div class="page">
        <p class="muted tiny">Tap an address to deliver there. Manage saved addresses below.</p>
        <div data-addr-list>${state.addresses.length ? state.addresses.map(addrCard).join('') : emptyState({ emoji: '📍', title: 'No addresses yet', body: 'Add a delivery address to get started.' })}</div>
        <button class="addr-add" data-add>${icon('plus')} Add a new address</button>
      </div>`;
    wire();
  }

  function wire() {
    outlet.querySelector('[data-add]')?.addEventListener('click', addAddress);
    outlet.querySelectorAll('[data-select]').forEach(card => {
      const select = () => chooseAddress(card.dataset.select);
      card.addEventListener('click', select);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
    });
    outlet.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); editAddress(btn.dataset.edit); }));
    outlet.querySelectorAll('[data-default]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); setDefault(btn.dataset.default); }));
    outlet.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); removeAddress(btn.dataset.del); }));
  }

  async function chooseAddress(id) {
    const addr = state.addresses.find(a => a.id === id);
    if (!addr) return;
    setAddress(addr);
    const res = await resolveServiceability(addr);
    render();
    if (res && !res.serviceable) toast('This address is outside our delivery area', 'error');
    else toast(`Delivering to ${addr.label || 'address'}`, 'success');
  }

  async function addAddress() {
    const values = await formSheet({ title: 'Add delivery address', submitLabel: 'Save address', fields: addressFields(), note: 'Demo addresses are geocoded near Koramangala so a store can deliver.' });
    if (!values) return;
    try {
      const res = await api.createAddress({ ...values, ...demoLatLng(), is_default: state.addresses.length === 0 });
      const addr = res.address || res;
      state.addresses.push(addr);
      setAddress(addr);
      await resolveServiceability(addr);
      render();
      toast('Address added', 'success');
    } catch (error) { toast(error.message || 'Could not add address', 'error'); }
  }

  async function editAddress(id) {
    const current = state.addresses.find(a => a.id === id);
    if (!current) return;
    const values = await formSheet({ title: 'Edit address', submitLabel: 'Save changes', fields: addressFields(current) });
    if (!values) return;
    try {
      const res = await api.updateAddress(id, values);
      const addr = res.address || res;
      state.addresses = state.addresses.map(a => a.id === id ? addr : a);
      if (state.address?.id === id) { setAddress(addr); await resolveServiceability(addr); }
      render();
      toast('Address updated', 'success');
    } catch (error) { toast(error.message || 'Could not update address', 'error'); }
  }

  async function setDefault(id) {
    try {
      await api.updateAddress(id, { is_default: true });
      await load();
      toast('Default address updated', 'success');
    } catch (error) { toast(error.message || 'Could not set default', 'error'); }
  }

  async function removeAddress(id) {
    const ok = await askConfirm({ title: 'Delete address?', message: 'This address will be removed from your account.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.deleteAddress(id);
      const wasSelected = state.address?.id === id;
      await load();
      if (wasSelected) {
        const next = state.addresses.find(a => a.is_default) || state.addresses[0] || null;
        setAddress(next);
        if (next) await resolveServiceability(next);
      }
      render();
      toast('Address deleted', 'success');
    } catch (error) { toast(error.message || 'Could not delete address', 'error'); }
  }

  await load();
}

/* ============================ Saved items ============================ */
export async function savedView(outlet, params, query, { router }) {
  function render() {
    const items = [...state.saved].map(id => getProduct(id)).filter(Boolean);
    outlet.innerHTML = `<div class="page">${items.length
      ? `<div class="plp-grid">${items.map(p => `
          <div class="saved-cell">
            ${productCardHtml(p, { qty: cartQty(p.id) })}
            <button class="saved-remove" data-unsave="${esc(p.id)}" data-store="${esc(p.store_id)}" aria-label="Remove ${esc(p.name)} from saved">${icon('heart')}</button>
          </div>`).join('')}</div>`
      : emptyState({ emoji: '💚', title: 'No saved items yet', body: 'Tap the heart on any product to keep it here for later.', actionHtml: '<button class="btn btn-primary" data-nav="/browse">Browse products</button>' })}</div>`;
    wire();
  }

  function wire() {
    outlet.querySelectorAll('[data-unsave]').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api.unsave(btn.dataset.store, btn.dataset.unsave);
        await refreshSaved();
        render();
        toast('Removed from saved', 'success');
      } catch (error) { toast(error.message || 'Could not remove', 'error'); btn.disabled = false; }
    }));
  }

  const offSaved = bus.on('saved', render);
  await refreshSaved();
  render();
  return () => offSaved();
}

/* ============================ Notifications ============================ */
const NOTIF_ICON = { order: 'truck', payment: 'wallet', refund: 'refresh', promo: 'percent', offer: 'percent' };

export async function notificationsView(outlet, params, query, { router }) {
  let items = [];
  let loading = true;

  async function load() {
    try { const res = await api.notifications(); items = res.notifications || []; }
    catch (error) { items = []; toast(error.message || 'Could not load notifications', 'error'); }
    loading = false;
    render();
  }

  function row(n) {
    return `<div class="notif-row ${n.read ? '' : 'unread'}" data-notif="${esc(n.id)}" ${n.order_id ? `data-order="${esc(n.order_id)}" role="button" tabindex="0"` : ''}>
      <span class="nf-ico">${icon(NOTIF_ICON[n.kind] || 'chat')}</span>
      <span class="nf-main">
        <span class="nf-title">${esc(n.title)}</span>
        <span class="nf-body">${esc(n.body)}</span>
        <span class="nf-time">${esc(relativeTime(n.created_at))}</span>
      </span>
    </div>`;
  }

  function render() {
    if (loading) { outlet.innerHTML = `<div class="page">${spinner('Loading notifications…')}</div>`; return; }
    const unread = items.filter(n => !n.read).length;
    outlet.innerHTML = `
      <div class="page">
        ${items.length ? `<div class="notif-head"><span class="muted tiny">${unread} unread</span><button class="mini-btn" data-read-all ${unread ? '' : 'disabled'}>${icon('check')} Mark all read</button></div>` : ''}
        <div data-notif-list>${items.length ? items.map(row).join('') : emptyState({ emoji: '🔔', title: 'No notifications', body: 'Order updates and offers will appear here.' })}</div>
      </div>`;
    wire();
  }

  function wire() {
    outlet.querySelector('[data-read-all]')?.addEventListener('click', async () => {
      try { await api.readAllNotifications(); items = items.map(n => ({ ...n, read: true })); render(); }
      catch (error) { toast(error.message || 'Could not update', 'error'); }
    });
    outlet.querySelectorAll('[data-notif]').forEach(el => {
      const activate = async () => {
        const n = items.find(x => x.id === el.dataset.notif);
        if (n && !n.read) {
          try { await api.readNotification(n.id); n.read = true; el.classList.remove('unread'); updateUnread(); } catch { /* ignore */ }
        }
        if (el.dataset.order) router.navigate(`/track/${el.dataset.order}`);
      };
      el.addEventListener('click', activate);
      if (el.dataset.order) el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
    });
  }

  function updateUnread() {
    const head = outlet.querySelector('.notif-head .muted');
    const unread = items.filter(n => !n.read).length;
    if (head) head.textContent = `${unread} unread`;
    const btn = outlet.querySelector('[data-read-all]');
    if (btn) btn.disabled = unread === 0;
  }

  await load();
}