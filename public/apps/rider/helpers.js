// Small rider-domain helpers shared by the views. Money stays integer paise.
import { esc, icon } from '../_shared/ui.js';
import { distanceLabel } from '../_shared/format.js';

export const OFFER_WINDOW_MS = 60000;
export const RING_RADIUS = 19;
export const RING_CIRC = 2 * Math.PI * RING_RADIUS;

export function haversineKm(aLat, aLng, bLat, bLng) {
  if ([aLat, aLng, bLat, bLng].some(n => typeof n !== 'number' || Number.isNaN(n))) return 0;
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function tripKm(job) {
  return haversineKm(job?.store?.lat, job?.store?.lng, job?.drop?.lat, job?.drop?.lng);
}
export function tripLabel(job) { return distanceLabel(tripKm(job)); }

/** Rough riding estimate at ~20 km/h plus a 2-minute handover buffer. */
export function etaMinutes(job) {
  return Math.max(3, Math.round(tripKm(job) * 3) + 2);
}

export function jobPayMinor(job) {
  return Number(job?.payout_minor || 0) + Number(job?.tip_minor || 0);
}

export function offerExpiresAt(job) {
  const offered = Date.parse(job?.offered_at || '');
  return (Number.isNaN(offered) ? Date.now() : offered) + OFFER_WINDOW_MS;
}

const JOB_CHIP = {
  offered: { cls: 'status-placed', text: 'New offer' },
  accepted: { cls: 'status-rider_assigned', text: 'Heading to store' },
  picked_up: { cls: 'status-picked_up', text: 'Out for delivery' },
  delivered: { cls: 'status-delivered', text: 'Delivered' },
  declined: { cls: 'status-cancelled', text: 'Declined' },
  cancelled: { cls: 'status-cancelled', text: 'Cancelled' },
  expired: { cls: 'status-collected', text: 'Expired' },
};
export function jobChip(status) {
  const chip = JOB_CHIP[status] || { cls: 'status-collected', text: status };
  return `<span class="status-chip ${chip.cls}"><i></i>${esc(chip.text)}</span>`;
}

export function paymentPill(job) {
  return job.payment_method === 'cod'
    ? `<span class="pill pill-amber">${icon('cash')} COD</span>`
    : `<span class="pill pill-blue">${icon('card')} Paid online</span>`;
}

/** External maps navigation (deliberate hand-off, not a page asset). */
export function navigateTo(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return;
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank', 'noopener');
}

export function mapsAvailable(job) {
  return typeof job?.store?.lat === 'number' && typeof job?.drop?.lat === 'number';
}