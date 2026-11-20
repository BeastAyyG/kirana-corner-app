# 05 — App Integration Guide (for the frontend lane)

Four clients consume this backend. This guide maps every screen to its endpoints so the frontend agent (Z code) can build without reading backend code. Contract details: [03-API-REFERENCE.md](03-API-REFERENCE.md).

## Universal conventions

- **Base**: same origin `/api/v2` in production; `http://127.0.0.1:3000/api/v2` in dev (set `KIRANA_CORS_ORIGINS` if your dev server runs on another port).
- **Auth flow**: `POST /auth/otp/request {phone}` → user enters 6-digit code → `POST /auth/otp/verify {phone, code}` → store `token` securely → send `Authorization: Bearer <token>` on every call. In dev the response includes `dev_code` (auto-fill button). `401` anywhere → clear token, return to sign-in.
- **Money**: everything is paise. Display `₹(minor/100)` with `Intl.NumberFormat('en-IN')`. Never do float math on prices.
- **Errors**: show `message` from the error body; branch on `code` for recovery UX (e.g. `PRICE_CHANGED` → refresh cart and re-quote; `SLOT_FULL` → reload slots; `INSUFFICIENT_STOCK` → show `details.available`).
- **Realtime**: open `EventSource('/api/v2/events/stream?token=<token>')` after sign-in. Reconnect is automatic (`retry: 3000`). Pass `&order_id=` on the tracking screen. Treat SSE as a hint to refetch, not as the source of truth.
- **Idempotency**: generate one `Idempotency-Key` (e.g. `crypto.randomUUID()`) per checkout attempt and reuse it on retry. Never regenerate on retry.

## 1. Customer app (Blinkit-style)

| Screen | Endpoints | Notes |
|---|---|---|
| Splash / location gate | `POST /serviceability {lat,lng}` | Browser geolocation or manual pin. Not serviceable → waitlist copy. Store + ETA promise come from here. |
| Sign in | `/auth/otp/request`, `/auth/otp/verify` | 30 s resend cooldown (`resend_after_seconds`); show countdown. |
| Home | `GET /categories`, `GET /stores/:id/products?category=…` | Category rails; product cards show MRP strikethrough + `discount_percent`. |
| Search | `GET /stores/:id/search?q=` | Debounce 250 ms. |
| Category / listing | `GET /stores/:id/products?category=&in_stock=&sort=&page=` | Infinite scroll via `page`; filters: in-stock, price asc/desc, discount. |
| Product detail | `GET /stores/:id/products/:pid` | Unit, brand, description; add-to-cart stepper bounded by `max_per_order` and `available`. |
| Cart | `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:pid`, `DELETE /cart` | Server is the source of truth; optimistic steppers reconcile on response. `CART_STORE_CONFLICT` → "start new basket?" dialog. |
| Checkout | `POST /cart/quote` → `POST /orders` | Address picker (`GET/POST /addresses`), coupon sheet (`GET /coupons`), tip chips (₹10/20/30/custom ≤₹500), delivery instructions, COD vs online. Scheduled mode: `GET /stores/:id/delivery-slots` → pass `delivery_type:'scheduled', slot_id`. |
| Payment (online) | response `payment.client_payload` | mock: call `POST /payments/:id/confirm` (dev). razorpay: open Checkout with key + order id; result arrives via webhook → refetch order. |
| Order tracking | `GET /orders/:id` + SSE `?order_id=` | Status stepper (placed→packing→packed→rider_assigned→picked_up→delivered), rider card + live map pin from `rider.location`, `eta_live_minutes`, **delivery OTP big and bold** while active. |
| Orders list | `GET /orders?status=` | Reorder button → `POST /orders/:id/reorder` → cart. |
| Rating | `POST /orders/:id/rate` | After delivered; once. |
| Saved | `GET /saved`, `PUT/DELETE /saved/:storeId/:pid` | Heart toggle on cards. |
| Profile | `GET/PATCH /auth/me`, addresses CRUD, `POST /auth/logout` | |
| Notifications | `GET /notifications`, read/read-all | Bell badge; SSE `notification` events prepend. |

