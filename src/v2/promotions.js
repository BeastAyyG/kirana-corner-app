import { AppError, isoNow, newId } from './util.js';

export function couponView(row) {
  return {
    id: row.id, code: row.code, description: row.description, type: row.type,
    value: row.value, min_order_minor: row.min_order_minor, max_discount_minor: row.max_discount_minor,
    starts_at: row.starts_at, ends_at: row.ends_at, active: Boolean(row.active)
  };
}

export function listAvailableCoupons(db, userId) {
  const now = isoNow();
  return db.prepare('SELECT * FROM coupons WHERE active=1 AND starts_at<=? AND ends_at>=? ORDER BY code').all(now, now)
    .filter(c => c.used_count < c.usage_limit)
    .filter(c => db.prepare('SELECT COUNT(*) AS count FROM coupon_redemptions WHERE coupon_id=? AND user_id=?').get(c.id, userId).count < c.per_user_limit)
    .map(couponView);
}

export function validateCoupon(db, code, userId, itemsTotal) {
  if (!code) return null;
  const coupon = db.prepare('SELECT * FROM coupons WHERE code=? AND active=1').get(String(code).trim().toUpperCase());
  if (!coupon) throw new AppError(400, 'COUPON_INVALID', 'That coupon code does not exist.');
  const now = isoNow();
  if (coupon.starts_at > now || coupon.ends_at < now) throw new AppError(400, 'COUPON_EXPIRED', 'That coupon is not active right now.');
  if (itemsTotal < coupon.min_order_minor)
    throw new AppError(400, 'COUPON_MIN_ORDER', `Add items worth ₹${Math.ceil((coupon.min_order_minor - itemsTotal) / 100)} more to use ${coupon.code}.`, { min_order_minor: coupon.min_order_minor });
  if (coupon.used_count >= coupon.usage_limit) throw new AppError(400, 'COUPON_EXHAUSTED', 'That coupon has reached its usage limit.');
  const used = db.prepare('SELECT COUNT(*) AS count FROM coupon_redemptions WHERE coupon_id=? AND user_id=?').get(coupon.id, userId).count;
  if (used >= coupon.per_user_limit) throw new AppError(400, 'COUPON_ALREADY_USED', `You have already used ${coupon.code}.`);
  return coupon;
}

export function couponDiscount(coupon, itemsTotal, deliveryFee) {
  if (!coupon) return { discount_minor: 0, free_delivery: false };
  if (coupon.type === 'free_delivery') return { discount_minor: 0, free_delivery: true };
  if (coupon.type === 'flat') return { discount_minor: Math.min(coupon.value, itemsTotal), free_delivery: false };
  const raw = Math.floor(itemsTotal * coupon.value / 100);
  return { discount_minor: Math.min(raw, coupon.max_discount_minor || raw, itemsTotal), free_delivery: false };
}

export function redeemCoupon(db, coupon, userId, orderId) {
  if (!coupon) return;
  db.prepare('UPDATE coupons SET used_count=used_count+1 WHERE id=? AND used_count<usage_limit').run(coupon.id);
  db.prepare('INSERT INTO coupon_redemptions (id,coupon_id,user_id,order_id,created_at) VALUES (?,?,?,?,?)')
    .run(newId('red-'), coupon.id, userId, orderId, isoNow());
}

export function releaseCoupon(db, orderId) {
  const redemption = db.prepare('SELECT * FROM coupon_redemptions WHERE order_id=?').get(orderId);
  if (!redemption) return;
  db.prepare('DELETE FROM coupon_redemptions WHERE order_id=?').run(orderId);
  db.prepare('UPDATE coupons SET used_count=MAX(0,used_count-1) WHERE id=?').run(redemption.coupon_id);
}