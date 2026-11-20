import { config, haversineKm, isoNow, newId } from './util.js';
import { getStore } from './db.js';
import { notify, publishOrder } from './events.js';

// Dispatch engine: auto-assign the nearest available rider when an order is packed.
// Offer model: rider must accept within KIRANA_RIDER_OFFER_SECONDS (default 60s),
// otherwise the offer expires and the next rider is tried.

export function activeJobCount(db, riderId) {
  return db.prepare(`SELECT COUNT(*) AS count FROM rider_jobs WHERE rider_id=? AND status IN ('offered','accepted','picked_up')`).get(riderId).count;
}

export function assignRider(db, bus, orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!order || order.status !== 'packed') return null;
  const existing = db.prepare(`SELECT * FROM rider_jobs WHERE order_id=? AND status IN ('offered','accepted','picked_up')`).get(orderId);
  if (existing) return existing;
  const store = getStore(db, order.store_id);
  const candidates = db.prepare(`SELECT r.*,u.name FROM riders r JOIN users u ON u.id=r.user_id
    WHERE r.is_online=1 AND r.active=1 AND u.active=1 AND r.lat IS NOT NULL`).all();
  const eligible = candidates
    .map(rider => ({ rider, distance: haversineKm(rider.lat, rider.lng, store.lat, store.lng), load: activeJobCount(db, rider.user_id) }))
    .filter(entry => entry.load < config.riderMaxActiveJobs())
    .filter(entry => !db.prepare(`SELECT 1 FROM rider_jobs WHERE order_id=? AND rider_id=? AND status IN ('declined','expired')`).get(orderId, entry.rider.user_id))
    .sort((a, b) => a.distance - b.distance || a.load - b.load);
  if (!eligible.length) {
    publishOrder(bus, orderId, 'dispatch.awaiting_rider', { order_id: orderId });
    return null;
  }
  const chosen = eligible[0].rider;
  const id = newId('job-'), now = isoNow();
  db.prepare(`INSERT INTO rider_jobs (id,order_id,rider_id,store_id,status,payout_minor,tip_minor,cash_to_collect_minor,offered_at,created_at,updated_at)
    VALUES (?,?,?,?, 'offered',?,?,?,?,?,?)`)
    .run(id, orderId, chosen.user_id, order.store_id, Number(store.rider_payout_minor), Number(order.tip_minor),
      order.payment_method === 'cod' ? Number(order.cod_due_minor) : 0, now, now, now);
  notify(db, bus, { userId: chosen.user_id, kind: 'job_offer', title: 'New delivery offer', body: `Pick up ${order.public_label} from ${store.name}.`, orderId });
  bus.publish(`rider:${chosen.user_id}`, 'job.offered', { job_id: id, order_id: orderId, store_id: order.store_id, payout_minor: Number(store.rider_payout_minor) });
  publishOrder(bus, orderId, 'dispatch.offered', { order_id: orderId, rider_id: chosen.user_id });
  return db.prepare('SELECT * FROM rider_jobs WHERE id=?').get(id);
}

export function sweepExpiredOffers(db, bus) {
  const cutoff = new Date(Date.now() - config.riderOfferSeconds() * 1000).toISOString();
  const expired = db.prepare(`SELECT * FROM rider_jobs WHERE status='offered' AND offered_at<?`).all(cutoff);
  for (const job of expired) {
    db.prepare(`UPDATE rider_jobs SET status='expired',ended_at=?,updated_at=? WHERE id=? AND status='offered'`).run(isoNow(), isoNow(), job.id);
    bus.publish(`rider:${job.rider_id}`, 'job.expired', { job_id: job.id, order_id: job.order_id });
    assignRider(db, bus, job.order_id);
  }
  return expired.length;
}

export function retryAwaitingOrders(db, bus) {
  const packed = db.prepare(`SELECT id FROM orders WHERE status='packed'`).all();
  for (const order of packed) assignRider(db, bus, order.id);
}