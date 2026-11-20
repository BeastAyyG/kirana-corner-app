import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}

export const isoNow = () => new Date().toISOString();
export const sha256 = value => createHash('sha256').update(String(value)).digest('hex');
export const newId = (prefix = '') => `${prefix}${randomUUID()}`;
export const randomDigits = length => {
  let out = '';
  while (out.length < length) out += String(randomBytes(1)[0] % 10);
  return out.slice(0, length);
};
export const randomToken = () => randomBytes(32).toString('base64url');

const secret = () => process.env.KIRANA_SESSION_SECRET || 'local-only-dev-secret-change-me-32chars!!';
export const hmac = value => createHmac('sha256', secret()).update(String(value)).digest('hex');
export function safeEqual(a, b) {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const config = {
  isProduction: () => process.env.NODE_ENV === 'production',
  otpDev: () => process.env.KIRANA_OTP_DEV === undefined ? process.env.NODE_ENV !== 'production' : process.env.KIRANA_OTP_DEV === 'true',
  otpProvider: () => process.env.KIRANA_OTP_PROVIDER || 'console',
  paymentProvider: () => process.env.KIRANA_PAYMENT_PROVIDER || 'mock',
  sessionDays: () => Number(process.env.KIRANA_SESSION_DAYS || 30),
  corsOrigins: () => (process.env.KIRANA_CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  riderOfferSeconds: () => Number(process.env.KIRANA_RIDER_OFFER_SECONDS || 60),
  riderMaxActiveJobs: () => Number(process.env.KIRANA_RIDER_MAX_ACTIVE_JOBS || 2),
  avgSpeedKmph: () => Number(process.env.KIRANA_AVG_SPEED_KMPH || 18)
};

export function assertProductionConfig() {
  if (!config.isProduction()) return;
  const s = process.env.KIRANA_SESSION_SECRET || '';
  if (s.length < 32 || s.startsWith('local-only') || s.startsWith('replace-with'))
    throw new Error('Production requires a unique KIRANA_SESSION_SECRET of at least 32 characters.');
  if (config.otpProvider() === 'console' && process.env.KIRANA_ALLOW_CONSOLE_OTP !== 'true')
    throw new Error('Production requires KIRANA_OTP_PROVIDER=msg91 or twilio (or an explicit KIRANA_ALLOW_CONSOLE_OTP=true acknowledgement).');
}

export function normalizePhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180, R = 6371;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function etaMinutes(distanceKm, prepMinutes) {
  const travel = Math.ceil((distanceKm / config.avgSpeedKmph()) * 60);
  return Math.max(8, prepMinutes + travel + 2);
}

export function requireString(value, name, { min = 1, max = 200 } = {}) {
  const text = String(value ?? '').trim();
  if (text.length < min || text.length > max)
    throw new AppError(400, 'INVALID_INPUT', `${name} must be ${min} to ${max} characters.`);
  return text;
}
export function requireInt(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < min || num > max)
    throw new AppError(400, 'INVALID_INPUT', `${name} must be a whole number from ${min} to ${max}.`);
  return num;
}
export function requireLatLng(lat, lng) {
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || la < -90 || la > 90 || !Number.isFinite(ln) || ln < -180 || ln > 180)
    throw new AppError(400, 'INVALID_LOCATION', 'Latitude and longitude must be valid coordinates.');
  return { lat: la, lng: ln };
}
export function requireBool(value, name) {
  if (typeof value !== 'boolean') throw new AppError(400, 'INVALID_INPUT', `${name} must be true or false.`);
  return value;
}

export async function readJson(request, maxBytes = 1024 * 1024) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) throw new AppError(413, 'BODY_TOO_LARGE', 'Request body is too large.');
  }
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { throw new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON.'); }
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}