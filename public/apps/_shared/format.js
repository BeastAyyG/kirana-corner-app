// Formatting helpers for the v2 delivery apps. Money is integer paise.
const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(minor) { return `₹${inr.format(Number(minor || 0) / 100)}`; }
export function moneyExact(minor) { return `₹${inr2.format(Number(minor || 0) / 100)}`; }

export function isoDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function nextDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
function dayDiff(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86400000);
}
export function dateLabel(dateStr, todayIso) {
  const diff = dayDiff(todayIso || isoDate(), dateStr);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
export function timeLabel(iso, timeZone = 'Asia/Kolkata') {
  try { return new Date(iso).toLocaleTimeString('en-IN', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }); }
  catch { return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }); }
}
export function slotRange(startsAt, endsAt, timeZone = 'Asia/Kolkata') {
  const hm = iso => {
    try { return new Date(iso).toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }); }
    catch { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }); }
  };
  return `${hm(startsAt)}–${hm(endsAt)}`;
}
export function dateShort(iso, timeZone = 'Asia/Kolkata') {
  try { return new Date(iso).toLocaleDateString('en-IN', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }); }
  catch { return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
}
export function dateTime(iso, timeZone = 'Asia/Kolkata') {
  return `${dateShort(iso, timeZone)} · ${timeLabel(iso, timeZone)}`;
}
export function relativeTime(iso) {
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return '';
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return dateShort(iso);
}

// v2 delivery lifecycle: placed → packing → packed → rider_assigned → picked_up → delivered (+cancelled)
const STATUS_TEXT = {
  placed: 'Order placed',
  packing: 'Being packed',
  packed: 'Packed',
  rider_assigned: 'Rider assigned',
  picked_up: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
export function statusText(status) { return STATUS_TEXT[status] || status; }

// Ordered steps shown on the customer tracking timeline.
export const DELIVERY_STEPS = [
  { key: 'placed', label: 'Order placed', note: 'We have your order' },
  { key: 'packing', label: 'Packing your items', note: 'The store is picking your basket' },
  { key: 'packed', label: 'Packed & ready', note: 'Waiting for a rider' },
  { key: 'rider_assigned', label: 'Rider assigned', note: 'Heading to the store' },
  { key: 'picked_up', label: 'Out for delivery', note: 'On the way to you' },
  { key: 'delivered', label: 'Delivered', note: 'Enjoy!' },
];
export const STATUS_ORDER = ['placed', 'packing', 'packed', 'rider_assigned', 'picked_up', 'delivered'];
export function stepIndex(status) {
  const i = STATUS_ORDER.indexOf(status);
  return i < 0 ? 0 : i;
}
export function isTerminal(status) { return status === 'delivered' || status === 'cancelled'; }
export function isLive(status) { return !isTerminal(status); }

export function prettyCode(code) {
  const c = String(code || '').toUpperCase();
  return c.length === 8 ? `${c.slice(0, 4)} ${c.slice(4)}` : c;
}
export function etaLabel(range) {
  if (Array.isArray(range) && range.length === 2) return `${range[0]}–${range[1]} min`;
  return `${range || 0} min`;
}
export function distanceLabel(km) {
  const n = Number(km || 0);
  return n < 1 ? `${Math.round(n * 1000)} m` : `${n.toFixed(1)} km`;
}
export function phonePretty(phone) {
  const c = String(phone || '').replace(/\D/g, '');
  return c.length === 12 && c.startsWith('91') ? `+91 ${c.slice(2, 7)} ${c.slice(7)}` : String(phone || '');
}