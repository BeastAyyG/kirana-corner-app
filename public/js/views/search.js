// Search screen: live results over the catalog, recent searches, quick categories.
import { state } from '../state.js';
import { esc, icon, productCardHtml, emptyState } from '../ui.js';
import { navigate, onView } from '../router.js';
import { CATEGORY_META, artForCategory } from '../art.js';

const RECENT_KEY = 'kc-recent-searches';
function recentSearches() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function pushRecent(term) {
  const list = recentSearches().filter(item => item !== term);
  list.unshift(term);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6))); } catch { /* ignore */ }
}

function discoverHtml() {
  const recent = recentSearches();
  return `
    ${recent.length ? `
      <div class="section-title"><h2>Recent searches</h2><button class="see-all" data-clear-recent>Clear</button></div>
      <div class="chip-wrap">
        ${recent.map(item => `<button class="chip" data-recent="${esc(item)}">${icon('clock')}${esc(item)}</button>`).join('')}
      </div>` : ''}
    <div class="section-title"><h2>Quick categories</h2></div>
    <div class="cat-photo-grid">
      ${CATEGORY_META.slice(1).map(meta => `
        <button class="cat-photo" data-cat="${esc(meta.key)}">
          <span class="cp-img"><img src="${artForCategory(meta.key)}" alt="" loading="lazy" data-art-cat="${esc(meta.key)}"></span>
          <span>${esc(meta.label)}</span>
        </button>`).join('')}
    </div>`;
}

export function renderSearch(outlet, { query }) {
  let term = query.get('q') || '';
  outlet.innerHTML = `
    <div class="subbar">
      <button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button>
      <div class="search-pill live">
        ${icon('search')}
        <input type="search" data-search-input placeholder="Search milk, atta, veggies…" value="${esc(term)}" aria-label="Search products" autocomplete="off">
      </div>
    </div>
    <div class="page">
      <div data-discover>${discoverHtml()}</div>
      <div data-results></div>
    </div>`;

  const input = outlet.querySelector('[data-search-input]');
  const discover = outlet.querySelector('[data-discover]');
  const results = outlet.querySelector('[data-results]');

  const renderResults = () => {
    const q = term.trim().toLowerCase();
    const matches = state.products.filter(product =>
      product.active && `${product.name} ${product.category} ${product.description || ''}`.toLowerCase().includes(q));
    results.innerHTML = `
      <div class="count-note">${matches.length} result${matches.length === 1 ? '' : 's'} for “${esc(term.trim())}”</div>
      <div class="spacer-8"></div>
      ${matches.length
        ? `<div class="plp-grid">${matches.map(product => productCardHtml(product, { qty: Number(state.basket[product.id] || 0) })).join('')}</div>`
        : emptyState({ emoji: '🔍', title: 'Nothing found', body: `No shelf items match “${term.trim()}”. Try a shorter word or browse categories.` })}`;
  };

  const update = () => {
    if (term.trim()) {
      discover.innerHTML = '';
      discover.hidden = true;
      results.hidden = false;
      renderResults();
    } else {
      results.innerHTML = '';
      results.hidden = true;
      discover.hidden = false;
      discover.innerHTML = discoverHtml();
    }
  };

  input.focus();
  input.setSelectionRange(term.length, term.length);
  input.addEventListener('input', () => { term = input.value; update(); });
  input.addEventListener('change', () => { if (term.trim()) pushRecent(term.trim()); });

  outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());
  outlet.addEventListener('click', event => {
    const recent = event.target.closest('[data-recent]');
    if (recent) { term = recent.dataset.recent; input.value = term; pushRecent(term); update(); return; }
    const cat = event.target.closest('[data-cat]');
    if (cat) { navigate(`#/c/${cat.dataset.cat}`); return; }
    if (event.target.closest('[data-clear-recent]')) {
      try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
      update();
    }
  });

  onView('catalog', () => { if (term.trim()) renderResults(); });
  update();
}