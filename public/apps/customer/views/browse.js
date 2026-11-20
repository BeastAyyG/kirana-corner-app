// Browse (PLP) + search. Left category rail, sort/stock filters, paginated grid.
// Search mode swaps the rail for a live input and queries name/brand/description.
import { api } from '../../_shared/api.js';
import { icon, productCardHtml, skeletonCards, emptyState, esc, toast, sheet } from '../../_shared/ui.js';
import { artForCategory } from '../../_shared/art.js';
import { state, cacheProducts, cartQty } from '../state.js';

const SORTS = [
  { key: '', label: 'Popular' },
  { key: 'price_asc', label: 'Price: low to high' },
  { key: 'price_desc', label: 'Price: high to low' },
  { key: 'discount', label: 'Biggest discount' },
  { key: 'name', label: 'Name A–Z' },
];
const PAGE_SIZE = 24;

export async function browseView(outlet, params, query, { router, path }) {
  const isSearch = path === '/search';
  let cat = isSearch ? '' : (params.cat || '');
  let sort = query.sort || '';
  let inStock = false;
  let q = query.q || '';
  let page = 1;
  let total = 0;
  let products = [];
  let loading = false;
  let debounce = null;

  if (!state.store) {
    outlet.innerHTML = `<div class="page">${emptyState({ emoji: '📍', title: 'Set your delivery location', body: 'Add an address to browse products.', actionHtml: '<button class="btn btn-primary" data-nav="/addresses">Add address</button>' })}</div>`;
    return;
  }

  function layout() {
    if (isSearch) {
      outlet.innerHTML = `
        <div class="page">
          <div class="search-pill live search-bar">${icon('search')}<input type="search" data-search-input placeholder="Search milk, atta, snacks…" value="${esc(q)}" autocomplete="off"></div>
          <div data-results>${skeletonCards(6)}</div>
        </div>`;
      const input = outlet.querySelector('[data-search-input]');
      input?.focus();
      input?.addEventListener('input', () => {
        q = input.value.trim();
        clearTimeout(debounce);
        debounce = setTimeout(() => { page = 1; load(true); }, 280);
      });
    } else {
      outlet.innerHTML = `
        <div class="plp-layout">
          <div class="plp-catrail" data-catrail>
            <button class="plp-cat" data-cat="" aria-pressed="${cat === ''}"><span class="pc-ico">${icon('grid')}</span><span>All</span></button>
            ${state.categories.map(c => `
              <button class="plp-cat" data-cat="${esc(c.id)}" aria-pressed="${cat === c.id}">
                <span class="pc-ico"><img src="${esc(artForCategory(c.id))}" alt="" loading="lazy" data-art-cat="${esc(c.id)}"></span>
                <span>${esc(c.name)}</span>
              </button>`).join('')}
          </div>
          <div class="plp-main">
            <div class="plp-filters">
              <button class="chip" data-sort>${icon('sort')} ${esc(SORTS.find(s => s.key === sort)?.label || 'Popular')}</button>
              <button class="chip ${inStock ? 'on' : ''}" data-stock aria-pressed="${inStock}">${icon('check')} In stock</button>
            </div>
            <div data-results>${skeletonCards(6)}</div>
            <div data-more></div>
          </div>
        </div>`;
      outlet.querySelectorAll('[data-cat]').forEach(btn => btn.addEventListener('click', () => {
        cat = btn.dataset.cat; page = 1;
        router.navigate(cat ? `/browse/${cat}` : '/browse', { replace: true });
      }));
      outlet.querySelector('[data-sort]')?.addEventListener('click', openSort);
      outlet.querySelector('[data-stock]')?.addEventListener('click', e => {
        inStock = !inStock; page = 1;
        e.currentTarget.classList.toggle('on', inStock);
        e.currentTarget.setAttribute('aria-pressed', String(inStock));
        load(true);
      });
    }
  }

  async function openSort() {
    const promise = sheet(`<div data-sort-options>${SORTS.map(s => `
      <button class="opt-row" data-sort-key="${s.key}" aria-checked="${s.key === sort}">${esc(s.label)}<span class="opt-check">${icon('check')}</span></button>`).join('')}</div>`, { title: 'Sort by' });
    const host = document.getElementById('sheet-host');
    host.querySelectorAll('[data-sort-key]').forEach(opt => opt.addEventListener('click', () => {
      sort = opt.dataset.sortKey; page = 1;
      const btn = outlet.querySelector('[data-sort]');
      if (btn) btn.innerHTML = `${icon('sort')} ${esc(SORTS.find(s => s.key === sort)?.label || 'Popular')}`;
      host.querySelector('[data-sheet-close]')?.click();
      load(true);
    }));
    await promise;
  }

  async function load(reset = false) {
    if (loading) return;
    loading = true;
    const results = outlet.querySelector('[data-results]');
    if (reset && results) results.innerHTML = skeletonCards(6);
    try {
      const res = await api.products(state.store.id, {
        q, category: cat, sort, in_stock: inStock ? 'true' : '', page, page_size: PAGE_SIZE,
      });
      const batch = res.products || [];
      total = res.total || 0;
      cacheProducts(batch);
      products = reset ? batch : [...products, ...batch];
      renderResults();
    } catch (error) {
      toast(error.message || 'Could not load products', 'error');
      if (results) results.innerHTML = emptyState({ emoji: '🔌', title: 'Something went wrong', body: 'Please try again.' });
    } finally { loading = false; }
  }

  function renderResults() {
    const results = outlet.querySelector('[data-results]');
    const more = outlet.querySelector('[data-more]');
    if (!results) return;
    if (!products.length) {
      results.innerHTML = emptyState({
        emoji: isSearch ? '🔍' : '🧺',
        title: isSearch ? `No results for "${q}"` : 'Nothing here yet',
        body: isSearch ? 'Try a different spelling or browse a category.' : 'Try another category or turn off the in-stock filter.',
      });
      if (more) more.innerHTML = '';
      return;
    }
    results.innerHTML = `<div class="plp-grid">${products.map(p => productCardHtml(p, { qty: cartQty(p.id), eta: `${state.serviceability?.eta_minutes ?? 15} min` })).join('')}</div>`;
    if (more) {
      more.innerHTML = products.length < total
        ? `<button class="btn btn-outline block" data-load-more>Load more (${total - products.length} left)</button>`
        : `<p class="muted tiny" data-end-note>${products.length} of ${total} products</p>`;
      more.querySelector('[data-load-more]')?.addEventListener('click', () => { page += 1; load(false); });
    }
  }

  layout();
  await load(true);
  return () => clearTimeout(debounce);
}