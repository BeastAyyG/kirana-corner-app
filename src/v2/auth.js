import {
  AppError, config, hmac, isoNow, newId, normalizePhone, randomDigits, randomToken,
  requireString, safeEqual, sha256
} from './util.js';
import { audit } from './db.js';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_SENDS_PER_WINDOW = 5;
const OTP_SEND_WINDOW_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 5;

async function sendViaProvider(phone, code) {
  const provider = config.otpProvider();
  if (provider === 'console') {
    console.log(`[otp] ${phone} -> ${code}`);
    return;
  }
  if (provider === 'msg91') {
    const authKey = process.env.KIRANA_MSG91_AUTHKEY;
    const templateId = process.env.KIRANA_MSG91_TEMPLATE_ID;
    if (!authKey || !templateId) throw new AppError(500, 'OTP_PROVIDER_NOT_CONFIGURED', 'MSG91 credentials are not configured.');
    const response = await fetch('https://control.msg91.com/api/v5/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authkey: authKey },
      body: JSON.stringify({ template_id: templateId, mobile: phone.replace('+', ''), otp: code }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new AppError(502, 'OTP_PROVIDER_FAILED', 'Could not send the OTP. Try again shortly.');
    return;
  }
  if (provider === 'twilio') {
    const sid = process.env.KIRANA_TWILIO_ACCOUNT_SID, token = process.env.KIRANA_TWILIO_AUTH_TOKEN;
    const service = process.env.KIRANA_TWILIO_VERIFY_SERVICE_SID;
    if (!sid || !token || !service) throw new AppError(500, 'OTP_PROVIDER_NOT_CONFIGURED', 'Twilio credentials are not configured.');
    const response = await fetch(`https://verify.twilio.com/v2/Services/${service}/Verifications`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: phone, Channel: 'sms' }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new AppError(502, 'OTP_PROVIDER_FAILED', 'Could not send the OTP. Try again shortly.');
    return;
  }
  throw new AppError(500, 'OTP_PROVIDER_UNKNOWN', `Unknown OTP provider "${provider}".`);
}

async function verifyViaProvider(phone, code) {
  if (config.otpProvider() !== 'twilio') return null;
  const sid = process.env.KIRANA_TWILIO_ACCOUNT_SID, token = process.env.KIRANA_TWILIO_AUTH_TOKEN;
  const service = process.env.KIRANA_TWILIO_VERIFY_SERVICE_SID;
  const response = await fetch(`https://verify.twilio.com/v2/Services/${service}/VerificationCheck`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: phone, Code: code }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new AppError(502, 'OTP_PROVIDER_FAILED', 'Could not verify the OTP. Try again shortly.');
  const data = await response.json();
  return data.status === 'approved';
}

export async function requestOtp(db, { phone }) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new AppError(400, 'INVALID_PHONE', 'Enter a valid Indian mobile number (10 digits starting with 6-9).');
  const now = Date.now();
  const recent = db.prepare('SELECT created_at FROM otp_challenges WHERE phone=? AND created_at>? ORDER BY created_at DESC')
    .all(normalized, new Date(now - OTP_SEND_WINDOW_MS).toISOString());
  if (recent.length >= OTP_MAX_SENDS_PER_WINDOW)
    throw new AppError(429, 'OTP_RATE_LIMITED', 'Too many OTP requests. Try again in about 10 minutes.');
  if (recent.length && now - Date.parse(recent[0].created_at) < OTP_RESEND_COOLDOWN_MS)
    throw new AppError(429, 'OTP_COOLDOWN', 'Please wait 30 seconds before requesting another OTP.', { retry_after_seconds: 30 });
  const existing = db.prepare('SELECT id,role,active FROM users WHERE phone=?').get(normalized);
  if (existing && !existing.active) throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.');
  const code = randomDigits(6);
  const id = newId('otp-');
  db.prepare('INSERT INTO otp_challenges (id,phone,code_hash,attempts,created_at,expires_at) VALUES (?,?,?,?,?,?)')
    .run(id, normalized, hmac(`${normalized}:${code}`), 0, isoNow(), new Date(now + OTP_TTL_MS).toISOString());
  await sendViaProvider(normalized, code);
  const payload = { challenge_id: id, phone: normalized, expires_at: new Date(now + OTP_TTL_MS).toISOString(), resend_after_seconds: 30 };
  if (config.otpDev()) payload.dev_code = code;
  return payload;
}

export function createSession(db, userId, userAgent = '') {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + config.sessionDays() * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash,user_id,user_agent,created_at,expires_at) VALUES (?,?,?,?,?)')
    .run(sha256(token), userId, String(userAgent).slice(0, 200), isoNow(), expiresAt);
  return { token, expiresAt };
}

