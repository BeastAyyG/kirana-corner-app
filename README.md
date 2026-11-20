# Kirana Corner — neighbourhood quick-commerce platform

A complete, deployable quick-commerce backend modelled on **Blinkit** (instant delivery) and **Big Basket** (scheduled slots), plus the original grocery-**pickup** app. Zero runtime dependencies: Node.js 24 built-ins only (`node:sqlite`, `node:http`, `node:crypto`, `node:test`).

It ships with two clients: a BigBasket-style **web PWA** (`public/`) and a **native Flutter Android app** (`kirana_mobile/`) — one app covering **customer, seller, rider and admin** behind a single phone-OTP login. See **[kirana_mobile/README.md](kirana_mobile/README.md)** for the mobile build/run guide.

Two APIs live side by side in one server:

| API | What it is | Auth | Clients |
|---|---|---|---|
| `/api/v1` | Grocery **pickup**: catalogue, basket, 30-min pickup slots, seller workspace, pay-at-store | cookie sessions (demo sign-in in dev) | the PWA in `public/` |
| `/api/v2` | **Delivery platform**: instant + scheduled delivery, picker ops, rider dispatch, payments, admin | phone OTP → bearer token | customer / store / rider / admin apps (frontend lane) |

## Quickstart

```sh
npm run dev        # http://127.0.0.1:3000 — seeds demo data, auto-restarts
```

Requires Node.js ≥ 24. No `npm install` — there are no dependencies.

- v1 pickup PWA: open <http://127.0.0.1:3000>, pick a demo account.
- v2 delivery API: sign in with `POST /api/v2/auth/otp/request {"phone":"9000000021"}` — dev returns `dev_code` — then `POST /api/v2/auth/otp/verify`. Demo phones: customer `9000000021`, picker `9000000002`, rider `9000000011`, admin `9000000001`.

## Native mobile app (Flutter)

`kirana_mobile/` is one Android app for all four roles. The account you sign in with decides the workspace (customer / seller / rider / admin) — no role picker, no separate apps. It is a native client of `/api/v2` and needs **no backend changes**.

```sh
npm run dev                 # 1. backend on :3000 (repo root, seeds demo data + console OTP)
cd kirana_mobile
flutter pub get             # 2. fetch app packages
flutter run                 # 3. run on an emulator/device (defaults to http://10.0.2.2:3000)
flutter build apk --release # 4. installable APK → build/app/outputs/flutter-apk/app-release.apk
```

Sign in with a demo phone (OTP auto-fills in dev): customer `9000000021`, seller `9000000002`, rider `9000000011`, admin `9000000001`. On a physical device, set the backend's LAN IP in-app (Account → Server URL). Full prerequisites, architecture, signing and troubleshooting: **[kirana_mobile/README.md](kirana_mobile/README.md)**.

## What the delivery platform does

- **Customer**: location serviceability with ETA promise, category catalogue + search + filters, persistent server-side cart, bill quote (delivery fee by distance, free-delivery threshold, handling fee, surge, coupons, tips), instant or scheduled-slot checkout with idempotency keys, COD or online payment, live order tracking (SSE + rider location + live ETA), 4-digit delivery OTP handoff, ratings, reorder, saved items, notifications.
- **Store (picker)**: realtime order queue, aisle-sorted pick lists, short-picks with automatic bill adjustment, pack → rider handoff via pickup code, inventory adjustments, catalogue/price management, store settings (hours, fees, radius, surge), daily metrics.
- **Rider**: online/offline toggle, nearest-rider job offers with expiry and auto-reassign, accept/decline, pickup-code verification, live location pings, delivery-OTP + cash-collection confirmation, earnings (payout + tips).
- **Admin**: overview dashboard, store/staff/rider provisioning, coupons, all-orders view with cancel + refund, audit log.
- **Platform**: integer-paise money with immutable order snapshots, transactional stock reservation, HMAC-signed payment webhooks (Razorpay + mock), OTP auth with rate limits (console / MSG91 / Twilio providers), SSE event bus, production boot guards, graceful shutdown.

