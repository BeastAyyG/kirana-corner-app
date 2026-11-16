// Product listing page for a category (2-col grid, sort sheet, price chips).
import { state } from '../state.js';
import { esc, icon, productCardHtml, emptyState, skeletonCards, sheet } from '../ui.js';
import { onView } from '../router.js';
import { setFilters } from '../actions.js';

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

function filteredLocally() {
  const filters = state.filters;
  const query = filters.q.trim().toLowerCase();
  let list = state.products.filter(product =>
    (filters.category === 'All' || product.category === filters.category) &&
    (!query || `${product.name} ${product.category} ${product.description || ''}`.toLowerCase().includes(query)) &&
    (!filters.inStock || product.available > 0) &&
    (filters.minPrice === '' || product.price_minor >= Number(filters.minPrice) * 100) &&
    (filters.maxPrice === '' || product.price_minor <= Number(filters.maxPrice) * 100));
  if (filters.sort === 'price_asc') list = [...list].sort((a, b) => a.price_minor - b.price_minor);
  else if (filters.sort === 'price_desc') list = [...list].sort((a, b) => b.price_minor - a.price_minor);
  else if (filters.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

async function openSortSheet() {
  await sheet(`
    <div data-sort-list>
      ${SORT_OPTIONS.map(option => `
        <button class="opt-row" data-sort-option="${esc(option.value)}" role="radio" aria-checked="${state.filters.sort === option.value}">
          <span>${esc(option.label)}</span>
          <span class="opt-check">${icon('check')}</span>
        </button>`).join('')}
    </div>`, { title: 'Sort products' });
  document.querySelector('[data-sort-list]')?.addEventListener('click', event => {
    const option = event.target.closest('[data-sort-option]');
    if (!option) return;
    setFilters({ sort: option.dataset.sortOption });
  });
}

export function renderBrowse(outlet, { category }) {
  state.filters.category = category || 'All';

  const draw = () => {
    const list = filteredLocally();
    outlet.innerHTML = `
      <div class="subbar">
        <button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button>
        <h1>${esc(TITLES[state.filters.category] || state.filters.category)}</h1>
        <span class="count-note">${list.length} item${list.length === 1 ? '' : 's'}</span>
        <button class="icon-btn" data-open-sort aria-label="Sort products">${icon('sort')}</button>
        <button class="icon-btn" data-toggle-stock aria-label="Only show in-stock items" aria-pressed="${state.filters.inStock}">${icon('filter')}</button>
      </div>
      <div class="chip-row">
        <button class="chip" data-price-under="30" aria-pressed="${state.filters.maxPrice === '30'}">Under ₹30</button>
        <button class="chip" data-price-under="50" aria-pressed="${state.filters.maxPrice === '50'}">Under ₹50</button>
        <button class="chip" data-price-under="100" aria-pressed="${state.filters.maxPrice === '100'}">Under ₹100</button>
        <button class="chip" data-clear-price aria-pressed="${!state.filters.maxPrice && !state.filters.minPrice}">Any price</button>
      </div>
      <div class="page">
        ${list.length
          ? `<div class="plp-grid">${list.map(product => productCardHtml(product, {
              qty: Number(state.basket[product.id] || 0),
              saved: state.saved.some(item => item.product_id === product.id),
            })).join('')}</div>`
          : (state.productsLoaded
            ? emptyState({ emoji: '🔍', title: 'No items match', body: 'Try a different category or clear the price filters.', actionHtml: '<button class="btn btn-outline" data-clear-all>Clear filters</button>' })
            : skeletonCards(4))}
      </div>`;

    outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());
    outlet.querySelector('[data-open-sort]')?.addEventListener('click', openSortSheet);
    outlet.querySelector('[data-toggle-stock]')?.addEventListener('click', () => {
      setFilters({ inStock: !state.filters.inStock });
    });
    outlet.querySelectorAll('[data-price-under]').forEach(button => {
      button.addEventListener('click', () => {
        const value = state.filters.maxPrice === button.dataset.priceUnder ? '' : button.dataset.priceUnder;
        setFilters({ maxPrice: value });
      });
    });
    outlet.querySelector('[data-clear-price]')?.addEventListener('click', () => setFilters({ maxPrice: '', minPrice: '' }));
    outlet.querySelector('[data-clear-all]')?.addEventListener('click', () => setFilters({ maxPrice: '', minPrice: '', inStock: false, sort: '' }));
  };

  onView('catalog', draw);
  onView('basket', draw);
  draw();
}
