# AGENTS.md — Blinkit Optimized Dashboard

Seller analytics: Inventory, Sales Performance, Campaign ROI from uploaded Blinkit `.xlsx` reports. Single login, roles `admin` (upload/delete) / `viewer` (read).

**Stack:** Node18+/Express 4 (`express-session`, `multer`, `xlsx`, `bcrypt`) · Angular 20 (standalone, signals) · Supabase Postgres (users + report data in `kv_store`, see Data persistence).

## Run
```
npm install && cd client && npm install && cd ..
cp .env.example .env   # SUPABASE_URL, SUPABASE_SERVICE_KEY, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, PORT=3000
npm run seed           # create admin (needs db/schema.sql run in Supabase first)
node scripts/migrate-json-to-kv.js [--dry-run|--force]   # one-time import of old data/*.json into kv_store
node scripts/kv-smoke.js                                 # set/get/delete a __test__ key, re-init
npm run dev            # express(nodemon) + ng serve
npm run build        # install client deps + build client (does not start express)
npm start              # require-build check + express (prod); errors if client/dist is missing
npm run deploy         # same as start (kept for older docs/scripts)
npm run render-build   # Render build step: root deps (no dev) + client deps + client build; Render start = `node server.js`
```
Other: `serve` (express only, no build check), `build:client` (build only, does not start), `dev:client`, `install:client`. App: `localhost:3000` → `/login` (static) → `/app/` (Angular).

## Layout
```
server.js              routes, uploads, endpoints
routes/auth.js         /api/login|logout|me
middleware/auth.js     requireAuth, requireAdmin
db/                    schema.sql, supabase.js, seed-admin.js
store/kv.js            ONLY place that touches kv_store (report data)
scripts/               require-build.js, migrate-json-to-kv.js, kv-smoke.js
parser/
  columnMap.js         Blinkit header -> internal field (ONLY place for raw header names)
  parseReport.js       inventory
  parseSales.js        sales + city/product aggregation
  parseCampaign.js     Blinkit ad export (.xls/.xlsx, daily rows) -> { uploads, rows }
  brandResolver.js     ONLY place that decides a brand (explicit col -> alias -> name parse -> "Unknown")
  snapshotHistory.js   inventory snapshot log (kv `history`), 45/60d calc
  salesHistory.js      city trend snapshots
  campaignStore.js     raw daily rows (kv `campaignData`) + query-time aggregation
  salesMonthly.js      monthly sales (kv `salesMonthly`): one slot per (brand, order-date month)
  brandOverview.js     builds GET brand-overview from already brand-filtered data (pure)
client/src/app/
  core/    api.service (ALL http), auth.guard, auth.service, feeder-map.ts, formatters.ts, models.ts, ui-state.service
  layout/  app-shell.component (sidebar+header+outlet)
  pages/   brand-overview-page | inventory-page | sales-page | monthly-page | campaign-page (.component.ts)
  shared/  brand-mark.component, brand-filter.component (brand chip bar)
public/                static login page only: login.html, login.js, style.css (legacy dashboard files removed)
data/ (gitignored; legacy JSON, read only by the migration script)   uploads/ (temp, auto-cleaned)
```
Routes: `/app/overview` (default), `/app/sales-performance` (Sales), `/app/inventory` (Stock), `/app/campaign-analysis` (Advertising), `/app/monthly-comparison` (Trends). Page and nav names are plain: Overview, Sales, Stock, Advertising, Trends; the sidebar title is "Analytics" and the brand switcher sits at the top of the sidebar.

