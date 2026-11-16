# Kirana Corner — Frontend (v2)

A BigBasket-inspired, mobile-first PWA for both sides of the marketplace:

- **Shopper app** — browse, search, basket, pickup slots, orders, saved items, account.
- **Shopkeeper (Partner) app** — open/close the shop, pickup queue with bag handover codes, shelf stock management, pickup-hour settings.

Both live in one installable app and switch by role (sample sign-in or role chooser).

## Stack

- Vanilla ES modules, **no build step, no third-party runtime packages** (matches the backend's zero-dependency approach).
- Hash-based SPA router (`#/home`, `#/c/Vegetables`, `#/seller/orders`, …) — deep-linkable on any static host.
- Renders against the existing `/api/v1` JSON API (cookie session). To point the frontend at a different API origin, set `window.KIRANA_API_BASE` before `app.js` loads (e.g. via a small inline script or host-injected global).
- PWA: `manifest.webmanifest`, generated PNG/SVG icons, offline shell service worker (`sw.js`, version-bump on deploy). Installable on Android/iOS/desktop.

## Layout

```
public/
  index.html            app shell (header, outlet, tab bar)
  app.js                entry → js/main.js
  manifest.webmanifest  PWA manifest
  sw.js                 offline shell service worker
  css/base.css          design tokens + components (BigBasket-style greens #84c225/#a6ce39)
  css/views.css         shopper + seller view styles
  icons/                generated PNG icons + favicon.svg
  js/
    config.js           API base + brand
    api.js              typed /api/v1 wrapper (idempotency keys, typed errors)
    state.js            central store + pub-sub bus + basket persistence
    actions.js          all data loads/mutations (stores, catalog, slots, orders, seller ops, polling)
    router.js           hash router with per-view bus subscriptions
    ui.js               escape/SVG icons/toast/bottom sheets/cards/skeletons
    format.js           paise→₹ money, slot/order date labels, status text
    art.js              emoji product art as data URIs (CSP-safe, no external images)
    basket-ops.js       shared qty stepper logic
    main.js             shell chrome (headers/tab bars), routes, boot, SW registration
    views/…             12 shopper + 4 seller screens
tools/make-icons.mjs    regenerates public/icons (pure Node, no deps): node tools/make-icons.mjs
```

## Shopper screens

Welcome/sign-in (sample accounts) · Home (banners, category circles, deals rail, shelf rail, active-order strip) · Shop picker · Category PLP (grid, sort sheet, price chips, in-stock filter) · Product detail (similar items, add/stepper, save) · Search (recent searches, quick categories) · My Basket (steppers, price-change/stock warnings, today/tomorrow slot picker, bill, confirm-sheet checkout) · Orders (active/history) · Order detail (timeline, big pickup-code card, cancel, order again) · Saved items · Account (nickname, links, install app, sign out).

## Seller screens

Dashboard (open/close switch, pickup point editor, live stat tiles, quick actions) · Pickup queue (status tabs, search, date filter, start packing → bag-label sheet → mark ready → 8-char pickup-code handover) · Shelf stock (steppers, hide/show, edit/add sheets) · Pickup settings (hours, capacity, cutoff, service days, closure dates, reset demo).

Behaviors preserved from v1: guest browsing, one-shop basket with price snapshots, idempotent checkout, slot capacity, cancellation release, seller membership checks, 6-second quiet polling (paused while the tab is hidden), 401 handling.

## Run

```sh
npm start            # serves frontend + API on http://127.0.0.1:3000
```

## Deploy (mobile)

1. **Installable PWA (recommended):** deploy the whole app (or just `public/` + a reverse proxy to the API). HTTPS is required for install prompts. Visitors get "Install app" on Android/desktop; iOS via Share → Add to Home Screen. All assets are same-origin, CSP-safe (`script-src 'self'`, `img-src … data:` — the app never uses inline scripts/styles or external images).
2. **Static hosting:** `public/` is deployable as-is to any static host; set `window.KIRANA_API_BASE` to the API URL and add the API origin to the backend's CORS allow-list (`KIRANA_CORS_ORIGINS`). Note: cookie sessions require the API and frontend to share a registrable domain (or the backend agent's token-auth upgrade).
3. **App stores (optional):** the PWA wraps directly with Bubblewrap/TWA (Play Store) or Capacitor; no code changes needed.

Bump `VERSION` in `public/sw.js` (and `APP_VERSION` in `public/js/config.js`) on each release so clients pick up the new shell.

## Notes for the backend agent

- Everything the UI calls is in `public/js/api.js` — a single file to update if endpoint shapes change (v2 auth/notifications/payments can slot in there).
- The UI polls every 6 s; an SSE stream can replace it later by subscribing in `actions.js` (`startPolling` is the only place to touch).
- `src/v2/util.js` config (`KIRANA_CORS_ORIGINS`, session days) is already respected by the API wrapper's cookie flow.
