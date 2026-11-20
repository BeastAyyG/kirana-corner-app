# Kirana Corner — native mobile app (Flutter)

One Android app for **all four roles** — customer, seller (picker), rider and admin — behind a single phone-OTP login. The account you sign in with decides which workspace you land in; there is no role picker and no separate app per role.

This app is a native client of the same Node backend that serves the web PWA. It talks to `/api/v2` (bearer-token auth) and reuses the backend's seeded demo catalogue, stores, staff and riders. **No backend changes are required to run it.**

> Status: built and verified end-to-end on an Android emulator with real data — customer browse→cart→checkout→track, seller queue→pack→ready, rider offer→accept→pickup→deliver, admin overview/orders/stores/people/coupons/audit. `flutter analyze` is clean.

---

## What each role gets

| Role | Sign-in lands on | Workspace |
|---|---|---|
| **Customer** | `/customer` | Home + categories, search/filters, product page, server-side cart, bill quote (fees/coupons/tips), instant or scheduled checkout, COD/online, live order tracking (SSE + rider location + ETA), delivery-OTP handoff, orders/reorder, saved items, addresses, notifications, account |
| **Seller / picker** | `/seller` | Realtime pickup queue, aisle-sorted pick lists, short-picks with bill adjustment, pack → mark ready (bag label + pickup point), pickup-code handover, inventory, catalogue/price editor, store settings, daily metrics |
| **Rider** | `/rider` | Online/offline duty toggle, nearest-job offers with a 60-second countdown, accept/decline, pickup-code verification, live location pings, delivery-OTP + cash-collection confirmation, earnings (payout + tips) |
| **Admin** | `/admin` | Overview dashboard (GMV, deliveries, riders online, stores open), order desk (filters/search/cancel/refund), store network, people (staff/rider provisioning, suspension), coupons, audit log, server settings |

Money is integer **paise** end-to-end; the app divides by 100 only for display (`intl` `en_IN` currency).

---

## Prerequisites

- **Flutter SDK** (stable channel). Developed and verified on **Flutter 3.50 / Dart 3.14**; any Flutter with Dart ≥ 3.4 works. <https://docs.flutter.dev/get-started/install>
- **Android toolchain**: Android SDK (platform-tools + build-tools), **JDK 17+** (verified on JDK 21), and an Android emulator **or** a physical device with USB debugging enabled.
- **Node.js ≥ 24** to run the backend (zero npm dependencies — see the [root README](../README.md)).
- Verify everything with:

```sh
flutter doctor -v
```

iOS is not configured yet (Android-first). The Dart code is platform-neutral; adding iOS later is `flutter create --platforms=ios .` plus CocoaPods.

---

## Quickstart

### 1. Start the backend (repo root)

```sh
cd ..            # kirana-corner-app/
npm run dev      # http://127.0.0.1:3000 — seeds demo data, console OTP, auto-restart
```

`npm run dev` runs in development mode with the **console OTP provider**, so sign-in codes are returned to the app as `dev_code` (auto-filled) and also printed to the server console.

### 2. Run the app

```sh
cd kirana_mobile
flutter pub get
flutter run                  # picks a connected emulator/device
```

On first launch the app points at `http://10.0.2.2:3000` — the Android emulator's alias for the host machine's loopback. With the backend running on the same machine and an emulator, **it works out of the box**.

### 3. Sign in

Enter a demo mobile number (10 digits, +91). In dev mode the OTP auto-fills; tap **Verify & continue**. You land in the workspace for that account's role.

| Role | Demo phone |
|---|---|
| Customer | `9000000021` |
| Seller / picker | `9000000002` |
| Rider | `9000000011` (or `9000000012`) |
| Admin | `9000000001` |

Any other valid number creates a fresh **customer** account (enter a name on the OTP step). Demo accounts are fictional seed data.

---

## Pointing the app at a backend

The base URL is **editable in-app** and persisted across launches (`shared_preferences`):

- **Customer**: Account → **Server URL**
- **Rider**: Account → **Server URL**
- **Admin**: More → **Server**

| Where the app runs | Base URL to use |
|---|---|
| Android **emulator**, backend on the same machine | `http://10.0.2.2:3000` (default) |
| **Physical device** on the same Wi-Fi | `http://<your-computer-LAN-IP>:3000` (e.g. `http://192.168.1.20:3000`) |
| **Deployed** backend | `https://your-domain.example` |

The app appends `/api/v2` automatically. Cleartext HTTP is enabled (`android:usesCleartextTraffic="true"`) so local/LAN development works; use HTTPS for anything public.

For a physical device, make sure the backend listens on all interfaces (`HOST=0.0.0.0`) and your firewall allows port 3000.

---

## Build an installable APK

```sh
flutter build apk --release
# output: build/app/outputs/flutter-apk/app-release.apk
```

Install on a connected device/emulator:

