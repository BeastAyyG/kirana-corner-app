import { isoNow } from './util.js';

export class EventBus {
  constructor() { this.topics = new Map(); }
  subscribe(topic, subscriber) {
    if (!this.topics.has(topic)) this.topics.set(topic, new Set());
    this.topics.get(topic).add(subscriber);
    return () => {
      const set = this.topics.get(topic);
      if (set) { set.delete(subscriber); if (!set.size) this.topics.delete(topic); }
    };
  }
  publish(topic, event, data) {
    const set = this.topics.get(topic);
    if (!set) return 0;
    const payload = `event: ${event}\ndata: ${JSON.stringify({ event, topic, data, at: isoNow() })}\n\n`;
    for (const subscriber of [...set]) {
      try { subscriber.write(payload); } catch { set.delete(subscriber); }
    }
    return set.size;
  }
  get subscriberCount() {
    let total = 0;
    for (const set of this.topics.values()) total += set.size;
    return total;
  }
}

export function notify(db, bus, { userId, kind, title, body, orderId = null }) {
  const id = `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`INSERT INTO notifications (id,user_id,kind,title,body,order_id,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, userId, kind, title, body, orderId, isoNow());
  bus.publish(`user:${userId}`, 'notification', { id, kind, title, body, order_id: orderId });
  return id;
}

export function publishOrder(bus, orderId, event, data) {
  bus.publish(`order:${orderId}`, event, data);
}