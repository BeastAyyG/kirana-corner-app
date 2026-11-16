import { AppError, isoNow, requireBool, requireLatLng } from './util.js';
import { audit } from './db.js';
import { assignRider, retryAwaitingOrders } from './dispatch.js';
import { getOrderView, markDelivered, markPickedUp, verifyDeliveryOtp, verifyPickupCode } from './orders.js';
import { notify, publishOrder } from './events.js';

function riderProfile(db, riderId) {
  const rider = db.prepare('SELECT r.*,u.name,u.phone,u.active FROM riders r JOIN users u ON u.id=r.user_id WHERE r.user_id=?').get(riderId);
  if (!rider || !rider.active) throw new AppError(403, 'RIDER_REQUIRED', 'No active rider profile for this account.');
  return rider;
}

export function getRiderMe(db, riderId) {
  const rider = riderProfile(db, riderId);
  return {
    id: rider.user_id, name: rider.name, phone: rider.phone, vehicle: rider.vehicle,
    home_store_id: rider.home_store_id, is_online: Boolean(rider.is_online),
    location: rider.lat === null ? null : { lat: rider.lat, lng: rider.lng, at: rider.last_ping_at }
  };
}

export function setAvailability(db, bus, riderId, online) {
  riderProfile(db, riderId);
  const flag = requireBool(online, 'online');
  db.prepare('UPDATE riders SET is_online=?,updated_at=? WHERE user_id=?').run(Number(flag), isoNow(), riderId);
  bus.publish(`rider:${riderId}`, 'availability', { online: flag });
  if (flag) retryAwaitingOrders(db, bus);
  return getRiderMe(db, riderId);
}

export function updateLocation(db, bus, riderId, { lat, lng }) {
  riderProfile(db, riderId);
  const point = requireLatLng(lat, lng);
  const now = isoNow();
  db.prepare('UPDATE riders SET lat=?,lng=?,last_ping_at=?,updated_at=? WHERE user_id=?').run(point.lat, point.lng, now, now, riderId);
  const active = db.prepare(`SELECT order_id FROM rider_jobs WHERE rider_id=? AND status IN ('accepted','picked_up')`).all(riderId);
  for (const { order_id: orderId } of active)
    publishOrder(bus, orderId, 'rider.location', { order_id: orderId, lat: point.lat, lng: point.lng, at: now });
  return { ok: true, at: now };
}

function jobView(db, job, riderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(job.order_id);
  const store = db.prepare('SELECT id,name,address,lat,lng FROM stores WHERE id=?').get(job.store_id);
  const address = JSON.parse(order.address_snapshot || '{}');
  return {
    id: job.id, order_id: job.order_id, public_label: order.public_label, status: job.status,
    order_status: order.status, payment_method: order.payment_method,
    payout_minor: Number(job.payout_minor), tip_minor: Number(job.tip_minor),
    cash_to_collect_minor: Number(job.cash_to_collect_minor), cash_collected: Boolean(job.cash_collected),
    store: { id: store.id, name: store.name, address: store.address, lat: store.lat, lng: store.lng },
    drop: { receiver_name: address.receiver_name, receiver_phone: address.receiver_phone, full_address: address.full_address, lat: address.lat, lng: address.lng },
    delivery_instructions: order.delivery_instructions,
    pickup_code: ['accepted'].includes(job.status) ? getOrderView(db, job.order_id, { id: riderId, role: 'rider' }).pickup_code : undefined,
    offered_at: job.offered_at, accepted_at: job.accepted_at, picked_up_at: job.picked_up_at, delivered_at: job.delivered_at
  };
}

export function listJobs(db, riderId, { status = '' } = {}) {
  riderProfile(db, riderId);
  const valid = ['offered', 'accepted', 'picked_up', 'delivered', 'declined', 'cancelled', 'expired'];
  if (status && !valid.includes(status)) throw new AppError(400, 'INVALID_STATUS_FILTER', 'Unknown job status.');
  const rows = status
    ? db.prepare('SELECT * FROM rider_jobs WHERE rider_id=? AND status=? ORDER BY created_at DESC').all(riderId, status)
    : db.prepare(`SELECT * FROM rider_jobs WHERE rider_id=? ORDER BY (status IN ('offered','accepted','picked_up')) DESC, created_at DESC`).all(riderId);
  return rows.map(job => jobView(db, job, riderId));
}

function ownJob(db, jobId, riderId) {
  const job = db.prepare('SELECT * FROM rider_jobs WHERE id=? AND rider_id=?').get(jobId, riderId);
  if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found.');
  return job;
}

