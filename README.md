# 📊 Blinkit Optimized Dashboard

A full-stack analytics dashboard for **Blinkit** sellers to track inventory health, city-level sales performance, and advertising campaign ROI — all from a single authenticated interface.

Built with **Node.js / Express** on the backend and **Angular 20** on the frontend, backed by **Supabase** (PostgreSQL) for user authentication and role management.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
  - [1. Clone the Repository](#1-clone-the-repository)
  - [2. Set Up Supabase](#2-set-up-supabase)
  - [3. Configure Environment Variables](#3-configure-environment-variables)
  - [4. Install Dependencies](#4-install-dependencies)
  - [5. Seed the Admin User](#5-seed-the-admin-user)
  - [6. Run the Application](#6-run-the-application)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
  - [Inventory Tracking](#inventory-tracking)
  - [Sales Performance](#sales-performance)
  - [Campaign Analysis](#campaign-analysis)
  - [The 45 / 60-Day Columns](#the-45--60-day-columns)
- [API Reference](#api-reference)
  - [Authentication](#authentication)
  - [Inventory](#inventory)
  - [Sales Performance](#sales-performance-1)
  - [Campaign Analysis](#campaign-analysis-1)
  - [Cross-Tab Lookups](#cross-tab-lookups)
  - [Export](#export)
- [Frontend (Angular)](#frontend-angular)
- [Feeder City Mapping](#feeder-city-mapping)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [If Blinkit Changes a Column Name](#if-blinkit-changes-a-column-name)
- [License](#license)

---

## Features

| Module | Capabilities |
|---|---|
| **Inventory** | Upload Blinkit "Stock On Hand" `.xlsx` reports → parsed product-warehouse grid with stock status (OK / Low / Out), units sold across 7/15/30/45/60-day windows, incoming inventory, search, sort, delete + undo |
| **Sales Performance** | Upload order-level sales `.xlsx` → city-level aggregation with revenue, units, order count, avg order value, best-selling product per city, performance tiers, trend comparison vs previous upload, per-product & per-brand breakdowns |
| **Campaign Analysis** | Upload advertising campaign `.xlsx` → multi-period campaign table with ad spend, sales, ROAS, ROI %, ROS/unit, impressions, ATC, qty sold, performance tiers, period selector |
| **Authentication** | Session-based login with bcrypt-hashed passwords stored in Supabase, role-based access (`admin` / `viewer`), admin-only uploads & deletes |
| **Export** | Download individual or combined multi-sheet `.xlsx` workbooks covering any/all of the three modules |
| **Undo / Restore** | Every delete operation returns the data needed for Ctrl+Z restoration — including trend-history snapshots for sales |
| **Feeder Scoping** | Sales can be scoped to Blinkit feeder-warehouse regions (Mumbai, Bengaluru, Faridabad, etc.) for city-level drill-downs |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js, Express 4, `express-session`, `multer`, `xlsx`, `bcrypt` |
| **Frontend** | Angular 20 (standalone components, signals, `HttpClient`) |
| **Database** | Supabase (PostgreSQL) — used for user auth; report data stored as local JSON files |
| **Parsers** | Custom Excel parsers (`xlsx` library) with configurable column mapping |
| **Dev Tools** | `nodemon`, `concurrently`, TypeScript 5.9 |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      Browser                             │
│                                                          │
│  /login  (static HTML)     /app/*  (Angular 20 SPA)      │
│          │                         │                     │
└──────────┼─────────────────────────┼─────────────────────┘
           │                         │
           ▼                         ▼
┌──────────────────────────────────────────────────────────┐
│                   Express Server (:3000)                  │
│                                                          │
│  Session Auth ──► /api/login, /api/logout, /api/me       │
│                                                          │
│  requireAuth ──► GET /api/products, /api/city-performance│
│                  GET /api/campaign-analysis, /api/export  │
│                                                          │
│  requireAdmin ─► POST /api/upload, /api/sales-upload     │
│                  POST /api/campaign-upload                │
│                  DELETE operations                        │
│                                                          │
│  Parsers: parseReport, parseSales, parseCampaign         │
│  History: snapshotHistory, salesHistory, campaignStore    │
└─────────────────────┬────────────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ Supabase │ │ data/*.  │ │ uploads/ │
   │ (users)  │ │  json    │ │  (temp)  │
   └──────────┘ └──────────┘ └──────────┘
```

---

## Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- A **Supabase** project (free tier works)

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/Harsh-suiwal/Blinkit-optimized-dashboard.git
cd Blinkit-optimized-dashboard
git checkout v4
```

### 2. Set Up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** and run the contents of [`db/schema.sql`](db/schema.sql) to create the required tables (`admin_users`, `inventory_products`, `snapshot_history`, `upload_meta`).
3. Copy your **Project URL** and **service_role key** from **Settings → API**.

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Supabase project credentials
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOi...

# Session secret (any random string)
SESSION_SECRET=your-random-secret-here

# First admin user (used by: npm run seed)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password

# Server port
PORT=3000
```

### 4. Install Dependencies

```bash
npm install
cd client && npm install && cd ..
```

### 5. Seed the Admin User

```bash
npm run seed
```

This creates (or updates) the first admin account in Supabase using the `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`.

### 6. Run the Application

**Production (build Angular, then start Express):**
```bash
npm run build
npm start
```

**Development (Express with auto-reload + Angular dev server):**
```bash
npm run dev
```

Open **http://localhost:3000** → log in with your admin credentials → you'll be redirected to the Angular dashboard at `/app/`.

---

## Project Structure

```
blinkit-dashboard/
├── server.js                   Express app — routes, upload handling, API endpoints
├── package.json                Server dependencies & scripts
├── .env.example                Environment variable template
│
├── client/                     Angular 20 frontend (standalone components)
│   ├── package.json            Angular dependencies
│   ├── angular.json            Angular CLI configuration
│   ├── tsconfig.json           TypeScript config
│   ├── src/
│   │   ├── index.html          SPA entry point
│   │   ├── main.ts             Angular bootstrap
│   │   ├── styles.css           Global styles
│   │   ├── asset/              Static assets (icons)
│   │   └── app/
│   │       ├── app.ts          Root component
│   │       ├── app.routes.ts   Route definitions
│   │       ├── app.config.ts   App configuration (providers)
│   │       ├── core/           Services, guards, models, utilities
│   │       │   ├── api.service.ts      HTTP client for all /api/* calls
│   │       │   ├── auth.guard.ts       Route guard (redirects to /login)
│   │       │   ├── auth.service.ts     Session state management
│   │       │   ├── feeder-map.ts       Blinkit warehouse → city mapping
│   │       │   ├── formatters.ts       Number/currency formatting utilities
│   │       │   ├── models.ts           TypeScript interfaces for all data
│   │       │   └── ui-state.service.ts Global UI state (sidebar, theme)
│   │       ├── layout/
│   │       │   └── app-shell.component.ts   Sidebar + header + router outlet
│   │       ├── pages/
│   │       │   ├── inventory-page.component.ts    Inventory dashboard tab
│   │       │   ├── sales-page.component.ts        Sales performance tab
│   │       │   └── campaign-page.component.ts     Campaign analysis tab
│   │       └── shared/
│   │           └── brand-mark.component.ts        Logo/brand mark component
│   └── public/
│       ├── Kali-dragon-icon.svg
│       └── favicon.ico
│
├── db/                         Database utilities
│   ├── schema.sql              Supabase table definitions (run manually)
│   ├── supabase.js             Supabase client (service-role key)
│   └── seed-admin.js           One-time admin user seeder
│
├── middleware/
│   └── auth.js                 requireAuth & requireAdmin middleware
│
├── routes/
│   └── auth.js                 /api/login, /api/logout, /api/me
│
├── parser/                     Excel file parsers
│   ├── parseReport.js          Inventory report parser (Stock On Hand)
│   ├── parseSales.js           Sales/order report parser + aggregation
│   ├── parseCampaign.js        Campaign report parser + tier assignment
│   ├── columnMap.js            Raw Blinkit column names → internal names
│   ├── snapshotHistory.js      Append-only inventory snapshot log + 45/60-day calc
│   ├── salesHistory.js         City-level sales trend history
│   └── campaignStore.js        Multi-period campaign data store
│
├── public/                     Legacy static frontend (kept for login page)
│   ├── login.html              Login page
│   ├── login.js                Login form handler
│   ├── style.css               Shared stylesheet (used by login)
│   ├── index.html              Legacy dashboard (redirects to /app/)
│   ├── app.js                  Legacy inventory JS
│   ├── sales-performance.html  Legacy sales page (redirects to /app/sales-performance)
│   ├── sales.js                Legacy sales JS
│   ├── campaign-analysis.html  Legacy campaign page (redirects to /app/campaign-analysis)
│   ├── campaign.js             Legacy campaign JS
│   └── sidebar.js              Legacy sidebar JS
│
├── data/                       Generated data (gitignored)
│   └── .gitkeep
│
└── uploads/                    Temporary file storage (auto-cleaned)
```

---

## How It Works

### Inventory Tracking

1. **Upload** a Blinkit "Stock On Hand" `.xlsx` report from the Inventory tab.
2. The server parses it via `parser/parseReport.js`, using the column map in `parser/columnMap.js` to translate raw Blinkit column headers to internal field names.
3. Each upload is logged as a dated snapshot in `data/history.json` via `parser/snapshotHistory.js`. This history enables the 45-day and 60-day sold calculations.
4. The processed data is cached in `data/latest.json` and served to the dashboard via `/api/products`.
5. Products are flagged as **Out** (stock = 0), **Low** (stock ≤ threshold), or **OK**.

### Sales Performance

1. **Upload** an order-level sales `.xlsx` report from the Sales tab.
2. `parser/parseSales.js` extracts individual order rows and aggregates them:
   - **By city**: revenue, units, order count, avg order value, best-selling product.
   - **By product**: revenue, units, with per-city breakdown for product-focus view.
3. City snapshots are stored in `parser/salesHistory.js` to compute **revenue change %** versus the previous upload.
4. Cities are assigned **performance tiers** (top / low) based on revenue distribution.
5. **Feeder scoping** groups cities by Blinkit warehouse region (see [Feeder City Mapping](#feeder-city-mapping)).

### Campaign Analysis

1. **Upload** a campaign performance `.xlsx` report from the Campaign tab.
2. `parser/parseCampaign.js` detects **period blocks** within the sheet (e.g., "June 2025", "July 2025") and extracts campaign rows for each.
3. Campaigns are stored per-period in `parser/campaignStore.js`, enabling **multi-period comparison** via a dropdown.
4. Key metrics: Ad Spend, Sales, ROAS, ROI %, ROS/Unit, Impressions, ATC (Add to Cart), Qty Sold.
5. Campaigns are assigned **performance tiers** based on ROAS.

### The 45 / 60-Day Columns

Blinkit's own reports only provide 7, 15, and 30-day sold windows. The 45 and 60-day figures are **computed from your upload history**:

- Upload the inventory report regularly (daily is ideal, weekly is workable).
- Once an upload exists from ~30 days before the latest one, the 45 and 60-day columns compute automatically for that product-warehouse pair.
- Until then, they display **"Insufficient data"** — this is intentional, not a bug.
- The tolerance window for finding a matching historical upload is configurable via `ANCHOR_TOLERANCE_DAYS` in `parser/snapshotHistory.js` (default: 5 days).

---

## API Reference

All API routes are prefixed with `/api/`. Requests require a valid session cookie unless noted otherwise.

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/login` | Public | Log in with `{ email, password }` |
| `POST` | `/api/logout` | Any | Destroy session |
| `GET` | `/api/me` | Any | Return current user info |

### Inventory

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/upload` | Admin | Upload inventory `.xlsx` (multipart `report` field) |
| `GET` | `/api/products` | Any | Get all product rows from the latest upload |
| `GET` | `/api/summary` | Any | Inventory summary stats (total stock, sold, low count) |
| `DELETE` | `/api/products?productName=...&warehouseName=...` | Admin | Remove one product-warehouse row |
| `POST` | `/api/products/restore` | Admin | Undo a product delete `{ row, index }` |

### Sales Performance

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/sales-upload` | Admin | Upload sales `.xlsx` (multipart `report` field) |
| `GET` | `/api/city-performance` | Any | City-level aggregated sales data |
| `GET` | `/api/sales-summary` | Any | Sales summary stats |
| `GET` | `/api/product-sales?product=...` | Any | Single product's sales + city breakdown |
| `GET` | `/api/product-city-sales` | Any | All products with per-city breakdowns |
| `GET` | `/api/brand-sales?brand=...` | Any | Single brand's aggregated city sales |
| `DELETE` | `/api/city-performance/:city` | Admin | Remove a city + its history |
| `POST` | `/api/city-performance/restore` | Admin | Undo a city delete (includes history snapshots) |
| `DELETE` | `/api/sales-history` | Admin | Wipe all sales data + trend history |

### Campaign Analysis

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/campaign-upload` | Admin | Upload campaign `.xlsx` (multipart `report` field) |
| `GET` | `/api/campaign-analysis?periodKey=...` | Any | Campaign rows for a period (defaults to latest) |
| `GET` | `/api/campaign-summary?periodKey=...` | Any | Campaign summary stats for a period |
| `DELETE` | `/api/campaign-analysis` | Admin | Remove one campaign `{ periodKey, storeIndex }` |
| `POST` | `/api/campaign-analysis/restore` | Admin | Undo a campaign delete |

### Cross-Tab Lookups

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/product-names` | Any | All distinct product names across inventory + sales |
| `GET` | `/api/brand-names` | Any | All distinct brand names across all data |

### Export

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/export` | Any | Download inventory as `.xlsx` |
| `GET` | `/api/export-campaign?periodKey=...` | Any | Download campaign data as `.xlsx` |
| `GET` | `/api/export-all?periodKey=...` | Any | Download combined workbook (all available sheets) |

---

## Frontend (Angular)

The authenticated dashboard is an **Angular 20** single-page application served at `/app/`.

| Route | Component | Description |
|-------|-----------|-------------|
| `/app/inventory` | `InventoryPageComponent` | Inventory dashboard (default) |
| `/app/sales-performance` | `SalesPageComponent` | Sales performance analytics |
| `/app/campaign-analysis` | `CampaignPageComponent` | Campaign ROI analysis |

**Key architectural decisions:**

- **Standalone components** — no NgModules, each component declares its own imports.
- **Signals** for reactive state management (`UiStateService`).
- **`ApiService`** wraps all `HttpClient` calls with typed generics and error normalization.
- **`AuthGuard`** checks `/api/me` before activating routes; redirects to `/login` on 401.
- **`AppShellComponent`** provides the sidebar navigation, header, and `<router-outlet>`.
- The login page is deliberately a **static HTML page** (`public/login.html`) outside Angular, for fast initial load.

---

## Feeder City Mapping

Blinkit operates through feeder warehouses that service groups of cities. The `feeder-map.ts` file maps each feeder to its serviced cities:

| Feeder | Cities |
|--------|--------|
| **Mumbai** | Mumbai, Nashik, Surat, Vadodara |
| **Ahmedabad** | Ahmedabad, Vadodara, Rajkot |
| **Lucknow** | Kanpur, Gorakhpur, Varanasi, Lucknow, Prayagraj |
| **Rajpura** | Chandigarh, Zirakpur, Panchkula, Kharar, Dehradun, Mohali, Jalandhar, Ludhiana |
| **Bengaluru** | Bengaluru, Mysore, Chennai |
| **Faridabad** | Faridabad, Haldwani, Udaipur, Agra, Delhi, Gurgaon, Meerut, Ghaziabad, Chandigarh, Amritsar |
| **Kolkata** | Kolkata, Ranchi, Patna |
| **Pune** | Pune, Goa |
| **Kundli** | Delhi, Meerut, Gurgaon, Ghaziabad, Rohtak, Faridabad, Agra, Sonipat |
| **Hyderabad** | Hyderabad, Visakhapatnam |
| **Nagpur** | Nagpur, Bhopal, Indore, Raipur |
| **Jaipur** | Jaipur, Jodhpur |

This mapping enables feeder-scoped views in the Sales Performance tab.

---

## Configuration

| Setting | Location | Default | Description |
|---------|----------|---------|-------------|
| `LOW_STOCK_THRESHOLD` | `.env` | `10` | Stock count at or below which a product is flagged "Low" |
| `ANCHOR_TOLERANCE_DAYS` | `parser/snapshotHistory.js` | `5` | Days of slack when looking for a ~30-day-old upload to anchor 45/60-day calculations |
| `PORT` | `.env` | `3000` | Server listening port |
| `SESSION_SECRET` | `.env` | — | Express session signing secret (required when `NODE_ENV=production`) |
| `NODE_ENV` | environment | — | Set to `production` on the host (Render): enables secure session cookies, so it must be served over HTTPS |
| `SUPABASE_URL` | `.env` | — | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | `.env` | — | Supabase service-role key (never expose to browser) |
| `ADMIN_EMAIL` | `.env` | — | Email for the seeded admin account |
| `ADMIN_PASSWORD` | `.env` | — | Password for the seeded admin account |

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start Express using the existing client build (fails with a hint if there is none; run `npm run build` first) |
| `npm run deploy` | Start Express using the existing build (fails with a hint if there is none) |
| `npm run dev` | Start Express (nodemon) + Angular dev server (concurrently) |
| `npm run serve` | Start Express only (no client build) |
| `npm run build` | Install client deps and build the Angular client (does not start Express) |
| `npm run build:client` | Build Angular client only |
| `npm run dev:client` | Start Angular dev server only |
| `npm run install:client` | Clean-install client dependencies |
| `npm run seed` | Create/update the admin user in Supabase |

---

## If Blinkit Changes a Column Name

Update **`parser/columnMap.js`** only — this is the single source of truth for mapping raw Blinkit Excel column headers to the internal field names used throughout the application. Nothing else needs to change.

---

## License

This project is private and intended for internal use.
