// Shopper home: banners, category circles, deals rail, bestsellers, slot teaser,
// recent orders — arranged like a grocery app landing page.
import { state, basketCount } from '../state.js';
import { esc, icon, productCardHtml, emptyState, skeletonCards } from '../ui.js';
import { navigate } from '../router.js';
import { money, slotWhen, statusText } from '../format.js';
import { CATEGORY_META } from '../art.js';

const BANNERS = [
  { cls: 'banner-green', emoji: '🧺', title: 'Evening pickup from your corner shop', sub: 'Reserve a slot — one labeled bag, packed for you' },
  { cls: 'banner-lime', emoji: '🥬', title: 'Fresh shelf stock, updated daily', sub: 'The shopkeeper keeps quantities live' },
  { cls: 'banner-deep', emoji: '💛', title: 'Save your regulars, shop again in a tap', sub: 'Repeat last order at today’s prices' },
];

function bannerDots(count) {
  return `<div class="banner-dot-row">${Array.from({ length: count }, (_, i) => `<span class="banner-dot ${i === 0 ? 'on' : ''}"></span>`).join('')}</div>`;
}

export async function renderHome(outlet) {
  const store = state.store;
  const products = state.products;
  const count = basketCount();

  const categoryTiles = CATEGORY_META.map(meta => {
    const countFor = meta.key === 'All' ? products.length : products.filter(product => product.category === meta.key).length;
    return `<button class="cat-tile" data-cat="${esc(meta.key)}" aria-pressed="${state.filters.category === meta.key}">
      <span class="cat-circle ${meta.tint}">${meta.emoji}</span>
      <span>${esc(meta.label)}${countFor ? ` · ${countFor}` : ''}</span>
    </button>`;
  }).join('');

  const deals = [...products].filter(product => product.available > 0).sort((a, b) => a.price_minor - b.price_minor).slice(0, 8);
  const fresh = [...products].filter(product => product.available > 0).slice(0, 8);
  const activeOrders = state.orders.filter(order => ['placed', 'packing', 'ready'].includes(order.status)).slice(0, 4);

  outlet.innerHTML = `
    ${store && !store.is_open ? `<div class="notice notice-warn">${icon('alert')}<span><strong>${esc(store.name)} is closed right now.</strong> You can still browse and build a basket; orders need an open shop and a bookable slot.</span></div>` : ''}
    <div class="banner-rail" data-banners>
      ${BANNERS.map(banner => `
        <div class="banner ${banner.cls}">
          <span class="b-emoji">${banner.emoji}</span>
          <strong>${esc(banner.title)}</strong>
          <span>${esc(banner.sub)}</span>
        </div>`).join('')}
    </div>
    ${bannerDots(BANNERS.length)}
    <div class="section-title"><h2>Shop by category</h2><a class="see-all" data-go="#/categories">See all</a></div>
    <div class="cat-grid">${categoryTiles}</div>
    <div class="section-title"><h2>Low prices this week</h2><span class="tiny muted">pay at store</span></div>
    ${deals.length ? `<div class="hrail" data-deals-rail>${deals.map(product => productCardHtml(product, {
      qty: Number(state.basket[product.id] || 0),
      saved: state.saved.some(item => item.product_id === product.id),
      rail: true,
    })).join('')}</div>` : skeletonCards(3)}
    <div class="teaser">
      <span class="t-icon">🕗</span>
      <div class="t-main"><strong>Choose your pickup slot</strong><span>30-minute evening windows at ${esc(store?.name || 'your shop')}</span></div>
      <button class="btn btn-primary" data-go="#/cart">Slot</button>
    </div>
    <div class="section-title"><h2>On the shelf now</h2><a class="see-all" data-go="#/categories">Browse</a></div>
    ${fresh.length ? `<div class="hrail" data-fresh-rail>${fresh.map(product => productCardHtml(product, {
      qty: Number(state.basket[product.id] || 0),
      saved: state.saved.some(item => item.product_id === product.id),
      rail: true,
    })).join('')}</div>` : `<div class="page">${emptyState({ emoji: '🏪', title: 'Shelf is empty right now', body: 'The shopkeeper has not listed any items yet. Check back soon.' })}</div>`}
    ${state.session.user?.role === 'shopper' && activeOrders.length ? `
      <div class="section-title"><h2>Your pickup orders</h2><a class="see-all" data-go="#/orders">All orders</a></div>
      <div class="order-strip">
        ${activeOrders.map(order => `
          <button class="mini-order" data-go="#/order/${esc(order.id)}">
            <span class="mo-row"><span class="mo-label">${esc(order.public_label)}</span><span class="pill pill-gray">${money(order.total_minor)}</span></span>
            <span class="mo-row"><span class="status-chip status-${esc(order.status)}"><i></i>${esc(statusText(order.status))}</span></span>
            <span class="mo-sub">${esc(slotWhen(order))}</span>
          </button>`).join('')}
      </div>` : ''}
    ${state.session.user?.role === 'shopper' && state.orders.some(order => order.status !== 'cancelled' && order.status !== 'collected') === false && state.orders.length ? `
      <div class="teaser"><span class="t-icon">🔁</span><div class="t-main"><strong>Shop your last order again</strong><span>Everything you picked last time</span></div><button class="btn btn-ghost" data-go="#/orders">View</button></div>` : ''}
    ${!state.session.user ? `
      <div class="teaser">
        <span class="t-icon">👤</span>
        <div class="t-main"><strong>Shopping as a guest</strong><span>Sign in to place pickup orders and keep your basket</span></div>
        <button class="btn btn-primary" data-go="#/welcome">Sign in</button>
      </div>` : ''}
    ${count ? `<button class="checkout-cta" data-go="#/cart" aria-label="View basket">
      <span class="cta-copy"><strong>${count} item${count === 1 ? '' : 's'} in basket</strong><span>Review & choose slot</span></span>
      <span class="cta-go">View basket ${icon('chevronRight')}</span>
    </button>` : ''}`;

  // category tiles
  outlet.querySelectorAll('[data-cat]').forEach(tile => {
    tile.addEventListener('click', () => navigate(`#/c/${tile.dataset.cat}`));
  });

  // banner dots sync
  const rail = outlet.querySelector('[data-banners]');
  const dots = outlet.querySelectorAll('.banner-dot');
  if (rail && dots.length) {
    rail.addEventListener('scroll', () => {
      const index = Math.min(dots.length - 1, Math.round(rail.scrollLeft / (rail.scrollWidth / BANNERS.length)));
      dots.forEach((dot, i) => dot.classList.toggle('on', i === index));
    }, { passive: true });
  }

  // store teaser: if no store chosen, nudge to stores
  if (!store) {
    outlet.querySelectorAll('[data-deals-rail], [data-fresh-rail]').forEach(node => node.addEventListener('click', event => {
      if (event.target.closest('[data-qty-plus]')) navigate('#/stores');
    }, { once: true }));
    outlet.querySelector('.section-title')?.insertAdjacentHTML('beforebegin',
      `<div class="notice notice-info">${icon('store')}<span>Pick a neighbourhood shop first — <button class="see-all" data-go="#/stores">choose a shop</button></span></div>`);
  }
}
