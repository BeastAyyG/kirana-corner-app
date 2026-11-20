# 06 — Operations Runbook

Day-2 operations for a running deployment. Setup lives in [04-INFRASTRUCTURE.md](04-INFRASTRUCTURE.md).

## Routine checks

| Check | Command / signal | Cadence |
|---|---|---|
| Liveness | `GET /healthz` → 200 | continuous (uptime monitor) |
| Readiness (both DBs open) | `GET /readyz` → 200 `{"ok":true,"db":"ok","delivery_db":"ok"}` | continuous; alert on non-200 |
| Disk headroom | `/data` volume usage | daily; SQLite + WAL + backups |
| Backups exist | newest file in `./backups` is < 24 h old | daily |
| Stuck dispatch | `GET /admin/orders?status=packed` — any order packed > 15 min with no rider | hourly during operating hours |
| Failed payments | `GET /admin/overview` → `pending_payments` growing while orders flow | hourly |
| Error rate | server stdout/stderr (structured JSON lines) | continuous log shipping |

## Backup & restore

**Backup** (safe on a live WAL database — uses `VACUUM INTO`):

```bash
npm run backup                # → ./backups/<name>-<timestamp>.sqlite (keeps 14 per DB)
npm run backup -- /mnt/offsite   # alternate directory
```

Cron example (02:30 daily): `30 2 * * * cd /srv/kirana && node scripts/backup.mjs /mnt/offsite/kirana-backups`

**Restore**:

```bash
docker compose stop kirana
cp backups/kirana-<ts>.sqlite          /data/kirana.sqlite
cp backups/kirana-delivery-<ts>.sqlite /data/kirana-delivery.sqlite
# remove stale WAL/SHM so SQLite starts clean from the restored files
rm -f /data/*.sqlite-wal /data/*.sqlite-shm
docker compose start kirana
curl -fsS localhost:3000/readyz
```

Sessions survive restore (they live in the DB); in-flight orders keep their state; riders may need to re-toggle availability if the process restarted mid-job — check the queue board after restore.

## Secret rotation

Both secrets (`KIRANA_SESSION_SECRET`, `KIRANA_PICKUP_CODE_SECRET`) are boot-validated (≥32 unique chars, must differ) in production.

1. Generate new values: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
2. Update `.env`, restart the service.
3. Effects: **session secret** rotation invalidates v1 cookie sessions only (v2 bearer tokens are stored hashed in the DB and survive). **Pickup-code secret** rotation changes the derived pickup/delivery codes for *existing active orders* — rotate only when no orders are between `packed` and `delivered`, or re-issue codes by notifying staff (admin order view shows current codes).

OTP hashes and payment-webhook secrets are independent; rotate provider keys at the provider, then update `.env`.

## Incident playbooks

### Order stuck in `packed`, no rider assigned
1. `GET /admin/orders?status=packed` — confirm age.
2. Check `GET /admin/overview` → `riders_online`. Zero online riders is the usual cause.
3. Riders exist but none offered? The sweep retries every 10 s; check rider `active_jobs` load (cap 2) and store `home_store_id` matching. A rider who declined is excluded for that order — another rider or a manual nudge is needed.
4. Last resort: `POST /admin/orders/:id/cancel {reason}` — stock releases automatically, COD drops, paid orders refund. Call the customer.

### Rider no-show after accepting
The job stays `accepted` until pickup. There is no auto-expiry on accepted jobs (only on offers). Admin cancels the order (refund/stock as above) and provisions/calls another rider; or the picker calls the rider via the customer/staff contact shown in the order view. Record the incident in the audit trail via the cancel reason.

### Payment captured but order still pending (webhook missed)
1. Verify at the provider dashboard that the payment succeeded.
2. Razorpay: replay the webhook from the dashboard (signature will validate).
3. Mock provider (non-prod): `POST /api/v2/payments/:id/confirm`.
4. Confirm `GET /orders/:id` shows `payment_status:'paid'` and the store queue now lists the order (`order.new` SSE fires on capture).

### Payment failed after stock reserved
No action needed for stock: failed online payments never reach the store queue, and admin cancel releases stock. If the customer retries, they place a **new** order (new idempotency key). Refunds for cancelled paid orders are recorded as `refunded` / `partially_refunded`; actual money movement for Razorpay must be issued from the Razorpay dashboard (the mock provider only bookkeeps).

### `SQLITE_BUSY` / database locked
WAL + `busy_timeout=5000` makes this rare. If it appears in logs: check for a second process holding the DB (a stray `node src/server.js`, an open backup copy tool using exclusive locks). Only one server process may own each DB file. `npm run backup` is safe concurrently. Never delete `-wal`/`-shm` files while the server is running.

### OTP provider outage
Customers cannot sign in. Options: failover by switching `KIRANA_OTP_PROVIDER` (msg91 ↔ twilio) and restarting; or, **non-production only**, `KIRANA_ALLOW_CONSOLE_OTP=true` reads codes from server logs. Never enable console OTP in production to "keep things moving" — it lets anyone sign in as any phone by reading logs.

### SSE clients not updating
Behind a proxy? Buffering must be off (`proxy_buffering off` nginx / Caddy flush). Check the 15 s heartbeat comment lines arrive; if not, the proxy is eating the stream. Clients auto-reconnect (`retry: 3000`) — a restart blips SSE for ≤3 s.

## Upgrades / deploys

```bash
git pull                       # or pull the new image
npm run check && npm run smoke # on a staging copy, never against prod data
npm run backup                 # pre-deploy snapshot
docker compose up -d --build   # or: systemctl restart kirana
curl -fsS localhost:3000/readyz
```

Migrations run automatically at boot (forward-only, idempotent). Rollback = restore the pre-deploy backup **and** the previous code together — newer schema + older code is unsupported. Graceful shutdown drains for 5 s (SIGTERM); `stop_grace_period: 15s` in compose covers it.

## Demo / staging reset

To wipe and reseed a non-production instance: stop the service, delete both DB files (plus `-wal`/`-shm`), start — seeds re-run automatically unless `KIRANA_V2_SKIP_SEED=true`. `npm run seed` prints the resulting counts and demo phones.