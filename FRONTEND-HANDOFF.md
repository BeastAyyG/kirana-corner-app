# Frontend Handoff — coordination contract between the backend agent and Z code

Two agents work in this repo. This document is the contract between them. **Read it before touching any file.**

## Who owns what (file lanes)

| Lane | Owner | Paths |
|---|---|---|
| Backend v2 (delivery platform) | backend agent | `src/v2/**`, `src/server.js`, `src/db.js`, `src/app.js` (v1 backend), `test/**`, `scripts/**`, `docs/**`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.github/**`, `.env.example`, `package.json`, `README.md`, `AGENTS.md`, this file |
| Frontend | **Z code** | `public/**` (the v1 PWA), `tools/make-icons.mjs`, and any new frontend dirs (`apps/**` or similar) |

Rules:

1. **Never edit outside your lane.** If the frontend needs a backend change (new field, new endpoint, different error code), write the request in `docs/FRONTEND-REQUESTS.md` (Z code creates/appends; backend agent answers inline and implements). Do not patch `src/` yourself.
2. The backend agent does not edit `public/**`. One exception already made: a guard assertion in `test/app.test.js` was retargeted to `public/js/views/cart.js` after the module rewrite — tests may *read* frontend files to pin invariants, never write them.
3. `package.json` scripts are backend-owned; if the frontend needs a build step, request it via `docs/FRONTEND-REQUESTS.md` rather than editing.
4. Shared working tree: both agents may have uncommitted changes at once. **Stage only your lane's files** (`git add <paths>`), never `git add -A` / `git add .`. Check `git status` before committing.

## What the backend gives you

- **v1 pickup API** (`/api/v1/*`): unchanged, cookie sessions, powers the existing `public/` PWA. Do not break it.
- **v2 delivery API** (`/api/v2/*`): the Blinkit/BigBasket-style platform — customer, store-picker, rider, admin roles. Bearer tokens via phone OTP. Full contract: **[docs/03-API-REFERENCE.md](docs/03-API-REFERENCE.md)**. Screen-by-screen integration map: **[docs/05-APP-INTEGRATION-GUIDE.md](docs/05-APP-INTEGRATION-GUIDE.md)**.
- Research/parity notes (what Blinkit/BigBasket do and where each behaviour lives): [docs/01-VISION-AND-RESEARCH.md](docs/01-VISION-AND-RESEARCH.md).

## What to build (frontend scope)

Four v2 clients against `/api/v2`: **customer** (Blinkit-style instant delivery + BigBasket-style scheduled slots), **store picker**, **rider**, **admin**. The existing v1 pickup PWA in `public/` stays working. Suggested layout: `apps/customer/`, `apps/store/`, `apps/rider/`, `apps/admin/` (or route trees inside one app — your call). Stack is your choice; the repo's backend is zero-dependency Node 24 and the v1 frontend is vanilla ES modules — staying dependency-free matches the house style, but it is not a requirement.

## Dev workflow (per machine)

Prerequisites: Node.js ≥ 24 on PATH. No `npm install` needed (zero runtime deps).

```bash
npm run dev          # server on http://127.0.0.1:3000, auto-restart, seeds demo data
```

- Demo sign-in (dev): `POST /api/v2/auth/otp/request` returns `dev_code` — auto-fill it. Phones: customer `9000000021`, picker `9000000002`, rider `9000000011`, admin `9000000001` (full table in docs/03 §Demo accounts).
- Serving the frontend from another port (e.g. Vite on 5173): start the backend with `KIRANA_CORS_ORIGINS=http://localhost:5173 npm run dev`.
- Live order demo without a second device: after a rider accepts, `POST /api/v2/dev/orders/:id/simulate` walks the order to delivered in 30 s with SSE updates. Dev only — 404 in production.
- SSE: `new EventSource('/api/v2/events/stream?token=' + token)` (add `&order_id=` on tracking). Auto-reconnect built in.

## Verification before you call anything done

```bash
npm run check        # syntax + all 26 tests (v1 + v2)
npm run smoke        # boots a real server, runs the full delivery lifecycle (23 checks)
```

Both must pass. If a test pins frontend structure (currently: basket price-note ordering in `public/js/views/cart.js`), keep that invariant or coordinate a test update through `docs/FRONTEND-REQUESTS.md` — do not edit `test/**` directly.

## Git etiquette

- Work on a feature branch (`feat/…`); commit locally; **no push unless the user asks**.
- Commit messages: `feat: …`, `fix: …`, `docs: …` (conventional).
- Before committing: `git status` + stage only your lane. Secret-scan anything new (`.env` never committed; `.env.example` is the template).

## Current state (backend, verified)

- v2 backend complete: OTP auth, catalogue/search, serviceability, cart/quote/coupons, instant + scheduled checkout with idempotency, picker queue/short-picks, nearest-rider dispatch with offer expiry, pickup/delivery OTP handoffs, live location + ETA, COD + online payments (mock & Razorpay) + refunds, ratings, reorder, notifications, SSE, admin console APIs, audit log.
- 26/26 tests, 23/23 smoke checks, production guards verified live. Docker image build runs in CI (`.github/workflows/ci.yml`).
- Known deliberate boundaries (not bugs): maps are haversine-based (no map tiles API), push notifications are in-app + SSE only, Razorpay refunds are bookkept (issue actual refunds from the Razorpay dashboard).