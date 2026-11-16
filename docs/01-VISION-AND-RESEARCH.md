# 01 — Vision & Reference Research

Kirana Corner is a neighbourhood quick-commerce platform: a customer app that feels like Blinkit, a store app that runs a dark store, a rider app that runs last-mile delivery, and an admin console that runs the network. This document records what we reverse-engineered from the two reference products and how each behaviour maps to the v2 backend.

## References studied

- **Blinkit** (instant delivery, ~10 minutes): dark-store model, small delivery radius, inventory-led catalogue, aisle/shelf picking, single-order pick-and-pack, nearest-rider dispatch, live order tracking, delivery OTP, COD + online payments, fee stack (delivery + handling + surge), free-delivery threshold, coupons, rider tips, ratings, one-tap reorder.
- **Big Basket** (classic + bbnow): scheduled delivery slots with capacity and cutoff, persistent basket, slot-first checkout, wider catalogue browsing by category, order history and repeat.

Sources consulted (public engineering/product write-ups and official pages):

- [Blinkit — official site](https://blinkit.com/)
- [Blinkit partner / store onboarding](https://blinkit.com/partner)
- [Quick commerce architecture overview (LinkedIn engineering write-up)](https://www.linkedin.com/pulse/quick-commerce-apps-like-blinkit-zepto-instamart-actually-work/)
- [Dark store operations guide (Brineweb)](https://brineweb.com/blog/dark-store-quick-commerce/)
- [Real-time UX in quick commerce (Shyam Future)](https://www.shyamfuture.com/blog/quick-commerce-app-development/)
- [Blinkit case study (Cognitute)](https://cognitute.org/blinkit-case-study/)
- [Quick commerce app development (iCoderz)](https://www.icoderzsolutions.com/blog/quick-commerce-app-development/)
- [Dark store logistics (3SC)](https://3scsolution.com/dark-stores-quick-commerce/)
- [Big Basket — official site](https://www.bigbasket.com/)

## Reverse-engineered model

### Blinkit: the instant loop

1. **Serviceability first.** The app resolves the customer's location to exactly one dark store (nearest, open, within ~2–3 km). Everything downstream — catalogue, stock, fees, ETA — is store-scoped. There is no marketplace ambiguity.
2. **Inventory-led catalogue.** Products are the store's own stock, with MRP strikethrough, unit ("500 g"), and availability. Search and category rails are the primary navigation.
3. **Promise before checkout.** ETA is computed from store prep time + travel time at a city-average speed, shown as a range ("10–14 min").
4. **Bill transparency.** Item total (with savings vs MRP), delivery fee (distance-based, waived above a threshold), handling fee, surge when demand is high, coupon discount, optional rider tip. All integer money.
5. **Pick-and-pack with shortages.** A picker walks aisle/shelf locations, marks actual picked quantities, and the bill adjusts automatically (COD due drops; online payments refund the difference).
6. **Dispatch as offers.** The nearest online rider gets a time-boxed offer; decline/timeout rolls to the next rider. Riders carry at most a couple of active jobs.
7. **Trust handoffs.** Pickup code at the store counter, delivery OTP at the door. COD cash is reconciled per job.
8. **Live tracking.** Rider location pings drive a live ETA; every status change is pushed to the customer in real time.

### Big Basket: the scheduled loop

1. **Slot-first checkout.** The customer picks a delivery window (e.g. 07:00–09:00) with visible remaining capacity; same-day slots close ~60 minutes before the window.
2. **Durable basket.** The basket survives sessions and devices; it is always single-store.
3. **Category depth.** A dozen aisles, filters (in-stock, price), sorting (price, discount), and pagination.

## Feature parity matrix

| Reference behaviour | v2 implementation | Where |
|---|---|---|
| Location → one dark store | `POST /serviceability` (nearest open store within radius) | `catalog.js` |
| 10-min promise, range | `etaMinutes = max(8, prep + km/18*60 + 2)`, range `[eta, eta+4]` | `util.js`, `catalog.js` |
| Scheduled 2-hour slots, capacity, cutoff | `delivery_slots` (7 windows/day, capacity 20, 60-min cutoff, today+2) | `catalog.js` |
| Inventory-led catalogue, MRP savings | `products` per store, `price ≤ mrp` CHECK, `discount_percent` | `db.js`, `catalog.js` |
| Search / category / filters / sort / pages | `GET /stores/:id/products`, `/search` | `catalog.js` |
| Persistent single-store basket | `carts` + `cart_items`, `CART_STORE_CONFLICT` | `cart.js` |
| Bill: delivery + handling + surge + coupon + tip | `computeBill` (single source of money math) | `cart.js` |
| Free delivery above ₹199 / FREESHIP coupon | store `free_above_minor`, coupon `free_delivery` | `cart.js`, `promotions.js` |
| Coupons: flat / percent / free-delivery, per-user limits | `coupons`, `coupon_redemptions`, release on cancel | `promotions.js` |
| COD + online (Razorpay adapter, mock dev) | `payments`, signed webhooks, refunds | `payments.js` |
| Idempotent checkout | `Idempotency-Key` + request/payload hashes | `orders.js` |
| Price-change guard at checkout | `expected_price_minor` → `PRICE_CHANGED` | `orders.js` |
| Aisle/shelf picking, shortage refunds | `pickItem`, `packOrder` (picked_quantity, refunded_minor) | `orders.js`, `store.js` |
| Nearest-rider offers, decline/expire rollover | `rider_jobs` offer model + 10 s sweep | `dispatch.js` |
| Pickup code + delivery OTP | HMAC-derived codes, hashes stored, role-gated views | `orders.js` |
| Live rider location + ETA | `POST /rider/location`, SSE `rider.location` | `rider.js`, `events.js` |
| Real-time status push | SSE `/events/stream` (user/order/store/rider topics) | `events.js`, `router.js` |
| Ratings, reorder, saved items | `rateOrder`, `reorder`, `saved_products` | `orders.js`, `catalog.js` |
| Rider earnings (payout + tips, COD cash) | `GET /rider/earnings` | `rider.js` |
| Store metrics (GMV, pack time, low stock) | `GET /store/:id/metrics` | `store.js` |
| Network ops (stores, staff, coupons, audit) | `/admin/*` | `admin.js` |

## Deliberate boundaries (not faked, not half-built)

- **Maps**: distance/ETA use haversine at a configurable average speed. A real maps/roads API is an integration point, not a stub — see `02-ARCHITECTURE.md` scaling path.
- **Payments**: Razorpay is wired for real order creation + webhook verification; the mock provider exists only for development and is disabled in production.
- **SMS OTP**: MSG91 and Twilio Verify adapters are real code paths; the console provider is development-only and blocked in production unless explicitly allowed for staging.
- **Push notifications**: in-app notifications + SSE are implemented; APNs/FCM push is a future integration (the notifications table is the outbox).
- **No real customer data in seeds**: all demo accounts use the reserved `+9190000000xx` range.