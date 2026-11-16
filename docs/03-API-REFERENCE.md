# 03 — API Reference (v2 Delivery Platform)

Base URL: `/api/v2`. All bodies are JSON. Money is integer **paise** (`*_minor`). Timestamps are ISO-8601 UTC. Phones normalize to `+91XXXXXXXXXX` (Indian mobile, starts 6–9).

**Auth**: `Authorization: Bearer <token>` from OTP verify. For SSE only, `?token=` is accepted. Roles: `customer`, `picker`, `rider`, `admin`.

**Errors**: `{ "code": "MACHINE_CODE", "message": "Human readable", "details"?: {...} }` with HTTP 400/401/403/404/409/413/429/500.

**Rate limit**: 300 requests/min/IP → `429 RATE_LIMITED`. **CORS**: set `KIRANA_CORS_ORIGINS`.

---

## Public

### POST /auth/otp/request
`{ "phone": "9000000021" }` → `{ challenge_id, phone, expires_at, resend_after_seconds, dev_code? }`
`dev_code` appears only in development. Limits: 5 sends/10 min (`OTP_RATE_LIMITED`), 30 s cooldown (`OTP_COOLDOWN`).

### POST /auth/otp/verify
`{ "phone", "code" }` → `{ token, user }`. Customers auto-register; staff roles must be pre-provisioned. Errors: `OTP_INCORRECT`, `OTP_EXPIRED`, `OTP_ATTEMPTS_EXCEEDED`, `ACCOUNT_SUSPENDED`.

### GET /categories
→ `{ categories: [{ id, name, sort_order }] }` (12 aisles).

### GET /stores
→ `{ stores: [publicStore] }` (active only).

### POST /serviceability
`{ "lat": 12.939, "lng": 77.621 }` → `{ serviceable, store?, distance_km?, eta_minutes?, eta_range?, promise? }`
Nearest open, accepting store within its radius. `promise` is the customer-facing text.

### GET /stores/:storeId/products
Query: `q`, `category`, `in_stock=true`, `sort=price_asc|price_desc|discount|name`, `page` (1-based), `page_size` (default 40, max 100).
→ `{ products: [product], page, page_size, total }`. Public product: `{ id, store_id, category_id, name, brand, unit, description, image_url, mrp_minor, price_minor, discount_percent, available, max_per_order, active, updated_at }` — never exposes `on_hand`.

### GET /stores/:storeId/products/:productId
→ `{ product }`.

### GET /stores/:storeId/search?q=
→ `{ products }` (name/brand match, ranked).

### GET /stores/:storeId/delivery-slots?date=YYYY-MM-DD
→ `{ slots: [{ id, slot_date, starts_at, ends_at, label, capacity, remaining, bookable }] }`
Seven 2-hour windows 07:00–21:00 IST, today + 2 days, 60-minute cutoff, capacity 20.

### POST /payments/webhook/:provider
Providers: `mock`, `razorpay`. Raw body signed with `x-kirana-signature` (mock, HMAC of raw body with session secret) or `x-razorpay-signature` (Razorpay webhook secret). Events: `payment.captured`, `payment.failed`. Bad signature → 401.

---

## Any authenticated role

| Endpoint | Behaviour |
|---|---|
| `GET /auth/me` | `{ user }` |
| `PATCH /auth/me` | `{ name? }` → `{ user }` |
| `POST /auth/logout` | revokes the token |
| `GET /notifications` | latest 100, `{ notifications: [{ id, kind, title, body, order_id, read, created_at }] }` |
| `POST /notifications/:id/read` / `POST /notifications/read-all` | mark read |
| `GET /events/stream?order_id=&token=` | SSE — see below |

### SSE events
`hello`, `notification`, `order.placed`, `order.status` (`{order_id, status, shortages?}`), `payment.captured`, `dispatch.offered`, `dispatch.awaiting_rider`, `rider.location` (`{order_id, lat, lng, at}`), `job.offered`, `job.expired`, `order.new` (store), `low_stock` (store). Heartbeat comment every 15 s; `retry: 3000`.

