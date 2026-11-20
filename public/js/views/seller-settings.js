// Seller settings: pickup hours, capacity, service days, closures, reset demo.
import { state } from '../state.js';
import { esc, icon, emptyState, toast, askConfirm } from '../ui.js';
import { onView } from '../router.js';
import { saveSettings, resetDemoData, refreshSettings } from '../actions.js';

const DAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];

export function renderSellerSettings(outlet) {
  let closures = [];
  let days = [0, 1, 2, 3, 4, 5, 6];

  const syncFromState = () => {
    if (state.seller.settings) {
      closures = [...(state.seller.settings.closure_dates || [])];
      days = [...(state.seller.settings.service_days || DAYS.map(day => day.value))];
    }
  };

  const draw = () => {
    if (state.session.user?.role !== 'seller') {
      outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🔐', title: 'Shopkeeper access only', body: 'Sign in with the shopkeeper account to change pickup settings.', actionHtml: '<button class="btn btn-primary" data-go-signin>Sign in</button>' })}</div>`;
      outlet.querySelector('[data-go-signin]')?.addEventListener('click', () => { location.hash = '#/welcome'; });
      return;
    }
    if (!state.seller.store) {
      outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🏪', title: 'No shop linked', body: 'This account has no assigned shop yet.' })}</div>`;
      return;
    }
    const settings = state.seller.settings;
    const store = state.seller.store;

    outlet.innerHTML = `
      <div class="subbar">
        <button class="icon-btn" data-back aria-label="Go back">${icon('chevronLeft')}</button>
        <h1>Pickup settings</h1>
        <span class="tiny muted">${esc(store.time_zone)}</span>
      </div>
      ${settings ? `
      <div class="page">
        <form class="settings-card" data-settings-form novalidate>
          <h3>Pickup window</h3>
          <div class="form-row">
            <div class="field"><label for="evening_start">Evening starts</label><input id="evening_start" name="evening_start" type="time" value="${esc(settings.evening_start)}" required></div>
            <div class="field"><label for="evening_end">Evening ends</label><input id="evening_end" name="evening_end" type="time" value="${esc(settings.evening_end)}" required></div>
          </div>
          <div class="form-row">
            <div class="field"><label for="capacity">Orders per slot</label><input id="capacity" name="capacity" type="number" min="1" max="500" step="1" value="${esc(settings.capacity)}" required></div>
            <div class="field"><label for="cutoff">Booking cutoff (min)</label><input id="cutoff" name="cutoff_minutes" type="number" min="0" max="360" step="1" value="${esc(settings.cutoff_minutes)}" required></div>
          </div>
          <span class="hint">Slots are fixed at 30 minutes.</span>
          <h3>Service days</h3>
          <div class="day-picker">
            ${DAYS.map(day => `<button type="button" class="day-chip" data-day="${day.value}" aria-pressed="${days.includes(day.value)}">${day.label}</button>`).join('')}
          </div>
          <h3>Closed dates</h3>
          <div class="closure-list">
            ${closures.length ? closures.map(date => `<div class="closure-item"><span>🗓️ ${esc(date)}</span><button type="button" data-remove-closure="${esc(date)}" aria-label="Remove ${esc(date)}">×</button></div>`).join('') : '<span class="tiny muted">No closure dates added.</span>'}
          </div>
          <div class="field"><label for="add-closure">Add a closed date</label><input id="add-closure" name="closure_date" type="date"><span class="hint">Block a full day — holidays, restocking, etc.</span></div>
          <button type="submit" class="btn btn-primary block">Save pickup settings</button>
          <span class="hint">Blocked while any future slot still has a booking.</span>
        </form>
        <div class="spacer-16"></div>
        <div class="settings-card">
          <h3>Danger zone</h3>
          <button class="btn btn-danger block" data-reset-demo>${icon('refresh')} Reset sample data</button>
          <span class="hint">Restores the demo catalogue, slots and orders. Use while testing.</span>
        </div>
      </div>` : '<div class="page"><div class="skel"></div></div>'}`;

    outlet.querySelector('[data-back]')?.addEventListener('click', () => history.back());
    outlet.querySelectorAll('[data-day]').forEach(button => {
      button.addEventListener('click', () => {
        const value = Number(button.dataset.day);
        if (days.includes(value)) days = days.filter(day => day !== value);
        else days = [...days, value].sort();
        button.setAttribute('aria-pressed', String(days.includes(value)));
      });
    });
    outlet.querySelectorAll('[data-remove-closure]').forEach(button => {
      button.addEventListener('click', () => {
        closures = closures.filter(date => date !== button.dataset.removeClosure);
        toast('Closure date removed — press Save to apply');
      });
    });
    outlet.querySelector('[data-reset-demo]')?.addEventListener('click', async () => {
      const ok = await askConfirm({ title: 'Reset sample data?', message: 'The demo catalogue, pickup slots and all orders return to their starting state.', confirmLabel: 'Reset', danger: true });
      if (ok) await resetDemoData();
    });

    outlet.querySelector('[data-settings-form]')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const closureInput = form.elements.closure_date;
      if (closureInput.value) closures = [...new Set([...closures, closureInput.value])].sort();
      const body = {
        evening_start: form.elements.evening_start.value,
        evening_end: form.elements.evening_end.value,
        slot_minutes: 30,
        capacity: Number(form.elements.capacity.value),
        cutoff_minutes: Number(form.elements.cutoff_minutes.value),
        service_days: days,
        closure_dates: closures,
      };
      const ok = await saveSettings(body);
      if (ok) { closureInput.value = ''; syncFromState(); draw(); }
    });
  };

  syncFromState();
  onView('seller', () => { syncFromState(); draw(); });
  if (!state.seller.settingsLoaded) refreshSettings({ silent: true });
  draw();
}
