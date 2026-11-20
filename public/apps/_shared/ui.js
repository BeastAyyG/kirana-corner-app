// Shared v2 UI kit: escape helper, inline SVG icons, toast, bottom sheets,
// skeletons, product cards and delivery-specific components (bill, coupons,
// live route card, OTP entry). State-agnostic: callers pass data + wire events.
import { money, moneyExact, statusText } from './format.js';
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
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  list: '<path d="M8.5 6h11M8.5 12h11M8.5 18h11"/><path d="M4 6h.4M4 12h.4M4 18h.4"/>',
  bolt: '<path d="M13 2.5 4.5 13.5H11L9.5 21.5 19 10h-6.5L13 2.5Z"/>',
  percent: '<path d="M18 5 6 19"/><circle cx="7.5" cy="7.5" r="2.3"/><circle cx="16.5" cy="16.5" r="2.3"/>',
  tag: '<path d="M3.5 12.5v-8a1 1 0 0 1 1-1h8L21 12l-8.5 8.5L3.5 12.5Z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9L12 3.5Z"/>',
  bike: '<circle cx="6" cy="17" r="3.2"/><circle cx="18" cy="17" r="3.2"/><path d="M6 17 9.5 9h5L18 17M9.5 9 8 5.5H5.5M14.5 9 13 5.5h2.5"/>',
  navigation: '<path d="M12 3.5 19 20.5l-7-4-7 4L12 3.5Z"/>',
  chat: '<path d="M4 5.5h16v11H9l-5 4V5.5Z"/>',
  share: '<circle cx="6" cy="12" r="2.4"/><circle cx="17.5" cy="5.5" r="2.4"/><circle cx="17.5" cy="18.5" r="2.4"/><path d="m8.2 10.8 7-4M8.2 13.2l7 4"/>',
  arrowRight: '<path d="M4 12h15M13.5 6l6 6-6 6"/>',
  leaf: '<path d="M5 19C5 9 12 4 20 4c0 9-5 15-13 15h-2Z"/><path d="M5 19c2-5 5-8 9-10"/>',
  shield: '<path d="M12 3.5 5 6v6c0 4.5 3 7.5 7 8.5 4-1 7-4 7-8.5V6l-7-2.5Z"/><path d="m9 11.5 2.2 2.2L15.5 9"/>',
  truck: '<path d="M3 6.5h11v10H3zM14 10h4l3 3v3.5h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  gift: '<rect x="4" y="9" width="16" height="4"/><path d="M5.5 13v7h13v-7M12 9v11M12 9c-2 0-4.5-1-4.5-3S10 3.5 12 9Zm0 0c2 0 4.5-1 4.5-3S14 3.5 12 9Z"/>',
  card: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M3.5 9.5h17M7 14.5h4"/>',
  cash: '<rect x="3.5" y="6.5" width="17" height="11" rx="1.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5h.4M17.1 14.5h.4"/>',
  location: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M4 12h16"/>',
};
export function icon(name, cls = '') {
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${cls}">${PATHS[name] || ''}</svg>`;
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
  const lead = kind === 'success' ? icon('check') : kind === 'error' ? icon('alert') : '';
  node.innerHTML = `${lead}<span>${esc(message)}</span>`;
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
      host, resolve,
      onCleanup: result => { cleanup.forEach(fn => fn()); if (result === undefined) onClose?.(); },
    };
  });
}
export { openSheet as sheet };

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
          <button type="button" class="btn btn-outline" data-sheet-cancel>Cancel</button>
          <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
        </div>
      </form>`;
    openSheet(body, { title, onClose: () => done(undefined) }).then(value => { if (value !== undefined) done(value); });
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
export function skeletonCards(count = 6) {
  return `<div class="plp-grid">${Array.from({ length: count }, () => `
    <div class="p-card skel-card">
      <div class="skel skel-art"></div>
      <div class="skel skel-price"></div>
      <div class="skel skel-line"></div>
      <div class="skel skel-line short"></div>
    </div>`).join('')}</div>`;
}
export function statusChip(status) {
  return `<span class="status-chip status-${esc(status)}"><i></i>${esc(statusText(status))}</span>`;
}
export function emptyState({ emoji = '🧺', image = '', title, body, actionHtml = '' } = {}) {
  const art = image ? `<img src="${esc(image)}" alt="" loading="lazy">` : emoji;
  return `<div class="empty"><div class="empty-art">${art}</div>
    <h3>${esc(title)}</h3><p>${esc(body)}</p>${actionHtml}</div>`;
}
export function stepperHtml(product, qty, variant = '') {
  const cls = variant ? `stepper ${variant}` : 'stepper';
  const max = product.max_per_order ?? product.available ?? 99;
  return `<div class="${cls}" data-stepper="${esc(product.id)}">
    <button type="button" data-qty-minus="${esc(product.id)}" aria-label="Remove one ${esc(product.name)}" ${qty <= 1 ? 'disabled' : ''}>−</button>
    <output>${qty}</output>
    <button type="button" data-qty-plus="${esc(product.id)}" aria-label="Add one ${esc(product.name)}" ${qty >= Math.min(max, product.available) ? 'disabled' : ''}>+</button>
  </div>`;
}
export function addControlHtml(product, qty, { variant = 'corner' } = {}) {
  const out = product.available < 1;
  if (variant === 'full') {
    if (out) return '<button class="add-full" disabled>SOLD OUT</button>';
    return qty ? stepperHtml(product, qty, 'full') : `<button class="add-full" data-qty-plus="${esc(product.id)}">ADD</button>`;
  }
  if (variant === 'tint') return stepperHtml(product, Math.max(1, qty), 'tint');
  if (out) return '';
  return qty ? stepperHtml(product, qty)
    : `<button class="add-corner" data-qty-plus="${esc(product.id)}" aria-label="Add ${esc(product.name)}">${icon('plus')}</button>`;
}
export function addControlWrap(product, qty, variant = 'corner') {
  return `<div class="p-add" data-add-control="${esc(product.id)}" data-variant="${variant}">${addControlHtml(product, qty, { variant })}</div>`;
}
/** Re-render every add/stepper control for a product in place. Caller supplies product + qty. */
export function syncAddControls(productId, product, qty) {
  if (!product) return;
  document.querySelectorAll(`[data-add-control="${CSS.escape(productId)}"]`).forEach(node => {
    const variant = node.dataset.variant || 'corner';
    node.innerHTML = addControlHtml(product, qty, { variant });
    node.firstElementChild?.classList.add('pop');
  });
}
export function productCardHtml(product, { qty = 0, rail = false, eta = '' } = {}) {
  const out = product.available < 1;
  const low = product.available > 0 && product.available <= 3;
  const mrp = Number(product.mrp_minor || 0);
  const disc = Number(product.discount_percent || 0);
  const showMrp = mrp > product.price_minor;
  return `<article class="p-card ${rail ? 'rail-card' : ''}" data-product-card="${esc(product.id)}">
    <div class="p-artwrap">
      <button type="button" class="p-art" data-open-product="${esc(product.id)}" aria-label="View ${esc(product.name)}">
        <img src="${esc(artFor(product))}" data-art-id="${esc(product.id)}" data-art-cat="${esc(product.category_id || '')}" alt="" loading="lazy" decoding="async" width="512" height="512" ${out ? 'class="is-out"' : ''}>
        ${showMrp && disc > 0 ? `<span class="off-flag">${disc}% OFF</span>` : ''}
        ${out ? '<span class="out-chip">Out of stock</span>' : ''}
      </button>
      ${out ? '' : addControlWrap(product, qty, 'corner')}
    </div>
    <div class="p-price price"><strong>${money(product.price_minor)}</strong>${showMrp ? `<span class="mrp">${money(mrp)}</span>` : ''}</div>
    <button type="button" class="p-name" data-open-product="${esc(product.id)}">${esc(product.name)}</button>
    <div class="p-unit">${esc(product.unit)}</div>
    ${low ? `<div class="p-low">Only ${product.available} left</div>` : ''}
    ${eta ? `<div class="p-eta">${icon('bolt')} ${esc(eta)}</div>` : ''}
  </article>`;
}
export function spinner(label = 'Loading…') {
  return `<div class="empty"><div class="spin-ring"></div><h3>${esc(label)}</h3></div>`;
}

/** Circular ETA / progress gauge. SVG presentation attributes only (CSP-safe). */
export function etaGauge({ progress = 0, centerTop = '', centerSub = '', size = 116, color = 'var(--bb-green)' } = {}) {
  const r = 50, circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  const offset = circ * (1 - clamped);
  return `<svg class="gauge" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${esc(centerTop)} ${esc(centerSub)}">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="#eceae6" stroke-width="9"/>
    <circle class="gauge-arc" cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="9"
      stroke-linecap="round" stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" text-anchor="middle" class="gauge-top">${esc(centerTop)}</text>
    <text x="60" y="75" text-anchor="middle" class="gauge-sub">${esc(centerSub)}</text>
  </svg>`;
}

/* ---------- delivery-specific ---------- */

/** BigBasket-style bill summary. `bill` from POST /cart/quote. */
export function billHtml(bill, { compact = false } = {}) {
  if (!bill) return '';
  const row = (label, value, cls = '') => `<div class="bill-row ${cls}"><span>${label}</span><span>${value}</span></div>`;
  const savings = Number(bill.savings_minor || 0);
  const coupon = Number(bill.coupon_discount_minor || 0);
  const delivery = Number(bill.delivery_fee_minor || 0);
  const waived = bill.delivery_fee_waived;
  return `<div class="bill ${compact ? 'bill-compact' : ''}">
    <div class="bill-title">${icon('receipt')} Bill details</div>
    ${row('Item total', moneyExact(bill.items_total_minor))}
    ${savings > 0 ? row('Product savings', `− ${moneyExact(savings)}`, 'bill-save') : ''}
    ${row('Delivery fee', waived ? '<span class="strike">' + moneyExact(delivery) + '</span> FREE' : moneyExact(delivery), waived ? 'bill-save' : '')}
    ${!waived && bill.amount_to_free_delivery_minor > 0 ? `<div class="bill-hint">${icon('truck')} Add ${money(bill.amount_to_free_delivery_minor)} more for free delivery</div>` : ''}
    ${Number(bill.handling_fee_minor || 0) > 0 ? row('Handling fee', moneyExact(bill.handling_fee_minor)) : ''}
    ${Number(bill.surge_fee_minor || 0) > 0 ? row('Surge fee', moneyExact(bill.surge_fee_minor), 'bill-warn') : ''}
    ${coupon > 0 ? row(`Coupon ${bill.coupon_code ? '(' + esc(bill.coupon_code) + ')' : ''}`, `− ${moneyExact(coupon)}`, 'bill-save') : ''}
    ${Number(bill.tip_minor || 0) > 0 ? row('Rider tip', moneyExact(bill.tip_minor)) : ''}
    <div class="bill-total"><span>To pay</span><span>${moneyExact(bill.grand_total_minor)}</span></div>
    ${savings + coupon > 0 ? `<div class="bill-saved">${icon('tag')} You save ${moneyExact(savings + coupon)} on this order</div>` : ''}
  </div>`;
}

/** Savings pill shown under the cart cluster / checkout. */
export function savingsPill(minor) {
  const n = Number(minor || 0);
  if (n <= 0) return '';
  return `<span class="savings-pill">${icon('tag')} Saving ${money(n)}</span>`;
}

/** Live route card: SVG street grid + store→home polyline + animated rider dot.
 *  progress 0..1 along the route. No external map tiles (CSP / offline safe). */
export function routeCard({ storeName = 'Store', addressLabel = 'Home', progress = 0, riderName = '', etaText = '', live = true } = {}) {
  const p = Math.max(0, Math.min(1, progress));
  // Route waypoints across a 320x180 viewBox (store bottom-left → home top-right).
  const pts = [[40, 150], [90, 150], [90, 96], [170, 96], [170, 44], [280, 44]];
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    const len = Math.hypot(dx, dy); segs.push({ from: pts[i - 1], to: pts[i], len }); total += len;
  }
  let walk = p * total, dot = pts[0];
  for (const s of segs) {
    if (walk <= s.len) { const t = s.len ? walk / s.len : 0; dot = [s.from[0] + (s.to[0] - s.from[0]) * t, s.from[1] + (s.to[1] - s.from[1]) * t]; break; }
    walk -= s.len; dot = s.to;
  }
  const poly = pts.map(pt => pt.join(',')).join(' ');
  // travelled portion polyline up to the dot
  const travelled = [];
  let acc = 0;
  for (const s of segs) {
    travelled.push(s.from.join(','));
    if (acc + s.len >= p * total) { travelled.push(dot.map(n => n.toFixed(1)).join(',')); break; }
    acc += s.len;
  }
  if (travelled.length === 1) travelled.push(dot.map(n => n.toFixed(1)).join(','));
  const grid = [];
  for (let x = 0; x <= 320; x += 40) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="180"/>`);
  for (let y = 0; y <= 180; y += 36) grid.push(`<line x1="0" y1="${y}" x2="320" y2="${y}"/>`);
  return `<div class="route-card ${live ? 'is-live' : ''}">
    <div class="route-head">
      <span class="route-title">${icon('navigation')} Live route <em>(approximate)</em></span>
      ${etaText ? `<span class="route-eta">${icon('bolt')} ${esc(etaText)}</span>` : ''}
    </div>
    <svg class="route-map" viewBox="0 0 320 180" role="img" aria-label="Delivery route from ${esc(storeName)} to ${esc(addressLabel)}">
      <rect width="320" height="180" rx="14" fill="#f3f6ee"/>
      <g class="route-grid" stroke="#e2e8d8" stroke-width="1">${grid.join('')}</g>
      <polyline points="${poly}" fill="none" stroke="#cdd8bd" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="${travelled.join(' ')}" fill="none" stroke="var(--bb-green)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <g class="route-pin store"><circle cx="40" cy="150" r="11" fill="#0c3b1e"/><text x="40" y="154" text-anchor="middle" font-size="11" fill="#fff">🏬</text></g>
      <g class="route-pin home"><circle cx="280" cy="44" r="11" fill="var(--bb-green-dark)"/><text x="280" y="48" text-anchor="middle" font-size="11" fill="#fff">🏠</text></g>
      ${live ? `<g class="route-rider"><circle cx="${dot[0].toFixed(1)}" cy="${dot[1].toFixed(1)}" r="13" fill="rgba(132,194,37,.25)"/><circle cx="${dot[0].toFixed(1)}" cy="${dot[1].toFixed(1)}" r="8" fill="#fff" stroke="var(--bb-green-dark)" stroke-width="2.5"/><text x="${dot[0].toFixed(1)}" y="${(dot[1] + 3.5).toFixed(1)}" text-anchor="middle" font-size="9">🛵</text></g>` : ''}
    </svg>
    <div class="route-legend">
      <span><i class="dot dot-store"></i>${esc(storeName)}</span>
      ${riderName ? `<span class="route-rider-name">${icon('bike')} ${esc(riderName)}</span>` : ''}
      <span><i class="dot dot-home"></i>${esc(addressLabel)}</span>
    </div>
  </div>`;
}

/** 4-digit delivery OTP entry (customer reads it aloud to the rider). */
export function otpDisplay(code) {
  const digits = String(code || '').padStart(4, '0').slice(0, 4).split('');
  return `<div class="otp-display">${digits.map(d => `<span class="otp-cell">${esc(d)}</span>`).join('')}</div>`;
}