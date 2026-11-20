// Store settings: read-only identity, live open/accepting/surge switches and a
// rupees-denominated operations + fees form. Saves are diff-based so masked
// values (surge fee reads 0 while surge is off; rider payout is not exposed by
// the settings GET) are never accidentally overwritten.
import { api } from '../../_shared/api.js';
import { icon, esc, toast, spinner, emptyState, askConfirm } from '../../_shared/ui.js';
import { money, phonePretty } from '../../_shared/format.js';
import { state, bus, signOut } from '../state.js';

const FEE_FIELDS = [
  { key: 'min_order_minor', label: 'Minimum order (₹)' },
  { key: 'delivery_base_fee_minor', label: 'Delivery base fee (₹)' },
  { key: 'delivery_per_km_minor', label: 'Delivery per km (₹)' },
  { key: 'free_delivery_above_minor', label: 'Free delivery above (₹)' },
  { key: 'handling_fee_minor', label: 'Handling fee (₹)' },
  { key: 'surge_fee_minor', label: 'Surge fee (₹)', hint: 'Reads ₹0 while surge is off — enter a value to change it' },
  { key: 'rider_payout_minor', label: 'Rider payout per order (₹)', hint: 'Leave blank to keep the current payout', blank: true },
];
const rupeesInput = minor => String(Number(minor || 0) / 100);

