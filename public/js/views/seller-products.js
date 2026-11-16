// Seller shelf management: list with stock steppers, hide/show, add/edit sheets.
import { state } from '../state.js';
import { esc, icon, emptyState, formSheet, toast, sheet, skeletonCards } from '../ui.js';
import { onView } from '../router.js';
import { money } from '../format.js';
import { artFor } from '../art.js';
import { sellerAdjustStock, sellerToggleActive, sellerSaveProduct, refreshSellerProducts } from '../actions.js';

const CATEGORIES = ['Vegetables', 'Dairy', 'Staples', 'Snacks'];

export function renderSellerProducts(outlet) {
  let term = '';

  const draw = () => {
    if (state.session.user?.role !== 'seller') {
      outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🔐', title: 'Shopkeeper access only', body: 'Sign in with the shopkeeper account to manage your shelf.', actionHtml: '<button class="btn btn-primary" data-go-signin>Sign in</button>' })}</div>`;
      outlet.querySelector('[data-go-signin]')?.addEventListener('click', () => { location.hash = '#/welcome'; });
      return;
    }
    if (!state.seller.store) {
      outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🏪', title: 'No shop linked', body: 'This account has no assigned shop yet.' })}</div>`;
      return;
    }
    const products = state.seller.products.filter(product =>
      !term.trim() || `${product.name} ${product.category}`.toLowerCase().includes(term.trim().toLowerCase()));

    outlet.innerHTML = `
      <div class="subbar">
        <h1>Shelf stock</h1>
        <span class="count-note">${state.seller.products.length} items</span>
      </div>
      <div class="chip-row">
        <input type="search" class="search-pill live" data-inv-search placeholder="Search your items…" value="${esc(term)}" aria-label="Search items">
      </div>
      <div class="page">
        ${products.length ? products.map(product => `
          <div class="inv-row ${product.active ? '' : 'is-hidden'}" data-inv="${esc(product.id)}">
            <img class="row-art" src="${product.image_url || artFor(product)}" alt="">
            <div class="iv-main">
              <div class="iv-name">${esc(product.name)} ${product.active ? '' : '<span class="pill pill-gray">Hidden</span>'} ${product.available <= 3 && product.active ? `<span class="pill pill-amber">${product.available} left</span>` : ''}</div>
              <div class="iv-sub">${esc(product.unit)} · ${money(product.price_minor)} · ${product.reserved} reserved</div>
            </div>
            <div class="iv-side">
              <div class="stock-stepper">
                <button data-stock-down="${esc(product.id)}" aria-label="Reduce ${esc(product.name)} shelf count" ${product.on_hand <= product.reserved ? 'disabled' : ''}>−</button>
                <output>${product.on_hand}</output>
                <button data-stock-up="${esc(product.id)}" aria-label="Increase ${esc(product.name)} shelf count">+</button>
              </div>
              <div class="so-actions">
                <button class="icon-mini" data-edit-product="${esc(product.id)}" aria-label="Edit ${esc(product.name)}">${icon('edit')}</button>
                <button class="icon-mini ${product.active ? 'on' : ''}" data-toggle-active="${esc(product.id)}" aria-label="${product.active ? 'Hide' : 'Show'} ${esc(product.name)}">${icon(product.active ? 'check' : 'close')}</button>
              </div>
            </div>
          </div>`).join('')
        : (state.seller.productsLoaded
          ? emptyState({ emoji: '📦', title: term ? 'No items match' : 'Shelf is empty', body: term ? 'Try a different search.' : 'Add your first item so shoppers can see it.', actionHtml: '<button class="btn btn-primary" data-add-product>Add item</button>' })
          : skeletonCards(3))}
      </div>
      <div class="fab-wrap"><button class="fab" data-add-product>${icon('plus')} Add item</button></div>`;

    const search = outlet.querySelector('[data-inv-search]');
    if (search) {
      let timer;
      search.addEventListener('input', () => {
        term = search.value;
        clearTimeout(timer);
        timer = setTimeout(draw, 200);
      });
    }
    outlet.querySelectorAll('[data-stock-up]').forEach(button => {
      button.addEventListener('click', () => sellerAdjustStock(button.dataset.stockUp, 1));
    });
    outlet.querySelectorAll('[data-stock-down]').forEach(button => {
      button.addEventListener('click', () => sellerAdjustStock(button.dataset.stockDown, -1));
    });
    outlet.querySelectorAll('[data-toggle-active]').forEach(button => {
      button.addEventListener('click', () => sellerToggleActive(button.dataset.toggleActive));
    });
    outlet.querySelectorAll('[data-edit-product]').forEach(button => {
      button.addEventListener('click', () => openEditSheet(button.dataset.editProduct));
    });
    outlet.querySelectorAll('[data-add-product]').forEach(button => {
      button.addEventListener('click', () => openAddSheet());
    });
  };

  async function openAddSheet() {
    const result = await formSheet({
      title: 'Add shelf item',
      submitLabel: 'Add item',
      note: 'Shoppers see this instantly with live availability.',
      fields: [
        { name: 'name', label: 'Item name', required: true, attrs: 'maxlength="50"', placeholder: 'e.g. Turmeric powder' },
        { name: 'unit', label: 'Pack / unit', required: true, attrs: 'maxlength="24"', placeholder: 'e.g. 200 g' },
        { name: 'category', label: 'Category', options: CATEGORIES, value: 'Vegetables' },
        { name: 'price', label: 'Price (₹)', required: true, type: 'number', attrs: 'min="0.01" step="0.01"', placeholder: '45' },
        { name: 'stock', label: 'Quantity on shelf', required: true, type: 'number', attrs: 'min="0" max="9999" step="1"', value: '0' },
        { name: 'description', label: 'Short description (optional)', attrs: 'maxlength="240"', placeholder: 'Freshly stocked everyday staple' },
      ],
    });
    if (!result) return;
    const price = Number(result.price);
    const stock = Number(result.stock);
    if (!Number.isFinite(price) || price <= 0) { toast('Enter a positive price'); return; }
    if (!Number.isInteger(stock) || stock < 0) { toast('Enter a whole shelf quantity'); return; }
    await sellerSaveProduct(null, {
      name: result.name, unit: result.unit, category: result.category,
      description: result.description || '', price_minor: Math.round(price * 100), on_hand: stock,
    });
  }

  async function openEditSheet(productId) {
    const product = state.seller.products.find(item => item.id === productId);
    if (!product) return;
    const result = await formSheet({
      title: `Edit ${product.name}`,
      submitLabel: 'Save changes',
      fields: [
        { name: 'name', label: 'Item name', value: product.name, required: true, attrs: 'maxlength="50"' },
        { name: 'unit', label: 'Pack / unit', value: product.unit, required: true, attrs: 'maxlength="24"' },
        { name: 'category', label: 'Category', options: CATEGORIES, value: product.category },
        { name: 'price', label: 'Price (₹)', value: (product.price_minor / 100).toFixed(2), required: true, type: 'number', attrs: 'min="0.01" step="0.01"' },
        { name: 'description', label: 'Short description', value: product.description || '', attrs: 'maxlength="240"' },
      ],
    });
    if (!result) return;
    const price = Number(result.price);
    if (!Number.isFinite(price) || price <= 0) { toast('Enter a positive price'); return; }
    await sellerSaveProduct(productId, {
      name: result.name, unit: result.unit, category: result.category,
      description: result.description || '', price_minor: Math.round(price * 100),
    });
  }

  onView('seller', draw);
  if (!state.seller.productsLoaded) refreshSellerProducts({ silent: true });
  draw();
}
