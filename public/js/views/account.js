// Account page: profile, quick links, install app, about.
import { state, basketCount } from '../state.js';
import { esc, icon, toast, formSheet, askConfirm } from '../ui.js';
import { navigate, onView } from '../router.js';
import { updateProfile, signOut } from '../actions.js';
import { APP_VERSION, BRAND } from '../config.js';
import { promptInstall } from '../install.js';

export function renderAccount(outlet) {
  const draw = () => {
    const user = state.session.user;
    if (!user) {
      outlet.innerHTML = `
        <div class="subbar"><h1>Account</h1></div>
        <div class="page">
          <div class="acct-head">
            <span class="acct-avatar">🛒</span>
            <div><strong>Guest shopper</strong><span>Sign in to keep your basket and orders</span></div>
          </div>
          <div class="acct-rows">
            <button class="acct-row" data-go-signin>
              <span class="a-icon">${icon('user')}</span>
              <span class="a-main"><strong>Sign in</strong><span>Use the sample shopper or shopkeeper account</span></span>
              ${icon('chevronRight')}
            </button>
          </div>
        </div>`;
      outlet.querySelector('[data-go-signin]')?.addEventListener('click', () => navigate('#/welcome'));
      return;
    }

    const name = state.profile?.display_name || user.display_name || 'Shopper';
    outlet.innerHTML = `
      <div class="subbar"><h1>Account</h1></div>
      <div class="page">
        <div class="acct-head">
          <span class="acct-avatar">${esc(name.slice(0, 1).toUpperCase())}</span>
          <div><strong>${esc(name)}</strong><span>${user.role === 'seller' ? 'Shopkeeper · partner app' : 'Sample shopper account'} · id ${esc(user.id)}</span></div>
          ${user.role === 'shopper' ? `<button class="btn btn-ghost" data-edit-name>${icon('edit')}</button>` : ''}
        </div>
        <div class="acct-rows">
          ${user.role === 'shopper' ? `
            <button class="acct-row" data-go="#/cart">
              <span class="a-icon">${icon('basket')}</span>
              <span class="a-main"><strong>My Basket</strong><span>${basketCount()} item${basketCount() === 1 ? '' : 's'} · choose a pickup slot</span></span>
              ${icon('chevronRight')}
            </button>
            <button class="acct-row" data-go="#/orders">
              <span class="a-icon">${icon('receipt')}</span>
              <span class="a-main"><strong>My Orders</strong><span>Track packing and pickup codes</span></span>
              ${icon('chevronRight')}
            </button>
            <button class="acct-row" data-go="#/saved">
              <span class="a-icon">${icon('heart')}</span>
              <span class="a-main"><strong>Saved items</strong><span>${state.saved.length} regular${state.saved.length === 1 ? '' : 's'}</span></span>
              ${icon('chevronRight')}
            </button>
            <button class="acct-row" data-go="#/stores">
              <span class="a-icon">${icon('store')}</span>
              <span class="a-main"><strong>Change shop</strong><span>${esc(state.store?.name || 'Choose a neighbourhood shop')}</span></span>
              ${icon('chevronRight')}
            </button>
            <button class="acct-row" data-install hidden>
              <span class="a-icon">${icon('install')}</span>
              <span class="a-main"><strong>Install app</strong><span>Add ${esc(BRAND.name)} to your home screen</span></span>
              ${icon('chevronRight')}
            </button>
            <button class="acct-row danger" data-acct-signout>
              <span class="a-icon">${icon('logout')}</span>
              <span class="a-main"><strong>Sign out</strong><span>End this demo session</span></span>
              ${icon('chevronRight')}
            </button>` : `
            <button class="acct-row" data-go="#/seller">
              <span class="a-icon">${icon('store')}</span>
              <span class="a-main"><strong>Open partner app</strong><span>Manage orders, shelf stock and pickup slots</span></span>
              ${icon('chevronRight')}
            </button>
            <button class="acct-row danger" data-acct-signout>
              <span class="a-icon">${icon('logout')}</span>
              <span class="a-main"><strong>Sign out</strong><span>End this demo session</span></span>
              ${icon('chevronRight')}
            </button>`}
        </div>
        <p class="welcome-note">${esc(BRAND.name)} v${APP_VERSION} · local prototype · no online payments · sample data only</p>
      </div>`;

    outlet.querySelectorAll('[data-go]').forEach(button => {
      button.addEventListener('click', () => navigate(button.dataset.go));
    });
    outlet.querySelector('[data-acct-signout]')?.addEventListener('click', async () => {
      const ok = await askConfirm({ title: 'Sign out?', message: 'You will need to sign in again to see your orders.', confirmLabel: 'Sign out', danger: true });
      if (ok) { await signOut(); navigate('#/welcome', { replace: true }); }
    });
    outlet.querySelector('[data-edit-name]')?.addEventListener('click', async () => {
      const result = await formSheet({
        title: 'Your nickname',
        submitLabel: 'Save',
        fields: [{
          name: 'display_name',
          label: 'Display name',
          value: name,
          required: true,
          attrs: 'maxlength="80"',
          hint: 'No email or phone is collected in this pilot.',
        }],
      });
      if (result) await updateProfile(result.display_name);
    });
    const installRow = outlet.querySelector('[data-install]');
    installRow?.addEventListener('click', () => {
      if (!promptInstall()) toast('Use your browser menu → “Install app” or “Add to Home screen”');
    });
    if (installRow && !window.matchMedia('(display-mode: standalone)').matches) installRow.hidden = false;
  };

  onView('profile', draw);
  onView('saved', draw);
  onView('basket', draw);
  draw();
}
