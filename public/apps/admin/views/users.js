// People: role-filtered directory of customers and staff, staff onboarding
// (picker / rider / admin) and suspend / activate with SELF_SUSPEND handling.
import { api } from '../../_shared/api.js';
import { icon, esc, toast, spinner, emptyState, askConfirm, formSheet } from '../../_shared/ui.js';
import { dateTime, phonePretty } from '../../_shared/format.js';
import { state, refreshUsers, refreshStores } from '../state.js';

const ROLE_TABS = [
  { role: '', label: 'All' },
  { role: 'customer', label: 'Customers' },
  { role: 'picker', label: 'Pickers' },
  { role: 'rider', label: 'Riders' },
  { role: 'admin', label: 'Admins' },
];
const ROLE_PILL = { customer: 'pill-gray', picker: 'pill-blue', rider: 'pill-amber', admin: 'pill-green' };

export async function usersView(outlet) {
  let alive = true;
  let role = '';
  let loading = true;
  let fetching = false;

  if (!state.stores.length) { try { await refreshStores(); } catch { /* staff form will warn */ } }

  function filtered() { return role ? state.users.filter(u => u.role === role) : state.users; }
  function countFor(r) { return r ? state.users.filter(u => u.role === r).length : state.users.length; }

  function rowHtml(u) {
    const isSelf = u.id === state.user?.id;
    return `<tr>
      <td><div class="t-main">${esc(u.name || '—')}${isSelf ? ' <span class="pill pill-green">You</span>' : ''}</div><div class="t-sub">${esc(u.id)}</div></td>
      <td class="num">${esc(phonePretty(u.phone))}</td>
      <td><span class="pill role-chip ${ROLE_PILL[u.role] || 'pill-gray'}">${esc(u.role)}</span></td>
      <td><span class="pill ${u.active ? 'pill-green' : 'pill-red'}">${u.active ? 'Active' : 'Suspended'}</span></td>
      <td class="t-sub">${esc(dateTime(u.created_at))}</td>
      <td><div class="row-actions">
        ${isSelf ? '<span class="t-sub">Signed in</span>' : `<button class="mini-btn ${u.active ? 'danger' : ''}" data-toggle-user="${esc(u.id)}">${icon(u.active ? 'close' : 'check')} ${u.active ? 'Suspend' : 'Activate'}</button>`}
      </div></td>
    </tr>`;
  }

  function renderTable() {
    if (!alive) return;
    const host = outlet.querySelector('[data-users-table]');
    const note = outlet.querySelector('[data-count]');
    if (!host) return;
    if (loading) { host.innerHTML = spinner('Loading people…'); return; }
    const list = filtered();
    if (note) note.textContent = `${list.length} account${list.length === 1 ? '' : 's'}`;
    if (!list.length) {
      host.innerHTML = emptyState({ emoji: '👥', title: 'No accounts in this view', body: role ? `No ${role} accounts yet. Add staff to grow the team.` : 'Accounts appear here as people sign up.' });
      return;
    }
    host.innerHTML = `<table class="admin-table t-wide">
      <thead><tr><th>Name</th><th>Phone</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
      <tbody>${list.map(rowHtml).join('')}</tbody>
    </table>`;
  }

  function render() {
    outlet.innerHTML = `
      <div class="admin-head">
        <div><h1>People</h1><div class="ah-sub">Customers, pickers, riders and admins</div></div>
        <div class="ah-actions">
          <button class="btn btn-outline refresh-btn" data-refresh>${icon('refresh')} Refresh</button>
          <button class="btn btn-primary" data-add-staff>${icon('plus')} Add staff</button>
        </div>
      </div>
      <div class="admin-toolbar">
        <div class="queue-tabs" role="tablist" aria-label="Filter by role">
          ${ROLE_TABS.map(tab => `<button class="chip ${tab.role === role ? 'on' : ''}" data-role-tab="${tab.role}" role="tab" aria-selected="${tab.role === role}">${tab.label} · ${countFor(tab.role)}</button>`).join('')}
        </div>
        <span class="count-note" data-count></span>
      </div>
      <div class="admin-card"><div class="table-wrap" data-users-table></div></div>`;
    outlet.querySelector('[data-refresh]')?.addEventListener('click', () => load(true));
    renderTable();
  }

  async function load(manual = false) {
    if (fetching) return;
    fetching = true;
    const btn = outlet.querySelector('[data-refresh]');
    btn?.classList.add('spinning');
    try { await refreshUsers(''); }
    catch (error) { if (manual) toast(error.message || 'Could not load users', 'error'); }
    fetching = false;
    loading = false;
    btn?.classList.remove('spinning');
    render();
  }

  /* ---------- staff onboarding ---------- */
  async function addStaff() {
    if (!state.stores.length) { toast('Add a store first — pickers and riders need one', 'error'); return; }
    const values = await formSheet({
      title: 'Add staff',
      submitLabel: 'Create account',
      note: 'The phone number becomes their sign-in. Pickers are bound to a store; riders get a home store.',
      fields: [
        { name: 'name', label: 'Full name', required: true, placeholder: 'Asha Kumar', attrs: 'maxlength="80"' },
        { name: 'phone', label: 'Mobile number', required: true, placeholder: '90000 00031', attrs: 'maxlength="10" inputmode="numeric"' },
        { name: 'role', label: 'Role', options: ['picker', 'rider', 'admin'], value: 'picker' },
        { name: 'store_id', label: 'Store', options: state.stores.map(s => s.id), value: state.stores[0]?.id, hint: 'Working store for pickers · home store for riders · ignored for admins' },
        { name: 'vehicle', label: 'Vehicle (riders)', options: ['bike', 'scooter', 'cycle', 'ev'], value: 'bike' },
      ],
    });
    if (!values) return;
    const digits = values.phone.replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) { toast('Enter a valid 10-digit mobile number', 'error'); return; }
    const body = { phone: `+91${digits}`, name: values.name, role: values.role };
    if (values.role === 'picker') body.store_id = values.store_id;
    if (values.role === 'rider') { body.home_store_id = values.store_id; body.vehicle = values.vehicle; }
    try {
      await api.adminCreateUser(body);
      toast(`${values.name} added as ${values.role}`, 'success');
      await load(false);
    } catch (error) {
      toast(error.message || 'Could not create the account', 'error');
    }
  }

  async function toggleUser(id) {
    const user = state.users.find(u => u.id === id);
    if (!user) return;
    const suspending = user.active;
    const ok = await askConfirm({
      title: suspending ? `Suspend ${user.name || 'this account'}?` : `Activate ${user.name || 'this account'}?`,
      message: suspending ? 'Their sessions end immediately and they cannot sign in until reactivated.' : 'They can sign in and work again.',
      confirmLabel: suspending ? 'Suspend' : 'Activate',
      danger: suspending,
    });
    if (!ok) return;
    try {
      await api.adminSetUserActive(id, !suspending);
      toast(suspending ? 'Account suspended' : 'Account activated', 'success');
      await load(false);
    } catch (error) {
      if (error.code === 'SELF_SUSPEND') toast('You cannot suspend your own account', 'error');
      else toast(error.message || 'Could not update the account', 'error');
    }
  }

  /* ---------- delegated actions ---------- */
  function onClick(event) {
    const tab = event.target.closest('[data-role-tab]');
    if (tab) { event.preventDefault(); role = tab.dataset.roleTab; render(); return; }
    if (event.target.closest('[data-add-staff]')) { event.preventDefault(); addStaff(); return; }
    const toggle = event.target.closest('[data-toggle-user]');
    if (toggle) { event.preventDefault(); toggleUser(toggle.dataset.toggleUser); }
  }

  render();
  outlet.addEventListener('click', onClick);
  await load();
  return () => { alive = false; outlet.removeEventListener('click', onClick); };
}