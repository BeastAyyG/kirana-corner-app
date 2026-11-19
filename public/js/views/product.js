// Product detail page (bbnow PDP): gallery, price block, accordion, sticky add bar.
import { state } from '../state.js';
import { esc, icon, productCardHtml, emptyState, addControlWrap, toast } from '../ui.js';
import { navigate, onView } from '../router.js';
import { api } from '../api.js';
import { money } from '../format.js';
import { artFor } from '../art.js';

function accordionHtml(product) {
  const items = [
    {
      title: 'Product details',
      body: `${esc(product.description || 'Stocked by your neighbourhood kirana.')}<br><br>Unit: ${esc(product.unit)} · Category: ${esc(product.category)}`,
    },
    {
      title: 'Freshness & stock',
      body: product.available > 0
        ? `${product.available} on the shelf right now. The shopkeeper updates quantities live, so what you see is what is in the store.`
        : 'Currently out of stock. The shop restocks daily — check back soon or save it to your list.',
    },
    {
      title: 'Pickup & payment',
      body: 'Reserve a 30-minute evening slot at checkout. Your items are packed into one labeled bag. Pay the shop directly at handover — no online payment.',
    },
  ];
  return `<div class="pdp-accordion">${items.map((item, i) => `
    <div class="pdp-acc-item ${i === 0 ? 'open' : ''}">
      <button class="pdp-acc-head" data-acc aria-expanded="${i === 0}"><span>${esc(item.title)}</span>${icon('chevronDown')}</button>
      <div class="pdp-acc-body">${item.body}</div>
    </div>`).join('')}</div>`;
}

export async function renderProduct(outlet, { productId }) {
  let product = state.products.find(item => item.id === productId);
  if (!product) {
    try {
      product = (await api.product(state.store.id, productId)).product;
    } catch {
      outlet.innerHTML = `<div class="subbar"><button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button><h1>Item</h1></div>
        ${emptyState({ emoji: '🔎', title: 'Item not found', body: 'It may have been removed from the shelf. Browse the categories instead.', actionHtml: '<button class="btn btn-primary" data-go-home>Go home</button>' })}`;
      outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());
      outlet.querySelector('[data-go-home]')?.addEventListener('click', () => navigate('#/home'));
      return;
    }
  }

  const draw = () => {
    const qty = Number(state.basket[product.id] || 0);
    const saved = state.saved.some(item => item.product_id === product.id);
    const out = product.available < 1;
    const mrp = Number(product.mrp_minor || 0);
    const disc = Number(product.discount_percent || 0);
    const showMrp = mrp > product.price_minor;
    const similar = state.products.filter(item => item.category === product.category && item.id !== product.id && item.active).slice(0, 8);
    const stockPill = out ? '<span class="pill pill-red">Out of stock</span>'
      : product.available <= 3 ? `<span class="pill pill-amber">Only ${product.available} left</span>`
      : `<span class="pill pill-green">${product.available} in stock</span>`;

    outlet.innerHTML = `
      <div class="subbar">
        <button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button>
        <h1>${esc(product.category)}</h1>
        <button class="icon-btn" data-share aria-label="Share item">${icon('share')}</button>
        <button class="icon-btn ${saved ? 'on' : ''}" data-toggle-save="${esc(product.id)}" aria-label="Save item" aria-pressed="${saved}">${icon('heart')}</button>
      </div>
      <div class="pdp-art">
        <img src="${artFor(product)}" alt="${esc(product.name)}" data-art-id="${esc(product.id)}" data-art-cat="${esc(product.category || '')}">
        ${showMrp && disc > 0 ? `<span class="off-flag">${disc}% OFF</span>` : ''}
      </div>
      <div class="pdp-body">
        <h1>${esc(product.name)}</h1>
        <div class="flex-between"><span class="pill pill-gray">${esc(product.unit)}</span>${stockPill}</div>
        <div class="pdp-price-block">
          <strong>${money(product.price_minor)}</strong>
          ${showMrp ? `<span class="mrp">${money(mrp)}</span>` : ''}
          ${showMrp ? `<span class="pdp-save">Save ${money(mrp - product.price_minor)}</span>` : '<span class="tiny muted">pay at store</span>'}
        </div>
        <p class="pdp-desc">${esc(product.description || 'Stocked by your neighbourhood kirana. Ask the shopkeeper at pickup for anything else you need.')}</p>
        ${accordionHtml(product)}
        ${similar.length ? `
          <div class="section-title"><h2>More in ${esc(product.category)}</h2><button class="see-circle" data-go="#/c/${esc(product.category)}" aria-label="See more">${icon('arrowRight')}</button></div>
          <div class="hrail">${similar.map(item => productCardHtml(item, { qty: Number(state.basket[item.id] || 0), rail: true })).join('')}</div>` : ''}
      </div>
      <div class="pdp-cta">
        <div class="grow"><strong>${money(product.price_minor)}</strong><span>${esc(product.unit)} · ${out ? 'out of stock' : `${product.available} on the shelf`}</span></div>
        ${addControlWrap(product, qty, 'full')}
      </div>`;

    outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());
    outlet.querySelector('[data-share]')?.addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}#/p/${product.id}`;
      const shareData = { title: product.name, text: `${product.name} · ${money(product.price_minor)} at ${state.store?.name || 'Kirana Corner'}`, url };
      if (navigator.share) { try { await navigator.share(shareData); } catch { /* dismissed */ } }
      else { try { await navigator.clipboard.writeText(url); toast('Link copied to clipboard', 'success'); } catch { toast(url); } }
    });
    outlet.querySelectorAll('[data-acc]').forEach(head => {
      head.addEventListener('click', () => {
        const item = head.closest('.pdp-acc-item');
        const open = item.classList.toggle('open');
        head.setAttribute('aria-expanded', String(open));
      });
    });
  };

  draw();
  onView('saved', () => {
    const saved = state.saved.some(item => item.product_id === product.id);
    const btn = outlet.querySelector('[data-toggle-save]');
    if (btn) { btn.classList.toggle('on', saved); btn.setAttribute('aria-pressed', String(saved)); }
  });
  onView('catalog', () => {
    const fresh = state.products.find(item => item.id === product.id);
    if (fresh && (fresh.available !== product.available || fresh.price_minor !== product.price_minor)) {
      product = fresh;
      draw();
    }
  });
}