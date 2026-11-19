# Blinkit Optimized Dashboard

A brand-first analytics dashboard for **Blinkit** sellers and the agencies that run their accounts. Upload Blinkit's Excel reports and get stock health, sales by city, month-by-month trends, advertising performance, profit, client-ready reports, and a brand strategy scorecard, all behind a role-based login.

- **Backend:** Node.js 18+ / Express 4
- **Frontend:** Angular 20 (standalone components, signals)
- **Storage:** Supabase (PostgreSQL): user logins plus all report data in one key-value table
- **Hosting:** built for a single Render web service

---

## Contents

- [What it does](#what-it-does)
- [Roles and permissions](#roles-and-permissions)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Deploying to Render](#deploying-to-render)
- [Project structure](#project-structure)
- [How the data works](#how-the-data-works)
- [Business rules](#business-rules)
- [API reference](#api-reference)
- [Testing](#testing)
- [Security notes](#security-notes)
- [Limits to know about](#limits-to-know-about)
- [Maintenance](#maintenance)
- [License](#license)

---

## What it does

Everything is organised around one **brand**. Pick a brand in the sidebar and every page shows only that brand.

| Page | Route | What it gives you |
|---|---|---|
| **Overview** | `/app/overview` | Headline cards (revenue, orders, units in stock, return on ad spend), revenue by month, top cities, top products, best sellers in stock. A month picker re-cuts sales and ads for any month on record. |
| **Sales** | `/app/sales-performance` | Three tabs. *City wise*: revenue, units, orders, AOV, best product, tiers, trend vs the previous upload, feeder-warehouse scoping. *Product wise*: per-product totals with a city breakdown. *Month by month*: pick one or several products and compare months, with wins, a revenue chart, a city table, and profit before ads. |
| **Stock** | `/app/inventory` | Product x warehouse grid with a status per row (see [Stock status](#stock-status)), 7/15/30/45/60-day units sold, incoming stock, days of stock, surge flags, search, sort, totals. |
| **Advertising** | `/app/campaign-analysis` | Spend, impressions, add to cart, quantity sold, sales, ROAS and new users. Daily trend chart, campaign table with direct/indirect toggles, brand performance table, campaign detail with targeting values. |
| **Trends** | `/app/monthly-comparison` | Compare up to 12 months of sales for a brand. |
| **Profit** | `/app/profit` | Net profit or loss by month, product or city, from a cost sheet plus typed costs, with ad spend shared out. Needs the `profit` permission. |
| **Strategy** | `/app/strategy` | A hand-written 10-pillar brand plan with must-do ticks, an M1 to M6 roadmap with gates, and add-ons. Health pills and top actions come from the brand's own numbers. An optional AI box writes brand-specific wording. |
| **Reports** | `/app/reports` | A 16:9 client report for one brand (pick months and sections), exported to PDF through the browser's print dialog. |
| **Uploads** | `/app/uploads` | One place to upload every report type, see what exists per brand, undo the last upload of a type, and delete a whole brand. Needs the `upload` permission. |
| **Users** | `/app/users` | Create users, set roles and passwords, tick which brands each user can see, deactivate accounts. Needs the `manageUsers` permission. |
| **Profile** | `/app/profile` | Account details and the Pro / Glass look switch (saved per browser). |

Also included:

- **Presentation mode** (`Present` on Overview): fullscreen, brand-only, no admin controls, no downloads, no per-product profit. Meant for client meetings. It is a display mode, not access control; for client-facing screens log in with an account that lacks the `profit` permission.
- **Undo everywhere:** every delete returns what is needed to restore it, and the latest upload of each report type can be undone from the Uploads page.
- **Duplicate-upload guard:** a file already processed today is skipped (override with `?force=1`).
- **Excel exports** for stock, sales, advertising, and a combined full report.
- **Sessions that survive restarts**, stored in Supabase.
- **Planned, shown as "Coming soon":** the platform tabs (All, Zepto, Flipkart Minutes).

---

## Roles and permissions

All permissions live in one table: [`config/permissions.js`](config/permissions.js). The server and the Angular app both read it, so changing a value there is the only edit needed.

| Role | Brands | Profit | Upload | Delete | Download | Manage users |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `admin` | all | yes | yes | yes | yes | yes |
| `moderator` | all | yes | yes | no | yes | no |
| `ecom_manager` | ticked only | yes | no | no | yes | no |
| `ecom_executive` | ticked only | no | no | no | yes | no |

> The values in `config/permissions.js` are **placeholders until the team confirms them**. Review that file before giving accounts to real users. A role name that is not in the table gets no access at all.

How access is enforced:

- Every `/api` call loads the user's role, brands and active flag from storage (not from the session cookie), so a change by an admin applies on the user's next click. A deactivated user gets `401`.
- Users without the all-brands permission must name one of their own brands on every request. Any other brand, real or invented, returns the same `404 Not found.`, and JSON responses are scrubbed so other brand names never leave the server.
- Uploading also requires the all-brands permission.
- The last active admin cannot be demoted or deactivated. Resetting a password or deactivating a user ends their sessions immediately.

---

## Architecture

```
Browser
  /login  (static HTML)            /app/*  (Angular 20 SPA)
        |                                 |
        v                                 v
+--------------------------------------------------------------+
|                    Express server (:3000)                    |
|                                                              |
|  /health, /api/login|logout|me          (public)             |
|  auth gate -> loadAccount -> brandGuard -> requirePerm(...)  |
|                                                              |
|  routes/users.js      routes/strategy.js      server.js      |
|  parser/*  (pure Excel parsing and number crunching)         |
|  store/kv.js  (in-memory copy, write-through to Supabase)    |
+------------------------------+-------------------------------+
                               |
                               v
                  Supabase (PostgreSQL)
                  admin_users  : logins, roles (bcrypt hashes)
                  kv_store     : every report, setting and session
```

Design points:

- **Parsing lives in `parser/`**, not in `server.js`. Most parser modules are pure functions that read nothing themselves, which is what makes them testable offline.
- **`store/kv.js` is the only code that touches `kv_store`.** It loads every row into memory at startup, serves reads from memory, and writes to Supabase first, updating memory only after the write succeeds.
- **Data-changing routes run one at a time** (`mutating()` wrapper with a lock), await every write, and return `500` if a save fails.
- **The login page is static HTML** on purpose, outside Angular, for a fast first load.

---

## Quick start

### Prerequisites

- Node.js 18 or newer, npm 9 or newer
- A free [Supabase](https://supabase.com) project

### 1. Clone

```bash
git clone https://github.com/Harsh-suiwal/Blinkit-optimized-dashboard.git
cd Blinkit-optimized-dashboard
```

### 2. Create the database tables

In the Supabase **SQL Editor**, run [`db/schema.sql`](db/schema.sql). The tables the app uses are `admin_users` (logins) and `kv_store` (everything else). The file also creates `inventory_products`, `snapshot_history` and `upload_meta`, which nothing reads or writes; you can skip or drop them.

Then copy the **Project URL** and the **service_role key** from **Settings > API**.

### 3. Configure

```bash
cp .env.example .env
```

Fill in the values (see [Environment variables](#environment-variables)). Never commit `.env`.

### 4. Install

```bash
npm install
npm --prefix client install
```

### 5. Create the first admin

```bash
npm run seed
```

This creates or updates the admin in `admin_users` from `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Both variables are required; the seed exits without writing an account when either is missing. Change the password after the first login.

### 6. Run

Development (Express with auto-reload plus the Angular dev server):

```bash
npm run dev
```

Production build, then start:

```bash
npm run build
npm start
```

Open <http://localhost:3000>, log in, and you land on `/app/overview`.

### Optional: import data from an old version

If you have `data/*.json` files from before the Supabase move:

```bash
node scripts/migrate-json-to-kv.js --dry-run   # list keys and sizes, write nothing
node scripts/migrate-json-to-kv.js             # upload (refuses if kv_store already has rows)
node scripts/migrate-json-to-kv.js --force     # overwrite
```

`node scripts/kv-smoke.js` checks the server can write, read and delete in `kv_store`.

---

## Environment variables

Defined in `.env.example`. Names only here; never put real values in the README.

| Variable | Required | Default | Purpose |
|---|:-:|---|---|
| `SUPABASE_URL` | yes | | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | yes | | Supabase **service-role** key. Server only; never expose it to a browser. |
| `SESSION_SECRET` | yes in production | random per run | Signs session cookies. The server refuses to start in production without it. Changing it logs everyone out. |
| `ADMIN_EMAIL` | for `npm run seed` | | First admin's email |
| `ADMIN_PASSWORD` | for `npm run seed` | | First admin's password |
| `PORT` | no | `3000` | Server port |
| `NODE_ENV` | set on the host | | `production` turns on secure (HTTPS-only) cookies, so serve the app over HTTPS |
| `TZ` | no | `Asia/Kolkata` | Business timezone used to date uploads (IANA name) |
| `OPENROUTER_API_KEY` | no | | Key for the optional AI box on the Strategy tab. Without any AI key the scorecard and plan still work. |
| `ANTHROPIC_API_KEY` | no | | Alternative AI key, used when no OpenRouter key is set |
| `STRATEGY_MODEL` / `STRATEGY_MODELS` | no | | Model id (or comma-separated list, tried in turn) for the AI box |

`LOW_STOCK_THRESHOLD` and `PRODUCT_PROFIT_ADMIN_ONLY` from older versions are **no longer used** (and are safe to delete from `.env`). Stock status is now days-of-cover based (see [Stock status](#stock-status)), and profit visibility comes from the role's `profit` permission.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Express (nodemon) and the Angular dev server together |
| `npm run build` | Clean-install root deps (no dev) and client deps, then build the Angular client. Does **not** start the server. |
| `npm start` | Check that a client build exists, then start Express. Fails with a hint if it does not. |
| `npm run deploy` | Same as `npm start` |
| `npm run serve` | Start Express only, no build check |
| `npm run render-build` | Render's build step (same as `build`) |
| `npm run seed` | Create or update the admin user |
| `npm run build:client` / `dev:client` / `install:client` | Client-only build, dev server, clean install |

---

## Deploying to Render

1. Create a **Web Service** from the repo.
2. **Build command:** `npm run build`
3. **Start command:** `npm start` (or `node server.js`)
4. Set the environment variables above, including `NODE_ENV=production`, `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
5. Run `npm run seed` once (locally, pointed at the same Supabase project) to create the first admin.
6. **Run exactly one instance.** Each instance keeps its own in-memory copy of the data.
7. On the free tier, point an uptime monitor (for example UptimeRobot, every 10 minutes) at `GET /health` so the service stays awake. It returns `{ "ok": true }` with no login and no data.

Render's disk is ephemeral and that is fine: nothing that must survive a deploy is stored on disk. Reports, settings and sessions all live in Supabase, so redeploys and restarts do not lose data or log users out (as long as `SESSION_SECRET` stays the same).

---

## Project structure

```
server.js                 Express app: upload handling and most API routes
config/permissions.js     Role permission table (single source of truth)
middleware/               auth.js (requireAuth), access.js (account load, brand guard, requirePerm)
routes/                   auth.js, users.js, strategy.js
db/                       schema.sql, supabase.js, seed-admin.js
store/                    kv.js, sessionStore.js, accounts.js, brandRegistry.js, uploadUndo.js
parser/                   Excel parsers and report maths (see below)
strategy/                 basePlan.js (the hand-written plan), playbook.md
scripts/                  require-build.js, migrate-json-to-kv.js, and the *-smoke.js tests
public/                   login.html, login.js, style.css (static login page and shared styles)
docs/                     kv-migration-plan.md (history of the Supabase move)
client/                   Angular 20 app
  src/app/core/           api.service (all HTTP), guards, auth, models, formatters, feeder-map, report-render
  src/app/layout/         app-shell (sidebar, header, router outlet)
  src/app/pages/          one component per page
  src/app/shared/         brand filter, brand mark, clear-data dialog
data/                     Legacy JSON, read only by the migration script (gitignored)
uploads/                  Temporary upload files (auto-cleaned, gitignored)
```

Key parser modules:

| File | Job |
|---|---|
| `columnMap.js` | Raw Blinkit header to internal field name. The **only** place raw headers appear. |
| `brandResolver.js` | The **only** place that decides a row's brand |
| `parseReport.js`, `parseSales.js`, `parseCampaign.js`, `parseBrandCosts.js` | File parsers for stock, sales, advertising, cost sheets |
| `snapshotHistory.js`, `salesHistory.js`, `salesMonthly.js`, `campaignStore.js`, `brandCosts.js` | Stored history and per-brand data |
| `stockStatus.js` | Stock status rules |
| `profitView.js`, `brandProfit.js` | Profit maths |
| `brandOverview.js`, `brandReport.js`, `strategyScorecard.js` | Pure builders for Overview, Reports, Strategy |
| `uploadGuard.js` | Duplicate-upload detection by file hash |

---

## How the data works

### Storage

All report data is stored in the Supabase table `kv_store` (`key` text, `value` jsonb), one JSON document per key. Keys in use:

`latest`, `history`, `salesLatest`, `salesByProduct`, `salesHistory`, `salesMonthly`, `campaignData`, `brandCosts`, `brandAliases`, `brandRegistry`, `uploadHashes`, `userProfiles`, `strategyTab`, `uploadUndo:<kind>`, `session:<sid>`.

Why a key-value store: Blinkit's export columns keep changing, so the app keeps flexible JSON documents instead of fixed relational tables. The table has row-level security on with no policies, so only the server's service-role key can read or write it.

Startup order: `kv.init()` loads every row, then the server listens. If the load fails the process exits; it never starts with an empty store.

### Uploads

Upload any `.xls` or `.xlsx` up to 25 MB as multipart field `report`.

| Report | Replaces on re-upload |
|---|---|
| Stock | Only the brands inside the file |
| Sales | Only the brands inside the file; also files the file's months into monthly sales |
| Monthly sales | Only that (brand, month) |
| Advertising | By (period, sheet type, brand), only for brands present in the file |
| Cost sheet | The brand's products (typed costs are kept) |

If a row has no brand, the file name is used; failing that, `Unknown`. Advertising files with campaigns whose brand cannot be worked out trigger a dry run and a one-by-one brand-assignment queue before anything is saved.

---

## Business rules

These are deliberate. Do not "fix" them without checking with the team.

### Stock status

Per product and warehouse: `sales per day = units sold in 30 days / 30`, `days of stock = stock / sales per day`.

| Status | Meaning |
|---|---|
| Healthy | At least 60 days of stock |
| Covered by Incoming | Below the healthy line, but incoming stock covers it |
| Reorder Now | Below 60 days; place an order |
| Reorder Urgently | Below the 15-day lead time; runs out before a new order arrives |
| Awaiting Incoming | No stock, incoming stock on the way |
| Out of Stock | No stock |
| No Recent Sales | Nothing sold recently |

Thresholds (`HEALTHY_DAYS` 60, `LEAD_TIME_DAYS` 15, surge settings) are in `parser/stockStatus.js`. A surge (last 7 days well above what the earlier weeks predict) is flagged but does not change status by default.

### The 45 / 60-day columns

Blinkit only reports 7, 15 and 30-day windows. 45 and 60-day figures are computed at upload time from your own upload history, which needs an upload about 30 days before the latest one (within `ANCHOR_TOLERANCE_DAYS`, 5, in `parser/snapshotHistory.js`). Until then the columns show "n/a" / "Insufficient data". That is intended. Clearing the stock history resets this clock.

### Sales and months

- City revenue change % compares against the same brand's previous upload. City tiers (top / low) come from the revenue distribution.
- Monthly sales file each order under its order-date month. A month is **partial** when the orders do not span the 1st to the last day. Partial months are never compared, and a zero base is never used for a percentage.
- Feeder scoping maps Blinkit warehouse regions to cities in `client/src/app/core/feeder-map.ts` (Mumbai, Ahmedabad, Lucknow, Rajpura, Bengaluru, Faridabad, Kolkata, Pune, Kundli, Hyderabad, Nagpur, Jaipur). A city can appear under several feeders (Delhi, Vadodara, Chandigarh). That is expected.

### Advertising

- Blinkit's export is one row per day x campaign x targeting value, in two sheet types (Product Boosting, Product Recommendation), detected from headers, never the sheet name.
- Aggregation happens at query time. ROAS and CPM are recomputed from sums, never averaged.
- There is **no Advertising ROI**, on purpose: it only repeated ROAS and read like profit. The Profit tab's ROI (profit / costs) is a different figure.

### Profit

- Net sales = gross revenue / (1 + GST %), using the cost sheet's Tax %.
- Costs = units x COGS + commission + inward + fulfilment + storage + ad spend + other expenses. Profit = net sales - costs. Margin = profit / net sales. ROI = profit / costs.
- A value typed on the Profit tab beats the uploaded cost sheet, which beats the defaults (GST 18%, commission 0%, inward 5, fulfilment 50, storage 30 rupees per unit).
- Ad spend and other expenses are brand-wide and shared across a month's priced products by gross sales. Products without COGS are shown in sales but left out of profit.
- Per-product profit elsewhere is labelled **profit before ads** and is shown only to users with the `profit` permission.
- Rows are rounded so they add up to the total, and every grouping gives the same total.

### Brands

Resolved server-side only, in this order: explicit column, alias, name parse, then `Unknown`. Aliases affect future uploads only.

---

## API reference

All routes are under `/api`, return JSON, and need a session cookie unless marked public. Access is shown as the permission required: **Any** means any logged-in user. Uploads are multipart with the file in field `report`. Mutating routes return `500` if saving fails; parse problems return `400`.

### Auth and health

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/health` | Public | Uptime ping |
| `POST` | `/api/login` | Public | `{ email, password }`. Limited to 10 failed attempts per IP per 15 minutes. |
| `POST` | `/api/logout` | Any | End the session |
| `GET` | `/api/me` | Any | Current user, role, permissions, brands |

### Stock

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/upload` | upload | Upload a stock report |
| `GET` | `/api/products`, `/api/summary` | Any | Rows and summary for the latest upload (`?brand=`) |
| `DELETE` | `/api/products?productName&warehouseName` | deleteData | Remove one row |
| `POST` | `/api/products/restore` | deleteData | Undo a row delete |
| `DELETE` | `/api/inventory-data?brand&history=1` | deleteData | Clear stock data; `history=1` also resets the 45/60-day history |

### Sales

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/sales-upload` | upload | Upload a sales report (also files its months) |
| `GET` | `/api/city-performance`, `/api/sales-summary`, `/api/product-sales`, `/api/product-city-sales`, `/api/brand-sales` | Any | City, product and brand views |
| `DELETE` | `/api/city-performance/:city` | deleteData | Remove a city (all brands) |
| `POST` | `/api/city-performance/restore` | deleteData | Undo, including trend history |
| `DELETE` | `/api/sales-history?brand` | deleteData | Clear sales and trend history |

### Monthly sales and product by month

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/sales-month-upload` | upload | Add months only |
| `GET` | `/api/sales-months`, `/api/sales-month-compare?months=YYYY-MM,...` | Any | List and compare (max 12 months) |
| `GET` / `POST` | `/api/product-month-detail` | Any | One product (GET) or several added together (POST `{ brand, products }`) |
| `DELETE` / `POST` | `/api/sales-month`, `/api/sales-month/restore` | deleteData | Remove and restore a month |

### Advertising

Query options: `periodKey`, `brand`, `sheetType` (`PRODUCT_BOOSTING` or `PRODUCT_RECOMMENDATION`, omit for both).

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/campaign-upload` | upload | Upload. `?dryRun=1` returns the plan, unresolved campaigns and skipped rows first. Optional `campaignBrands` and `defaultBrand` assign brands. |
| `GET` | `/api/campaign-analysis`, `/api/campaign-summary`, `/api/campaign-brands`, `/api/campaign-detail` | Any | Campaigns, totals, brands, one campaign's targeting and daily data |
| `DELETE` | `/api/campaign-analysis`, `/api/campaign-data?brand` | deleteData | Remove a campaign, or all campaign data |
| `POST` | `/api/campaign-analysis/restore` | deleteData | Undo with the returned `undoToken` (held in server memory; lost on restart) |

### Overview, reports, lookups

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/brand-overview?brand[&month=YYYY-MM]` | Any | Overview data |
| `GET` | `/api/brand-report?brand&months&profit=1` | Any | Client report data. Profit is included only if the user has the profit permission. |
| `GET` | `/api/product-names`, `/api/brand-names` | Any | Lookups |
| `POST` | `/api/brand-alias` | upload | Teach the brand resolver `{ raw, canonical }` |
| `DELETE` | `/api/brand?brand[&typed=1]` | deleteData | Delete a whole brand's data (`typed=1` also removes hand-typed profit inputs) |

### Profit

`?brand=` is required on all of these.

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/profit-view?brand&groupBy&months&products&cities&includeAds` | profit | Net profit by month, product or city |
| `GET` | `/api/brand-profit` | profit | Brand profit from the uploaded sheet |
| `POST` | `/api/brand-costs-upload` | upload | Upload a cost sheet |
| `POST` | `/api/profit-product-cost`, `/api/profit-settings`, `/api/brand-other-costs` | profit | Typed COGS, GST, commission, fees, monthly other expenses |

### Uploads panel

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/uploads-overview` | upload | What is uploaded per brand, plus the undo list |
| `POST` | `/api/uploads/undo` | upload | `{ kind }`: `inventory`, `sales`, `salesMonthly`, `campaign`, `costs` |

### Strategy

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/strategy/scorecard?brand[&product][&report]` | Any | Health pills, top actions, plan with this brand's facts |
| `PUT` | `/api/strategy/progress`, `/api/strategy/inputs` | Any | Save checklist ticks and manual inputs per brand |
| `POST` | `/api/strategy/generate`, `/api/strategy/clear` | Any | Optional AI wording; cancel or delete a draft or report |
| `GET` | `/api/strategy/quota` | Any | Remaining free AI requests today, when the key reports it |

### Users

All need `manageUsers`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` / `POST` | `/api/users` | List or create users |
| `PATCH` | `/api/users/:id` | Change name, role, brands, active flag |
| `POST` | `/api/users/:id/password` | Set or reset a password |
| `POST` / `DELETE` | `/api/users/brands` | Add or remove a brand name that has no data yet |

### Exports

All need `download`; `export-all` also needs all-brands access.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/export`, `/api/export-sales`, `/api/export-campaign` | One module as `.xlsx` (`?brand=` where it applies) |
| `GET` | `/api/export-all` | Combined multi-sheet workbook |

---

## Testing

The smoke tests run offline: no server and no database needed. Install dependencies first, then run any of them:

```bash
node scripts/access-smoke.js        # roles, brand scoping, permissions
node scripts/session-smoke.js       # session store
node scripts/overview-smoke.js      # brand overview builder
node scripts/profit-smoke.js        # profit maths
node scripts/profit-view-smoke.js   # profit view groupings and checks
node scripts/report-smoke.js        # client report builder
node scripts/strategy-smoke.js      # strategy scorecard
node scripts/uploads-smoke.js       # uploads overview and undo
```

`node scripts/kv-smoke.js` is different: it talks to your real Supabase project (writes and deletes a `__test__` key), so it needs a valid `.env`.

The Express routes themselves are not covered by these tests. Parser changes should also be checked with a real Blinkit export before release.

---

## Security notes

- Passwords are bcrypt-hashed (12 rounds) and never sent back to the browser.
- Sessions use `httpOnly`, `sameSite=lax` cookies, `secure` in production, and a 24-hour lifetime.
- Failed logins are rate limited per IP. The limiter is in memory and resets on restart.
- The Supabase service-role key bypasses row-level security. Keep it server-side only and out of git (`.env` is gitignored).
- `kv_store` has row-level security on with no policies, so nothing but the server can reach it.
- Uploads are limited to `.xls` / `.xlsx` and 25 MB.
- Report HTML on the Reports page is built with every value escaped; keep it that way if you edit `report-render.ts`.
- `npm run seed` requires `ADMIN_EMAIL` and `ADMIN_PASSWORD` and does not print the password.

---

## Limits to know about

- **Single server instance only.** Data is cached in memory per process.
- Each save rewrites the whole JSON document for its key, and the contents cannot be queried with SQL. Fine at this scale; revisit if data grows large.
- Advertising undo tokens live in server memory and are lost on restart. The Uploads page's "Undo the last upload" is stored in Supabase and survives restarts, but only covers the latest upload of each report type.
- The login rate limiter is per process and resets on restart.
- Platform tabs (All, Zepto, Flipkart Minutes) are placeholders.

---

## Maintenance

- **Blinkit renamed a column:** edit `parser/columnMap.js` only.
- **Change what a role can do:** edit `config/permissions.js` only.
- **Change the strategy plan:** edit `strategy/basePlan.js`. Nothing is generated; the AI box only adds brand-specific wording.
- **Change stock thresholds:** edit `STOCK_SETTINGS` in `parser/stockStatus.js`.
- **New environment variable:** add it to `.env.example` and the table above.
- **New endpoint:** add it to the API reference above (and `AGENTS.md`).
- Contributor and AI-assistant conventions, plus the full list of domain rules, are in [`AGENTS.md`](AGENTS.md).

---

## License

Private. For internal use only.