Research and feature-parity mapping: [docs/01-VISION-AND-RESEARCH.md](docs/01-VISION-AND-RESEARCH.md).

## Verify

```sh
npm run check      # syntax + 26 tests (v1 pickup + v2 delivery platform)
npm run smoke      # boots a real server and runs the full delivery lifecycle — 23 checks
npm run seed       # print DB counts + demo phones
npm run backup     # safe live snapshots of both DBs (VACUUM INTO, keeps 14)
```

## Deploy

```sh
cp .env.example .env    # set both secrets (generator command inside), OTP + payment providers
docker compose up -d --build
curl -fsS localhost:3000/readyz
```

The image is `node:24-alpine`, non-root, with a `/data` volume and a `/readyz` healthcheck. CI (`.github/workflows/ci.yml`) runs the test suite, the smoke lifecycle, and a Docker build + boot probe on every push/PR. TLS reverse-proxy configs (Caddy/nginx with SSE-safe settings), systemd, backups, and incident playbooks: [docs/04-INFRASTRUCTURE.md](docs/04-INFRASTRUCTURE.md) and [docs/06-OPERATIONS-RUNBOOK.md](docs/06-OPERATIONS-RUNBOOK.md).

**Production guards (verified)**: boot fails without two distinct ≥32-char secrets; demo sign-in, mock payment confirm, and the dev simulator 404 in production; console OTP is blocked unless explicitly allowed; OTP codes are HMAC-hashed with send/attempt limits.

## Documentation

| Doc | Contents |
|---|---|
| [01 — Vision & Research](docs/01-VISION-AND-RESEARCH.md) | Blinkit/BigBasket reverse-engineering, parity matrix, deliberate boundaries |
| [02 — Architecture](docs/02-ARCHITECTURE.md) | decisions, module map, data model, state machines, money flow, scaling path |
| [03 — API Reference](docs/03-API-REFERENCE.md) | every v2 endpoint, request/response shapes, error codes, SSE events |
| [04 — Infrastructure](docs/04-INFRASTRUCTURE.md) | env vars, Docker, TLS proxies, systemd, providers, backups |
| [05 — App Integration Guide](docs/05-APP-INTEGRATION-GUIDE.md) | screen→API maps for all four clients |
| [06 — Operations Runbook](docs/06-OPERATIONS-RUNBOOK.md) | day-2 ops, incident playbooks, restore, secret rotation |
| [Mobile app guide](kirana_mobile/README.md) | Flutter prerequisites, run/build APK, role login, architecture, troubleshooting |
| [FRONTEND-HANDOFF.md](FRONTEND-HANDOFF.md) | two-agent coordination contract (backend ↔ Z code) |

## Honest boundaries

- Maps/ETA use haversine distance, not a road-network API; swap in Google/Mapbox at the marked seam when keys exist.
- Push notifications are in-app + SSE; FCM/APNs is a documented future seam.
- Razorpay order creation + webhook capture are real; refund money movement is issued from the Razorpay dashboard (the platform bookkeeps refund state).
- SQLite is the deliberate single-node choice; the Postgres/Redis scaling path is documented in 02.
- Seed data is fictional; no real customer data is collected.

## Repository layout

```
src/            v1 pickup backend + server entry
src/v2/         delivery platform (15 modules)
public/         web PWA (frontend lane — Z code): js/ v1 pickup SPA, apps/ v2 role apps, img/ generated pack
kirana_mobile/  native Flutter Android app — all four roles (see kirana_mobile/README.md)
test/           node:test suites (v1 + v2)
scripts/        smoke lifecycle, seed report, backup
docs/           the six documents above
design-assets/  generated imagery pack (reference/ is gitignored, study-only)
data/           SQLite databases (gitignored)
```

Working in this repo with another agent? Read [AGENTS.md](AGENTS.md) and [FRONTEND-HANDOFF.md](FRONTEND-HANDOFF.md) first.

## License

[MIT](LICENSE) — free to use, modify and redistribute. The backend is zero-dependency Node.js; the Flutter app's packages are pinned in `kirana_mobile/pubspec.yaml`. Seed data is fictional and the imagery pack is original/unbranded (no third-party marks).