```sh
flutter install --release
# or: adb install -r build/app/outputs/flutter-apk/app-release.apk
```

**Signing:** the release build currently uses the **debug signing config** (the standard Flutter template default), so the APK is sideload-friendly for testing and demos but **not** suitable for the Play Store. To publish, create a keystore and wire up `android/key.properties` + a release `signingConfig` in `android/app/build.gradle.kts` (the marked `TODO`). Never commit the keystore or `key.properties` — both are gitignored.

For smaller per-device artifacts use `flutter build apk --split-per-abi`.

---

## Architecture

Feature-first modules over a shared core; Riverpod for state, dio for HTTP, go_router for navigation.

```
lib/
  main.dart                 boot: intl date locales (en_IN/en_GB), load config, ProviderScope
  core/
    config.dart             AppConfig: base URL (persisted), /api/v2 resolution, asset URLs
    api/api_client.dart     dio client, bearer token, error mapping
    api/api_exception.dart  typed API errors
    providers.dart          session bootstrap, secure token storage (kc-v2-token)
    app_router.dart         splash → auth → role shell; roleHome() + redirect guards
    models.dart             shared response models
    theme.dart              design tokens (BB) + Material theme
    format.dart             paise→₹ (en_IN), dates, codes
    art.dart, widgets.dart  imagery fallbacks + shared UI
  features/
    auth/                   phone-OTP sign-in (dev-code auto-fill)
    customer/               home, browse, product, cart, checkout, track, orders, saved,
                            addresses, notifications, account
    seller/                 queue, order detail, inventory, product form, metrics, settings
    rider/                  duty, jobs, job detail, earnings, account, location pings
    admin/                  overview, orders, stores, people, coupons, audit, more
```

Each role shell owns its bottom-nav tabs (an `IndexedStack`); detail screens are pushed with `Navigator`. Polling cadences: rider jobs 10s, job detail 12s, location ping 20s; customer tracking uses SSE.

**Key conventions**

- **Auth**: phone OTP → bearer token stored in `flutter_secure_storage` (`kc-v2-token`). One role per account; the router redirects to `roleHome(role)` and blocks cross-role paths.
- **Money**: integer paise (`*_minor`); never float math. Display via `NumberFormat.currency(en_IN)`.
- **Dates**: `initializeDateFormatting('en_IN')` / `('en_GB')` run in `main()` before `runApp` — required, or `DateFormat` throws `LocaleDataException`.
- **Rider offer window**: the app mirrors the web rider app's **60-second** countdown (`rider_helpers.dart`); Accept disables when the local timer expires.
- **Delivery OTP**: deterministically derived per order by the backend; the customer order view exposes it for live orders, and the rider enters it to complete delivery.

---

## Configuration & permissions

- `android/app/src/main/AndroidManifest.xml`: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`; `usesCleartextTraffic="true"`; label **Kirana Corner**; `applicationId com.kirana.kirana_mobile`.
- Location is used for rider pings and customer serviceability; the app requests permission at runtime via `geolocator`.
- Runtime dependencies are pinned in `pubspec.yaml` / `pubspec.lock` (Riverpod, dio, go_router, flutter_secure_storage, intl, geolocator, url_launcher, shared_preferences). These are app-side only — the **backend stays zero-dependency**.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `LocaleDataException` / dates crash | Ensure `initializeDateFormatting('en_IN'/'en_GB')` runs in `main()` before `runApp` (already wired). |
| App can't reach backend on emulator | Use `http://10.0.2.2:3000`, not `127.0.0.1`. Confirm the backend is running. |
| Physical device can't connect | Use the computer's LAN IP; set backend `HOST=0.0.0.0`; allow port 3000 through the firewall; same Wi-Fi. |
| OTP not auto-filling | Backend must be in dev/console mode (`npm run dev`). Otherwise read the code from the server console, or set `KIRANA_OTP_DEV=true`. |
| Rider "Offer expired" / Accept disabled | The app's offer countdown is 60s. Accept within the window; a new offer is dispatched on retry. |
| Cleartext HTTP blocked | Only relevant if you disable `usesCleartextTraffic`; keep it for local dev, use HTTPS in production. |
| `flutter run` finds no device | `flutter devices`; start an emulator (`flutter emulators --launch <id>`) or enable USB debugging. |

---

## Verify

```sh
flutter analyze        # static analysis — clean
flutter test           # widget/unit tests (if present)
flutter build apk --release
```

The backend contract this app consumes is documented in [../docs/03-API-REFERENCE.md](../docs/03-API-REFERENCE.md); screen→API maps for all four clients are in [../docs/05-APP-INTEGRATION-GUIDE.md](../docs/05-APP-INTEGRATION-GUIDE.md).

## Boundaries

- Maps/ETA use haversine distance (no road-network API yet); FCM/APNs push is a documented future seam (tracking is SSE + in-app).
- Android-first; iOS not yet configured.
- Release APK is debug-signed until a production keystore is added.