---

## Customer

### Addresses
- `GET /addresses` → `{ addresses }` (max 10; `full_address` computed)
- `POST /addresses` `{ label, receiver_name, receiver_phone, line1, line2?, landmark?, city, pincode, lat, lng, is_default? }` → 201 `{ address }`
- `PATCH /addresses/:id` (any subset) → `{ address }`
- `DELETE /addresses/:id` → `{ deleted: true }` (default reassigns to newest)

### Cart (single store, ≤60 lines)
- `GET /cart` → `{ cart: { store_id, items: [{ product_id, quantity, product }], updated_at } }`
- `PUT /cart` `{ store_id, items: [{product_id, quantity}] }` → replace
- `DELETE /cart` → empty
- `POST /cart/items` `{ store_id, product_id, quantity }` → add (409 `CART_STORE_CONFLICT` across stores; 400 `MAX_PER_ORDER`, `INSUFFICIENT_STOCK`)
- `PATCH /cart/items/:productId` `{ quantity }` (0 removes)

### POST /cart/quote
`{ address_id, coupon_code?, tip_minor?, delivery_type?, slot_id? }` →
```json
{ "quote": { "store": {...}, "address": {...}, "delivery_type": "instant",
  "items": [...], "bill": { "items_total_minor", "savings_minor", "delivery_fee_minor",
    "handling_fee_minor", "surge_fee_minor", "tip_minor", "coupon_discount_minor",
    "grand_total_minor", "amount_to_free_delivery_minor" },
  "eta_minutes", "eta_range", "payment_methods": ["cod","online"] } }
```

### GET /coupons
→ `{ coupons }` usable by this customer now.

### Saved items
`GET /saved`, `PUT /saved/:storeId/:productId`, `DELETE /saved/:storeId/:productId`.

### POST /orders  (checkout)
Headers: **`Idempotency-Key: <16–128 chars [A-Za-z0-9._~-]>`** (required).
Body: `{ address_id, payment_method: "cod"|"online", coupon_code?, tip_minor? (≤50000), delivery_instructions? (≤240), delivery_type?: "instant"|"scheduled", slot_id?, items?, store_id? }`
Omit `items` to checkout the server cart. With `items`, each may carry `expected_price_minor` → 409 `PRICE_CHANGED` if stale.
→ 201 `{ order, payment?, replayed? }`. Online: `payment = { payment_id, provider, amount_minor, client_payload }` (mock: `confirm_via`; razorpay: key/order id for Checkout).
Errors: `EMPTY_CART`, `MIN_ORDER`, `STORE_CLOSED`, `OUT_OF_RANGE`, `INSUFFICIENT_STOCK`, `PRODUCT_UNAVAILABLE`, `SLOT_UNAVAILABLE`, `SLOT_FULL`, `COUPON_*`, `IDEMPOTENCY_KEY_REUSED`.

### Orders
- `GET /orders?status=` → `{ orders }` (newest first)
- `GET /orders/:id` → `{ order }` — full view: bill, items (with picked/refunded), events, address snapshot, store, `slot?`, `rider?` (name/phone/vehicle + `location` + `eta_live_minutes` while active), `delivery_otp` (customer only, while active), `pickup_code` (staff/rider/admin only)
- `POST /orders/:id/cancel` `{ reason? }` — customer: only while `placed` (else 409 `CANCELLATION_CLOSED`)
- `POST /orders/:id/reorder` → `{ cart }` refilled at current prices/stock
- `POST /orders/:id/rate` `{ rating: 1..5, comment? }` — delivered orders, once (409 `ALREADY_RATED`)
- `POST /orders/:id/pay` → new payment intent for pending/failed online orders

### POST /payments/:paymentId/confirm
Development-only mock capture → `{ payment_id, order_id, payment_status: "paid" }`. 404 in production.

---

## Picker (store staff)

