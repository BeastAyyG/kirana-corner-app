// DOM building blocks: escape helper, inline SVG icons, toast, bottom sheets,
// skeleton loaders and shared card components used by every view.
import { money, statusText } from './format.js';
import { artFor } from './art.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ---------- inline icon set (stroke: currentColor) ---------- */
const PATHS = {
  basket: '<path d="M4.5 9.5h15l-1.6 8.4a2 2 0 0 1-2 1.6H8.1a2 2 0 0 1-2-1.6L4.5 9.5Z"/><path d="M8.5 9.5C8.5 6 10 3.5 12 3.5s3.5 2.5 3.5 6"/><path d="M9 13v3.5M12 13v3.5M15 13v3.5"/>',
  home: '<path d="M4 10.5 12 4l8 6.5"/><path d="M6 9.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1V9.5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
  receipt: '<path d="M6 3.5h12V20l-2.4-1.6L13.2 20l-2.4-1.6L8.4 20 6 18.4V3.5Z"/><path d="M9 8h6M9 11.5h6"/>',
  user: '<circle cx="12" cy="8.2" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>',
  search: '<circle cx="11" cy="11" r="6.2"/><path d="m15.6 15.6 4 4"/>',
  pin: '<path d="M12 21s-6.4-5.6-6.4-10.2a6.4 6.4 0 1 1 12.8 0C18.4 15.4 12 21 12 21Z"/><circle cx="12" cy="10.6" r="2.3"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
  chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  heart: '<path d="M12 20s-7.2-4.6-7.2-9.7A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.2 2.7C19.2 15.4 12 20 12 20Z"/>',
  clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.5V12l3 2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  bag: '<path d="M6 8h12l1 12H5L6 8Z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/>',
  store: '<path d="M4 9.5 5.5 4.5h13L20 9.5"/><path d="M4 9.5a2.2 2.2 0 0 0 4.4 0 2.3 2.3 0 0 0 4.6 0 2.3 2.3 0 0 0 4.6 0 2.2 2.2 0 0 0 2.4 0"/><path d="M5.5 12v7.5h13V12"/><path d="M9.5 19.5v-4h5v4"/>',
  box: '<path d="M4 8.2 12 4l8 4.2v7.6L12 20l-8-4.2V8.2Z"/><path d="M4 8.2 12 12l8-3.8M12 12v8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.4M12 18.1v2.4M3.5 12h2.4M18.1 12h2.4M6 6l1.7 1.7M16.3 16.3 18 18M18 6l-1.7 1.7M7.7 16.3 6 18"/>',
  edit: '<path d="M5 19h3l10-10-3-3L5 16v3Z"/><path d="m13.5 6.5 3 3"/>',
  trash: '<path d="M5.5 7h13M9.5 7V5h5v2M7 7l1 12.5h8L17 7"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5M12 15.8v.4"/>',
  logout: '<path d="M14 4.5H6.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H14"/><path d="M10 12h9.5M16.5 8.5 20 12l-3.5 3.5"/>',
  sort: '<path d="M7 5v14M7 19l-3-3M7 19l3-3"/><path d="M13 7h7M13 12h5M13 17h3"/>',
  filter: '<path d="M5 7h14M8 12h8M10.5 17h3"/>',
  refresh: '<path d="M5.5 12a6.5 6.5 0 0 1 11.3-4.4L20 10"/><path d="M20 4.5V10h-5.5"/><path d="M18.5 12a6.5 6.5 0 0 1-11.3 4.4L4 14"/><path d="M4 19.5V14h5.5"/>',
  phone: '<path d="M7 3.5h10a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z"/><path d="M10 17.5h4"/>',
  install: '<path d="M12 3.5v10M8.5 10 12 13.5 15.5 10"/><path d="M5 15.5v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
  wallet: '<rect x="4" y="6.5" width="16" height="12" rx="2.5"/><path d="M4 10.5h16M16.5 14.5h.4"/>',
};
export function icon(name, cls = '') {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${cls}">${PATHS[name] || ''}</svg>`;
}
export const LOGO_BASKET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 9.5h15l-1.6 8.4a2 2 0 0 1-2 1.6H8.1a2 2 0 0 1-2-1.6L4.5 9.5Z" fill="rgba(255,255,255,.16)"/><path d="M8.5 9.5C8.5 6 10 3.5 12 3.5s3.5 2.5 3.5 6"/><path d="M9 13v3.5M12 13v3.5M15 13v3.5"/></svg>';

