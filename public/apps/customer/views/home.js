// Home: bbnow-style banner carousel, category chips, product rails and an
// active-order strip. Banners are original photography with HTML overlay copy.
import { api } from '../../_shared/api.js';
import { icon, productCardHtml, skeletonCards, emptyState, esc, toast } from '../../_shared/ui.js';
import { artForCategory } from '../../_shared/art.js';
import { state, cacheProducts, cartQty } from '../state.js';

const BANNERS = [
  { img: '/img/banners/fresh-vegetables.webp', title: 'Farm-fresh veggies', sub: 'Hand-picked this morning', cat: 'fruits-vegetables', cta: 'Shop fresh' },
  { img: '/img/banners/dairy-morning.webp', title: 'Morning dairy', sub: 'Milk, curd & paneer daily', cat: 'dairy-breakfast', cta: 'Shop dairy' },
  { img: '/img/banners/daily-staples.webp', title: 'Stock up & save', sub: 'Atta, rice, dal up to 20% off', cat: 'atta-rice-dal', cta: 'Shop staples' },
];

export async function homeView(outlet, params, query, { router }) {
  if (!state.store) {
    outlet.innerHTML = `<div class="page">${emptyState({ emoji: '📍', title: 'Set your delivery location', body: 'Add an address so we can find a kirana that delivers to you.', actionHtml: '<button class="btn btn-primary" data-nav="/addresses">Add address</button>' })}</div>`;
    return;
  }
  outlet.innerHTML = `<div class="home"><div class="home-green">${catChipsHtml({})}</div>${bannerHtml()}<div class="pad-x">${skeletonCards(4)}</div></div>`;
  wireBanner();

  let products = [];
  try {
    const res = await api.products(state.store.id, { page_size: 40, in_stock: 1 });
    products = res.products || [];
    cacheProducts(products);
  } catch (error) {
    toast(error.message || 'Could not load products', 'error');
  }

  const byCat = slug => products.filter(p => p.category_id === slug).slice(0, 8);
  const deals = [...products].filter(p => p.discount_percent > 0).sort((a, b) => b.discount_percent - a.discount_percent).slice(0, 8);
  const fresh = byCat('fruits-vegetables');
  const dairy = byCat('dairy-breakfast');
  const counts = {};
  for (const p of products) if (p.available !== 0) counts[p.category_id] = (counts[p.category_id] || 0) + 1;

  outlet.innerHTML = `
    <div class="home">
      <div class="home-green">${catChipsHtml(counts)}</div>
      ${bannerHtml()}
      ${state.activeOrder ? activeStripHtml() : ''}
      ${couponTeaserHtml()}
      ${deals.length ? railHtml('Best deals', 'percent', deals, '/browse') : ''}
      ${fresh.length ? railHtml('Fresh vegetables', 'leaf', fresh, '/browse/fruits-vegetables') : ''}
      ${dairy.length ? railHtml('Dairy & breakfast', 'bolt', dairy, '/browse/dairy-breakfast') : ''}
      ${categoryGridHtml()}
      <div class="pad-x"><div class="save-strip">${icon('shield')} Quality checked · Fair prices · Delivered in ${esc(state.serviceability?.eta_minutes ?? 15)} minutes</div></div>
    </div>`;
  wireBanner();
  return () => stopBanner();
}

function bannerHtml() {
  return `
    <div class="banner-rail" data-banner-rail>
      ${BANNERS.map((b, i) => `
        <div class="banner" data-banner="${i}">
          <img class="banner-bg" src="${b.img}" alt="" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async">
          <div class="banner-scrim"></div>
          <span class="banner-badge">${icon('leaf')} Kirana Fresh</span>
          <div class="banner-copy">
            <strong>${esc(b.title)}</strong><span>${esc(b.sub)}</span>
            <button class="shop-now" data-nav="/browse/${b.cat}">${esc(b.cta)} ${icon('arrowRight')}</button>
          </div>
        </div>`).join('')}
    </div>
    <div class="banner-dot-row" data-banner-dots>${BANNERS.map((_, i) => `<span class="banner-dot ${i === 0 ? 'on' : ''}" data-dot="${i}"></span>`).join('')}</div>`;
}