| Endpoint | Behaviour |
|---|---|
| `GET /store/stores` | assigned stores |
| `GET /store/:id/queue?status=&q=` | payment-ready orders, pending-payment first; search by label/phone |
| `GET /store/:id/orders/:orderId` | staff order view (customer info, aisle/shelf, pickup_code) |
| `POST /store/orders/:id/start-packing` | placed → packing (requires paid/cod_due) |
| `POST /store/orders/:id/items/:itemId/pick` | `{ picked_quantity }` (0..quantity) |
| `POST /store/orders/:id/pack` | finalize picks → packed; shortages refund/reduce COD; dispatch rider |
| `GET /store/:id/inventory?low=true` | staff products (on_hand/reserved/aisle/shelf); `low` = available ≤5 |
| `POST /store/:id/inventory/:pid/adjust` | `{ delta, reason }` (cannot go below reserved) |
| `POST /store/:id/products` | create product (full fields) |
| `PATCH /store/:id/products/:pid` | update any product fields |
| `GET /store/:id/settings` / `PUT` | open/close, accepting_orders, prep time, fees, surge, radius, payout |
| `GET /store/:id/metrics` | today orders/GMV/avg pack minutes/shortage refunds/low-stock count |
| `POST /orders/:id/cancel` | staff cancel before picked_up |

---

## Rider

| Endpoint | Behaviour |
|---|---|
| `GET /rider/me` | profile + home store + online state |
| `POST /rider/availability` | `{ online: true\|false }` (going online retries awaiting orders) |
| `POST /rider/location` | `{ lat, lng }` → publishes `rider.location` to active order streams |
| `GET /rider/jobs?status=` | offered/accepted/picked_up/delivered history; accepted jobs include `pickup_code` |
| `POST /rider/jobs/:id/accept` | offered → accepted (409 `JOB_EXPIRED`); order → rider_assigned |
| `POST /rider/jobs/:id/decline` | rolls offer to next nearest rider |
| `POST /rider/jobs/:id/pickup` | `{ pickup_code }` → picked_up (inventory settles) |
| `POST /rider/jobs/:id/deliver` | `{ delivery_otp, cash_collected? }` → delivered; COD settles |
| `GET /rider/earnings` | `{ today, week, all_time }` each `{ deliveries, payout_minor, tips_minor, total_minor, cash_collected_minor }` |

---

## Admin

| Endpoint | Behaviour |
|---|---|
| `GET /admin/overview` | today orders by status, GMV, avg delivery minutes, riders online, stores open, users by role, pending payments |
| `GET/POST /admin/stores`, `PATCH /admin/stores/:id` | network store CRUD (fees, radius, prep, payout, active) |
| `GET /admin/users?role=`, `POST /admin/users` | list / provision staff: `{ phone, name, role: picker\|rider\|admin, store_id? \| home_store_id? }` |
| `PATCH /admin/users/:id` | `{ active }` — suspension kills sessions; cannot suspend self |
| `GET/POST /admin/coupons`, `PATCH /admin/coupons/:code` | coupon CRUD |
| `GET /admin/orders?status=&store_id=` | all orders (no delivery OTP exposure) |
| `POST /admin/orders/:id/cancel` | ops cancel before picked_up, refunds apply |
| `GET /admin/audit?limit=` | audit trail |

---

## Dev tools (non-production only)

`POST /dev/orders/:id/simulate` — customer or admin; requires an accepted job. Moves the rider store→door over 30 one-second ticks, auto-pickup at tick 3, auto-deliver at tick 30 (system bypass of codes). → `{ started, order_id, duration_seconds }`. Use it to demo live tracking without a second device.

---

## Demo accounts (seeded, development)

| Role | Phone | Notes |
|---|---|---|
| customer | +919000000021 | has default address `addr-demo-home` (Koramangala) |
| picker | +919000000002 | Saathi Kirana — Koramangala |
| picker | +919000000003 | Saathi Kirana — HSR |
| rider | +919000000011 | Arjun, Koramangala |
| rider | +919000000012 | Meena, Koramangala |
| rider | +919000000013 | Vikram, HSR |
| admin | +919000000001 | full network |

OTP codes print to the server console in development (`[otp] +91… -> 123456`) and ride along as `dev_code` in the request response.