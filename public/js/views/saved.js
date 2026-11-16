// Saved items list ("save for later").
import { state } from '../state.js';
import { esc, icon, emptyState, addControlHtml } from '../ui.js';
import { navigate, onView } from '../router.js';
import { money } from '../format.js';
import { artFor } from '../art.js';

export function renderSaved(outlet) {
  const draw = () => {
    if (state.session.user?.role !== 'shopper') {
      outlet.innerHTML = `
        <div class="subbar"><h1>Saved items</h1></div>
        <div class="page">
          ${emptyState({ emoji: '♡', title: 'Sign in to save items', body: 'Keep your regulars one tap away by saving them here.', actionHtml: '<button class="btn btn-primary" data-go-signin>Sign in</button>' })}
        </div>`;
      outlet.querySelector('[data-go-signin]')?.addEventListener('click', () => navigate('#/welcome'));
      return;
    }
    const items = state.saved;
    outlet.innerHTML = `
      <div class="subbar">
        <button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button>
        <h1>Saved items</h1>
        <span class="count-note">${items.length}</span>
      </div>
      <div class="page">
        ${items.length ? items.map(item => `
          <div class="row-card">
            <img class="row-art" src="${item.image_url || artFor(item)}" alt="">
            <div class="row-main">
              <div class="row-title">${esc(item.name)}</div>
              <div class="row-sub">${esc(item.unit)} · ${money(item.price_minor)}${item.available < 1 ? ' · out of stock' : ''}</div>
            </div>
            ${item.available > 0
              ? addControlHtml(item, Number(state.basket[item.id] || 0))
              : `<button class="btn btn-ghost" data-remove-save="${esc(item.product_id)}">Remove</button>`}
          </div>`).join('')
        : emptyState({ emoji: '🤍', title: 'No saved items yet', body: 'Tap the heart on any item to keep your regulars handy.', actionHtml: '<button class="btn btn-primary" data-go-shop>Browse shelf</button>' })}
      </div>`;
    outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());
    outlet.querySelector('[data-go-shop]')?.addEventListener('click', () => navigate('#/categories'));
    outlet.querySelectorAll('[data-remove-save]').forEach(button => {
      button.addEventListener('click', () => {
        import('../actions.js').then(({ toggleSaved }) => toggleSaved(button.dataset.removeSave, false));
      });
    });
  };
  onView('saved', draw);
  onView('basket', draw);
  draw();
}