let bannerTimer = null;
function stopBanner() { if (bannerTimer) { clearInterval(bannerTimer); bannerTimer = null; } }
function wireBanner() {
  const rail = outlet.querySelector('[data-banner-rail]');
  const dots = [...outlet.querySelectorAll('[data-dot]')];
  if (!rail) return;
  const update = () => {
    const i = Math.round(rail.scrollLeft / rail.clientWidth);
    dots.forEach((d, j) => d.classList.toggle('on', j === i));
  };
  rail.addEventListener('scroll', update, { passive: true });
  dots.forEach(d => d.addEventListener('click', () => rail.scrollTo({ left: Number(d.dataset.dot) * rail.clientWidth, behavior: 'smooth' })));
  stopBanner();
  bannerTimer = setInterval(() => {
    const i = Math.round(rail.scrollLeft / rail.clientWidth);
    const next = (i + 1) % BANNERS.length;
    rail.scrollTo({ left: next * rail.clientWidth, behavior: 'smooth' });
  }, 4500);
}

function catChipsHtml(counts) {
  const all = `<button class="cat-chip" data-nav="/browse" aria-pressed="true">
    <span class="cc-ico cc-ico-all">${icon('bag')}</span>
    <span class="cc-label">All</span>
  </button>`;
  return `<div class="cat-chips">${all}${state.categories.map(c => {
    const n = counts[c.id] || 0;
    return `<button class="cat-chip${n ? ' has-badge' : ''}" data-nav="/browse/${esc(c.id)}" aria-pressed="false">
      ${n ? `<span class="cc-badge cc-badge-count">${n} available</span>` : ''}
      <span class="cc-ico"><img src="${esc(artForCategory(c.id))}" alt="" loading="lazy" data-art-cat="${esc(c.id)}"></span>
      <span class="cc-label">${esc(c.name)}</span>
    </button>`;
  }).join('')}</div>`;
}

function activeStripHtml() {
  const o = state.activeOrder;
  return `<div class="order-strip"><button class="mini-order" data-nav="/track/${esc(o.id)}">
    <div class="mo-row"><span class="mo-label">Order ${esc(o.public_label || '')}</span>${icon('chevronRight')}</div>
    <span class="mo-sub">${esc(o.status === 'picked_up' ? 'Out for delivery' : 'In progress')} · ${o.eta_live_minutes ?? o.eta_promise_minutes ?? '—'} min away</span>
  </button></div>`;
}

function couponTeaserHtml() {
  const c = state.coupons[0];
  if (!c) return '';
  return `<div class="pad-x"><button class="coupon-row" data-nav="/cart">
    <span class="cp-ico">${icon('percent')}</span>
    <span class="cp-main"><strong>${esc(c.code)} — ${esc(c.description || 'Save on your order')}</strong><span>Apply at checkout & save more</span></span>
    ${icon('chevronRight', 'cp-go')}
  </button></div>`;
}

function railHtml(title, ico, products, seeAll) {
  return `<div class="section-title pad-x"><h2>${icon(ico)} ${esc(title)}</h2><button class="see-circle" data-nav="${seeAll}" aria-label="See all ${esc(title)}">${icon('chevronRight')}</button></div>
    <div class="hrail">${products.map(p => productCardHtml(p, { qty: cartQty(p.id), rail: true, eta: `${state.serviceability?.eta_minutes ?? 15} min` })).join('')}</div>`;
}

function categoryGridHtml() {
  return `<div class="section-title pad-x"><h2>${icon('grid')} Shop by category</h2></div>
    <div class="pad-x"><div class="cat-photo-grid">${state.categories.slice(0, 8).map(c => `
      <button class="cat-photo" data-nav="/browse/${esc(c.id)}">
        <span class="cp-img"><img src="${esc(artForCategory(c.id))}" alt="" loading="lazy" data-art-cat="${esc(c.id)}"></span>
        <span>${esc(c.name)}</span>
      </button>`).join('')}</div></div>`;
}