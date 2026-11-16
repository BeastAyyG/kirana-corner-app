// Full category grid ("Shop by category" page).
import { state } from '../state.js';
import { esc, emptyState } from '../ui.js';
import { navigate } from '../router.js';
import { CATEGORY_META } from '../art.js';

export async function renderCategories(outlet) {
  const products = state.products;
  outlet.innerHTML = `
    <div class="subbar"><h1>Shop by category</h1></div>
    <div class="page">
      <div class="cat-grid cats-large">
        ${CATEGORY_META.map(meta => {
          const count = meta.key === 'All' ? products.length : products.filter(product => product.category === meta.key).length;
          return `<button class="cat-tile" data-cat="${esc(meta.key)}">
            <span class="cat-circle ${meta.tint}">${meta.emoji}</span>
            <span>${esc(meta.label)}</span>
            <span class="tiny muted">${count} item${count === 1 ? '' : 's'}</span>
          </button>`;
        }).join('')}
      </div>
      ${!state.store ? `<div class="notice notice-info">Pick a neighbourhood shop first to see its shelf.</div>` : ''}
      ${products.length === 0 && state.store ? emptyState({ emoji: '🧺', title: 'Nothing on the shelf yet', body: 'Items the shopkeeper lists will appear here.' }) : ''}
    </div>`;
  outlet.querySelectorAll('[data-cat]').forEach(tile => {
    tile.addEventListener('click', () => navigate(tile.dataset.cat === 'All' ? '#/c/All' : `#/c/${tile.dataset.cat}`));
  });
}