## API (all `/api/*`; R = any logged-in, A = admin; uploads are multipart field `report`)
**Inventory:** `POST upload` A · `GET products` R · `GET summary` R · `DELETE products?productName&warehouseName` A · `POST products/restore {row,index}` A
**Sales:** `POST sales-upload` A · `GET city-performance` · `GET sales-summary` · `GET product-sales?product` · `GET product-city-sales` · `GET brand-sales?brand` (all R) · `DELETE city-performance/:city` A · `POST city-performance/restore` A (incl. history) · `DELETE sales-history` A (wipes all + trends)
**Campaign** (query: `periodKey`, `brand`, `sheetType`=PRODUCT_BOOSTING|PRODUCT_RECOMMENDATION, omit for both): `POST campaign-upload` A (multipart `report` + optional `campaignBrands` JSON `{campaignName: brand}` to label unresolved campaigns one by one, + optional `defaultBrand` as a one-brand-for-all fallback; `?dryRun=1` returns `plan[]` (one item per period x sheet x brand, incl. `brandName` and `removedCampaigns`), `unresolved[]`, `skippedRows`, `unrecognisedSheets`) · `GET campaign-analysis` (campaigns[] + brandSummaries[]) · `GET campaign-summary` · `GET campaign-brands` · `GET campaign-detail?periodKey&sheetType&campaignId` (targeting + daily) (all R) · `DELETE campaign-analysis {periodKey,sheetType,campaignId}` A returns `undoToken` · `POST campaign-analysis/restore {undoToken}` A (token held in server memory; lost on restart)
**Monthly sales:** `POST sales-month-upload` A (multipart `report`; only adds months, never changes the Sales tab view; dup guard kind `salesMonthly`) · `GET sales-months?brand` · `GET sales-month-compare?months=YYYY-MM,...&brand` (max 12) (both R) · `DELETE sales-month?brand&month` A returns `removed` slot · `POST sales-month/restore {slot}` A. `POST sales-upload` also files its months.
**Brand overview:** `GET brand-overview?brand` R (sales, inventory, campaign = brand's latest campaign month, months; a section is null when nothing was uploaded). `sales.from`/`to` = order dates covered by the brand's latest sales upload (stored in `salesLatest.brandUploads[brand]` since v7; null for older uploads). Overview cards link to their detail pages; no in-place expansion (kept deliberately simple).
**Lookups:** `GET product-names`, `GET brand-names` (R; includes campaign and monthly brands) · `POST brand-alias {raw,canonical}` A (teaches brandResolver; saved to kv `brandAliases`)
**Duplicate guard:** an upload endpoint skips (200 `{duplicate:true,skipped:true}`) a file whose SHA-256 was already processed today for that kind (hashes in kv `uploadHashes`, parser/uploadGuard.js); `?force=1` bypasses it and any delete/clear for that kind forgets the hashes.
**Export (R):** `GET export`, `export-campaign?periodKey&brand&sheetType` (summary + daily sheets), `export-all?periodKey` → .xlsx

## Domain rules (intentional, don't "fix")
- Stock: Out = 0, Low ≤ `LOW_STOCK_THRESHOLD` (env, default 10), else OK.
- 45/60-day sold are computed from upload history (Blinkit only gives 7/15/30). Needs an upload ~30 days before latest (±`ANCHOR_TOLERANCE_DAYS`=5 in snapshotHistory.js). Otherwise shows "Insufficient data".
- Sales: city revenue change % vs previous upload; tiers top/low by revenue distribution; metrics = revenue, units, orders, AOV, best product.
- Monthly sales: each order is filed under the month of its Order Date (YYYY-MM-DD, DD-MM-YYYY or Excel serial; unreadable dates are skipped and counted). Re-upload replaces only that (brand, month). A month is "partial" when its orders don't span the 1st to the last day. With all brands, orders are summed per brand (same as Sales). Change % = first vs last selected month.
- Campaign: the Blinkit export is one row per day x campaign x targeting value, in two sheets (Product Boosting has Targeting Value/Match Type/Position; Recommendation does not). Sheet type is detected from headers, never the sheet name. Re-upload replaces by (periodKey, sheetType, brandName), and only for the brands present in the file; other brands in the same period/sheet type are untouched. periodKey is derived per row from the DD-MM-YYYY date. Aggregation happens at query time; ROAS/ROI/CPM are recomputed from sums, never averaged. The export has no status/duration, so the UI has none. A stored campaignData without a `rows` array (old aggregated format) is treated as empty with a warning.
- Brands: resolved server-side only; campaigns whose name does not resolve use, in order: `campaignBrands` label (admin picks per campaign in a queue) -> `defaultBrand` -> the upload file name (a multi-brand file named "Oicia..." puts unmatched campaigns under Oicia); aliases only affect future uploads (brandResolver.js); client `brandFor()` just reads `row.brandName`. Unresolvable -> "Unknown" (no first-word guessing). Default aliases live in code; admin additions in kv `brandAliases`.
- Feeder scoping: `core/feeder-map.ts` maps warehouse regions (Mumbai, Ahmedabad, Lucknow, Rajpura, Bengaluru, Faridabad, Kolkata, Pune, Kundli, Hyderabad, Nagpur, Jaipur) → cities. Cities can appear under several feeders (Delhi, Vadodara, Chandigarh…). Expected.

## Conventions
- Parsing in `parser/`, not `server.js`. Blinkit renames a column → edit `columnMap.js` only.
- Writes: `requireAdmin`. Reads: `requireAuth`.
- Every delete returns what's needed for undo; keep its `restore` endpoint in sync.
- Angular: standalone only, signals, HTTP only via `ApiService`, types in `models.ts`. Login stays static HTML.
- Never expose/log `SUPABASE_SERVICE_KEY`; never commit `.env`.
- New env var → update `.env.example`. New endpoint → update this file.

## Unused tables
`db/schema.sql` also creates `inventory_products`, `snapshot_history`, `upload_meta`; nothing reads or writes them. Report data is in `kv_store`.

## Done checklist
`npm run dev` boots and Angular compiles; parser changes tested with a real export (campaign: samples/Oicia Campaign Sheet.xls -> 1168 + 80 rows).

## Inventory storage (per brand)
- kv `latest` = { rows, brandUploads:{brand:{date,fileName}} }. An upload replaces only the brands in that file; other brands stay. Empty Brand Name -> file name -> "Unknown".
- kv `history` keeps every upload (entries carry brandName). A same-day re-upload replaces only that item+warehouse; nothing else is ever deleted.
- 45/60d sold: 45d = sold30(now)+sold15(snapshot ~30d back) or sold15(now)+sold30(snapshot ~15d back), whichever anchor is closest to its ideal date; 60d = sold30(now)+sold30(snapshot ~30d back). Anchors must be within +/-5 days (ANCHOR_TOLERANCE_DAYS). Otherwise "n/a". Computed at upload time.

## Brand-first data model (all tabs)
- Brand is the primary filter. The sidebar dropdown and each tab chip bar share `ui.focusedBrand`; every tab re-queries with it (server-side `?brand=`).
- Meeting mode: while a brand is selected, the brand chip bars, the campaign Brand Performance table and the unknown-brand notice are hidden, so no other brand is ever on screen. Switch brands from the sidebar; "All brands" restores everything.
- Inventory, Sales and Campaign data are all stored per brand and an upload replaces only the brands inside that file. Empty brand in a file -> file name -> "Unknown".
- Sales: kv `salesLatest` = { brandUploads, cityRows } with one row per (brand, city) and its own trend vs that brand's previous upload (kv `salesHistory` entries carry brandName). `GET city-performance?brand=` combines brand rows per city (orders are summed per brand, so a mixed-brand order counts once per brand) and also returns brandSummaries for the chips. `DELETE city-performance/:city` removes the city for all brands (offered only in the unfiltered view).
- Clear data always asks which brand (or all): `DELETE inventory-data?brand=` (history kept), `DELETE sales-history?brand=` (removes that brand's trend history), `DELETE campaign-data?brand=` (all months). Shared UI: shared/clear-data-dialog.component.ts.

## Deployment (Render)
- Build: `npm run build`. Start: `npm run serve`.
- Render's filesystem is ephemeral. Do not rely on local files for anything that must survive a deploy.
- Sessions are in memory (everyone is logged out on restart). campaignTrash undo tokens are also in memory.

## Data persistence (after v6)
- All report data lives in Supabase table `kv_store` (key -> jsonb), accessed ONLY through store/kv.js. No fs reads/writes under data/ outside the one-time migration script.
- Startup: `kv.init()` loads every row before `listen`; on failure the process exits (never starts empty).
- `kv.get` returns a clone (mutate freely, then `await kv.set`). `kv.peek` returns the cached object with no copy: READ-ONLY, used for hot read paths (campaign queries, history lookups, aliases, hashes). `set` upserts first and updates the cache only on success; writes per key are serialized.
- Data-changing routes are wrapped in `mutating()` (server.js): one at a time via `kv.withLock`, every write awaited, 500 if a save fails (upload parse errors stay 400).
- Write order in multi-write routes: history before the current view, upload hash last (only after the data is saved). City delete removes history first; city restore re-adds history (de-duplicated) before the view.
- Keys: latest, history, salesLatest, salesByProduct, salesHistory, campaignData, brandAliases, uploadHashes, salesMonthly.

## Look and feel (v7 Pro theme)
- The flat "Pro theme" block at the end of `public/style.css` overrides the older glass styles through the same tokens (light and dark). Use the tokens (`--surface`, `--surface-alt`, `--border`, `--text`, `--text-muted`, `--accent`, `--success`, `--danger`), never raw colours. Sentence case for every label and heading.
- Planned features show a shared "Coming soon" page (`pages/coming-soon-page.component.ts`, title and text from route data): Reports (`/reports`), Uploads (`/uploads`, admin-only in the sidebar), Present (`/present`), and the platform tabs All / Zepto / Flipkart Minutes (`/platforms/...`). When one is built, replace its route's component; keep the button where it is.
- Overview layout: header with platform tabs (Blinkit active), period pill, Present and Create report; four headline cards (Revenue, Orders, Units in stock, Return on ad spend), each opening its page; a change vs last month only when the latest sales upload is the latest full month; panels: Revenue by month, Top cities, Top products, Best sellers in stock.
- Single server instance only.

## Review fixes & enhancements (v6)
- Inventory: incoming inventory calculation reads "Incoming scheduled inventory" only (was double-counted with net).
- Inventory cards: summary is a computed signal over rows and filters (no card freeze on brand switch); 401 redirects to /login on session expiry.
- Campaign Analysis: dry-run detects campaigns with "Unknown" brands and prompts the admin with a one-at-a-time brand queue (each campaign labelled separately, or "apply to all remaining") before uploading; the replace warning is then shown per brand; clarifies replaced campaigns and skipped rows.
- Sales Feeder view: aggregated City totals table per mapped city across all products.