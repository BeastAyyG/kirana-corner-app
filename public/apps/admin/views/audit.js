// Audit trail: newest-first ledger of every privileged action. Real columns
// are id / actor_id / action / entity / entity_id / detail (JSON string) /
// created_at — details are parsed defensively and money keys render as ₹.
import { icon, esc, toast, spinner, emptyState } from '../../_shared/ui.js';
import { money, relativeTime, dateTime } from '../../_shared/format.js';
import { state, refreshAudit, refreshUsers } from '../state.js';

const LIMITS = [50, 100, 200, 500];
const MONEY_KEYS = new Set(['total', 'grand_total', 'amount', 'refund']);

function shortId(id) {
  const s = String(id || '');
  return s.length > 20 ? `${s.slice(0, 20)}…` : s;
}

function detailSummary(raw) {
  const text = String(raw || '');
  if (!text) return '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { return text.length > 160 ? `${text.slice(0, 160)}…` : text; }
  if (!parsed || typeof parsed !== 'object') return String(parsed);
  const parts = Object.entries(parsed).slice(0, 6).map(([key, value]) => {
    const label = key.replace(/_minor$/, '').replace(/_/g, ' ');
    if (key.endsWith('_minor') || MONEY_KEYS.has(key)) return `${label}: ${money(value)}`;
    if (typeof value === 'boolean') return `${label}: ${value ? 'yes' : 'no'}`;
    if (value && typeof value === 'object') return `${label}: …`;
    return `${label}: ${String(value)}`;
  });
  const summary = parts.join(' · ');
  return summary.length > 180 ? `${summary.slice(0, 180)}…` : summary;
}

export async function auditView(outlet) {
  let alive = true;
  let limit = 100;
  let loading = true;
  let fetching = false;

  // Actor names make the ledger readable; fall back to ids when unavailable.
  if (!state.users.length) { try { await refreshUsers(''); } catch { /* ids are fine */ } }
  const actorName = id => state.users.find(u => u.id === id)?.name || '';

  function rowHtml(ev) {
    const name = actorName(ev.actor_id);
    const summary = detailSummary(ev.detail);
    return `<div class="audit-row">
      <span class="au-actor" title="${esc(ev.actor_id)}">${esc(name || shortId(ev.actor_id))}</span>
      <span class="au-action">
        <strong>${esc(ev.action)}</strong>
        <span class="au-target">${esc(ev.entity)} · ${esc(shortId(ev.entity_id))}</span>
        ${summary ? `<span class="au-detail">${esc(summary)}</span>` : ''}
      </span>
      <span class="au-time" title="${esc(dateTime(ev.created_at))}">${esc(relativeTime(ev.created_at))}</span>
    </div>`;
  }

  function renderList() {
    if (!alive) return;
    const host = outlet.querySelector('[data-audit-list]');
    const note = outlet.querySelector('[data-count]');
    if (!host) return;
    if (loading) { host.innerHTML = spinner('Loading audit log…'); return; }
    if (note) note.textContent = `${state.audit.length} event${state.audit.length === 1 ? '' : 's'} · newest first`;
    host.innerHTML = state.audit.length
      ? state.audit.map(rowHtml).join('')
      : emptyState({ emoji: '🛡️', title: 'No audit events', body: 'Privileged actions — store edits, staff changes, coupons and cancellations — are recorded here.' });
  }

  function render() {
    outlet.innerHTML = `
      <div class="admin-head">
        <div><h1>Audit log</h1><div class="ah-sub" data-count>Every privileged action, newest first</div></div>
        <div class="ah-actions">
          <select class="admin-select" data-limit aria-label="Number of events">
            ${LIMITS.map(n => `<option value="${n}" ${n === limit ? 'selected' : ''}>Last ${n}</option>`).join('')}
          </select>
          <button class="btn btn-outline refresh-btn" data-refresh>${icon('refresh')} Refresh</button>
        </div>
      </div>
      <div class="admin-card"><div data-audit-list></div></div>`;
    outlet.querySelector('[data-limit]')?.addEventListener('change', e => { limit = Number(e.target.value) || 100; loading = true; renderList(); load(); });
    outlet.querySelector('[data-refresh]')?.addEventListener('click', () => load(true));
    renderList();
  }

  async function load(manual = false) {
    if (fetching) return;
    fetching = true;
    const btn = outlet.querySelector('[data-refresh]');
    btn?.classList.add('spinning');
    try { await refreshAudit(limit); }
    catch (error) { if (manual) toast(error.message || 'Could not load the audit log', 'error'); }
    fetching = false;
    loading = false;
    btn?.classList.remove('spinning');
    renderList();
  }

  render();
  await load();
  return () => { alive = false; };
}