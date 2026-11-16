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

- Shopper: browse/search/category-filter the shelf, adjust a basket, choose a pickup time, place and track an order, or cancel before packing.
- Shopkeeper: add/hide products, adjust shelf quantities, set 30-minute pickup hours and capacity, pack orders, mark bags ready, and verify the shopper's pickup code at handoff.

Orders, reservations, catalogue changes, pickup settings, sessions, and audit events are stored in SQLite. The default database is `data/kirana.sqlite`; set `KIRANA_DB_PATH` to use another path. The shop uses `Asia/Kolkata` for its sample pickup times. There are no online payments; orders say “pay at store.”

## Tests

```sh
npm test
npm run check
```

The tests exercise the HTTP API, sample sign-in, role/store permissions, order ownership, checkout idempotency, paise price snapshots, cancellation reservation release, seller state transitions and handoff-code validation, persistence across server restart, and concurrent stock/slot capacity limits.

## API outline

The API is under `/api/v1`:

- `GET /stores`
- `GET /stores/:storeId/products?q=&category=`
- `GET /stores/:storeId/pickup-slots?date=YYYY-MM-DD`
- `POST /orders` with `Idempotency-Key`
- `GET /orders` and `GET /orders/:orderId`
- `POST /orders/:orderId/cancel`
- `GET`/`POST /seller/stores/:storeId/products`
- `PATCH /seller/products/:productId`
- `GET /seller/stores/:storeId/orders`
- `GET`/`PUT /seller/stores/:storeId/pickup-settings`
- `POST /seller/orders/:orderId/start-packing`, `/mark-ready`, and `/complete-pickup`

Prices are stored as integer paise. Checkout reads current prices and stock in a transaction, creates immutable order-item snapshots, and reserves stock plus one slot place atomically. Permitted cancellation releases both; verified collection converts reserved inventory into sold inventory.

## Not production-ready

This project is a local prototype, not a production service. The sample-account sign-in intentionally allows anyone to act as the demo shopper or shopkeeper outside production mode. Setting `NODE_ENV=production` disables that route, but real identity, account recovery, deployment hardening, and launch policies still need to be implemented before real customers or sellers use it. Sample data remains in the database, and no real payment processing is present. Do not publish this prototype or put real customer data into it.

The pickup-code secret can be supplied as `KIRANA_PICKUP_CODE_SECRET`; the built-in default is only suitable for local sample data. `HOST` and `PORT` set the listener (default `127.0.0.1:3000`).