export function getSessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.id,u.phone,u.role,u.name,u.active,s.expires_at AS expiresAt
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(sha256(token));
  if (!row) return null;
  if (Date.parse(row.expiresAt) <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
    return null;
  }
  if (!row.active) return null;
  return { id: row.id, phone: row.phone, role: row.role, name: row.name, expiresAt: row.expiresAt };
}

export function revokeSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
}

export async function verifyOtp(db, { phone, code, name = '', userAgent = '' }) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new AppError(400, 'INVALID_PHONE', 'Enter a valid Indian mobile number.');
  const supplied = String(code || '').trim();
  if (!/^\d{6}$/.test(supplied)) throw new AppError(400, 'INVALID_OTP_FORMAT', 'The OTP is 6 digits.');
  const challenge = db.prepare(`SELECT * FROM otp_challenges WHERE phone=? AND consumed_at IS NULL
    ORDER BY created_at DESC LIMIT 1`).get(normalized);
  if (!challenge) throw new AppError(400, 'OTP_NOT_REQUESTED', 'Request an OTP first.');
  if (Date.parse(challenge.expires_at) <= Date.now()) throw new AppError(400, 'OTP_EXPIRED', 'That OTP expired. Request a new one.');
  if (challenge.attempts >= OTP_MAX_VERIFY_ATTEMPTS) throw new AppError(429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many wrong attempts. Request a new OTP.');

  let valid = safeEqual(hmac(`${normalized}:${supplied}`), challenge.code_hash);
  if (valid && config.otpProvider() === 'twilio') valid = await verifyViaProvider(normalized, supplied);
  if (!valid) {
    db.prepare('UPDATE otp_challenges SET attempts=attempts+1 WHERE id=?').run(challenge.id);
    throw new AppError(400, 'OTP_INCORRECT', 'That OTP is incorrect.', { attempts_remaining: OTP_MAX_VERIFY_ATTEMPTS - challenge.attempts - 1 });
  }
  db.prepare('UPDATE otp_challenges SET consumed_at=? WHERE id=?').run(isoNow(), challenge.id);

  let user = db.prepare('SELECT id,phone,role,name,active FROM users WHERE phone=?').get(normalized);
  if (user && !user.active) throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.');
  if (!user) {
    const id = newId('usr-');
    const displayName = String(name || '').trim().slice(0, 80) || 'Customer';
    db.prepare('INSERT INTO users (id,phone,role,name,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)')
      .run(id, normalized, 'customer', displayName, isoNow(), isoNow());
    user = { id, phone: normalized, role: 'customer', name: displayName, active: 1 };
    audit(db, id, 'auth.register', 'user', id, { phone: normalized });
  }
  const session = createSession(db, user.id, userAgent);
  return { token: session.token, expires_at: session.expiresAt, user: { id: user.id, phone: user.phone, role: user.role, name: user.name } };
}

export function updateProfile(db, userId, { name }) {
  const displayName = requireString(name, 'Name', { min: 1, max: 80 });
  db.prepare('UPDATE users SET name=?,updated_at=? WHERE id=?').run(displayName, isoNow(), userId);
  const user = db.prepare('SELECT id,phone,role,name FROM users WHERE id=?').get(userId);
  return user;
}