/* ---------- toast ---------- */
export function toast(message, kind = 'default', ms = 2600) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.getElementById('app').appendChild(host);
  }
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 260);
  }, ms);
}

/* ---------- bottom sheet ---------- */
let sheetState = null;
function closeSheet(result) {
  if (!sheetState) return;
  const { host, resolve, onCleanup } = sheetState;
  sheetState = null;
  host.classList.remove('open');
  setTimeout(() => { host.innerHTML = ''; }, 240);
  onCleanup?.(result);
  resolve(result);
}

/** renderSheet(bodyHtml, {title, onClose}) — resolves with the closeSheet result. */
function openSheet(bodyHtml, { title = '', dismissable = true, onClose } = {}) {
  return new Promise(resolve => {
    let host = document.getElementById('sheet-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'sheet-host';
      document.getElementById('app').appendChild(host);
    }
    if (sheetState) closeSheet(undefined);
    host.innerHTML = `
      <div class="sheet-backdrop"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title || 'Dialog')}">
        <div class="sheet-grab"></div>
        ${title ? `<div class="sheet-head"><h2>${esc(title)}</h2>${dismissable ? `<button class="icon-btn" data-sheet-close aria-label="Close">${icon('close')}</button>` : ''}</div>` : ''}
        <div class="sheet-body">${bodyHtml}</div>
      </div>`;
    host.classList.add('open');
    const backdrop = host.querySelector('.sheet-backdrop');
    const cleanup = [];
    const on = (el, event, fn) => { el.addEventListener(event, fn); cleanup.push(() => el.removeEventListener(event, fn)); };
    if (dismissable) {
      on(backdrop, 'click', () => closeSheet(undefined));
      host.querySelector('[data-sheet-close]')?.addEventListener('click', () => closeSheet(undefined));
      on(document, 'keydown', event => { if (event.key === 'Escape') closeSheet(undefined); });
    }
    sheetState = {
      host,
      resolve,
      onCleanup: result => {
        cleanup.forEach(fn => fn());
        // onClose signals a pure dismissal (no explicit result), not a button close
        if (result === undefined) onClose?.();
      },
    };
  });
}
export { openSheet as sheet };

/** Promise-based confirm sheet: resolves true (confirm), false (cancel) or false (dismissed). */
export function askConfirm({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const done = value => { if (!settled) { settled = true; resolve(Boolean(value)); } };
    openSheet(`
      <p class="muted">${esc(message)}</p>
      <div class="sheet-actions">
        <button class="btn btn-outline" data-ask-no>${esc(cancelLabel)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ask-yes>${esc(confirmLabel)}</button>
      </div>`, { title, onClose: () => done(false) }).then(value => done(value));
    const host = document.getElementById('sheet-host');
    host.querySelector('[data-ask-yes]')?.addEventListener('click', () => closeSheet(true));
    host.querySelector('[data-ask-no]')?.addEventListener('click', () => closeSheet(false));
  });
}

