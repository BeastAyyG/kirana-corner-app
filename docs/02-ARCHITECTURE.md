# 02 — Architecture & Design Rationale

This is the full thought process behind the backend: the constraints we accepted, the decisions they forced, and the exact mechanics of money, stock, state, and real-time events.

## Constraints → decisions

| Constraint | Decision | Why |
|---|---|---|
| Repo philosophy: zero runtime dependencies, Node 24 | `node:http`, `node:sqlite` (DatabaseSync), `node:crypto`, `node:test` | No supply chain, no install step, Docker image is just `COPY` + `node` |
| Existing v1 pickup app must keep working | Additive `/api/v2` platform, separate database file | Zero regression risk; v1 cookie/demo auth untouched; v2 uses Bearer + OTP |
| One small team, one city pilot | Single process, SQLite in WAL mode | A single Node process handles thousands of orders/day; WAL gives concurrent readers + one writer |
| Money must never drift | Integer paise everywhere; one `computeBill` function | No floats; quote and checkout share the same math; order items are immutable snapshots |
| Stock must never oversell | `reserved ≤ on_hand` CHECK + conditional `UPDATE … WHERE on_hand-reserved>=?` inside `BEGIN IMMEDIATE` | The database enforces the invariant even under concurrent checkouts |
| Codes must be re-showable without storing plaintext | HMAC-derived delivery OTP (4 digits) and pickup code (6 chars) from `secret:kind:orderId`; only hashes stored | Customer can reopen the order and see the OTP again; a DB leak never reveals codes |
| Mobile apps need live updates without a socket stack | SSE over plain HTTP with an in-process EventBus | Works through proxies, auto-reconnects (`retry: 3000`), no dependency; topics map to authz scopes |
| Riders decline / go offline | Offer model with expiry + 10 s sweep + reassignment | No order is ever stranded on one rider; partial unique index guarantees one active job per order |

## Process topology

```
node src/server.js
├── HTTP server (node:http)
│   ├── /healthz, /readyz          → liveness / both DBs readable
│   ├── /api/v1/*                  → legacy pickup (cookie sessions, demo auth)
│   ├── /api/v2/*                  → delivery platform (Bearer tokens, OTP)
│   │   └── router.js → auth/catalog/cart/orders/store/rider/admin/payments
│   └── /*                         → static public/ (frontend lane)
├── v1 DB  data/kirana.sqlite          (WAL)
├── v2 DB  data/kirana-delivery.sqlite (WAL, migrations + seed-on-empty)
├── EventBus (SSE topics: user:<id>, order:<id>, store:<id>, rider:<id>)
└── 10 s sweep (unref): expire rider offers, retry awaiting orders, cancel stale pending payments
```

Graceful shutdown: SIGTERM/SIGINT stop the listener, close both DBs, force-exit after 5 s.

## Module map (`src/v2/`)

| File | Responsibility |
|---|---|
| `util.js` | AppError, ids, hashing/HMAC, config getters, phone/lat-lng validation, haversine, ETA, `tx()` |
| `db.js` | Migrations (schema_migrations), seed-on-empty, store/staff helpers, audit |
| `seed.js` | 12 categories, ~75 products × 2 stores, demo staff/riders/customer, 3 coupons |
| `auth.js` | OTP request/verify (console/MSG91/Twilio), rate limits, sessions, profile |
| `catalog.js` | Serviceability, stores, products/search/filters, addresses, saved items, delivery slots |
| `cart.js` | Single-store basket, item limits, `computeBill`, `quoteCart` |
| `promotions.js` | Coupon validation/discount/redemption/release |
| `payments.js` | Mock + Razorpay intents, capture, signed webhooks, refunds |
| `orders.js` | Checkout (idempotent), state machine, picking/packing/shortages, codes, tracking view, cancel/reorder/rate |
| `dispatch.js` | Nearest-rider offers, expiry sweep, retry awaiting orders |
| `rider.js` | Availability, location pings, job accept/decline/pickup/deliver, earnings |
| `store.js` | Queue, inventory adjustments, product CRUD, settings, metrics |
| `admin.js` | Network overview, stores/users/coupons CRUD, all-orders, audit log |
| `events.js` | EventBus (SSE), notifications outbox, order publishing |
| `router.js` | Route table, authz, rate limit (300/min/IP), CORS, SSE endpoint, dev simulator |

## Data model (v2)

- **Identity**: `users(role: customer|picker|rider|admin)`, `sessions(token_hash, expires)`, `otp_challenges(hashed code, attempts, expiry)`, `store_staff`, `riders(location, online, vehicle)`.
- **Catalogue**: `stores(lat/lng, radius, prep, fee config, surge)`, `categories`, `products(PK store_id+id, price≤mrp, reserved≤on_hand, aisle/shelf, max_per_order)`.
- **Customer state**: `addresses(snapshot source)`, `carts`/`cart_items`, `saved_products`.
- **Commerce**: `coupons`/`coupon_redemptions`, `delivery_slots(capacity, reserved_count)`, `orders(bill columns, address_snapshot, code hashes, timestamps per status)`, `order_items(price snapshot, picked_quantity, refunded_minor)`, `order_events`, `idempotency_keys(payload_hash, request_hash)`.
- **Fulfilment**: `rider_jobs(offer lifecycle, payout, tip, cash_to_collect/collected)`, `payments`, `refunds`.
- **Ops**: `notifications`, `audit_log`.

