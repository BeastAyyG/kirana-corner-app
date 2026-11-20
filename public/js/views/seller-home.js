// Seller dashboard: open/close switch, pickup point, today's stats, quick links.
import { state } from '../state.js';
import { esc, icon, emptyState, formSheet, toast } from '../ui.js';
import { navigate, onView } from '../router.js';
import { sellerUpdateStore, refreshSellerStores, refreshSellerProducts, refreshQueue } from '../actions.js';

export function renderSellerHome(outlet) {
  const draw = async () => {
    if (state.session.user?.role !== 'seller') {
      outlet.innerHTML = `
        <div class="page">
          ${emptyState({ emoji: '🔐', title: 'Shopkeeper access only', body: 'Sign in with the shopkeeper account to manage orders and your shelf.', actionHtml: '<button class="btn btn-primary" data-go-signin>Sign in</button>' })}
        </div>`;
      outlet.querySelector('[data-go-signin]')?.addEventListener('click', () => navigate('#/welcome'));
      return;
    }
    if (!state.seller.stores.length) {
      outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🏪', title: 'No shop linked', body: 'This account has no assigned shop yet. Ask the platform admin to link your shop.', actionHtml: '<button class="btn btn-outline" data-reload>Refresh</button>' })}</div>`;
      outlet.querySelector('[data-reload]')?.addEventListener('click', () => refreshSellerStores());
      return;
    }
    const store = state.seller.store;
    const orders = state.seller.orders;
    const placed = orders.filter(order => order.status === 'placed').length;
    const packing = orders.filter(order => order.status === 'packing').length;
    const ready = orders.filter(order => order.status === 'ready').length;
    const collectedToday = orders.filter(order => order.status === 'collected');
    const activeCount = placed + packing + ready;

    outlet.innerHTML = `
      <div class="page">
        ${state.seller.stores.length > 1 ? `
          <div class="chip-row" data-store-chips>
            ${state.seller.stores.map(item => `<button class="chip ${item.id === store.id ? 'on' : ''}" data-pick-seller-store="${esc(item.id)}">🏪 ${esc(item.name)}</button>`).join('')}
          </div>` : ''}
        <div class="toggle-card">
          <div class="toggle-row">
            <span class="t-icon">${store.is_open ? '🟢' : '🔴'}</span>
            <div class="tg-main">
              <strong>${store.is_open ? 'Shop is open' : 'Shop is closed'}</strong>
              <span>${store.is_open ? 'Shoppers can place pickup orders' : 'New orders are paused'}</span>
            </div>
            <button class="switch" role="switch" aria-checked="${store.is_open}" data-toggle-open aria-label="Toggle shop open"></button>
          </div>
          <div class="toggle-row">
            <span class="t-icon">📍</span>
            <div class="tg-main">
              <strong>${esc(store.pickup_location)}</strong>
              <span>Pickup point shown on shopper orders</span>
            </div>
            <button class="icon-mini" data-edit-pickup aria-label="Edit pickup point">${icon('edit')}</button>
          </div>
        </div>
        <div class="stat-grid">
          <div class="stat-tile accent-new"><strong>${placed}</strong><span>New</span></div>
          <div class="stat-tile"><strong>${packing}</strong><span>Packing</span></div>
          <div class="stat-tile accent-ready"><strong>${ready}</strong><span>Ready</span></div>
          <div class="stat-tile"><strong>${collectedToday.length}</strong><span>Done</span></div>
        </div>
        ${activeCount ? `<div class="notice notice-warn">${icon('alert')}<span><strong>${activeCount} order${activeCount === 1 ? ' needs' : 's need'} action.</strong> Open the queue to pack and hand over bags.</span></div>` : `<div class="notice notice-info">${icon('check')}<span>Queue is clear — no orders waiting on you.</span></div>`}
        <div class="section-title"><h2>Quick actions</h2></div>
        <div class="acct-rows">
          <button class="acct-row" data-go="#/seller/orders">
            <span class="a-icon">${icon('receipt')}</span>
            <span class="a-main"><strong>Pickup queue</strong><span>Pack bags, mark ready, verify codes</span></span>
            ${activeCount ? `<span class="pill pill-amber">${activeCount}</span>` : ''}${icon('chevronRight')}
          </button>
          <button class="acct-row" data-go="#/seller/products">
            <span class="a-icon">${icon('box')}</span>
            <span class="a-main"><strong>Shelf stock</strong><span>${state.seller.products.length} items listed · update prices and counts</span></span>
            ${icon('chevronRight')}
          </button>
          <button class="acct-row" data-go="#/seller/settings">
            <span class="a-icon">${icon('gear')}</span>
            <span class="a-main"><strong>Pickup slots & hours</strong><span>Service days, capacity, closures</span></span>
            ${icon('chevronRight')}
          </button>
        </div>
        <div class="spacer-16"></div>
        <div class="notice notice-info">${icon('store')}<span>Shoppers see live shelf quantities — keep them close to what's actually in the shop.</span></div>
      </div>`;

    outlet.querySelectorAll('[data-go]').forEach(button => {
      button.addEventListener('click', () => navigate(button.dataset.go));
    });
    outlet.querySelectorAll('[data-pick-seller-store]').forEach(button => {
      button.addEventListener('click', () => {
        import('../actions.js').then(({ selectSellerStore }) => selectSellerStore(button.dataset.pickSellerStore));
      });
    });
    outlet.querySelector('[data-toggle-open]')?.addEventListener('click', async event => {
      const next = !store.is_open;
      event.currentTarget.setAttribute('aria-checked', String(next));
      const done = await sellerUpdateStore({ is_open: next });
      if (done) toast(next ? 'Shop opened for pickup' : 'Shop closed — new orders paused', 'success');
    });
    outlet.querySelector('[data-edit-pickup]')?.addEventListener('click', async () => {
      const result = await formSheet({
        title: 'Pickup point',
        submitLabel: 'Save',
        fields: [{
          name: 'pickup_location',
          label: 'Where shoppers collect bags',
          value: store.pickup_location,
          required: true,
          attrs: 'maxlength="120"',
          hint: 'Shown on every order, e.g. "Green rack beside the front counter".',
        }],
      });
      if (result) await sellerUpdateStore({ is_open: store.is_open, pickup_location: result.pickup_location });
    });
  };

  const refresh = () => draw();
  onView('seller', refresh);
  if (!state.seller.productsLoaded) refreshSellerProducts({ silent: true });
  if (!state.seller.ordersLoaded) refreshQueue({ silent: true });
  draw();
}
