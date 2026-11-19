// Shopper home (bbnow): photo banner carousel, category chips, product rails,
// slot teaser and active-order strip. The floating cluster carries the basket CTA.
import { state } from '../state.js';
import { esc, icon, productCardHtml, emptyState, skeletonCards } from '../ui.js';
import { navigate, onView } from '../router.js';
import { money, slotWhen, statusText } from '../format.js';
import { CATEGORY_META, artForCategory } from '../art.js';

const BANNERS = [
  { img: '/img/banners/fresh-vegetables.webp', title: 'Fresh from the morning mandi', sub: 'Hand-picked vegetables, stocked daily', cat: 'Vegetables' },
  { img: '/img/banners/dairy-morning.webp', title: 'Milk, curd & paneer by 7 am', sub: 'Dairy essentials from your corner shop', cat: 'Dairy' },
  { img: '/img/banners/daily-staples.webp', title: 'Stock up for the week', sub: 'Atta, rice, dal & oil at shelf prices', cat: 'Staples' },
];
const CHIP_BADGE = { Vegetables: { text: 'FRESH', cls: 'dark' }, Snacks: { text: 'NEW', cls: 'red' } };
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

function railSignature(products) {
  return products.map(p => `${p.id}:${p.price_minor}:${p.available}:${p.active}`).join('|');
}

function chipsHtml() {
  return CATEGORY_META.map(meta => {
    const badge = CHIP_BADGE[meta.key];
    const ico = meta.key === 'All' ? icon('bag') : `<img src="${artForCategory(meta.key)}" alt="" loading="lazy" data-art-cat="${esc(meta.key)}">`;
    return `<button class="cat-chip" data-cat="${esc(meta.key)}" aria-pressed="${state.filters.category === meta.key}">
      ${badge ? `<span class="cc-badge ${badge.cls}">${badge.text}</span>` : ''}
      <span class="cc-ico">${ico}</span>
      <span class="cc-label">${esc(meta.label)}</span>
    </button>`;
  }).join('');
}

function railHtml(products, { sortPrice = false } = {}) {
  let list = products.filter(product => product.available > 0 && product.active);
  if (sortPrice) list = [...list].sort((a, b) => a.price_minor - b.price_minor);
  list = list.slice(0, 10);
  if (!list.length) return '';
  return list.map(product => productCardHtml(product, {
    qty: Number(state.basket[product.id] || 0), rail: true,
  })).join('');
}

function orderStripHtml() {
  const active = state.orders.filter(order => ['placed', 'packing', 'ready'].includes(order.status)).slice(0, 4);
  if (state.session.user?.role !== 'shopper' || !active.length) return '';
  return `
    <div class="section-title home-title"><h2>Your pickup orders</h2><a class="see-all" data-go="#/orders">All orders</a></div>
    <div class="order-strip">
      ${active.map(order => `
        <button class="mini-order" data-go="#/order/${esc(order.id)}">
          <span class="mo-row"><span class="mo-label">${esc(order.public_label)}</span><span class="pill pill-gray">${money(order.total_minor)}</span></span>
          <span class="mo-row"><span class="status-chip status-${esc(order.status)}"><i></i>${esc(statusText(order.status))}</span></span>
          <span class="mo-sub">${esc(slotWhen(order))}</span>
        </button>`).join('')}
    </div>`;
}

