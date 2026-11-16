// Neighbourhood shop picker.
import { state } from '../state.js';
import { esc, icon, emptyState } from '../ui.js';
import { selectStore, refreshStores } from '../actions.js';
import { navigate } from '../router.js';

export async function renderStores(outlet, { query }) {
  let term = query.get('q') || '';
  const draw = (stores, loading = false) => {
    outlet.innerHTML = `
      <div class="subbar">
        <button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button>
        <h1>Choose your shop</h1>
      </div>
      <div class="page">
        <div class="field">
          <input type="search" data-store-search placeholder="Search by shop or neighbourhood" value="${esc(term)}" aria-label="Search shops">
        </div>
        <div class="spacer-16"></div>
        ${loading ? '<div class="skel" data-sk="store"></div><div class="spacer-8"></div><div class="skel" data-sk="store"></div>'
          : stores.length ? stores.map(store => `
            <div class="store-card">
              <div class="sc-top">
                <span class="sc-badge">🏪</span>
                <div>
                  <div class="sc-name">${esc(store.name)}</div>
                  <div class="sc-sub">${esc(store.neighborhood)} · ${esc(store.address)}</div>
                </div>
                ${store.is_open ? '<span class="pill pill-green">Open</span>' : '<span class="pill pill-red">Closed</span>'}
              </div>
              <div class="sc-meta">
                <span class="pill pill-gray">📍 ${esc(store.pickup_location)}</span>
                <span class="pill pill-gray">Evening pickup</span>
              </div>
              <button class="btn ${store.id === state.store?.id ? 'btn-outline' : 'btn-primary'} block" data-pick-store="${esc(store.id)}">
                ${store.id === state.store?.id ? 'Currently selected' : 'Shop here'}
              </button>
            </div>`).join('')
          : emptyState({ emoji: '🏪', title: 'No shops found', body: 'Try another shop or neighbourhood name.' })}
      </div>`;

    outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());
    const input = outlet.querySelector('[data-store-search]');
    if (input) {
      let timer;
      input.addEventListener('input', () => {
        term = input.value;
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const list = await refreshStores(term);
          draw(list);
          const input2 = outlet.querySelector('[data-store-search]');
          input2.value = term;
          input2.focus();
          input2.setSelectionRange(term.length, term.length);
        }, 250);
      });
    }
    outlet.querySelectorAll('[data-pick-store]').forEach(button => {
      button.addEventListener('click', async () => {
        const picked = await selectStore(button.dataset.pickStore);
        if (picked === false) return; // cancelled
        navigate('#/home');
      });
    });
  };
  draw(state.stores, !state.stores.length);
  const fresh = await refreshStores(term);
  draw(fresh);
}
