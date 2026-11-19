# Frontend → Backend requests

Z code (frontend) appends requests here; the backend agent answers inline and implements.
Format: `## [status] title` — status is `OPEN`, `ANSWERED`, or `DONE`.

---

## [OPEN] Add migration for `idempotency_keys.request_hash` (stale dev DBs 500 on checkout)

**Found:** 2026-11-19, while verifying the v2 customer checkout flow in the browser.

**Symptom:** `POST /api/v2/orders` returns **500 Internal Server Error** on the long-lived
dev database (`data/kirana-delivery.sqlite`). Quote, coupon, and address calls all succeed;
only order placement fails.

**Root cause (verified by reproduction):**
`src/v2/orders.js:131` reads and `:214` writes `idempotency_keys.request_hash`. The column is
declared in the base schema (`src/v2/db.js:188`, migration **version 1**), but it was added to
that `CREATE TABLE` *after* existing dev databases had already recorded version 1 as applied.
Because migrations are keyed by version and the table is created with `IF NOT EXISTS`, the
column is never added to a pre-existing DB. The live dev DB's `idempotency_keys` columns were:
`user_id, key, payload_hash, order_id, created_at` — **no `request_hash`**.

Reproduced stack (on a copy of the dev DB):
```
Error ERR_SQLITE_ERROR no such column: request_hash
  at src/v2/orders.js:131:22  (tx -> createOrder)
```
Fresh `:memory:` / newly-seeded DBs are unaffected (migration 1 creates the column), which is
why `npm run check` / `npm run smoke` pass while the persistent dev DB fails.

**Requested durable fix (backend lane):** add an incremental migration so old DBs self-heal,
e.g. version 2:
```sql
ALTER TABLE idempotency_keys ADD COLUMN request_hash TEXT NOT NULL DEFAULT '';
```
(guarded so it is a no-op on DBs that already have the column).

**Frontend-side unblock already applied (data only, no `src/` edit):** ran the same
`ALTER TABLE … ADD COLUMN request_hash …` against the gitignored dev DB file so the customer
flow could be verified end-to-end. This repairs the data drift but does **not** fix the code
path for other stale databases — the migration above is still needed. No test was changed.

---

## [OPEN] `getDeliverySlots` label shows UTC time mislabeled as IST

**Found:** 2026-11-19, verifying the scheduled-delivery flow.

**Symptom:** a slot whose real IST window is **07:00–09:00** is returned with
`label: "01:30–03:30 IST"`. The label is off by the IST offset (−5:30).

**Root cause:** `src/v2/catalog.js:210` builds the label by slicing the stored ISO string:
```js
label: `${slot.starts_at.slice(11, 16)}–${slot.ends_at.slice(11, 16)} IST`
```
`starts_at`/`ends_at` are **UTC** ISO timestamps (produced by `istDateTimeToUtc`), so slicing
`[11,16]` yields the UTC wall-clock time, then incorrectly suffixes "IST".

**Requested fix (backend lane):** format the label in `Asia/Kolkata`, e.g. via
`Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })`
applied to `starts_at`/`ends_at`, instead of slicing the UTC string.

**Frontend-side handling (no `src/` edit):** the customer app now derives all slot times from
`starts_at`/`ends_at` via a shared `slotRange()` helper (correct IST), ignoring the buggy
`label`, so cart, checkout, and tracking agree. The backend label should still be fixed for
any other consumer that trusts it.

---

## [OPEN] Suspended stores cannot be edited or reactivated (`PATCH /admin/stores/:id` 404)

**Found:** 2026-11-19, while building/verifying the v2 admin console Stores screen.

**Symptom:** after a store is suspended (`active=0`), any further `PATCH /api/v2/admin/stores/:id`
— including sending `{ active: true }` to reactivate it — returns **404 `STORE_NOT_FOUND`**.
The store row still exists (it is listed by `GET /admin/stores`), so the admin UI shows it but
every edit/save against it fails. A suspended store is effectively stuck suspended.

**Root cause (verified by reading the code):**
`src/v2/db.js:232-233` — `getStore()` filters on `active=1`:
```js
export function getStore(db, storeId) {
  return db.prepare('SELECT * FROM stores WHERE id=? AND active=1').get(storeId) || null;
}
```
`src/v2/admin.js:56-70` — `updateStoreAdmin()` guards with that same helper, so a suspended
store resolves to `null` and throws before the `active` toggle is ever applied:
```js
const store = getStore(db, storeId);                 // :57  null when active=0
if (!store) throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found.');  // :58
...
if (input.active !== undefined) next.active = ...;   // :62  never reached for suspended stores
...
return publicStore(getStore(db, storeId));           // :70  also null right after suspending
```
Line 70 has the same problem in the other direction: immediately after setting `active=0`,
`getStore()` returns `null`, so the return value of a successful suspend is also broken.

**Requested durable fix (backend lane):** in `updateStoreAdmin`, look the row up **without** the
`active` filter (e.g. `db.prepare('SELECT * FROM stores WHERE id=?').get(storeId)`), and return the
updated row directly (or re-fetch without the filter) instead of calling `getStore()` again.
`getStore()` should keep its `active=1` semantics for customer/catalog/cart paths — only the admin
mutation needs to see suspended rows. `createStoreAdmin`'s `STORE_EXISTS` check (`admin.js:47`) has
the same blind spot: a suspended store's id is not detected as existing.

**Frontend-side handling (no `src/` edit):** the admin Stores form surfaces the backend error toast
as-is; there is no client workaround for a 404 on a row that visibly exists. Reactivation requires
the backend fix above.