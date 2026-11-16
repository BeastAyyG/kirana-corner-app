// Search screen with live results and recent searches.
import { state } from '../state.js';
import { esc, icon, productCardHtml, emptyState } from '../ui.js';
import { navigate } from '../router.js';
import { CATEGORY_META } from '../art.js';

const RECENT_KEY = 'kc-recent-searches';
function recentSearches() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function pushRecent(term) {
  const list = recentSearches().filter(item => item !== term);
  list.unshift(term);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6))); } catch { /* ignore */ }
}

export function renderSearch(outlet, { query }) {
  let term = query.get('q') || '';
  const draw = () => {
    const results = term.trim()
      ? state.products.filter(product =>
          `${product.name} ${product.category} ${product.description || ''}`.toLowerCase().includes(term.trim().toLowerCase()))
      : [];
    outlet.innerHTML = `
      <div class="subbar">
        <button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button>
        <div class="search-pill live">
          ${icon('search')}
          <input type="search" data-search-input placeholder="Search milk, atta, veggies…" value="${esc(term)}" aria-label="Search products" autocomplete="off">
        </div>
      </div>
      <div class="page">
        ${!term.trim() ? `
          ${recentSearches().length ? `
            <div class="section-title"><h2>Recent searches</h2><button class="see-all" data-clear-recent>Clear</button></div>
            <div class="chip-row" data-recent-row>
              ${recentSearches().map(item => `<button class="chip" data-recent="${esc(item)}">${esc(item)}</button>`).join('')}
            </div>` : ''}
          <div class="section-title"><h2>Quick categories</h2></div>
          <div class="cat-grid">
            ${CATEGORY_META.slice(1).map(meta => `
              <button class="cat-tile" data-cat="${esc(meta.key)}">
                <span class="cat-circle ${meta.tint}">${meta.emoji}</span><span>${esc(meta.label)}</span>
              </button>`).join('')}
          </div>` : `
          <div class="count-note" data-result-note>${results.length} result${results.length === 1 ? '' : 's'} for “${esc(term.trim())}”</div>
          <div class="spacer-8"></div>
          ${results.length
            ? `<div class="plp-grid">${results.map(product => productCardHtml(product, {
                qty: Number(state.basket[product.id] || 0),
                saved: state.saved.some(item => item.product_id === product.id),
              })).join('')}</div>`
            : emptyState({ emoji: '🔍', title: 'Nothing found', body: `No shelf items match “${term.trim()}”. Try a shorter word or browse categories.` })}`}
      </div>`;

    outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());
    const input = outlet.querySelector('[data-search-input]');
    if (input) {
      input.focus();
      input.setSelectionRange(term.length, term.length);
      input.addEventListener('input', () => { term = input.value; draw(); });
      input.addEventListener('change', () => {
        if (term.trim()) pushRecent(term.trim());
      });
    }
    outlet.querySelector('[data-clear-recent]')?.addEventListener('click', () => {
      try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
      draw();
    });
    outlet.querySelectorAll('[data-recent]').forEach(button => {
      button.addEventListener('click', () => { term = button.dataset.recent; draw(); });
    });
    outlet.querySelectorAll('[data-cat]').forEach(button => {
      button.addEventListener('click', () => navigate(`#/c/${button.dataset.cat}`));
    });
  };
  draw();
}