**Demo without a second device**: after a rider accepts, `POST /dev/orders/:id/simulate` moves the rider to the door in 30 s with live SSE updates (dev only).

## 2. Store app (picker / dark-store ops)

| Screen | Endpoints |
|---|---|
| Sign in | same OTP flow (picker phone) |
| Store switcher | `GET /store/stores` |
| Order queue (bell) | `GET /store/:id/queue` + SSE `order.new` | New-order sound/banner on SSE; unpaid online orders are hidden until captured. |
| Pick list | `GET /store/:id/orders/:oid` | Items sorted by **aisle/shelf**; customer name/phone; `POST …/start-packing` then per-item `POST …/items/:itemId/pick {picked_quantity}` (short-pick allowed). |
| Pack & handoff | `POST /store/orders/:id/pack` | Show shortage summary + adjusted COD; display **pickup_code** for the rider; SSE `dispatch.offered` confirms a rider is coming. |
| Inventory | `GET /store/:id/inventory?low=true`, `POST …/inventory/:pid/adjust {delta,reason}` | Low-stock badge ≤5; cannot adjust below reserved. |
| Catalogue | `POST /store/:id/products`, `PATCH /store/:id/products/:pid` | Price ≤ MRP enforced; aisle/shelf fields. |
| Settings | `GET/PUT /store/:id/settings` | Open/close, accepting orders, prep time, fees, surge toggle, radius, rider payout. |
| Metrics | `GET /store/:id/metrics` | Today's orders, GMV, avg pack minutes, shortage refunds, low-stock count. |
| Cancel | `POST /orders/:id/cancel {reason}` | Allowed until rider pickup. |

## 3. Rider app

| Screen | Endpoints |
|---|---|
| Sign in | OTP (rider phone) |
| Home / toggle | `GET /rider/me`, `POST /rider/availability {online}` | Big online/offline switch; going online may immediately offer a job (SSE `job.offered`). |
| Job offer | `GET /rider/jobs` + SSE | Countdown from `offered_at + KIRANA_RIDER_OFFER_SECONDS`; accept → `POST /rider/jobs/:id/accept`; decline → `POST …/decline`. |
| Active job | job view | Store address + **pickup_code**; navigate to store; `POST …/pickup {pickup_code}`. |
| En route | `POST /rider/location {lat,lng}` every ~5 s while active | Customer's map moves from these pings. |
| Delivery | `POST …/deliver {delivery_otp, cash_collected}` | Ask customer for 4-digit OTP; COD: confirm cash collected. |
| Earnings | `GET /rider/earnings` | Today / week / all-time: deliveries, payout, tips, cash collected. |

## 4. Admin console

| Screen | Endpoints |
|---|---|
| Dashboard | `GET /admin/overview` |
| Stores | `GET/POST /admin/stores`, `PATCH /admin/stores/:id` |
| Staff & riders | `GET /admin/users?role=`, `POST /admin/users`, `PATCH /admin/users/:id {active}` |
| Coupons | `GET/POST /admin/coupons`, `PATCH /admin/coupons/:code` |
| All orders | `GET /admin/orders?status=&store_id=`, `POST /admin/orders/:id/cancel` |
| Audit | `GET /admin/audit?limit=` |

## Suggested frontend structure (Z code's lane)

The existing `public/` PWA is the v1 pickup app. For the v2 delivery apps, keep them in separate directories (e.g. `apps/customer/`, `apps/store/`, `apps/rider/`, `apps/admin/`) or separate route trees — do not break the v1 app. Any stack is fine (the backend is stack-agnostic JSON); if you stay dependency-free like the backend, vanilla ES modules + a tiny router match the repo philosophy. See [FRONTEND-HANDOFF.md](../FRONTEND-HANDOFF.md) for coordination rules.