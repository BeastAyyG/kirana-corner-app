# 07 — BigBasket Design Brief (for Z code)

**Owner of this document:** backend agent. **Implementer:** Z code (`public/**`, `apps/**`).
This is the pixel-level spec that replaces the "age-old" look with the current BigBasket / bbnow design language. It is grounded in **real, current BigBasket screens** scraped from the official Play Store and App Store listings (November 2026), not from memory of the 2019 app.

**How to use it:** work top to bottom. §1–§4 are shared foundations, §5 is the component library, §6 is per-screen layouts, §7 is motion, §8 is the acceptance checklist. Everything here is implementable inside your lane — no backend change is required. If you disagree with a spec or need an API change, use `docs/FRONTEND-REQUESTS.md`.

---

## 0. Evidence base and copyright boundary

Local study reference (scraped official store-listing screenshots, **gitignored — never commit, never ship**):

| File | What it shows |
|---|---|
| `design-assets/reference/bigbasket-appstore/ios-1.webp` | **bbnow home** (highest-res): ETA header, address row, search + mic + list button, category chips with promo badges, photographic banner + "Shop now" pill + dots, "Order Again" rail with `+` cards, floating order pill + dark-green cart pill, 4-tab bottom nav |
| `design-assets/reference/bigbasket-appstore/ios-5.webp` | Home variant: festive illustrated banner with 4 sub-tiles, dark-green "Deals Are Live!" section card with white product cards and `⚡12 MINS` ETA labels |
| `design-assets/reference/bigbasket-appstore/ios-4.webp` | **Basket**: title bar + address, "Congrats! You're saving ₹490" strip, `⚡ Now 13 mins / 🕐 Later 2 hrs` segmented toggle, "Apply coupon" row, "Delivery in ⚡15 mins · 2 Products", item rows with light-green steppers, "Order again" category tabs |
| `design-assets/reference/bigbasket-appstore/ios-3.webp` | **Order Status**: map with green route, home pin, rider marker, circular "15 mins" ETA gauge, rider callback card with avatar + call button, "219 Deliveries ★4.5" pills |
| `design-assets/reference/bigbasket-play/shot-2.png`, `shot-4.png` | Same home + basket screens (Android framing), cross-check |

Rules:

1. **Never commit `design-assets/reference/`** (it is in `.gitignore`). These are copyrighted BigBasket screenshots — study only.
2. **Never copy BigBasket branding**: no `bb` logo, no "bigbasket", "fresho!", "bbDaily", "Tata" marks, no scraped brand packshots (Maggi, Nescafé…). Our brand is **Kirana Corner**; our catalogue is unbranded local-shop goods.
3. **Ship only the generated pack** in `design-assets/products|categories|banners/*.webp` (original, unbranded, white-background studio shots made for this repo).

---

## 1. What is actually wrong today (audit)

The token system and layout skeleton in `public/css/base.css` are already close (bb green family, 480px phone frame, sticky header, tab bar, sheets). The dated feel comes from **content and detail**, not structure:

| Problem | Where | Fix (section) |
|---|---|---|
| Emoji-on-gradient tiles for every product | `public/js/art.js` | Real packshots (§4) |
| Emoji text banners (`🧺 Evening pickup…`) | `public/js/views/home.js` `BANNERS` | Photographic banners with HTML text overlay (§5.4) |
| Full-width green ADD button on every card | `public/js/ui.js` `productCardHtml` | Compact `+` button overlapping image corner; stepper after add (§5.5) |
| Category tiles are emoji circles with counts in the label | `home.js`, `categories.js` | Photo tiles / chips with badges, no counts in labels (§5.3) |
| No ETA promise, no address row, no savings strip, no floating cart pill | header, cart | §5.1, §5.7, §6.4 |
| Prices show no MRP strikethrough / % OFF flag on cards | `ui.js` (v2 data has MRP; v1 doesn't — see §3) | §5.5 |
| Generic empty/skeleton states | `ui.js` | §5.10 |

**Do not redesign the token palette.** Keep `--bb-*` as-is; add the few tokens in §2.2. The green is already BigBasket's green (`#84c225`).

---

## 2. Foundations

### 2.1 Canvas

- White-first: page background `#ffffff` for home/browse (bbnow is white, not gray). Keep `--bb-bg: #f4f4f2` only for input fills and recessed areas (search pill, sheet grabs).
- Cards: white, **1px `--bb-line` border OR `--bb-shadow`, not both stacked heavily**. bbnow product cards are borderless on white with the image doing the work; use shadow only on floating elements (cart pill, sheets, sticky bars).
- Radius: cards/images `12px` (`--bb-radius`), pills `999px`, buttons `10px`, banner `16px` (`--bb-radius-lg`).
- Phone frame stays `max-width: 480px`; desktop gets the centered frame with soft outer shadow (already in `base.css`).

### 2.2 Token additions (append to `:root` in `base.css`)

```css
--bb-cart: #0c3b1e;        /* floating cart pill — near-black green, from ios-1 */
--bb-cart-ink: #ffffff;
--bb-stepper-tint: #d9efd0; /* basket stepper fill — light green, from ios-4 */
--bb-save-tint: #e9f7ee;    /* "you're saving" strip background */
--bb-save-ink: #1e7a3c;     /* savings strip text */
--bb-eta-blue: #2f6fed;     /* "12 mins" order-status circle */
--bb-flag: #1e9e4a;         /* "% OFF" corner flag green */
```

Everything else (greens, red, amber, blue, ink/sub/faint, line, shadows, radii, font stack, header/tab heights) stays as defined in `base.css:3-29`.

### 2.3 Typography

System stack already set (`--bb-font`). No webfonts — matches house style and CSP.

| Role | Size / weight / tracking |
|---|---|
| ETA promise ("15 mins" / "Pickup in 30 min") | 17px / 800 / −0.02em, ink |
| Screen title (subbar h1) | 17px / 800 / −0.02em |
| Section title ("Order Again") | 16px / 800 / −0.02em |
| Product name | 12.5px / 600, ink, 2-line clamp |
| Brand / unit line ("500 gm", "Local farm") | 11px / 500, `--bb-sub` |
| Price | 14px / 800, ink; MRP 11px strikethrough `--bb-faint`; save 11px / 800 green-dark |
| Banner headline | 20px / 800 / −0.02em, white (on photo) |
| Banner sub | 12px / 500, white 85% |
| Tab label | 10px / 700 (already set) |
| Micro badges ("No Extra Cost", "New") | 8.5–9px / 800 |

### 2.4 Spacing

4px base grid. Page gutter 14px (already `.page`). Section gap 18px top / 10px bottom (already `.section-title`). Card gutter 10px. Rail card width 132px (image 132×132, text below). Touch targets ≥ 40px; the `+` button is 32×32 visual but keep a 40px hit area via padding.

---

## 3. Voice and copy

- Short, confident, lowercase-friendly. "Order again", "On the shelf now", "Low prices this week" — keep our existing headings, they already match bb tone.
- ETA language: v1 pickup = **"Pickup in 30 min"** / slot windows; v2 instant = **"⚡ 15 mins"**. Never promise what the backend can't do (see §6.5 tracking boundary).
- Savings: "You're saving ₹X" only where real MRP data exists. **v2 has it** (`mrp_minor`, `discount_percent`, cart `savings_minor`). **v1 has no MRP field** — show plain prices there; never fabricate a strikethrough. If v1 should show savings too, request an `mrp_minor` column via `docs/FRONTEND-REQUESTS.md` (backend lane).
- No lorem, no TODO, no emoji as UI artwork. Emoji may remain only inside generated fallback tiles (§4.3) and empty-state art.

---

## 4. Imagery pipeline (the single biggest visual upgrade)

### 4.1 The pack (already generated, in this repo)

```
design-assets/products/<id>.webp      24 files, 512×512, white-bg studio packshots
design-assets/categories/<slug>.webp   4 files, 512×512 (vegetables, dairy, staples, snacks)
design-assets/banners/<name>.webp      3 files, 1200×800, left ~45% kept clear for text
```

Product filenames match seed ids exactly: `tomato onion potato banana chillies spinach coriander milk bread curd paneer eggs dal atta salt rice basmati sugar chana-dal oil tea biscuits chips namkeen`.
Banner names: `fresh-vegetables`, `daily-staples`, `dairy-morning`.

### 4.2 Wiring (no backend change needed)

The server serves `public/` statically, so copy the pack into your lane once:

```bash
mkdir -p public/img
cp -r design-assets/products public/img/products
cp -r design-assets/categories public/img/categories
cp -r design-assets/banners public/img/banners
```

Then in `public/js/art.js`, make `artFor(item)` prefer the local packshot and keep the emoji SVG as **fallback only**:

```js
const LOCAL = new Set(['tomato','onion',/* …all 24 ids… */]);
export function artFor(item) {
  if (item?.image_url) return item.image_url;            // seller-provided https art wins
  if (item?.id && LOCAL.has(item.id)) return `/img/products/${item.id}.webp`;
  return emojiTile(item);                                 // existing SVG data-URI path, unchanged
}
```

- Do **not** try to push local paths through the seller API — `image_url` is validated `https://`-only (`src/db.js`). The local preference lives entirely in the frontend.
- Category tiles: `artForCategory(slug)` → `/img/categories/<slug>.webp`, same fallback pattern.
- `<img loading="lazy" decoding="async" width="512" height="512">` on every card image; `fetchpriority="high"` only on the first banner.
- CSP already allows `img-src data:` and self — no header change needed.

### 4.3 Fallback behaviour

If a packshot 404s (seller added a new product id), `onerror` swaps to the emoji tile once (guard against loops). New seller products with an `https` `image_url` render that URL directly. Nothing ever shows a broken image icon.

---

## 5. Component library (pixel specs)

### 5.1 App header (shopper) — replaces current logo row

Two rows, sticky, white, total ≈ 96px (keep `--bb-header-h`):

```
Row 1 (52px):  [⚡ 15 mins]            (profile circle 36px, right)
               [🏠 Home — Plot 23, Sector 9… ▾]   ← address/store row, 12px, ellipsis
Row 2 (44px):  [🔍 Search for 'biscuits'        🎤]  [☰ list]
               └─ search pill: flex-1, h40, radius 10, bg --bb-bg, 1px line
               └─ list button: 40×40 circle, white, 1px line (opens saved/lists)
```

- v1: ETA text = "Pickup in 30 min" when a store is open; address row = chosen store name + area, tap → `#/stores`. No store chosen → "Choose your corner shop ▾".
- v2 customer: ETA from serviceability response; address row = saved address label + line, tap → address sheet.
- Mic icon is decorative-but-honest: wire it to the Web Speech API if trivially available, otherwise hide it (no dead buttons).
- Seller app keeps the dark-green header (already `.app-header.seller`) — that variant is fine.

### 5.2 Category chips row (home, under header)

Horizontal scroll, no scrollbar (`.chip-row` exists). Each chip: icon-over-label, 64px wide, label 11px/700.

- Selected chip: **3px green underline** below the label (bbnow style), not a filled pill.
- Promo badges float above the chip, 8.5px/800: red-tint bg + red text ("No Extra Cost") or ink bg + white text ("17 Available"). Map to real data: badge = count of available products in that category; hide when 0.
- Use the generated category webp cropped in a 44px circle as the icon for the 4 real categories; "All" keeps a bag icon.

### 5.3 Category grid (categories screen)

2-column grid of photo tiles: image 1:1 radius 12, label below 13px/700 centered. No counts in labels, no emoji circles. Tap → `#/c/<key>`.

### 5.4 Banner carousel (home hero)

- Rail: horizontal snap-scroll, one banner visible, gutter 14px, banner width = page width − 28px, height ≈ 150px, radius 16.
- Background: the generated banner webp (`object-fit: cover`). **Text is HTML overlay on the left 45%** (the images were generated with that space clear):
  - headline 20px/800 white, sub 12px white/85, then a **white "Shop now" pill** (h32, radius 999, ink text 12px/800) → routes to the matching category.
  - Add a subtle left-to-right dark scrim (`linear-gradient(90deg, rgba(10,40,16,.55), transparent 60%)`) so white text passes contrast on any banner.
- Dots below: 6px circles, active dot elongates to 18px pill, green (already `.banner-dot`, add the elongation).
- Auto-advance every 5s, pause on touch/hover, respect `prefers-reduced-motion` (no auto-advance).
- Content: 3 banners → fresh-vegetables ("Fresh from the morning mandi", → Vegetables), dairy-morning ("Milk, curd & paneer by 7 am", → Dairy), daily-staples ("Stock up for the week", → Staples).

### 5.5 Product card (the most-repeated component)

Rail card 132px wide; grid card flexes. Structure top→bottom:

```
┌────────────────┐
│ [8% OFF flag]  │  ← flag: absolute top-left, green --bb-flag, white 9px/800,
│                │     radius 6px 0 6px 0 (corner ribbon). v2: show when
│                │     discount_percent > 0 (API provides it). v1: no MRP data → no flag.
│   packshot     │  ← 1:1, radius 12, white bg, object-fit contain, padding 6px
│           [+]  │  ← 32×32, absolute bottom-right, overlapping image edge by 6px,
└────────────────┘     white bg, 1.5px green border, green +, radius 9, soft shadow
₹28  ₹40             ← price row: 14px/800 ink + 11px strikethrough faint
                     (strikethrough only when the API exposes mrp_minor — v2 yes, v1 no)
Fresh Palak          ← name 12.5px/600, 2-line clamp
500 gm               ← unit 11px sub
```

- **`+` → stepper morph**: on add, the `+` button swaps in place to a 32px-high stepper (`− 1 +`) with white bg / green border (rail) — same footprint family, no layout shift. In basket rows the stepper is **light-green filled** (`--bb-stepper-tint`, dark-green glyphs, no border) per ios-4.
- Out of stock (`available === 0`): image 45% opacity, gray "Out of stock" pill over image bottom, no `+`.
- Low stock (`available <= 3`): amber "Only 3 left" micro-label under unit.
- v2 instant cards add `⚡ 12 MINS` 9px/800 green label under the unit (ios-5).
- Whole card (except stepper) taps → PDP. Save/heart stays on PDP, not on cards (bbnow cards are clean).
- Keep `productCardHtml(product, opts)` signature; extend opts, don't break callers.

### 5.6 Section header

`Title (16/800)` left; right = **chevron-in-circle** (28px, 1px line border) for "see all", or text "See all" 12px/700 green-dark for secondary sections. Already `.section-title`; add the circle variant.

### 5.7 Floating bottom cluster (above tab bar)

Two elements, only when relevant (ios-1):

1. **Order-status pill** (left, when an active order exists): white pill h44, shadow-lg, blue 34px circle with "12\nmins" 8px/800 white, label "Order confirmed" 12px/700 + chevron. Tap → order tracking. Text = real order status via `statusText()`.
2. **Cart pill** (right, when basket non-empty): `--bb-cart` bg, white, h44, radius 999, "🛍 2 →" (bag icon + count 14px/800 + arrow). Tap → cart. Slides up on first add (§7).

They sit in one fixed row: `bottom: calc(tabbar-h + 10px)`, gutters 14px, space-between. When both present the order pill truncates with ellipsis. The existing `.checkout-cta` full-width bar is replaced by this cluster on home; cart screen keeps its own checkout bar.

### 5.8 Bottom tab bar

4 tabs, icon-over-label (existing `.tabbar`). Shopper: **Home / Categories / Orders / Account** (keep our routes; bbnow's Reorder/bbDaily are their brand features — our equivalent is Orders with a reorder shortcut inside). Active tab: green-dark icon + label, icon gets a soft green-tint rounded backdrop (28px pill behind icon). Basket badge stays on the header list button, not the tab bar. Seller tabs unchanged.

### 5.9 Basket / cart screen chrome

- **Savings strip**: full-width `--bb-save-tint` band, "🎉 You're saving ₹X" 12px/700 `--bb-save-ink`, only when the quote/cart exposes savings > 0 (v2 `savings_minor`; v1 has no MRP → omit the strip). (🎉 is copy, not artwork — allowed.)
- **Now / Later segmented control** (v2): white container radius 12 padding 4, two halves; active = `--bb-cart` bg white text with ⚡/🕐 icon + "Now 13 mins" / "Later 2 hrs"; inactive = white bg ink text. v1 equivalent: slot picker stays a sheet, but style the trigger as this segmented look ("Today 6:30 pm ▾").
- **Coupon row**: white row, amber % icon tile 32px radius 8, "Apply coupon" 13px/700, chevron; applied state shows code + green "−₹X" and an ✕ to remove.
- **Item rows**: packshot 56px radius 10 left; name 13px/600 (1-line ellipsis), unit 11px sub, price row 13px/800 + MRP strikethrough; light-green stepper right. Row separators 1px line, no cards-per-item.
- **"Order again" rail** at the bottom with category tabs (green underline active) — reuse §5.5 cards, data from past orders.

### 5.10 Empty, skeleton, toast, sheet

- Empty states: keep the centered art circle but use a **generated category image** (e.g. empty basket → `categories/staples.webp` in the 74px circle) instead of emoji where one fits; title 15px/800, body 12.5px sub, one primary action.
- Skeletons: shimmer exists; make card skeletons match §5.5 geometry (image square + 2 text bars + price bar), not generic blocks.
- Toasts: keep dark pill; success = `--bb-green-deep`. Add a tiny leading icon (check/alert).
- Sheets: keep current grab + radius; section titles inside sheets 16.5px/800.

---

## 6. Per-screen layouts

### 6.1 v1 shopper home (`views/home.js`)

Top→bottom: header (§5.1) → category chips (§5.2) → banner carousel (§5.4) → "Order again" rail (only if past orders; else skip) → "Low prices this week" rail (cheapest 8, §5.5 cards) → slot teaser (restyle as white row with clock icon tile, not a colored block) → "On the shelf now" rail → active-order strip (restyle as §5.7 order pill content inline) → guest sign-in teaser (only when logged out). Floating cluster (§5.7) + tab bar (§5.8). Closed-store notice stays, styled `notice-warn`.

### 6.2 Category / browse (`views/categories.js`, `views/browse.js`)

- Categories: §5.3 photo grid.
- Browse (PLP): **left vertical category rail** (72px wide, white, icon-over-label 10px, active = green-tint bg + 3px green left edge) + right 2-column product grid (§5.5). Sticky filter chip row on top of the grid (sort: price ↑↓, "In stock", category). This is the classic BigBasket PLP pattern — no scraped screenshot of it, but it is their long-standing layout; keep it simple.
- Search (`views/search.js`): live results grid under the header search pill (pill becomes a real input here), recent searches as chips, empty query → category photo grid.

### 6.3 PDP (`views/product.js`)

White page: image gallery (packshot full-width 1:1, swipe if multiple images), % OFF flag, name 18px/800, unit 12px sub, price block (20px/800 + MRP + green "Save ₹X"), stock line, **full-width ADD button h48** (PDP is the one place full-width ADD is correct) morphing to a full-width stepper, "Why you'll like it" accordion (description, shelf life, origin — from product fields), "Similar items" rail. Sticky bottom bar: price left + ADD/stepper right when the main button scrolls out.

### 6.4 Cart (`views/cart.js`)

§5.9 chrome: savings strip (v2) → slot/Now-Later control → coupon row (v2) → "Pickup in 30 min · N items" header → item rows → bill card (item total, savings green where data exists, slot fee if any, **To pay** bold row) → "Order again" rail → sticky checkout bar (total left, "Place order →" green right). **Keep the price-change note invariant**: `const priceChanged` computed before `lines.map(` — pinned by `test/app.test.js`.

### 6.5 Order tracking (`views/order.js`, v2 tracking)

Evidence: ios-3. **Boundary: our backend has haversine ETA + SSE, no map tiles API.** Do not embed Google Maps (needs a key + billing). Instead:

- Status hero: circular **ETA gauge** (SVG ring, green arc = elapsed/total, center "15\nmins" 18px/800) + status headline ("Packing your order", "On the way") + public label.
- **Stylized route card**: simple SVG street-grid illustration (light gray lines on white), green polyline from store pin to home pin, animated rider dot along the path driven by SSE location pings. Label it honestly: "Live route (approximate)". This reads like ios-3 without a maps dependency.
- Rider/partner card: avatar circle, "Tap to call <name>" (tel: link only if a real number is exposed; otherwise show name + "219 deliveries ★4.5"-style stats from the API), call button.
- Status timeline: placed → packing → ready/out → delivered, green checks, timestamps.
- v1 pickup: same timeline minus map/rider; show slot window + pickup OTP big and centered when ready.

### 6.6 Orders list, account, welcome, stores

- Orders: white rows with status chip (existing chips are good), packshot thumbnails stack (up to 3 overlapping 32px circles), total, slot/ETA line, chevron. Reorder button per delivered order.
- Account: profile header (avatar circle, name, phone), row-cards for addresses/saved/help/logout (existing `.row-card` is fine), app version footer.
- Welcome: brand mark + one-line value prop, phone input → OTP (v2) or name/role (v1), demo-account hint card in dev. Keep it one screen, no carousel.
- Stores: store cards with open/closed pill, distance, "Pickup in 30 min", select button.

### 6.7 v2 apps (`apps/customer|store|rider|admin`)

Same foundations (§2–§5). Role specifics:

- **Customer**: home = §6.1 with ⚡ETA + delivery address; cart = §5.9 Now/Later; tracking = §6.5.
- **Store picker**: dark-green header (exists), queue as status-grouped cards (New / Packing / Ready), each with items checklist, short-pick button per line, "Mark ready" primary. Big tap targets, glove-friendly 48px rows.
- **Rider**: offer card modal (earnings, distance, expiry countdown ring), active delivery = §6.5 route card + pickup/delivery OTP entry (6-box input), "Navigate" opens `geo:`/maps URL with coordinates (external, no key needed).
- **Admin**: desktop-first table layout is fine here (it's an ops console, not a phone app); keep bb tokens, dense tables, status chips, audit log.

---

## 7. Motion

- Durations: micro 120ms, standard 200ms, sheet 240ms; easing `cubic-bezier(.2,.8,.3,1)` (already used by sheets).
- `+` → stepper: 120ms scale .8→1 pop; cart count badge: 150ms pop on change.
- Cart pill: slide-up + fade on first add; order pill swaps text with 150ms crossfade on SSE status change.
- Banner auto-advance 5s (pause on interaction); dots animate width.
- Page transitions: 150ms fade/slide-8px on route change (router already swaps outlet — add a class).
- ETA gauge arc animates on mount; rider dot moves with 1s linear interpolation between SSE pings.
- `prefers-reduced-motion`: kill auto-advance, pops, and parallax; keep instant state changes (base.css already has the global override).

---

## 8. Acceptance checklist (Z code: verify each before calling it done)

- [ ] `npm run check` and `npm run smoke` pass (the cart price-note invariant included).
- [ ] Home first paint shows **zero emoji tiles** for the 24 seeded products; all packshots load (Network tab: 24× 200, `image/webp`).
- [ ] Banner text is HTML (selectable, accessible), contrast ≥ 4.5:1 over the scrim; dots track scroll; auto-advance pauses on touch.
- [ ] `+` add → stepper morph works on rail, grid, PDP, search; quantities stay in sync across views and after reload (basket state).
- [ ] Out-of-stock and low-stock states render; nothing is tappable that has no handler.
- [ ] Floating cart pill appears on first add, shows live count, routes to cart; order pill shows real status and updates via SSE/poll without reload.
- [ ] Cart: savings strip (v2) matches the quote's `savings_minor` and the bill card; coupon apply/remove works; slot/Now-Later selection persists into checkout. v1 shows no fabricated MRP/savings anywhere.
- [ ] Tracking: ETA gauge + timeline reflect real order state; simulate endpoint (`POST /api/v2/dev/orders/:id/simulate`) drives the rider dot and status transitions end-to-end.
- [ ] 360×740 (small Android) and 390×844 (iPhone) viewports: no horizontal overflow, no clipped text, tab bar + floating cluster never overlap content (page bottom padding accounts for both).
- [ ] Keyboard nav: focus-visible rings everywhere; sheets trap focus and close on Esc/backdrop.
- [ ] `git status` shows only your lane staged; `design-assets/reference/` never appears in a commit.
- [ ] Side-by-side sanity: open `design-assets/reference/bigbasket-appstore/ios-1.webp` next to the running home screen — a stranger should read them as the same design family (white canvas, green accents, photo banners, `+` cards, dark cart pill), not the same brand.

## 9. Suggested implementation order

1. §4 imagery wiring + §5.5 product card (biggest visible win, everything else inherits it).
2. §5.1 header + §5.4 banners + §5.2 chips (home reads BigBasket immediately).
3. §5.7 floating cluster + §5.8 tab bar.
4. §5.9/§6.4 cart chrome.
5. §6.5 tracking (gauge + route card).
6. PLP/PDP/search polish, then v2 apps.

Questions or API gaps → `docs/FRONTEND-REQUESTS.md`. Do not edit `src/`, `test/`, or this document.