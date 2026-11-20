// Earnings: today / week / all-time payout cards plus delivered-job history.
import { icon, esc, toast, emptyState, spinner } from '../../_shared/ui.js';
import { money, dateTime } from '../../_shared/format.js';
import { state, bus, refreshJobs, refreshEarnings } from '../state.js';
import { jobPayMinor } from '../helpers.js';

const HISTORY_LIMIT = 30;

export async function earningsView(outlet, params, query, { router }) {
  let disposed = false;
  let loading = !state.earnings;

  function periodCard(label, period, { hero = false, iconName = 'clock', note = '' } = {}) {
    const p = period || { deliveries: 0, payout_minor: 0, tips_minor: 0, total_minor: 0, cash_collected_minor: 0 };
    return `
      <div class="earn-card ${hero ? 'is-hero' : ''}">
        <div class="ec-head">
          <h2>${icon(iconName)} ${esc(label)}</h2>
          <span class="pill ${hero ? 'pill-green' : 'pill-gray'}">${p.deliveries} deliver${p.deliveries === 1 ? 'y' : 'ies'}</span>
        </div>
        <div class="ec-total">${money(p.total_minor)}<small>${esc(note || 'Payout + tips')}</small></div>
        <div class="ec-rows">
          <div class="ec-row"><span>${icon('bike')} Delivery payout</span><strong>${money(p.payout_minor)}</strong></div>
          <div class="ec-row tips"><span>${icon('gift')} Customer tips</span><strong>${money(p.tips_minor)}</strong></div>
          <div class="ec-row cash"><span>${icon('cash')} COD cash collected</span><strong>${money(p.cash_collected_minor)}</strong></div>
        </div>
      </div>`;
  }

  function historyRow(job) {
    const tip = Number(job.tip_minor || 0);
    return `
      <div class="row-card">
        <div class="row-main">
          <div class="row-title">${esc(job.public_label || job.id)}</div>
          <div class="row-sub">${esc(dateTime(job.delivered_at))} · ${esc(job.store?.name || '')}${job.payment_method === 'cod' ? ' · COD' : ''}</div>
        </div>
        <span class="past-pay">+${money(jobPayMinor(job))}${tip > 0 ? `<span class="pill pill-green">${icon('gift')} ${money(tip)}</span>` : ''}</span>
      </div>`;
  }

  function render() {
    if (disposed) return;
    if (loading) { outlet.innerHTML = `<div class="page">${spinner('Crunching your earnings…')}</div>`; return; }
    const earnings = state.earnings || {};
    const history = state.jobs
      .filter(j => j.status === 'delivered')
      .sort((a, b) => Date.parse(b.delivered_at || 0) - Date.parse(a.delivered_at || 0))
      .slice(0, HISTORY_LIMIT);
    outlet.innerHTML = `
      <div class="page">
        ${periodCard('Today', earnings.today, { hero: true, iconName: 'bolt', note: 'Earned since midnight' })}
        ${periodCard('This week', earnings.week, { iconName: 'clock', note: 'Last 7 days' })}
        ${periodCard('All time', earnings.all_time, { iconName: 'wallet', note: 'Since you joined' })}
        <div class="notice notice-info">${icon('cash')} <span>COD cash you collect is deposited at your home store — it is tracked here but not part of your payout.</span></div>
        <div class="section-title"><h2>${icon('receipt')} Delivery history</h2><span class="pill pill-gray">${history.length} shown</span></div>
        ${history.length ? history.map(historyRow).join('') : emptyState({ emoji: '🧾', title: 'No deliveries yet', body: 'Complete your first delivery and it will show up here with its payout.', actionHtml: '<button class="btn btn-primary" data-nav="/">Find jobs</button>' })}
      </div>`;
  }

  async function load({ silent = false } = {}) {
    if (!silent) { loading = !state.earnings; render(); }
    try {
      await Promise.all([refreshEarnings(), refreshJobs()]);
    } catch (error) {
      toast(error.message || 'Could not refresh earnings', 'error');
    }
    loading = false;
    render();
  }

  const offEarnings = bus.on('earnings', render);
  const offJobs = bus.on('jobs', render);
  const offRefresh = bus.on('refresh-earnings', async () => {
    toast('Refreshing earnings…', 'default', 1200);
    await load({ silent: true });
  });

  await load();

  return () => {
    disposed = true;
    offEarnings(); offJobs(); offRefresh();
  };
}