export function acceptJob(db, bus, jobId, riderId) {
  const job = ownJob(db, jobId, riderId);
  if (job.status !== 'offered') throw new AppError(409, 'JOB_NOT_OFFERED', `This job is ${job.status}, not offered.`);
  const cutoff = Date.now() - Number(process.env.KIRANA_RIDER_OFFER_SECONDS || 60) * 1000;
  if (Date.parse(job.offered_at) < cutoff) {
    db.prepare(`UPDATE rider_jobs SET status='expired',ended_at=?,updated_at=? WHERE id=?`).run(isoNow(), isoNow(), jobId);
    assignRider(db, bus, job.order_id);
    throw new AppError(409, 'JOB_EXPIRED', 'That offer expired. Another rider is being assigned.');
  }
  const now = isoNow();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE rider_jobs SET status='accepted',accepted_at=?,updated_at=? WHERE id=? AND status='offered'`).run(now, now, jobId);
    const changed = db.prepare(`UPDATE orders SET status='rider_assigned',rider_id=?,assigned_at=?,updated_at=? WHERE id=? AND status='packed'`)
      .run(riderId, now, now, job.order_id).changes;
    if (changed !== 1) throw new AppError(409, 'ORDER_CONFLICT', 'The order changed. Refresh.');
    db.prepare('INSERT INTO order_events (order_id,actor_id,status,note,created_at) VALUES (?,?,?,?,?)')
      .run(job.order_id, riderId, 'rider_assigned', 'Rider accepted the delivery', now);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  const order = db.prepare('SELECT customer_id,public_label FROM orders WHERE id=?').get(job.order_id);
  publishOrder(bus, job.order_id, 'order.status', { order_id: job.order_id, status: 'rider_assigned', rider_id: riderId });
  notify(db, bus, { userId: order.customer_id, kind: 'order', title: 'Rider assigned', body: `A rider is heading to the store for ${order.public_label}.`, orderId: job.order_id });
  return jobView(db, db.prepare('SELECT * FROM rider_jobs WHERE id=?').get(jobId), riderId);
}

export function declineJob(db, bus, jobId, riderId) {
  const job = ownJob(db, jobId, riderId);
  if (job.status !== 'offered') throw new AppError(409, 'JOB_NOT_OFFERED', `This job is ${job.status}.`);
  db.prepare(`UPDATE rider_jobs SET status='declined',ended_at=?,updated_at=? WHERE id=? AND status='offered'`).run(isoNow(), isoNow(), jobId);
  audit(db, riderId, 'job.declined', 'rider_job', jobId, { order_id: job.order_id });
  assignRider(db, bus, job.order_id);
  return { declined: true };
}

export function pickupJob(db, bus, jobId, riderId, pickupCode, { system = false } = {}) {
  const job = ownJob(db, jobId, riderId);
  if (job.status !== 'accepted') throw new AppError(409, 'JOB_NOT_ACCEPTED', `This job is ${job.status}.`);
  if (!system && !verifyPickupCode(job.order_id, pickupCode || ''))
    throw new AppError(400, 'INVALID_PICKUP_CODE', 'That pickup code does not match. Ask the store for the code on the order.');
  const view = markPickedUp(db, bus, job.order_id, riderId);
  db.prepare(`UPDATE rider_jobs SET status='picked_up',picked_up_at=?,updated_at=? WHERE id=? AND status='accepted'`).run(isoNow(), isoNow(), jobId);
  return { job: jobView(db, db.prepare('SELECT * FROM rider_jobs WHERE id=?').get(jobId), riderId), order: view };
}

export function deliverJob(db, bus, jobId, riderId, { delivery_otp: deliveryOtp, cash_collected: cashCollected = false, system = false } = {}) {
  const job = ownJob(db, jobId, riderId);
  if (job.status !== 'picked_up') throw new AppError(409, 'JOB_NOT_PICKED_UP', `This job is ${job.status}.`);
  if (!system && !verifyDeliveryOtp(job.order_id, deliveryOtp || ''))
    throw new AppError(400, 'INVALID_DELIVERY_OTP', 'That delivery OTP does not match. Ask the customer for the OTP shown in their app.');
  const order = db.prepare('SELECT payment_method FROM orders WHERE id=?').get(job.order_id);
  if (order.payment_method === 'cod' && typeof cashCollected !== 'boolean')
    throw new AppError(400, 'INVALID_INPUT', 'cash_collected must be true or false for COD orders.');
  const view = markDelivered(db, bus, job.order_id, riderId, { cashCollected: order.payment_method === 'cod' ? cashCollected : false });
  return { job: jobView(db, db.prepare('SELECT * FROM rider_jobs WHERE id=?').get(jobId), riderId), order: view };
}

export function earnings(db, riderId) {
  riderProfile(db, riderId);
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const sum = since => db.prepare(`SELECT COUNT(*) AS deliveries, COALESCE(SUM(payout_minor),0) AS payout, COALESCE(SUM(tip_minor),0) AS tips,
    COALESCE(SUM(CASE WHEN cash_collected=1 THEN cash_to_collect_minor ELSE 0 END),0) AS cash_collected
    FROM rider_jobs WHERE rider_id=? AND status='delivered' AND delivered_at>=?`).get(riderId, since);
  const today = sum(dayStart.toISOString()), week = sum(weekStart.toISOString()), all = sum('1970-01-01T00:00:00.000Z');
  const map = row => ({
    deliveries: Number(row.deliveries), payout_minor: Number(row.payout), tips_minor: Number(row.tips),
    total_minor: Number(row.payout) + Number(row.tips), cash_collected_minor: Number(row.cash_collected)
  });
  return { today: map(today), week: map(week), all_time: map(all) };
}