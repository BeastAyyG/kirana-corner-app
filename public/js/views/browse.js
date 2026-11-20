// Product listing page (bbnow PLP): sticky left category rail, filter chips,
// 2-column product grid. Filtering is client-side over the full catalog so the
// rail can switch categories instantly without a server round-trip.
import { state } from '../state.js';
import { esc, icon, productCardHtml, emptyState, skeletonCards, sheet } from '../ui.js';
import { navigate, onView } from '../router.js';
import { CATEGORY_META, artForCategory } from '../art.js';

const SORT_OPTIONS = [
  { value: '', label: 'Recommended' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'name', label: 'Name: A to Z' },
];
const TITLES = {
  All: 'Everything', Vegetables: 'Vegetables', Dairy: 'Dairy & Eggs',
  Staples: 'Staples & Atta', Snacks: 'Snacks',
};

export function renderBrowse(outlet, { category }) {
  let cat = CATEGORY_META.some(meta => meta.key === category) ? category : 'All';
  let sort = '';
  let inStock = false;
  let maxPrice = '';

  const filtered = () => {
    let list = state.products.filter(product =>
      product.active &&
      (cat === 'All' || product.category === cat) &&
      (!inStock || product.available > 0) &&
      (maxPrice === '' || product.price_minor <= Number(maxPrice) * 100));
    if (sort === 'price_asc') list = [...list].sort((a, b) => a.price_minor - b.price_minor);
    else if (sort === 'price_desc') list = [...list].sort((a, b) => b.price_minor - a.price_minor);
    else if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  };

  const gridHtml = list => list.length
    ? `<div class="plp-grid" data-plp-grid>${list.map(product => productCardHtml(product, {
        qty: Number(state.basket[product.id] || 0),
      })).join('')}</div>`
    : (state.productsLoaded
      ? emptyState({ emoji: '🔍', title: 'No items match', body: 'Try a different category or clear the price filters.', actionHtml: '<button class="btn btn-outline" data-clear-all>Clear filters</button>' })
      : skeletonCards(4));

  const railHtml = () => CATEGORY_META.map(meta => {
    const ico = meta.key === 'All' ? icon('bag') : `<img src="${artForCategory(meta.key)}" alt="" loading="lazy" data-art-cat="${esc(meta.key)}">`;
    return `<button class="plp-cat" data-rail-cat="${esc(meta.key)}" aria-pressed="${cat === meta.key}">
      <span class="pc-ico">${ico}</span><span>${esc(meta.label)}</span>
    </button>`;
  }).join('');

  const draw = () => {
    const list = filtered();
    outlet.innerHTML = `
      <div class="subbar">
        <button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button>
        <h1>${esc(TITLES[cat] || cat)}</h1>
        <span class="count-note" data-count>${list.length}</span>
        <button class="icon-btn" data-open-sort aria-label="Sort products">${icon('sort')}</button>
        <button class="icon-btn" data-toggle-stock aria-label="Only show in-stock items" aria-pressed="${inStock}">${icon('filter')}</button>
      </div>
      <div class="plp-layout">
        <nav class="plp-catrail" aria-label="Categories">${railHtml()}</nav>
        <div class="plp-main">
          <div class="plp-filters">
            <button class="chip" data-price-under="30" aria-pressed="${maxPrice === '30'}">Under ₹30</button>
            <button class="chip" data-price-under="50" aria-pressed="${maxPrice === '50'}">Under ₹50</button>
            <button class="chip" data-price-under="100" aria-pressed="${maxPrice === '100'}">Under ₹100</button>
            <button class="chip" data-clear-price aria-pressed="${!maxPrice}">Any price</button>
          </div>
          <div data-grid-slot>${gridHtml(list)}</div>
        </div>
      </div>`;
    bind();
  };

  const updateGrid = () => {
    const list = filtered();
    const slot = outlet.querySelector('[data-grid-slot]');
    const count = outlet.querySelector('[data-count]');
    if (slot) slot.innerHTML = gridHtml(list);
    if (count) count.textContent = list.length;
    bindGrid();
  };

  function bindGrid() {
    outlet.querySelector('[data-clear-all]')?.addEventListener('click', () => {
      maxPrice = ''; inStock = false; sort = ''; draw();
    });
  }

  function bind() {
    outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());
    outlet.querySelectorAll('[data-rail-cat]').forEach(button => {
      button.addEventListener('click', () => navigate(`#/c/${button.dataset.railCat}`));
    });
    outlet.querySelector('[data-open-sort]')?.addEventListener('click', openSortSheet);
    outlet.querySelector('[data-toggle-stock]')?.addEventListener('click', () => { inStock = !inStock; draw(); });
    outlet.querySelectorAll('[data-price-under]').forEach(button => {
      button.addEventListener('click', () => {
        maxPrice = maxPrice === button.dataset.priceUnder ? '' : button.dataset.priceUnder;
        draw();
      });
    });
    outlet.querySelector('[data-clear-price]')?.addEventListener('click', () => { maxPrice = ''; draw(); });
    bindGrid();
  }

  async function openSortSheet() {
    const body = `<div data-sort-list>${SORT_OPTIONS.map(option => `
      <button class="opt-row" data-sort-option="${esc(option.value)}" role="radio" aria-checked="${sort === option.value}">
        <span>${esc(option.label)}</span><span class="opt-check">${icon('check')}</span>
      </button>`).join('')}</div>`;
    const pending = sheet(body, { title: 'Sort products' });
    document.querySelector('[data-sort-list]')?.addEventListener('click', event => {
      const option = event.target.closest('[data-sort-option]');
      if (!option) return;
      sort = option.dataset.sortOption;
      document.querySelector('#sheet-host [data-sheet-close]')?.click();
      draw();
    });
    await pending;
  }

  let lastSig = '';
  onView('catalog', () => {
    const sig = state.products.map(p => `${p.id}:${p.price_minor}:${p.available}:${p.active}`).join('|');
    if (sig === lastSig) return;
    lastSig = sig;
    updateGrid();
  });
  draw();
  lastSig = state.products.map(p => `${p.id}:${p.price_minor}:${p.available}:${p.active}`).join('|');
}