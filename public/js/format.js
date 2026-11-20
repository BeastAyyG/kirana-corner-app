// Formatting helpers (money is stored as integer paise).

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function money(minor) {
  const rupees = Number(minor || 0) / 100;
  return `₹${inr.format(rupees)}`;
}

export function moneyExact(minor) {
  const rupees = Number(minor || 0) / 100;
  return `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rupees)}`;
}

export function isoDate(date) {
  const d = date instanceof Date ? date : new Date(`${date}T12:00:00Z`);
  if (date instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return d.toISOString().slice(0, 10);
}

export function nextDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function dayDiff(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86400000);
}

/** "Today" / "Tomorrow" / "Mon, 18 Nov" relative to the store's local date. */
export function dateLabel(dateStr, todayIso) {
  const diff = dayDiff(todayIso || isoDate(new Date()), dateStr);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function timeLabel(iso, timeZone) {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
}

export function dateShort(iso, timeZone) {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { timeZone, weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }
}

export function slotWhen(order) {
  return `${dateShort(order.pickup_starts_at, order.time_zone)} · ${order.pickup_slot_label}`;
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

export function statusText(status) {
  return ({
    placed: 'Order placed',
    packing: 'Being packed',
    ready: 'Ready for pickup',
    collected: 'Picked up',
    cancelled: 'Cancelled',
  })[status] || status;
}

/** Pickup codes are 8 chars; display as two groups for readability. */
export function prettyCode(code) {
  const c = String(code || '').toUpperCase();
  return c.length === 8 ? `${c.slice(0, 4)} ${c.slice(4)}` : c;
}