export async function settingsView(outlet, params, query, { router }) {
  if (!state.store) {
    outlet.innerHTML = `<div class="page">${emptyState({ emoji: '🏬', title: 'No store assigned', body: 'This picker account is not staffed on any store yet.' })}</div>`;
    return;
  }

  let dead = false;
  let toggleBusy = false;
  let saveBusy = false;
  let settings = null;
  let baseline = null;

  function toggleRow(key, title, sub) {
    const on = Boolean(settings[key]);
    return `<div class="toggle-row">
      <div class="tg-main"><strong>${esc(title)}</strong><span>${esc(sub)}</span></div>
      <button class="switch" role="switch" aria-checked="${on}" data-toggle="${key}" aria-label="${esc(title)}"></button>
    </div>`;
  }

  function feeField(f) {
    const value = f.blank ? '' : rupeesInput(baseline[f.key]);
    return `<div class="field">
      <label for="set-${f.key}">${esc(f.label)}</label>
      <input id="set-${f.key}" data-fee="${f.key}" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value)}" ${f.blank ? 'placeholder="Keep current"' : ''}>
      ${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}
    </div>`;
  }

  function render() {
    const s = settings;
    outlet.innerHTML = `
      <div class="page">
        <div class="section-title"><h2>${icon('gear')} Store settings</h2><span class="muted tiny">${esc(s.id)}</span></div>
        <div class="settings-stack">
          <div class="settings-card">
            <h3>${esc(s.name)}</h3>
            <div class="kv-list">
              <div class="kv-row"><span class="k">Address</span><span class="v">${esc(s.address)}</span></div>
              <div class="kv-row"><span class="k">City</span><span class="v">${esc(s.city)}</span></div>
              <div class="kv-row"><span class="k">Pincode</span><span class="v">${esc(s.pincode)}</span></div>
            </div>
            <p class="settings-note">Store identity is managed by the admin team.</p>
          </div>

          <div class="toggle-card">
            ${toggleRow('is_open', 'Store open', 'Visible to customers nearby')}
            ${toggleRow('accepting_orders', 'Accepting orders', 'Customers can place new orders')}
            ${toggleRow('surge_active', 'Surge pricing', `Adds ${money(baseline.surge_fee_minor)} during busy periods`)}
          </div>

          <div class="settings-card">
            <h3>Operations</h3>
            <div class="form-row">
              <div class="field">
                <label for="set-prep">Prep time (minutes)</label>
                <input id="set-prep" data-op="prep_time_minutes" type="number" min="1" max="120" step="1" inputmode="numeric" value="${esc(s.prep_time_minutes)}">
                <span class="hint">1–120 minutes</span>
              </div>
              <div class="field">
                <label for="set-radius">Delivery radius (km)</label>
                <input id="set-radius" data-op="radius_km" type="number" min="0.1" max="15" step="0.1" inputmode="decimal" value="${esc(s.radius_km)}">
                <span class="hint">Up to 15 km</span>
              </div>
            </div>
            <h3>Fees</h3>
            <div class="form-row">${feeField(FEE_FIELDS[0])}${feeField(FEE_FIELDS[1])}</div>
            <div class="form-row">${feeField(FEE_FIELDS[2])}${feeField(FEE_FIELDS[3])}</div>
            <div class="form-row">${feeField(FEE_FIELDS[4])}${feeField(FEE_FIELDS[5])}</div>
            ${feeField(FEE_FIELDS[6])}
            <button class="btn btn-primary block" data-save-settings>${icon('check')} Save changes</button>
            <p class="settings-note">Only changed fields are sent. Amounts are entered in rupees.</p>
          </div>

          <div class="settings-card">
            <h3>Signed in</h3>
            <div class="kv-list">
              <div class="kv-row"><span class="k">Picker</span><span class="v">${esc(state.user?.name || 'Picker')}</span></div>
              <div class="kv-row"><span class="k">Phone</span><span class="v">${esc(phonePretty(state.user?.phone))}</span></div>
            </div>
            <button class="signout-row" data-signout>
              <span class="a-icon">${icon('logout')}</span>
              <span><strong>Sign out</strong><span>End this picker session</span></span>
            </button>
          </div>
        </div>
      </div>`;
    wire();
  }

  function syncStore(next) {
    settings = { ...settings, ...next };
    state.store = { ...state.store, ...next };
    state.stores = state.stores.map(s => (s.id === next.id ? { ...s, ...next } : s));
    bus.emit('store', state.store);
  }

  async function flipToggle(key, btn) {
    if (toggleBusy || dead) return;
    toggleBusy = true;
    const next = !Boolean(settings[key]);
    btn.setAttribute('aria-checked', String(next)); // optimistic
    btn.disabled = true;
    try {
      const res = await api.updateStoreSettings(state.store.id, { [key]: next });
      if (dead) return;
      baseline = { ...baseline, [key]: Boolean(res.store[key]) };
      syncStore(res.store);
      toast(`${key === 'is_open' ? 'Store' : key === 'accepting_orders' ? 'Order intake' : 'Surge'} ${next ? 'on' : 'off'}`, 'success');
    } catch (error) {
      if (!dead) {
        btn.setAttribute('aria-checked', String(!next));
        toast(error.message || 'Could not update the setting', 'error');
      }
    } finally {
      toggleBusy = false;
      if (btn.isConnected) btn.disabled = false;
    }
  }

  function readOps(body) {
    const prepRaw = outlet.querySelector('[data-op="prep_time_minutes"]').value.trim();
    if (prepRaw !== '') {
      const prep = Number(prepRaw);
      if (!Number.isInteger(prep) || prep < 1 || prep > 120) { toast('Prep time must be 1–120 minutes', 'error'); return false; }
      if (prep !== Number(baseline.prep_time_minutes)) body.prep_time_minutes = prep;
    }
    const radiusRaw = outlet.querySelector('[data-op="radius_km"]').value.trim();
    if (radiusRaw !== '') {
      const radius = Number(radiusRaw);
      if (!Number.isFinite(radius) || radius <= 0 || radius > 15) { toast('Radius must be between 0.1 and 15 km', 'error'); return false; }
      if (radius !== Number(baseline.radius_km)) body.radius_km = radius;
    }
    return true;
  }

  function readFees(body) {
    for (const f of FEE_FIELDS) {
      const raw = outlet.querySelector(`[data-fee="${f.key}"]`).value.trim();
      if (raw === '') continue;
      const paise = Math.round(Number(raw) * 100);
      if (!Number.isFinite(paise) || paise < 0 || paise > 1000000) { toast(`${f.label}: enter a valid amount`, 'error'); return false; }
      // Rider payout is not returned by the settings GET, so a filled value is
      // always sent; other fees are only sent when they differ from baseline.
      if (f.blank || paise !== Number(baseline[f.key] || 0)) body[f.key] = paise;
    }
    return true;
  }

  async function save() {
    if (saveBusy || dead) return;
    const body = {};
    if (!readOps(body) || !readFees(body)) return;
    if (!Object.keys(body).length) { toast('Nothing changed yet', 'default'); return; }
    saveBusy = true;
    const btn = outlet.querySelector('[data-save-settings]');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const res = await api.updateStoreSettings(state.store.id, body);
      if (dead) return;
      baseline = { ...baseline, ...body };
      syncStore(res.store);
      toast('Settings saved', 'success');
      // Inputs keep the values just saved; re-prefilling from the response
      // would show masked fees (surge reads 0 while off).
    } catch (error) {
      if (!dead) toast(error.message || 'Could not save settings', 'error');
    } finally {
      saveBusy = false;
      const again = outlet.querySelector('[data-save-settings]');
      if (again) { again.disabled = false; again.innerHTML = `${icon('check')} Save changes`; }
    }
  }

  async function doSignOut() {
    const ok = await askConfirm({ title: 'Sign out?', message: 'You will need an OTP to sign back in.', confirmLabel: 'Sign out', danger: true });
    if (!ok || dead) return;
    try { await api.logout(); } catch { /* session is cleared locally regardless */ }
    signOut();
    router.navigate('/auth', { replace: true });
  }

  function wire() {
    outlet.querySelectorAll('[data-toggle]').forEach(btn => btn.addEventListener('click', () => flipToggle(btn.dataset.toggle, btn)));
    outlet.querySelector('[data-save-settings]')?.addEventListener('click', save);
    outlet.querySelector('[data-signout]')?.addEventListener('click', doSignOut);
  }

  outlet.innerHTML = `<div class="page">${spinner('Loading settings…')}</div>`;
  try {
    const res = await api.storeSettings(state.store.id);
    if (dead) return;
    settings = res.store;
    baseline = { ...res.store };
  } catch (error) {
    if (dead) return;
    outlet.innerHTML = `<div class="page">${emptyState({ emoji: '📡', title: 'Could not load settings', body: error.message || 'Check your connection.', actionHtml: '<button class="btn btn-primary" data-settings-retry>Retry</button>' })}</div>`;
    outlet.querySelector('[data-settings-retry]')?.addEventListener('click', () => router.refresh());
    return;
  }
  render();
  return () => { dead = true; };
}