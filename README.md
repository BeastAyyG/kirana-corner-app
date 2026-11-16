# Kirana Corner

A local sample-data prototype for grocery pickup with two role-specific screens: a shopper catalogue and a shopkeeper workspace. It uses a persistent SQLite database and a JSON API. The seeded shop and sign-in buttons are for testing only.

## Requirements

- Node.js 24 or newer (uses the built-in `node:sqlite` module)
- No third-party runtime packages

## Run locally

```sh
npm start
```

Open <http://127.0.0.1:3000>. The sample store is Saathi Kirana. Choose either sample account on the opening screen:

- Shopper: browse before sign-in, search or choose a neighbourhood shop, filter/sort products, inspect item details, save favorites, keep a persistent one-shop basket, review the order and pickup slot, place/track orders, update a nickname, cancel before packing, and repeat an order at current prices.
- Shopkeeper: switch among assigned shops, manage product details and shelf quantities, open/close the shop, set service days, closure dates, pickup point and 30-minute slot capacity, search/filter the pickup queue, pack orders, mark bags ready, and verify the shopper's pickup code at handoff.

Orders, reservations, catalogue changes, pickup settings, sessions, and audit events are stored in SQLite. The default database is `data/kirana.sqlite`; set `KIRANA_DB_PATH` to use another path. The shop uses `Asia/Kolkata` for its sample pickup times. There are no online payments; orders say “pay at store.”

## Tests

```sh
npm test
npm run check
```

Copy `.env.example` to `.env` only for local development and replace its sample values as needed. The example secret is not valid for production.

The tests exercise the HTTP API, sample sign-in, role/store permissions, order ownership, checkout idempotency, paise price snapshots, cancellation reservation release, seller state transitions and handoff-code validation, persistence across server restart, and concurrent stock/slot capacity limits.

## API outline

The API is under `/api/v1`:

- `GET /stores?q=` — active shops by name/neighbourhood
- `GET /stores/:storeId/products?q=&category=&in_stock=&min_price=&max_price=&sort=`
- `GET /stores/:storeId/products/:productId`
- `GET /stores/:storeId/pickup-slots?date=YYYY-MM-DD`
- `POST /orders` with `Idempotency-Key`
- `GET`/`PATCH /shopper/me` — nickname-only sample profile
- `GET`/`PUT /shopper/basket` — durable single-store basket
- `GET /shopper/me/orders` and `GET /orders/:orderId`
- `GET /shopper/me/saved-products`; `PUT`/`DELETE /shopper/me/saved-products/:productId`
- `POST /orders/:orderId/cancel`
- `GET`/`POST /seller/stores/:storeId/products`
- `PATCH /seller/products/:productId`
- `GET /seller/stores`; `PATCH /seller/stores/:storeId` — assigned-shop list and open/closed/pickup-point controls
- `GET /seller/stores/:storeId/orders?date=&status=&q=`
- `GET`/`PUT /seller/stores/:storeId/pickup-settings` — service days, closures, hours and capacity
- `POST /seller/orders/:orderId/start-packing`, `/mark-ready`, and `/complete-pickup`

Prices are stored as integer paise. Checkout reads current prices and stock in a transaction, creates immutable order-item snapshots, and reserves stock plus one slot place atomically. Permitted cancellation releases both; verified collection converts reserved inventory into sold inventory.

## Not production-ready

This project is a local prototype, not a production service. The sample-account sign-in intentionally allows anyone to act as the demo shopper or shopkeeper outside production mode. Setting `NODE_ENV=production` disables that route, but real identity, account recovery, deployment hardening, and launch policies still need to be implemented before real customers or sellers use it. Sample data remains in the database, and no real payment processing is present. Do not publish this prototype or put real customer data into it.

Production startup is blocked unless `KIRANA_PICKUP_CODE_SECRET` is set to a unique value of at least 32 characters; the built-in default is only for local sample data. Production deployment remains disabled until real shopper authentication and seller onboarding are implemented. This pilot does not collect shopper email/phone details; do not store real contact data until retention and deletion policies are defined. `HOST` and `PORT` set the listener (default `127.0.0.1:3000`).
