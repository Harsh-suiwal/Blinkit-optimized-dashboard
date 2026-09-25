# Blinkit Inventory Dashboard — Phase 1 MVP

## Setup

```
npm install
cd client && npm install && cd ..
npm start
```

Then open **http://localhost:3000**

## Frontend structure

The login screen remains a deliberately lightweight static page at
`/login`. After the existing session-based login succeeds, it redirects to
the Angular application at `/app/`.

- `public/login.html` and `public/login.js` are the only login assets.
- `client/` is the Angular 20 frontend (standalone components and routes).
- `npm start` compiles the Angular client into `client/dist/client/browser`
  and then starts Express.
- Express protects `/app/*` with the existing session middleware and serves
  the Angular entry file for direct links such as `/app/sales-performance`.
- All `/api/*` routes, Supabase-backed authentication, uploads, parsers, and
  Excel exports remain on the existing Node/Express backend.

## How it works

1. Upload the Blinkit "Stock On Hand" `.xlsx` report from the dashboard.
2. The server parses it (`parser/parseReport.js`), using the column map in
   `parser/columnMap.js`.
3. Every upload is logged as a dated snapshot in `data/history.json`
   (`parser/snapshotHistory.js`). This is what makes the 45-day and
   60-day sold figures possible — Blinkit's report only gives 7/15/30-day
   windows, so those two are built from your own upload history over time.
4. The latest processed data is cached in `data/latest.json` and served
   to the dashboard.
5. **Export Sheet** downloads the consolidated report exactly per spec:
   Product Name, Warehouse Name, Total Stock Available, Units Sold
   7/15/30/45/60 Days, Incoming Inventory — one row per product-warehouse
   combination.

## About the 45 / 60-day columns

These can't be computed from a single upload — there's no way around
that, since Blinkit's own report doesn't provide them. They fill in once
there's enough upload history:

- Upload the report regularly (daily is ideal, weekly is workable).
- Once an upload exists from roughly 30 days before the latest one, the
  45 and 60-day columns compute automatically for that product-warehouse.
- Until then, they show **"Insufficient data"** rather than a wrong
  number — that's intentional, not a bug.

## Folder structure

```
blinkit-dashboard/
├── server.js               Express app, routes, upload handling
├── package.json
├── parser/
│   ├── parseReport.js       reads Excel, cleans rows, maps columns
│   ├── columnMap.js          raw Blinkit column names -> internal names
│   └── snapshotHistory.js    append-only upload log + 45/60-day calculation
├── data/
│   ├── history.json          created on first upload — full snapshot log
│   └── latest.json           created on first upload — latest processed report
├── uploads/                  temp storage, files deleted right after parsing
└── public/
    ├── index.html
    ├── style.css
    └── app.js                 upload, fetch, render, search/sort, export
```

## Config

- `LOW_STOCK_THRESHOLD` in `server.js` — the stock number below which a
  product is flagged "Low." Currently 10.
- `ANCHOR_TOLERANCE_DAYS` in `parser/snapshotHistory.js` — how many days
  of slack allowed when looking for an upload "around 30 days ago" to
  anchor the 45/60-day calculation. Currently 5.

## If Blinkit changes a column name

Update `parser/columnMap.js` only — nothing else needs to change.