export function renderHome(outlet) {
  const store = state.store;
  const products = state.products;
  const dealsSig = railSignature(products);

  outlet.innerHTML = `
    <div class="home">
      ${store && !store.is_open ? `<div class="pad-x"><div class="notice notice-warn">${icon('alert')}<span><strong>${esc(store.name)} is closed right now.</strong> Browse and build a basket; orders need an open shop and a bookable slot.</span></div></div>` : ''}
      ${!store ? `<div class="pad-x"><div class="notice notice-info">${icon('store')}<span>Pick a neighbourhood shop first — <button class="see-all" data-go="#/stores">choose a shop</button></span></div></div>` : ''}
      <div class="banner-rail" data-banners>
        ${BANNERS.map(banner => `
          <button class="banner" data-go="#/c/${esc(banner.cat)}" aria-label="${esc(banner.title)} — shop ${esc(banner.cat)}">
            <img class="banner-bg" src="${banner.img}" alt="" loading="lazy" data-art-cat="${esc(banner.cat)}">
            <span class="banner-scrim"></span>
            <span class="banner-copy"><strong>${esc(banner.title)}</strong><span>${esc(banner.sub)}</span><span class="shop-now">Shop now ${icon('arrowRight')}</span></span>
          </button>`).join('')}
      </div>
      <div class="banner-dot-row">${BANNERS.map((_, i) => `<span class="banner-dot ${i === 0 ? 'on' : ''}"></span>`).join('')}</div>
      <div class="cat-chips">${chipsHtml()}</div>

      <div class="section-title home-title"><h2>Low prices this week</h2><button class="see-circle" data-go="#/c/All" aria-label="See all">${icon('arrowRight')}</button></div>
      <div class="hrail" data-deals>${railHtml(products, { sortPrice: true }) || skeletonCards(3)}</div>

      <div class="teaser">
        <span class="t-icon">${icon('clock')}</span>
        <div class="t-main"><strong>Choose your pickup slot</strong><span>30-minute evening windows at ${esc(store?.name || 'your shop')}</span></div>
        <button class="btn btn-primary" data-go="#/cart">Slot</button>
      </div>

      <div class="section-title home-title"><h2>On the shelf now</h2><button class="see-circle" data-go="#/categories" aria-label="Browse">${icon('arrowRight')}</button></div>
      <div class="hrail" data-fresh>${railHtml(products) || `<div class="pad-x">${emptyState({ emoji: '🏪', title: 'Shelf is empty right now', body: 'The shopkeeper has not listed any items yet. Check back soon.' })}</div>`}</div>

      <div data-orders-slot>${orderStripHtml()}</div>

      ${!state.session.user ? `
        <div class="teaser">
          <span class="t-icon">${icon('user')}</span>
          <div class="t-main"><strong>Shopping as a guest</strong><span>Sign in to place pickup orders and keep your basket</span></div>
          <button class="btn btn-primary" data-go="#/welcome">Sign in</button>
        </div>` : ''}
    </div>`;

  outlet.querySelectorAll('[data-cat]').forEach(tile => {
    tile.addEventListener('click', () => navigate(`#/c/${tile.dataset.cat}`));
  });

  /* banner carousel: dot sync + auto-advance (pauses on touch, respects reduced motion) */
  const rail = outlet.querySelector('[data-banners]');
  const dots = [...outlet.querySelectorAll('.banner-dot')];
  let timer = null;
  let paused = false;
  const stride = () => (rail.querySelector('.banner')?.offsetWidth || rail.clientWidth) + 12;
  const indexNow = () => Math.max(0, Math.min(BANNERS.length - 1, Math.round(rail.scrollLeft / stride())));
  const syncDots = () => dots.forEach((dot, i) => dot.classList.toggle('on', i === indexNow()));
  rail.addEventListener('scroll', syncDots, { passive: true });
  const pause = () => { paused = true; };
  const resume = () => { paused = false; };
  rail.addEventListener('pointerdown', pause);
  rail.addEventListener('pointerup', resume);
  rail.addEventListener('pointercancel', resume);
  rail.addEventListener('mouseenter', pause);
  rail.addEventListener('mouseleave', resume);
  if (!REDUCED.matches) {
    timer = setInterval(() => {
      if (paused || document.hidden) return;
      const next = (indexNow() + 1) % BANNERS.length;
      rail.scrollTo({ left: next * stride(), behavior: 'smooth' });
    }, 5000);
  }

  /* live updates that never disturb the carousel */
  let lastDealsSig = dealsSig;
  onView('catalog', () => {
    const sig = railSignature(state.products);
    if (sig === lastDealsSig) return;
    lastDealsSig = sig;
    const deals = outlet.querySelector('[data-deals]');
    const fresh = outlet.querySelector('[data-fresh]');
    if (deals) deals.innerHTML = railHtml(state.products, { sortPrice: true }) || skeletonCards(3);
    if (fresh) fresh.innerHTML = railHtml(state.products) || '';
  });
  onView('orders', () => {
    const slot = outlet.querySelector('[data-orders-slot]');
    if (slot) slot.innerHTML = orderStripHtml();
  });

  return () => {
    if (timer) clearInterval(timer);
    rail.removeEventListener('scroll', syncDots);
    rail.removeEventListener('pointerdown', pause);
    rail.removeEventListener('pointerup', resume);
    rail.removeEventListener('pointercancel', resume);
    rail.removeEventListener('mouseenter', pause);
    rail.removeEventListener('mouseleave', resume);
  };
}