# AGENTS.md — Blinkit Optimized Dashboard

Seller analytics: Inventory, Sales Performance, Campaign ROI from uploaded Blinkit `.xlsx` reports. Single login, roles `admin` (upload/delete) / `viewer` (read).

**Stack:** Node18+/Express 4 (`express-session`, `multer`, `xlsx`, `bcrypt`) · Angular 20 (standalone, signals) · Supabase Postgres (users only). Report data = local JSON in `data/` (see Open Question).

## Run
```
npm install && cd client && npm install && cd ..
cp .env.example .env   # SUPABASE_URL, SUPABASE_SERVICE_KEY, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, PORT=3000
npm run seed           # create admin (needs db/schema.sql run in Supabase first)
npm run dev            # express(nodemon) + ng serve
npm start              # build client + express (prod)
```
Other: `serve` (express only), `build:client`, `dev:client`, `install:client`. App: `localhost:3000` → `/login` (static) → `/app/` (Angular).

## Layout
```
server.js              routes, uploads, endpoints
routes/auth.js         /api/login|logout|me
middleware/auth.js     requireAuth, requireAdmin
db/                    schema.sql, supabase.js, seed-admin.js
parser/
  columnMap.js         Blinkit header -> internal field (ONLY place for raw header names)
  parseReport.js       inventory
  parseSales.js        sales + city/product aggregation
  parseCampaign.js     Blinkit ad export (.xls/.xlsx, daily rows) -> { uploads, rows }
  brandResolver.js     ONLY place that decides a brand (explicit col -> alias -> name parse -> "Unknown")
  snapshotHistory.js   inventory snapshot log (data/history.json), 45/60d calc
  salesHistory.js      city trend snapshots
  campaignStore.js     raw daily rows (data/campaignData.json) + query-time aggregation
client/src/app/
  core/    api.service (ALL http), auth.guard, auth.service, feeder-map.ts, formatters.ts, models.ts, ui-state.service
  layout/  app-shell.component (sidebar+header+outlet)
  pages/   inventory-page | sales-page | campaign-page (.component.ts)
  shared/  brand-mark.component, brand-filter.component (brand chip bar)
public/                legacy; only login.html, login.js, style.css are live. Don't extend the rest.
data/ (gitignored: latest.json, history.json...)   uploads/ (temp, auto-cleaned)
```
Routes: `/app/inventory` (default), `/app/sales-performance`, `/app/campaign-analysis`.

## API (all `/api/*`; R = any logged-in, A = admin; uploads are multipart field `report`)
**Inventory:** `POST upload` A · `GET products` R · `GET summary` R · `DELETE products?productName&warehouseName` A · `POST products/restore {row,index}` A
**Sales:** `POST sales-upload` A · `GET city-performance` · `GET sales-summary` · `GET product-sales?product` · `GET product-city-sales` · `GET brand-sales?brand` (all R) · `DELETE city-performance/:city` A · `POST city-performance/restore` A (incl. history) · `DELETE sales-history` A (wipes all + trends)
**Campaign** (query: `periodKey`, `brand`, `sheetType`=PRODUCT_BOOSTING|PRODUCT_RECOMMENDATION, omit for both): `POST campaign-upload` A (multipart `report`; `?dryRun=1` returns what would be replaced) · `GET campaign-analysis` (campaigns[] + brandSummaries[]) · `GET campaign-summary` · `GET campaign-brands` · `GET campaign-detail?periodKey&sheetType&campaignId` (targeting + daily) (all R) · `DELETE campaign-analysis {periodKey,sheetType,campaignId}` A returns `undoToken` · `POST campaign-analysis/restore {undoToken}` A (token held in server memory; lost on restart)
**Lookups:** `GET product-names`, `GET brand-names` (R; includes campaign brands) · `POST brand-alias {raw,canonical}` A (teaches brandResolver; saved to data/brandAliases.json)
**Export (R):** `GET export`, `export-campaign?periodKey&brand&sheetType` (summary + daily sheets), `export-all?periodKey` → .xlsx

## Domain rules (intentional, don't "fix")
- Stock: Out = 0, Low ≤ `LOW_STOCK_THRESHOLD` (10, in server.js), else OK.
- 45/60-day sold are computed from upload history (Blinkit only gives 7/15/30). Needs an upload ~30 days before latest (±`ANCHOR_TOLERANCE_DAYS`=5 in snapshotHistory.js). Otherwise shows "Insufficient data".
- Sales: city revenue change % vs previous upload; tiers top/low by revenue distribution; metrics = revenue, units, orders, AOV, best product.
- Campaign: the Blinkit export is one row per day x campaign x targeting value, in two sheets (Product Boosting has Targeting Value/Match Type/Position; Recommendation does not). Sheet type is detected from headers, never the sheet name. Re-upload replaces by (periodKey, sheetType); periodKey is derived per row from the DD-MM-YYYY date. Aggregation happens at query time; ROAS/ROI/CPM are recomputed from sums, never averaged. The export has no status/duration, so the UI has none. The old aggregated store is auto-moved to data/campaignData.v1.json.
- Brands: resolved server-side only; campaigns whose name does not resolve fall back to the upload file name (a multi-brand file named "Oicia..." puts unmatched campaigns under Oicia); aliases only affect future uploads (brandResolver.js); client `brandFor()` just reads `row.brandName`. Unresolvable -> "Unknown" (no first-word guessing). Default aliases live in code; admin additions in data/brandAliases.json.
- Feeder scoping: `core/feeder-map.ts` maps warehouse regions (Mumbai, Ahmedabad, Lucknow, Rajpura, Bengaluru, Faridabad, Kolkata, Pune, Kundli, Hyderabad, Nagpur, Jaipur) → cities. Cities can appear under several feeders (Delhi, Vadodara, Chandigarh…). Expected.

## Conventions
- Parsing in `parser/`, not `server.js`. Blinkit renames a column → edit `columnMap.js` only.
- Writes: `requireAdmin`. Reads: `requireAuth`.
- Every delete returns what's needed for undo; keep its `restore` endpoint in sync.
- Angular: standalone only, signals, HTTP only via `ApiService`, types in `models.ts`. Login stays static HTML.
- Never expose/log `SUPABASE_SERVICE_KEY`; never commit `.env`.
- New env var → update `.env.example`. New endpoint → update this file.

## Open question
`db/schema.sql` creates `admin_users`, `inventory_products`, `snapshot_history`, `upload_meta`, but report data is described as local JSON. Check what the code actually reads/writes before touching storage.

## Done checklist
`npm run dev` boots and Angular compiles; parser changes tested with a real export (campaign: samples/Oicia Campaign Sheet.xls -> 1168 + 80 rows).