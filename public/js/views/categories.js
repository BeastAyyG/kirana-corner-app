// Full category grid ("Shop by category") with photographic tiles.
import { state } from '../state.js';
import { esc, icon, emptyState } from '../ui.js';
import { navigate, onView } from '../router.js';
import { CATEGORY_META, artForCategory } from '../art.js';

export function renderCategories(outlet) {
  const draw = () => {
    const products = state.products;
    const total = products.length;
    outlet.innerHTML = `
      <div class="subbar"><h1>Shop by category</h1></div>
      <div class="page">
        <button class="cat-all-row" data-cat="All">
          <span class="car-ico">${icon('bag')}</span>
          <span class="car-main"><strong>Browse everything</strong><span>${total} item${total === 1 ? '' : 's'} on the shelf</span></span>
          ${icon('chevronRight', 'car-chev')}
        </button>
        <div class="spacer-16"></div>
        <div class="cat-photo-grid">
          ${CATEGORY_META.slice(1).map(meta => {
            const count = products.filter(product => product.category === meta.key).length;
            return `<button class="cat-photo" data-cat="${esc(meta.key)}">
              <span class="cp-img"><img src="${artForCategory(meta.key)}" alt="" loading="lazy" data-art-cat="${esc(meta.key)}"></span>
              <span>${esc(meta.label)}</span>
              <span class="tiny muted">${count} item${count === 1 ? '' : 's'}</span>
            </button>`;
          }).join('')}
        </div>
        ${!state.store ? `<div class="notice notice-info">${icon('store')}<span>Pick a neighbourhood shop first to see its shelf.</span></div>` : ''}
        ${products.length === 0 && state.store ? emptyState({ emoji: '🧺', title: 'Nothing on the shelf yet', body: 'Items the shopkeeper lists will appear here.' }) : ''}
      </div>`;
    outlet.querySelectorAll('[data-cat]').forEach(tile => {
      tile.addEventListener('click', () => navigate(`#/c/${tile.dataset.cat}`));
    });
  };
  onView('catalog', draw);
  draw();
}