/** Form sheet: fields = [{name,label,type,value,required,placeholder,options,hint}] → values|undefined. */
export function formSheet({ title, submitLabel = 'Save', fields, note = '' }) {
  return new Promise(resolve => {
    let settled = false;
    const done = value => { if (!settled) { settled = true; resolve(value); } };
    const body = `
      ${note ? `<p class="muted tiny">${esc(note)}</p>` : ''}
      <form class="form-grid" data-sheet-form novalidate>
        ${fields.map(field => `
          <div class="field">
            <label for="sf-${esc(field.name)}">${esc(field.label)}</label>
            ${field.options
              ? `<select id="sf-${esc(field.name)}" name="${esc(field.name)}">${field.options.map(option => `<option value="${esc(option)}" ${option === field.value ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select>`
              : `<input id="sf-${esc(field.name)}" name="${esc(field.name)}" type="${esc(field.type || 'text')}" value="${esc(field.value ?? '')}" placeholder="${esc(field.placeholder || '')}" ${field.required ? 'required' : ''} ${field.attrs || ''}>`}
            ${field.hint ? `<span class="hint">${esc(field.hint)}</span>` : ''}
          </div>`).join('')}
        <div class="sheet-actions">
          <button type="button" class="btn btn-outline" data-sheet-cancel>${esc('Cancel')}</button>
          <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
        </div>
      </form>`;
    openSheet(body, { title, onClose: () => done(undefined) }).then(value => {
      if (value !== undefined) done(value);
    });
    const host = document.getElementById('sheet-host');
    const form = host.querySelector('[data-sheet-form]');
    host.querySelector('[data-sheet-cancel]')?.addEventListener('click', () => closeSheet(undefined));
    form?.addEventListener('submit', event => {
      event.preventDefault();
      const values = {};
      for (const field of fields) {
        const input = form.elements[field.name];
        const value = String(input.value ?? '').trim();
        if (field.required && !value) { input.focus(); input.reportValidity?.(); return; }
        values[field.name] = value;
      }
      closeSheet(values);
    });
  });
}

/* ---------- shared components ---------- */
export function skeletonCards(count = 4) {
  return `<div class="plp-grid">${Array.from({ length: count }, () => `
    <div class="p-card"><div class="skel" data-sk="art"></div>
      <div class="skel" data-sk="line"></div><div class="skel" data-sk="line"></div>
    </div>`).join('')}</div>`;
}

export function statusChip(status) {
  return `<span class="status-chip status-${esc(status)}"><i></i>${esc(statusText(status))}</span>`;
}

export function emptyState({ emoji = '🧺', title, body, actionHtml = '' } = {}) {
  return `<div class="empty"><div class="empty-art">${emoji}</div>
    <h3>${esc(title)}</h3><p>${esc(body)}</p>${actionHtml}</div>`;
}

export function stepperHtml(product, qty, compact = false) {
  return `<div class="stepper" data-stepper="${esc(product.id)}">
    <button type="button" data-qty-minus="${esc(product.id)}" aria-label="Remove one ${esc(product.name)}" ${qty <= 1 ? 'disabled' : ''}>−</button>
    <output>${qty}</output>
    <button type="button" data-qty-plus="${esc(product.id)}" aria-label="Add one ${esc(product.name)}" ${qty >= product.available ? 'disabled' : ''}>+</button>
  </div>${compact ? '' : ''}`;
}

export function addControlHtml(product, qty) {
  if (!qty) {
    return `<button class="add-btn" data-qty-plus="${esc(product.id)}" ${product.available < 1 ? 'disabled' : ''}>${product.available < 1 ? 'SOLD OUT' : 'ADD'}</button>`;
  }
  return stepperHtml(product, qty);
}

export function productCardHtml(product, { qty = 0, saved = false, rail = false } = {}) {
  const out = product.available < 1;
  const low = product.available > 0 && product.available <= 3;
  return `<article class="p-card ${rail ? 'rail-card' : ''}" data-product-card="${esc(product.id)}">
    <button type="button" class="p-art" data-open-product="${esc(product.id)}" aria-label="View ${esc(product.name)}">
      <img src="${product.image_url || artFor(product)}" alt="" loading="lazy">
      ${low ? `<span class="pill pill-amber low-chip">${product.available} left</span>` : ''}
      ${out ? '<span class="out-chip">Out of stock</span>' : ''}
    </button>
    <button type="button" class="p-save ${saved ? 'on' : ''}" data-toggle-save="${esc(product.id)}" aria-label="${saved ? 'Remove from' : 'Save to'} saved items">${icon('heart')}</button>
    <div>
      <button type="button" class="p-name" data-open-product="${esc(product.id)}">${esc(product.name)}</button>
      <div class="p-unit">${esc(product.unit)}</div>
    </div>
    <div class="p-foot">
      <div class="price"><strong>${money(product.price_minor)}</strong></div>
      ${out ? '<span class="tiny muted">Notify shop</span>' : addControlHtml(product, qty)}
    </div>
  </article>`;
}

export function spinner(label = 'Loading…') {
  return `<div class="empty"><h3>${esc(label)}</h3></div>`;
}
