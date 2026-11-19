// Rider account: profile, duty toggle, name edit, app switching and sign-out.
import { api } from '../../_shared/api.js';
import { icon, esc, toast, formSheet, askConfirm } from '../../_shared/ui.js';
import { phonePretty } from '../../_shared/format.js';
import { state, bus, signOut } from '../state.js';

const APP_VERSION = 'v2.0.0';

export async function accountView(outlet, params, query, { router }) {
  let disposed = false;
  let homeStoreName = '';

  try {
    const res = await api.stores();
    const stores = res.stores || [];
    homeStoreName = stores.find(s => s.id === state.rider?.home_store_id)?.name || stores[0]?.name || '';
  } catch { /* store name is decorative — profile still renders */ }

  function render() {
    if (disposed) return;
    const rider = state.rider || {};
    const name = rider.name || state.user?.name || 'Rider';
    const initial = name.charAt(0).toUpperCase();
    outlet.innerHTML = `
      <div class="page">
        <div class="acct-head">
          <span class="acct-avatar">${esc(initial)}</span>
          <div class="a-main">
            <strong>${esc(name)}</strong>
            <span>${esc(phonePretty(rider.phone || state.user?.phone || ''))}</span>
            <div class="rd-pills">
              <span class="pill pill-green">${icon('bike')} ${esc(rider.vehicle || 'Bike')}</span>
              ${homeStoreName ? `<span class="pill pill-blue">${icon('store')} ${esc(homeStoreName)}</span>` : ''}
              <span class="pill ${state.online ? 'pill-green' : 'pill-gray'}">${icon('location')} ${state.online ? 'On duty' : 'Off duty'}</span>
            </div>
          </div>
          <button class="icon-btn" data-edit-name aria-label="Edit name">${icon('edit')}</button>
        </div>

        <div class="spacer-16"></div>
        <div class="toggle-card">
          <div class="toggle-row">
            <div class="tg-main">
              <strong>${state.online ? 'On duty' : 'Off duty'}</strong>
              <span>${state.online ? 'Receiving offers and sharing location with live orders.' : 'Go online to receive delivery offers.'}</span>
            </div>
            <button class="switch" role="switch" aria-checked="${state.online}" data-online-toggle aria-label="${state.online ? 'Go offline' : 'Go online'}"></button>
          </div>
        </div>

        <div class="acct-rows">
          <button class="acct-row" data-edit-name>
            <span class="a-icon">${icon('user')}</span>
            <span class="a-main"><strong>Edit name</strong><span>Shown to customers on their Track screen</span></span>
            ${icon('chevronRight')}
          </button>
          <button class="acct-row" data-nav="/earnings">
            <span class="a-icon">${icon('wallet')}</span>
            <span class="a-main"><strong>Earnings & payouts</strong><span>Today, this week and all time</span></span>
            ${icon('chevronRight')}
          </button>
          <button class="acct-row" data-nav="/">
            <span class="a-icon">${icon('bike')}</span>
            <span class="a-main"><strong>Delivery jobs</strong><span>Offers, active deliveries and history</span></span>
            ${icon('chevronRight')}
          </button>
          <button class="acct-row danger" data-signout>
            <span class="a-icon">${icon('logout')}</span>
            <span class="a-main"><strong>Sign out</strong><span>You will stop receiving offers</span></span>
            ${icon('chevronRight')}
          </button>
        </div>

        <div class="section-title"><h2>${icon('grid')} Switch app</h2></div>
        <div class="role-switch">
          <a href="/apps/customer/index.html">Customer</a>
          <a href="/apps/store/index.html">Store picker</a>
          <a href="/apps/rider/index.html" class="current">Rider</a>
          <a href="/apps/admin/index.html">Admin</a>
          <a href="/customer">Pickup app</a>
        </div>
        <p class="app-version">Kirana Corner Rider · ${APP_VERSION} · demo build</p>
      </div>`;
    wire();
  }

  function wire() {
    outlet.querySelectorAll('[data-edit-name]').forEach(btn => btn.addEventListener('click', editName));
    outlet.querySelector('[data-signout]')?.addEventListener('click', doSignOut);
  }

  async function editName() {
    const values = await formSheet({
      title: 'Edit your name',
      submitLabel: 'Save name',
      fields: [{ name: 'name', label: 'Full name', value: state.rider?.name || state.user?.name || '', required: true, placeholder: 'e.g. Arjun Kumar', attrs: 'maxlength="60" autocomplete="name"' }],
      note: 'Customers see this name while tracking their order.',
    });
    if (!values?.name || disposed) return;
    try {
      const res = await api.updateProfile(values.name);
      const updated = res.user || res;
      state.user = { ...state.user, name: updated.name || values.name };
      if (state.rider) state.rider = { ...state.rider, name: updated.name || values.name };
      toast('Name updated', 'success');
      render();
      bus.emit('profile', state.user); // refresh the top bar chrome
    } catch (error) {
      toast(error.message || 'Could not update name', 'error');
    }
  }

  async function doSignOut() {
    const ok = await askConfirm({
      title: 'Sign out?',
      message: state.online ? 'You are on duty — signing out stops new offers. Active deliveries stay assigned to you.' : 'You can sign back in anytime with your rider number.',
      confirmLabel: 'Sign out',
      danger: true,
    });
    if (!ok || disposed) return;
    try { await api.logout(); } catch { /* local sign-out still proceeds */ }
    signOut();
    router.navigate('/auth', { replace: true });
  }

  const offOnline = bus.on('online', render);
  render();

  return () => {
    disposed = true;
    offOnline();
  };
}