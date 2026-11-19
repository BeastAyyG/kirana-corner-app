// Product detail: large packshot, MRP strikethrough + %OFF, ADD→stepper morph,
// accordion details, save toggle, sticky CTA and a similar-products rail.
import { api } from '../../_shared/api.js';
import { icon, addControlHtml, productCardHtml, emptyState, esc, toast, spinner } from '../../_shared/ui.js';
import { artFor } from '../../_shared/art.js';
import { money } from '../../_shared/format.js';
import { state, bus, cacheProducts, cartQty, getProduct } from '../state.js';

export async function productView(outlet, params, query, { router }) {
  const id = params.id;
  if (!state.store) { router.navigate('/', { replace: true }); return; }
  outlet.innerHTML = spinner('Loading product…');

  let product = getProduct(id);
  try {
    const res = await api.product(state.store.id, id);
    product = res.product || res;
    cacheProducts([product]);
  } catch (error) {
    if (!product) {
      outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🔍', title: 'Product not found', body: 'It may be unavailable at your store.', actionHtml: '<button class="btn btn-primary" data-nav="/browse">Browse products</button>' })}</div>`;
      return;
    }
  }

  const mrp = Number(product.mrp_minor || 0);
  const price = Number(product.price_minor || 0);
  const disc = Number(product.discount_percent || 0);
  const save = mrp - price;
  const out = product.available < 1;
  const low = product.available > 0 && product.available <= 3;
  const saved = state.saved.has(id);

  outlet.innerHTML = `
    <div class="pdp">
      <div class="pdp-art">
        <img src="${esc(artFor(product))}" data-art-id="${esc(product.id)}" data-art-cat="${esc(product.category_id || '')}" alt="${esc(product.name)}" ${out ? 'class="is-out"' : ''}>
        ${disc > 0 && save > 0 ? `<span class="off-flag">${disc}% OFF</span>` : ''}
      </div>
      <div class="pdp-body">
        <div class="flex-between">
          <div>
            <h1>${esc(product.name)}</h1>
            <div class="pdp-unit">${esc(product.brand ? product.brand + ' · ' : '')}${esc(product.unit)}</div>
          </div>
          <button class="icon-btn ${saved ? 'on' : ''}" data-save aria-label="${saved ? 'Remove from saved' : 'Save for later'}" aria-pressed="${saved}">${icon('heart')}</button>
        </div>
        <div class="pdp-price-block">
          <strong>${money(price)}</strong>
          ${save > 0 ? `<span class="mrp">${money(mrp)}</span><span class="pdp-save">Save ${money(save)}</span>` : ''}
        </div>
        <div class="pdp-stock ${out ? 'muted' : ''}">${out ? 'Out of stock' : low ? `Hurry — only ${product.available} left` : `In stock · ${product.available} available`}</div>
        <div class="pdp-add" data-add-control="${esc(product.id)}" data-variant="full">${addControlHtml(product, cartQty(product.id), { variant: 'full' })}</div>
        <p class="pdp-desc">${esc(product.description || '')}</p>
        <div class="pdp-accordion">
          ${accItem('Product details', `${esc(product.name)} (${esc(product.unit)}). ${esc(product.brand ? 'Brand: ' + product.brand + '.' : '')} Quality-checked and stored fresh at ${esc(state.store.name)}.`, true)}
          ${accItem('Delivery & returns', `Delivered in ${esc(state.serviceability?.eta_minutes ?? 15)} minutes to your address. Free delivery on orders above ${money(state.store.free_delivery_above_minor)}. Easy returns on damaged items.`)}
          ${accItem('Why Kirana Corner', 'We partner with your neighbourhood kirana so you get fair prices, fresh stock and fast delivery — while supporting local shops.')}
        </div>
      </div>
      <div class="pdp-cta">
        <div class="grow"><strong>${money(price)}</strong><span>${save > 0 ? `You save ${money(save)}` : esc(product.unit)}</span></div>
        <div class="p-add" data-add-control="${esc(product.id)}" data-variant="full">${addControlHtml(product, cartQty(product.id), { variant: 'full' })}</div>
      </div>
      <div data-similar></div>
    </div>`;

  wireAccordion();
  wireSave();
  loadSimilar();

  async function loadSimilar() {
    try {
      const res = await api.products(state.store.id, { category: product.category_id, page_size: 8, in_stock: 'true' });
      const similar = (res.products || []).filter(p => p.id !== id).slice(0, 6);
      cacheProducts(similar);
      const host = outlet.querySelector('[data-similar]');
      if (host && similar.length) {
        host.innerHTML = `<div class="section-title pad-x"><h2>${icon('grid')} Similar products</h2></div>
          <div class="hrail">${similar.map(p => productCardHtml(p, { qty: cartQty(p.id), rail: true })).join('')}</div>`;
      }
    } catch { /* optional */ }
  }

  function wireSave() {
    outlet.querySelector('[data-save]')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      const isSaved = state.saved.has(id);
      try {
        if (isSaved) { await api.unsave(state.store.id, id); state.saved.delete(id); }
        else { await api.save(state.store.id, id); state.saved.add(id); }
        btn.classList.toggle('on', !isSaved);
        btn.setAttribute('aria-pressed', String(!isSaved));
        toast(!isSaved ? 'Saved for later' : 'Removed from saved', 'success');
        bus.emit('saved', state.saved);
      } catch (error) { toast(error.message || 'Could not update saved', 'error'); }
    });
  }
}

function accItem(title, body, open = false) {
  return `<div class="pdp-acc-item ${open ? 'open' : ''}">
    <button class="pdp-acc-head" data-acc aria-expanded="${open}">${esc(title)} ${icon('chevronDown')}</button>
    <div class="pdp-acc-body">${body}</div>
  </div>`;
}
function wireAccordion() {
  outlet.querySelectorAll('[data-acc]').forEach(head => head.addEventListener('click', () => {
    const item = head.closest('.pdp-acc-item');
    const open = item.classList.toggle('open');
    head.setAttribute('aria-expanded', String(open));
  }));
}