## State machines

### Order

```
placed → packing → packed → rider_assigned → picked_up → delivered
   └────────┴──────────┴──────────────┴─────────────→ cancelled
```

- `placed`: stock reserved, slot reserved (if scheduled), coupon redeemed. Online orders sit here with `payment_status=pending` until capture (15-min TTL, then auto-cancel).
- `packing`: picker started; items get `picked_quantity`.
- `packed`: picks finalized; shortages refund (online) or reduce COD due; dispatch offers a rider.
- `rider_assigned`: a rider accepted the job.
- `picked_up`: pickup code verified; `on_hand -= picked`, `reserved -= quantity` (invariant preserved because `picked ≤ quantity`).
- `delivered`: delivery OTP verified; COD marked collected; rider earnings settle.
- `cancelled`: customer while `placed`; staff/admin before `picked_up`. Releases stock, slot, coupon; cancels active job; refunds captured online payments.

### Payment

```
pending → paid → (partially_)refunded        online
pending → failed → (retry) → paid            online
cod_due → cod_collected                      COD (reduced by shortages)
```

### Rider job

```
offered → accepted → picked_up → delivered
   └→ declined / expired / cancelled   (order rolls to next rider)
```

A partial unique index (`order_id WHERE status IN active`) guarantees at most one live job per order while keeping the full offer history.

## Money flow (all integer paise)

```
items_total   = Σ snapshot_price × quantity
savings       = Σ (mrp − price) × quantity
delivery_fee  = base + per_km × distance      (0 if items_total ≥ free_above or coupon frees it)
handling_fee  = store constant (₹9)
surge_fee     = store surge when active
coupon        = flat | percent (capped) | free_delivery
grand_total   = items_total − coupon + delivery + handling + surge + tip
cod_due       = grand_total (COD) → reduced by shortage refunds → collected at door
```

Quote (`POST /cart/quote`) and checkout call the same `computeBill`; checkout additionally re-reads live prices/stock inside the transaction and rejects stale displayed prices (`PRICE_CHANGED`).

## Checkout transaction (the critical path)

1. Validate `Idempotency-Key` (16–128 chars). Compute `request_hash` from the raw request.
2. `BEGIN IMMEDIATE`:
   - Prior key with same `request_hash` → replay stored order (works even after the cart was cleared).
   - Prior key, different request → compare canonical `payload_hash`; mismatch → 409.
   - Resolve store (open + accepting), address (owned, within radius), items (active, `max_per_order`, stock, expected prices).
   - Validate + redeem coupon; book slot if scheduled (conditional capacity update).
   - Insert order + immutable item snapshots; reserve stock via conditional UPDATE; write event + idempotency row; clear cart.
3. `COMMIT`, then side effects: notify store staff (COD) or create payment intent (online); publish `order.placed`.

## Real-time (SSE)

`GET /api/v2/events/stream?token=…&order_id=…` (EventSource cannot set headers, so the token may ride the query string). Subscriptions are authorization-scoped:

- everyone: `user:<id>` (notifications)
- `order_id` param: only the customer, assigned rider, store staff, or admin
- picker: every assigned `store:<id>` (new-order bell)
- rider: `rider:<id>` (job offers)

Events: `hello`, `notification`, `order.placed`, `order.status`, `payment.captured`, `dispatch.offered`, `dispatch.awaiting_rider`, `rider.location`, `job.offered`, `job.expired`, `order.new`, `low_stock`. Heartbeat every 15 s; `retry: 3000` for reconnect.

## Security model

- Phone OTP (6 digits, HMAC-hashed, 5-min TTL, 5 sends/10 min, 30 s cooldown, 5 verify attempts). Customers auto-register; staff/rider/admin are provisioned by admin only.
- Sessions: 30-day random tokens, SHA-256 hashed at rest; suspension kills sessions.
- Role gates on every route; ownership checks on orders/addresses/jobs; store-membership checks on all store operations.
- Delivery OTP visible only to the customer while the order is active; pickup code only to staff/assigned rider/admin. Admin order lists never include the delivery OTP.
- Same-origin enforcement on v1 mutations; explicit CORS allowlist on v2; 300 req/min/IP; 1 MB body cap; parameterized SQL everywhere; CSP + nosniff on responses.
- Production guards: unique ≥32-char `KIRANA_SESSION_SECRET` and `KIRANA_PICKUP_CODE_SECRET` required at boot; console OTP, mock-payment confirm, demo sign-in, and the dev simulator are disabled.

## Scaling path (when the pilot outgrows one process)

1. **SQLite → Postgres**: the schema is plain SQL; swap `DatabaseSync` for a Postgres client behind the same helpers, keep `BEGIN IMMEDIATE` semantics as `SELECT … FOR UPDATE` on stock rows.
2. **SSE → Redis pub/sub**: EventBus is the only fan-out point; multiple API replicas subscribe to Redis channels instead of local topics.
3. **Dispatch → job queue**: the 10 s sweep becomes a delayed-queue worker (offer expiry, payment TTL) so timing survives restarts precisely.
4. **Haversine → road-network ETA**: `etaMinutes` and `haversineKm` are the two functions to replace with a maps provider.
5. **Notifications → FCM/APNs**: the `notifications` table is already an outbox; a worker drains it to push providers.
6. **Multi-city**: stores already carry their own fee/prep/radius config; add a city column and shard by region.