// Inventory workspace: live stock steppers (±1 quick adjust), low-stock filter,
// search, hide/show toggles and full create/edit sheets. Prices are entered in
// rupees and converted to integer paise on the wire; display uses money().
import { api } from '../../_shared/api.js';
import { icon, emptyState, esc, toast, spinner, formSheet } from '../../_shared/ui.js';
import { money } from '../../_shared/format.js';
import { state, bus } from '../state.js';

const LOW_STOCK_THRESHOLD = 5;
const busy = new Set();

const rupeesInput = minor => String(Number(minor || 0) / 100);
const toPaise = value => Math.round(Number(value) * 100);
const availableOf = p => Number(p.available ?? (p.on_hand - p.reserved));

export async function inventoryView(outlet, params, query, { router }) {
  if (!state.store) {
    outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🏬', title: 'No store assigned', body: 'This picker account is not staffed on any store yet.' })}</div>`;
    return;
  }

  let q = '';
  let lowOnly = false;
  let products = [];
  let loading = true;
  let dead = false;

  const filtered = () => {
    const term = q.toLowerCase();
    if (!term) return products;
    return products.filter(p => `${p.name} ${p.brand || ''} ${p.unit}`.toLowerCase().includes(term));
  };

  function rowHtml(p) {
    const available = availableOf(p);
    const out = available <= 0;
    const low = !out && available <= LOW_STOCK_THRESHOLD;
    const stockPill = out ? '<span class="pill pill-red">Out of stock</span>'
      : low ? `<span class="pill pill-amber">Low · ${available} left</span>`
      : `<span class="pill pill-green">${available} available</span>`;
    const mrp = Number(p.mrp_minor || 0);
    const priceLine = `<div class="inv-price"><strong>${money(p.price_minor)}</strong>${mrp > p.price_minor ? `<span class="mrp">${money(mrp)}</span>` : ''}${Number(p.discount_percent || 0) > 0 ? `<span class="off">${p.discount_percent}% off</span>` : ''}</div>`;
    return `
      <div class="inv-row ${p.active ? '' : 'is-hidden'}" data-inv-row="${esc(p.id)}">
        <div class="iv-main">
          <div class="iv-name">${esc(p.name)}${p.brand ? `<span class="pill pill-gray">${esc(p.brand)}</span>` : ''}<span class="muted tiny">${esc(p.unit)}</span></div>
          ${priceLine}
          <div class="iv-sub"><span>Aisle ${esc(p.aisle || '—')} · Shelf ${esc(p.shelf || '—')} · on hand ${p.on_hand} · reserved ${p.reserved}</span>${stockPill}</div>
        </div>
        <div class="iv-side">
          <div class="stock-stepper">
            <button data-inv-minus="${esc(p.id)}" aria-label="Remove one ${esc(p.name)}" ${p.on_hand <= p.reserved ? 'disabled' : ''}>−</button>
            <output>${p.on_hand}</output>
            <button data-inv-plus="${esc(p.id)}" aria-label="Add one ${esc(p.name)}">+</button>
          </div>
          <div class="iv-buttons">
            <button class="icon-mini" data-inv-edit="${esc(p.id)}" aria-label="Edit ${esc(p.name)}">${icon('edit')}</button>
            <button class="icon-mini ${p.active ? 'on' : ''}" data-inv-toggle="${esc(p.id)}" aria-pressed="${Boolean(p.active)}" aria-label="${p.active ? 'Hide' : 'Show'} ${esc(p.name)}">${icon(p.active ? 'check' : 'close')}</button>
          </div>
        </div>
      </div>`;
  }

  function updateList() {
    const host = outlet.querySelector('[data-inv-list]');
    if (!host) return;
    if (loading) { host.innerHTML = spinner('Loading inventory…'); return; }
    const list = filtered();
    if (!list.length) {
      host.innerHTML = q
        ? emptyState({ emoji: '🔍', title: 'No matches', body: `No items match “${q}”.`, actionHtml: '<button class="btn btn-outline" data-inv-clear>Clear search</button>' })
        : emptyState({ emoji: '📦', title: lowOnly ? 'Nothing running low' : 'No items yet', body: lowOnly ? 'Every active item has healthy stock right now.' : 'Add your first item with the button below.', actionHtml: lowOnly ? '' : '<button class="btn btn-primary" data-add-item>Add item</button>' });
      return;
    }
    host.innerHTML = list.map(rowHtml).join('');
  }

  function updateNote() {
    const note = outlet.querySelector('[data-inv-count]');
    if (!note) return;
    const lowCount = products.filter(p => p.active && availableOf(p) <= LOW_STOCK_THRESHOLD).length;
    note.textContent = `${filtered().length} of ${products.length} items · ${lowCount} low on stock`;
  }

  function renderShell() {
    outlet.innerHTML = `
      <div class="page">
        <div class="inv-toolbar">
          <label class="search-pill live">${icon('search')}<input data-inv-search type="search" placeholder="Search name, brand or unit…" value="${esc(q)}" aria-label="Search inventory"></label>
          <button class="chip" data-low-toggle aria-pressed="${lowOnly}">${icon('alert')} Low stock</button>
        </div>
        <p class="inv-count" data-inv-count></p>
        <div data-inv-list></div>
        <div class="fab-wrap"><button class="fab" data-add-item>${icon('plus')} Add item</button></div>
      </div>`;
    outlet.querySelector('[data-inv-search]').addEventListener('input', event => {
      q = event.target.value.trim();
      updateList(); updateNote();
    });
    outlet.querySelector('[data-low-toggle]').addEventListener('click', event => {
      lowOnly = !lowOnly;
      event.currentTarget.setAttribute('aria-pressed', String(lowOnly));
      load();
    });
    outlet.querySelector('[data-inv-list]').addEventListener('click', event => {
      if (event.target.closest('[data-add-item]')) { openProductSheet(null); return; }
      if (event.target.closest('[data-inv-clear]')) {
        q = '';
        const input = outlet.querySelector('[data-inv-search]');
        if (input) input.value = '';
        updateList(); updateNote();
        return;
      }
      const minus = event.target.closest('[data-inv-minus]');
      const plus = event.target.closest('[data-inv-plus]');
      if (minus || plus) { adjust((minus || plus).dataset.invMinus || (minus || plus).dataset.invPlus, plus ? 1 : -1); return; }
      const edit = event.target.closest('[data-inv-edit]');
      if (edit) { openProductSheet(products.find(p => p.id === edit.dataset.invEdit)); return; }
      const toggle = event.target.closest('[data-inv-toggle]');
      if (toggle) { toggleActive(toggle.dataset.invToggle); }
    });
    outlet.querySelectorAll('[data-add-item]').forEach(btn => btn.addEventListener('click', () => openProductSheet(null)));
  }

  async function load() {
    if (dead) return;
    try {
      const res = await api.inventory(state.store.id, { low: lowOnly ? 'true' : '' });
      if (dead) return;
      products = res.products || [];
      state.inventory = products;
    } catch (error) {
      if (dead) return;
      if (loading) toast(error.message || 'Could not load inventory', 'error');
    }
    loading = false;
    updateList(); updateNote();
  }

  function replaceRow(product) {
    products = products.map(p => (p.id === product.id ? product : p));
    state.inventory = products;
    // With an active filter the row may need to leave the list entirely.
    if (lowOnly || q) { updateList(); updateNote(); return; }
    const row = outlet.querySelector(`[data-inv-row="${CSS.escape(product.id)}"]`);
    if (row) {
      row.outerHTML = rowHtml(product);
      outlet.querySelector(`[data-inv-row="${CSS.escape(product.id)}"] .stock-stepper output`)?.classList.add('pop');
    } else {
      updateList();
    }
    updateNote();
  }

  async function adjust(pid, delta) {
    if (busy.has(pid) || dead) return;
    busy.add(pid);
    try {
      const res = await api.adjustInventory(state.store.id, pid, { delta, reason: 'Quick adjust' });
      if (dead) return;
      replaceRow(res.product);
    } catch (error) {
      if (!dead) toast(error.message || 'Could not adjust stock', 'error');
    } finally {
      busy.delete(pid);
    }
  }

  async function toggleActive(pid) {
    const p = products.find(x => x.id === pid);
    if (!p || busy.has(pid) || dead) return;
    busy.add(pid);
    try {
      const res = await api.updateStoreProduct(state.store.id, pid, { active: !p.active });
      if (dead) return;
      replaceRow(res.product);
      toast(`${res.product.name} ${res.product.active ? 'is visible to customers' : 'hidden from customers'}`, 'success');
    } catch (error) {
      if (!dead) toast(error.message || 'Could not update the item', 'error');
    } finally {
      busy.delete(pid);
    }
  }

  async function openProductSheet(p) {
    const cats = state.categories;
    const catName = cats.find(c => c.id === p?.category_id)?.name || cats[0]?.name || '';
    const values = await formSheet({
      title: p ? `Edit — ${p.name}` : 'Add item',
      submitLabel: p ? 'Save changes' : 'Add item',
      note: 'Prices are in rupees. Stock cannot go below reserved units.',
      fields: [
        { name: 'name', label: 'Item name', required: true, value: p?.name || '', placeholder: 'e.g. Toor Dal', attrs: 'maxlength="80"' },
        { name: 'brand', label: 'Brand', value: p?.brand || '', placeholder: 'e.g. Tata Sampann', attrs: 'maxlength="60"' },
        { name: 'unit', label: 'Unit', required: true, value: p?.unit || '', placeholder: 'e.g. 500 g', attrs: 'maxlength="24"' },
        { name: 'category', label: 'Category', options: cats.map(c => c.name), value: catName },
        { name: 'mrp', label: 'MRP (₹)', type: 'number', required: true, value: p ? rupeesInput(p.mrp_minor) : '', attrs: 'min="0.01" step="0.01" inputmode="decimal"' },
        { name: 'price', label: 'Selling price (₹)', type: 'number', required: true, value: p ? rupeesInput(p.price_minor) : '', attrs: 'min="0.01" step="0.01" inputmode="decimal"', hint: 'Must be at or below MRP' },
        { name: 'on_hand', label: 'Stock on hand', type: 'number', required: true, value: String(p?.on_hand ?? 0), attrs: `min="${p?.reserved ?? 0}" step="1" inputmode="numeric"`, hint: p?.reserved ? `${p.reserved} units are reserved in live orders` : '' },
        { name: 'aisle', label: 'Aisle', value: p?.aisle || '', placeholder: 'e.g. A3', attrs: 'maxlength="12"' },
        { name: 'shelf', label: 'Shelf', value: p?.shelf || '', placeholder: 'e.g. S4', attrs: 'maxlength="12"' },
        { name: 'max_per_order', label: 'Max per order', type: 'number', required: true, value: String(p?.max_per_order ?? 10), attrs: 'min="1" max="99" step="1" inputmode="numeric"' },
      ],
    });
    if (!values || dead) return;

    const category = cats.find(c => c.name === values.category);
    const mrp = toPaise(values.mrp);
    const price = toPaise(values.price);
    const onHand = Number(values.on_hand);
    const maxPer = Number(values.max_per_order);
    const reserved = Number(p?.reserved || 0);
    if (!category) { toast('Pick a category', 'error'); return; }
    if (!Number.isFinite(mrp) || mrp < 1) { toast('Enter a valid MRP in rupees', 'error'); return; }
    if (!Number.isFinite(price) || price < 1 || price > mrp) { toast('Selling price must be between ₹0.01 and the MRP', 'error'); return; }
    if (!Number.isInteger(onHand) || onHand < reserved) { toast(`Stock must be a whole number${reserved ? ` of at least ${reserved} (reserved)` : ''}`, 'error'); return; }
    if (!Number.isInteger(maxPer) || maxPer < 1 || maxPer > 99) { toast('Max per order must be 1–99', 'error'); return; }

    const body = {
      name: values.name, brand: values.brand, unit: values.unit, category_id: category.id,
      description: p?.description || '', image_url: p?.image_url || '',
      mrp_minor: mrp, price_minor: price, on_hand: onHand,
      aisle: values.aisle, shelf: values.shelf, max_per_order: maxPer,
      active: p ? Boolean(p.active) : true,
    };
    try {
      const res = p
        ? await api.updateStoreProduct(state.store.id, p.id, body)
        : await api.createStoreProduct(state.store.id, body);
      if (dead) return;
      toast(p ? `${res.product.name} updated` : `${res.product.name} added to the catalogue`, 'success');
      await load();
    } catch (error) {
      if (!dead) toast(error.message || 'Could not save the item', 'error');
    }
  }

  renderShell();
  updateList(); updateNote();
  const offLow = bus.on('low-stock', load);
  await load();
  return () => { dead = true; offLow(); };
}