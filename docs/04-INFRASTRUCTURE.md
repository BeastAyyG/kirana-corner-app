# 04 — Infrastructure & Deployment

## What ships

| Artifact | Purpose |
|---|---|
| `Dockerfile` | `node:24-alpine`, non-root `node` user, `/data` volume, built-in `/readyz` healthcheck. No install step (zero dependencies). |
| `docker-compose.yml` | One service + named volume `kirana-data`, production env, 15 s stop grace. |
| `.github/workflows/ci.yml` | On push/PR: `npm run check` (syntax + 26 tests), `scripts/smoke.mjs` (23-check live lifecycle), Docker build + container readiness probe. |
| `.env.example` | Every supported variable, grouped, with safe defaults. |
| `scripts/seed.mjs` | Provision/migrate databases; prints demo accounts. |
| `scripts/backup.mjs` | `VACUUM INTO` snapshots of both DBs (safe on live WAL), keeps last 14. |
| `scripts/smoke.mjs` | Boots the real server and drives a full order lifecycle over HTTP; exits non-zero on any failure. |

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | development | `production` enables all guards below |
| `HOST` / `PORT` | 127.0.0.1 / 3000 | Container sets 0.0.0.0:3000 |
| `KIRANA_DB_PATH` | data/kirana.sqlite | v1 pickup DB |
| `KIRANA_V2_DB_PATH` | data/kirana-delivery.sqlite | v2 delivery DB |
| `KIRANA_V2_SKIP_SEED` | unset | `true` = schema only, no demo data |
| `KIRANA_PICKUP_CODE_SECRET` | dev default | **Required ≥32 unique chars in production** (v1) |
| `KIRANA_SESSION_SECRET` | dev default | **Required ≥32 unique chars in production** (v2 sessions, OTP hashing, derived codes, mock webhook signing) |
| `KIRANA_OTP_PROVIDER` | console | `console` \| `msg91` \| `twilio` |
| `KIRANA_ALLOW_CONSOLE_OTP` | unset | `true` permits console OTP in production (staging only) |
| `KIRANA_OTP_DEV` | non-production | `true` returns `dev_code` in OTP responses |
| `KIRANA_MSG91_AUTHKEY` / `KIRANA_MSG91_TEMPLATE_ID` | — | MSG91 SMS OTP |
| `KIRANA_TWILIO_ACCOUNT_SID` / `KIRANA_TWILIO_AUTH_TOKEN` / `KIRANA_TWILIO_VERIFY_SERVICE_SID` | — | Twilio Verify |
| `KIRANA_SESSION_DAYS` | 30 | Bearer token lifetime |
| `KIRANA_COOKIE_SECURE` | unset | `true` adds Secure to v1 cookies (HTTPS) |
| `KIRANA_PAYMENT_PROVIDER` | mock | `mock` (dev) \| `razorpay` |
| `KIRANA_RAZORPAY_KEY_ID` / `KIRANA_RAZORPAY_KEY_SECRET` | — | Razorpay Orders API |
| `KIRANA_RAZORPAY_WEBHOOK_SECRET` | — | Verifies `x-razorpay-signature` |
| `KIRANA_RIDER_OFFER_SECONDS` | 60 | Offer expiry before rollover |
| `KIRANA_RIDER_MAX_ACTIVE_JOBS` | 2 | Rider load cap |
| `KIRANA_AVG_SPEED_KMPH` | 18 | ETA model speed |
| `KIRANA_CORS_ORIGINS` | empty | Comma-separated allowlist for browser apps on other origins |

Generate secrets: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` — use a **different** value for each secret.

## Deploy with Docker (single VM)

```sh
cp .env.example .env
# edit .env: set both secrets, KIRANA_OTP_PROVIDER, KIRANA_PAYMENT_PROVIDER
docker compose up -d --build
curl http://127.0.0.1:3000/readyz     # {"ok":true,"databases":["pickup","delivery"]}
```

Data persists in the `kirana-data` volume. Update = `docker compose up -d --build` (migrations run automatically at boot; shutdown is graceful).

### TLS reverse proxy (required for real users)

Caddy example (`/etc/caddy/Caddyfile`):

```
kirana.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

nginx equivalent: proxy_pass to 127.0.0.1:3000, and for SSE set `proxy_buffering off; proxy_read_timeout 3600s;` on `/api/v2/events/stream`. The app already sends `x-accel-buffering: no`.

Set `KIRANA_COOKIE_SECURE=true` when serving v1 over HTTPS. v2 Bearer tokens are transport-agnostic but must only travel over TLS in production.

## Deploy without Docker

Node 24+, `npm start` under a process manager (systemd/PM2). Example systemd unit:

```ini
[Unit]
Description=Kirana Corner
After=network.target

[Service]
WorkingDirectory=/opt/kirana-corner-app
EnvironmentFile=/opt/kirana-corner-app/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
User=kirana

[Install]
WantedBy=multi-user.target
```

## Provider integration

- **MSG91**: create an OTP template, set `KIRANA_OTP_PROVIDER=msg91`, `KIRANA_MSG91_AUTHKEY`, `KIRANA_MSG91_TEMPLATE_ID`. The adapter sends `##OTP##` variable style requests.
- **Twilio Verify**: create a Verify service, set the three `KIRANA_TWILIO_*` vars and `KIRANA_OTP_PROVIDER=twilio`. Request → Twilio sends SMS; verify → VerificationCheck.
- **Razorpay**: set `KIRANA_PAYMENT_PROVIDER=razorpay` + key id/secret. Checkout creates a real Razorpay Order; the client opens Razorpay Checkout with `client_payload`. Configure a webhook to `POST /api/v2/payments/webhook/razorpay` for `payment.captured` / `payment.failed` with the webhook secret.
- **Console OTP in staging**: `KIRANA_ALLOW_CONSOLE_OTP=true` keeps codes in server logs — never enable with real customer phones.

## Backups & restore

```sh
node scripts/backup.mjs /var/backups/kirana     # both DBs, timestamped, keeps 14
```

Cron (hourly): `0 * * * * cd /opt/kirana-corner-app && /usr/bin/node scripts/backup.mjs /var/backups/kirana >> /var/log/kirana-backup.log 2>&1`

Restore: stop the service, copy the snapshot over `KIRANA_DB_PATH` / `KIRANA_V2_DB_PATH` (delete `-wal`/`-shm` sidecars), start. `VACUUM INTO` snapshots are consistent single files — no sidecars needed.

## Health & monitoring

- `GET /healthz` — process alive. `GET /readyz` — both databases readable (use for load-balancer checks).
- Docker `HEALTHCHECK` polls `/readyz` every 30 s.
- Logs: structured-ish console lines; OTP codes only in dev/console mode. 500s log the full error server-side, never to clients.
- Audit trail: `GET /admin/audit` (order placement, cancellations, inventory adjustments, payment captures, staff changes).

## Production guard checklist (verified behaviour)

- Boot **refuses** without unique ≥32-char secrets (both v1 and v2).
- v1 demo sign-in and demo reset → 404.
- v2 console OTP → blocked unless `KIRANA_ALLOW_CONSOLE_OTP=true`.
- Mock payment confirm + dev simulator → 404.
- `dev_code` never appears in OTP responses unless `KIRANA_OTP_DEV=true`.