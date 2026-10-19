require('dotenv').config();

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const { parseReport } = require('./parser/parseReport');
const { appendSnapshot, computeExtendedWindows, loadHistory, todayDateString } = require('./parser/snapshotHistory');
const { parseSalesRows, aggregateByCity, aggregateByProduct, assignPerformanceTiers } = require('./parser/parseSales');
const {
  appendCitySnapshot,
  attachTrend,
  clearHistory,
  removeBrandFromHistory,
  removeCityFromHistory,
  getSnapshotsForCity,
  restoreSnapshotsForCity,
} = require('./parser/salesHistory');
const { parseCampaignFile } = require('./parser/parseCampaign');
const {
  loadStore: loadCampaignStore,
  clearStore: clearCampaignStore,
  removeBrandRows: removeCampaignBrandRows,
  planUpload: planCampaignUpload,
  upsertUpload: upsertCampaignUpload,
  listPeriods: listCampaignPeriods,
  getLatestPeriodKey: getLatestCampaignPeriodKey,
  resolvePeriodKey: resolveCampaignPeriod,
  getLastUploadedDate: getCampaignUploadedDate,
  removeCampaignRows,
  restoreCampaignRows,
  selectRows: selectCampaignRows,
  aggregateTotals: aggregateCampaignTotals,
  aggregateByCampaign: aggregateCampaigns,
  aggregateByBrand: aggregateCampaignsByBrand,
  getCampaignDetail,
  listCampaignBrands,
} = require('./parser/campaignStore');
const { resolveBrand, saveAlias, loadAliases } = require('./parser/brandResolver');
const { hashFile, isDuplicateUpload, recordUpload, clearUploadHashes } = require('./parser/uploadGuard');

const kv = require('./store/kv');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
// kv_store keys (see store/kv.js)
const LATEST_KEY = 'latest';
const SALES_LATEST_KEY = 'salesLatest';
const PRODUCT_SALES_KEY = 'salesByProduct';
const ANGULAR_DIST_PATH = path.join(__dirname, 'client', 'dist', 'client', 'browser');
// "Low stock" line; set LOW_STOCK_THRESHOLD in .env to change it (unset/invalid/negative -> 10)
const envLowStock = process.env.LOW_STOCK_THRESHOLD;
const LOW_STOCK_THRESHOLD =
  envLowStock && envLowStock.trim() !== '' && Number.isFinite(Number(envLowStock)) && Number(envLowStock) >= 0
    ? Number(envLowStock)
    : 10;

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (/\.xlsx?$/i.test(file.originalname)) return cb(null, true);
    cb(new Error('Only .xls and .xlsx files are accepted.'));
  },
});

// Wraps upload.single('report') so rejections come back as JSON 400 instead of Express's HTML 500.
const uploadReport = (req, res, next) => {
  upload.single('report')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 25 MB).' : err.message;
    res.status(400).json({ error: message });
  });
};

// Wraps every data-changing route: runs one at a time (so a concurrent request can't read
// stale data mid-save and overwrite it), awaits all writes, answers 500 if a save fails.
const mutating = (handler) => (req, res) =>
  kv.withLock(() => handler(req, res)).catch((err) => {
    console.error(`${req.method} ${req.path} failed:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Saving failed. Please try again.' });
  });

// --- Session setup --------------------------------------------------------

// No hardcoded fallback: production refuses to start without a secret; elsewhere a random
// per-process one is used (sessions live in memory anyway, so restarts log everyone out).
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (process.env.NODE_ENV === 'production') {
    console.error('SESSION_SECRET is not set. Refusing to start in production without it.');
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET is not set; using a random one for this run.');
}

// Behind Render's HTTPS proxy: trust the first hop so req.secure / client IPs are right.
app.set('trust proxy', 1);

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
    },
  })
);

app.use(express.json());

// --- Auth routes (public) -------------------------------------------------

app.use('/api', authRoutes);

// --- Serve login page (public) --------------------------------------------

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/login.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.js'));
});

// --- Auth gate: everything below requires login ---------------------------

// The login page deliberately remains a small, static page. The authenticated
// dashboard is served as the Angular single-page application under /app.
app.use((req, res, next) => {
  // Allow style.css through without auth (needed by login page)
  if (req.path === '/style.css') {
    return express.static(path.join(__dirname, 'public'))(req, res, next);
  }

  // For all other static assets and pages, require session
  if (!req.session || !req.session.user) {
    // API requests get 401
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    // HTML/page requests get redirected
    return res.redirect('/login');
  }

  next();
});

// Preserve useful legacy URLs while moving the actual dashboard to Angular.
app.get('/', (_req, res) => res.redirect('/app/'));

// The static middleware handles hashed JS/CSS files. The fallback is required
// for direct loads and browser refreshes of Angular client-side routes.
app.use('/app', express.static(ANGULAR_DIST_PATH));
app.get(['/app', '/app/*'], (_req, res) => {
  res.sendFile(path.join(ANGULAR_DIST_PATH, 'index.html'));
});

/**
 * Builds the full consolidated product list: today's parsed rows plus
 * the 45/60 day figures pulled from snapshot history.
 */
function buildConsolidatedRows(parsedRows, date) {
  const history = loadHistory({ readOnly: true }); // once per upload, not per row
  return parsedRows.map((row) => {
    const { unitsSold45, unitsSold60 } = computeExtendedWindows({
      itemId: row.itemId,
      warehouseId: row.warehouseId,
      latestDate: date,
      latestUnitsSold15: row.unitsSold15,
      latestUnitsSold30: row.unitsSold30,
    }, history);

    const stockStatus =
      row.totalStockAvailable <= 0 ? 'out' : row.totalStockAvailable <= LOW_STOCK_THRESHOLD ? 'low' : 'ok';

    return {
      productName: row.productName,
      brandName: row.brandName || '',
      warehouseName: row.warehouseName,
      totalStockAvailable: row.totalStockAvailable,
      unitsSold7: row.unitsSold7,
      unitsSold15: row.unitsSold15,
      unitsSold30: row.unitsSold30,
      unitsSold45, // number, or null if not enough history yet
      unitsSold60, // number, or null if not enough history yet
      incomingInventory: row.incomingInventory,
      stockStatus,
    };
  });
}

// Inventory is stored per brand so uploading one brand never removes another:
//   { date, fileName, rows, brandUploads: { "<Brand>": { date, fileName } } }
// `date`/`fileName` mirror the most recent upload for older callers.
async function saveLatest(store) {
  await kv.set(LATEST_KEY, store);
}

// Returns a private copy (small document), or null if nothing is stored.
function loadLatest() {
  const latest = kv.get(LATEST_KEY);
  if (!latest) return null;
  if (latest.brandUploads) return latest;

  // Pre-per-brand shape: attribute every row to its brand with the old date/file name.
  // Converted in memory on each read; the next save stores the new shape.
  const brandUploads = {};
  (latest.rows || []).forEach((r) => {
    r.brandName = r.brandName || 'Unknown';
    brandUploads[r.brandName] = { date: latest.date, fileName: latest.fileName };
  });
  return { ...latest, rows: latest.rows || [], brandUploads };
}

// --- Upload (admin only) --------------------------------------------------

app.post('/api/upload', requireAdmin, uploadReport, mutating(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    // Same file already processed today -> skip (?force=1 overrides).
    const fileHash = hashFile(req.file.path);
    if (req.query.force !== '1' && isDuplicateUpload('inventory', fileHash)) {
      return res.json({ ok: true, duplicate: true, skipped: true });
    }

    const parsedRows = parseReport(req.file.path);
    const date = todayDateString();

    // Rows with an empty Brand Name column fall back to the file name, then "Unknown".
    const fileBrand = resolveBrand(path.parse(req.file.originalname).name).brand;
    parsedRows.forEach((row) => {
      if (!row.brandName) row.brandName = fileBrand;
    });

    // Save this upload into the history log BEFORE computing 45/60 day
    // windows for it, so today's own snapshot is available for future uploads.
    // Write order: history, then the current view, then the upload hash. Each step is
    // idempotent on retry, and the hash is only recorded once the data is saved.
    await appendSnapshot(parsedRows, date);

    const newRows = buildConsolidatedRows(parsedRows, date);

    // Replace only the brands present in this file; every other brand stays.
    const brands = Array.from(new Set(newRows.map((r) => r.brandName)));
    const previous = loadLatest() || { rows: [], brandUploads: {} };
    const brandUploads = { ...previous.brandUploads };
    brands.forEach((b) => {
      brandUploads[b] = { date, fileName: req.file.originalname };
    });
    const rows = previous.rows.filter((r) => !brands.includes(r.brandName)).concat(newRows);
    await saveLatest({ date, fileName: req.file.originalname, rows, brandUploads });
    await recordUpload('inventory', fileHash);

    res.json({ ok: true, date, rowCount: newRows.length, totalRowCount: rows.length, brands });
  } catch (err) {
    if (err.kvError) throw err; // save failed -> 500 from mutating()
    res.status(400).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
}));

// --- Read APIs (any authenticated user) ------------------------------------

app.get('/api/products', requireAuth, (req, res) => {
  const latest = loadLatest();
  if (!latest) return res.json({ date: null, rows: [] });
  // Stamp the resolved brand so the client never has to guess it.
  const aliases = loadAliases();
  const rows = latest.rows.map((r) => ({ ...r, brandName: brandOf(r.productName, r.brandName, aliases) }));
  res.json({ ...latest, rows });
});

app.get('/api/summary', requireAuth, (req, res) => {
  const latest = loadLatest();
  if (!latest) {
    return res.json({ totalUnitsSold30: 0, totalStock: 0, productCount: 0, lowOrOutCount: 0 });
  }

  const totalUnitsSold30 = latest.rows.reduce((sum, r) => sum + r.unitsSold30, 0);
  const totalStock = latest.rows.reduce((sum, r) => sum + r.totalStockAvailable, 0);
  const productCount = new Set(latest.rows.map((r) => r.productName)).size;
  const lowOrOutCount = latest.rows.filter((r) => r.stockStatus !== 'ok').length;

  res.json({ date: latest.date, totalUnitsSold30, totalStock, productCount, lowOrOutCount });
});

// Wipes the current inventory view for one brand (?brand=) or for every brand. The upload history log
// (kv "history") is kept on purpose: it is what the 45/60-day figures
// are computed from, and it cannot be rebuilt.
app.delete('/api/inventory-data', requireAdmin, mutating(async (req, res) => {
  const brand = typeof req.query.brand === 'string' ? req.query.brand.trim() : '';
  const latest = brand ? loadLatest() : null;

  if (brand && latest) {
    latest.rows = latest.rows.filter((r) => !sameBrand(r.brandName, brand));
    Object.keys(latest.brandUploads).forEach((b) => {
      if (sameBrand(b, brand)) delete latest.brandUploads[b];
    });
    if (latest.rows.length) {
      await saveLatest(latest);
      await clearUploadHashes('inventory');
      return res.json({ ok: true, brand });
    }
  }

  await kv.delete(LATEST_KEY);
  await clearUploadHashes('inventory');
  res.json({ ok: true });
}));

// Removes one product+warehouse row from the current inventory view.
// Kept intentionally simple: this only touches the current view (not the
// 45/60 day snapshot history), since that history is shared across
// products and warehouses and shouldn't be wiped by a single-row delete.
app.delete('/api/products', requireAdmin, mutating(async (req, res) => {
  const { productName, warehouseName } = req.query;
  if (!productName || !warehouseName) {
    return res.status(400).json({ error: 'productName and warehouseName are required.' });
  }

  const latest = loadLatest();
  if (!latest) return res.status(404).json({ error: 'No inventory data to delete from.' });

  const index = latest.rows.findIndex(
    (r) => r.productName === productName && r.warehouseName === warehouseName
  );
  if (index === -1) {
    return res.status(404).json({ error: `Row for "${productName}" / "${warehouseName}" not found.` });
  }

  const [removedRow] = latest.rows.splice(index, 1);
  await saveLatest(latest);
  await clearUploadHashes('inventory');

  res.json({ ok: true, removedRow, index, rowCount: latest.rows.length });
}));

// Re-inserts a previously deleted row (Ctrl+Z / undo) at its original
// position.
app.post('/api/products/restore', requireAdmin, mutating(async (req, res) => {
  const { row, index } = req.body || {};
  if (!row) return res.status(400).json({ error: 'row is required.' });

  const latest = loadLatest();
  if (!latest) return res.status(404).json({ error: 'No inventory data to restore into.' });

  const clampedIndex = Math.max(0, Math.min(typeof index === 'number' ? index : latest.rows.length, latest.rows.length));
  latest.rows.splice(clampedIndex, 0, row);
  await saveLatest(latest);

  res.json({ ok: true, rowCount: latest.rows.length });
}));

// --- Product Focus (product-centric cross-tab view) ------------------------

// Distinct product names, drawn from whatever data we currently have, so
// the "focus one product" dropdown always reflects real data across tabs.
app.get('/api/product-names', requireAuth, (req, res) => {
  const names = new Set();

  const inventory = loadLatest();
  if (inventory) inventory.rows.forEach((r) => names.add(r.productName));

  const productSales = loadProductSalesLatest();
  if (productSales) productSales.productRows.forEach((r) => names.add(r.productName));

  res.json({ names: Array.from(names).sort((a, b) => a.localeCompare(b)) });
});

// --- Brand Filter (cross-tab brand dropdown) --------------------------------

// Single source of truth is parser/brandResolver.js. Returns '' when the brand
// can't be determined (so callers can skip it instead of showing "Unknown").
function brandOf(name, explicitBrand, aliases) {
  const { brand } = resolveBrand(name, explicitBrand, aliases);
  return brand === 'Unknown' ? '' : brand;
}

// Distinct brand names across all uploaded data (inventory + sales + campaigns).
app.get('/api/brand-names', requireAuth, (req, res) => {
  const brands = new Set();
  const aliases = loadAliases();
  const add = (name, explicit) => {
    const b = brandOf(name, explicit, aliases);
    if (b) brands.add(b);
  };

  const inventory = loadLatest();
  if (inventory && Array.isArray(inventory.rows)) {
    inventory.rows.forEach((r) => add(r.productName, r.brandName));
  }

  const productSales = loadProductSalesLatest();
  if (productSales && Array.isArray(productSales.productRows)) {
    productSales.productRows.forEach((r) => add(r.productName, r.brandName));
  }

  const salesLatest = loadSalesLatest();
  if (salesLatest && Array.isArray(salesLatest.cityRows)) {
    salesLatest.cityRows.forEach((r) => add('', r.brandName));
  }

  listCampaignBrands(loadCampaignStore()).forEach((b) => {
    if (b !== 'Unknown') brands.add(b);
  });

  res.json({ brands: Array.from(brands).sort((x, y) => x.localeCompare(y)) });
});

// Teaches the brand resolver a new mapping, e.g. { raw: 'Knife PB', canonical: 'Oicia' }.
// Applies to files parsed from now on; already-stored campaign rows keep their brand.
app.post('/api/brand-alias', requireAdmin, mutating(async (req, res) => {
  const { raw, canonical } = req.body || {};
  if (typeof raw !== 'string' || typeof canonical !== 'string' || !raw.trim() || !canonical.trim()) {
    return res.status(400).json({ error: 'raw and canonical are required.' });
  }
  await saveAlias(raw, canonical);
  res.json({ ok: true });
}));

// --- Export (any authenticated user) ----------------------------------------

/** Builds the Inventory worksheet, or null if nothing has been uploaded. */
function buildInventoryWorksheet() {
  const latest = loadLatest();
  if (!latest) return null;

  const headers = [
    'Product Name',
    'Warehouse Name',
    'Total Stock Available',
    'Units Sold - 7 Days',
    'Units Sold - 15 Days',
    'Units Sold - 30 Days',
    'Units Sold - 45 Days',
    'Units Sold - 60 Days',
    'Incoming Inventory',
  ];

  const dataRows = latest.rows.map((r) => [
    r.productName,
    r.warehouseName,
    r.totalStockAvailable,
    r.unitsSold7,
    r.unitsSold15,
    r.unitsSold30,
    r.unitsSold45 === null ? 'Insufficient data' : r.unitsSold45,
    r.unitsSold60 === null ? 'Insufficient data' : r.unitsSold60,
    r.incomingInventory,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  ws['!cols'] = [{ wch: 45 }, { wch: 30 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  return { ws, date: latest.date };
}

app.get('/api/export', requireAuth, (req, res) => {
  const built = buildInventoryWorksheet();
  if (!built) return res.status(400).json({ error: 'No report uploaded yet.' });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.ws, 'Consolidated Report');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="Consolidated_Inventory_Report_${built.date}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// --- Sales / City Performance -------------------------------------------
// Stored per brand, like inventory, so uploading one brand never removes another:
//   salesLatest.json    { date, fileName, brandUploads: { "<Brand>": { date, fileName } }, cityRows }
//                       cityRows = one row per (brandName, city), each with its own trend vs that
//                       brand's previous upload
//   salesByProduct.json { date, fileName, productRows }   (each product row carries brandName)
// Reads combine the brand rows per city (see combineCityRows).

async function saveSalesLatest(store) {
  await kv.set(SALES_LATEST_KEY, store);
}

// Returns a private copy (small document), or null if nothing is stored.
function loadSalesLatest() {
  const latest = kv.get(SALES_LATEST_KEY);
  if (!latest) return null;
  if (latest.brandUploads) return latest;

  // Pre-per-brand shape: its city rows were totalled across brands. Attribute each row to
  // its single brand (or "Unknown") and keep the old date / file name. Converted in memory
  // on each read; the next save stores the new shape.
  const brandUploads = {};
  const cityRows = (latest.cityRows || []).map((r) => {
    const brandName = r.brandName || (r.brands && r.brands.length === 1 ? r.brands[0] : 'Unknown');
    brandUploads[brandName] = { date: latest.date, fileName: latest.fileName };
    return { ...r, brandName };
  });
  return { ...latest, cityRows, brandUploads };
}

async function saveProductSalesLatest(productRows, date, fileName) {
  await kv.set(PRODUCT_SALES_KEY, { date, fileName, productRows });
}

function loadProductSalesLatest() {
  return kv.get(PRODUCT_SALES_KEY);
}

const sameBrand = (a, b) => String(a || 'Unknown').toLowerCase() === String(b || 'Unknown').toLowerCase();

/**
 * Merges per-brand city rows into one row per city. Ratios are recomputed from sums;
 * the trend compares only the brand rows that have a previous upload, so a brand
 * uploaded for the first time doesn't distort it. Orders are summed per brand (an
 * order containing two brands' products counts once in each).
 */
function combineCityRows(rows) {
  const byCity = new Map();
  for (const r of rows) {
    if (!byCity.has(r.city)) {
      byCity.set(r.city, {
        city: r.city, revenue: 0, units: 0, orderCount: 0, topProduct: null, topProductRevenue: 0,
        brands: [], currentWithPrev: 0, previous: 0, hasPrev: false,
      });
    }
    const g = byCity.get(r.city);
    g.revenue += r.revenue;
    g.units += r.units;
    g.orderCount += r.orderCount || 0;
    if ((r.topProductRevenue || 0) > g.topProductRevenue) {
      g.topProduct = r.topProduct;
      g.topProductRevenue = r.topProductRevenue;
    }
    if (r.brandName && !g.brands.includes(r.brandName)) g.brands.push(r.brandName);
    if (r.previousRevenue !== null && r.previousRevenue !== undefined) {
      g.currentWithPrev += r.revenue;
      g.previous += r.previousRevenue;
      g.hasPrev = true;
    }
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  const combined = Array.from(byCity.values()).map((g) => ({
    city: g.city,
    revenue: round2(g.revenue),
    units: g.units,
    orderCount: g.orderCount,
    avgOrderValue: g.orderCount > 0 ? round2(g.revenue / g.orderCount) : 0,
    topProduct: g.topProduct,
    topProductRevenue: round2(g.topProductRevenue),
    brands: g.brands,
    revenueChangePct: g.hasPrev && g.previous > 0 ? Math.round(((g.currentWithPrev - g.previous) / g.previous) * 1000) / 10 : null,
    previousRevenue: g.hasPrev ? round2(g.previous) : null,
  }));
  return assignPerformanceTiers(combined).sort((a, b) => b.revenue - a.revenue);
}

/** One entry per brand with its total revenue/units, biggest first (for the brand chips). */
function salesBrandSummaries(cityRows) {
  const byBrand = new Map();
  for (const r of cityRows) {
    const name = r.brandName || 'Unknown';
    if (!byBrand.has(name)) byBrand.set(name, { brandName: name, revenue: 0, units: 0 });
    const b = byBrand.get(name);
    b.revenue += r.revenue;
    b.units += r.units;
  }
  return Array.from(byBrand.values())
    .map((b) => ({ ...b, revenue: Math.round(b.revenue * 100) / 100 }))
    .sort((a, b) => b.revenue - a.revenue);
}

function salesRowsForBrand(store, brand) {
  return brand ? store.cityRows.filter((r) => sameBrand(r.brandName, brand)) : store.cityRows;
}

app.post('/api/sales-upload', requireAdmin, uploadReport, mutating(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    const fileHash = hashFile(req.file.path);
    if (req.query.force !== '1' && isDuplicateUpload('sales', fileHash)) {
      return res.json({ ok: true, duplicate: true, skipped: true });
    }

    const salesRows = parseSalesRows(req.file.path);
    const date = todayDateString();

    // Orders with an empty Brand Name fall back to the file name, then "Unknown".
    const fileBrand = resolveBrand(path.parse(req.file.originalname).name).brand;
    salesRows.forEach((row) => {
      if (!row.brandName) row.brandName = fileBrand;
    });

    const brands = Array.from(new Set(salesRows.map((r) => r.brandName)));
    const cityAgg = brands.flatMap((brandName) =>
      aggregateByCity(salesRows.filter((r) => r.brandName === brandName)).map((row) => ({ ...row, brandName }))
    );

    // Log this upload's per-brand city totals BEFORE computing the trend, so it
    // becomes the comparison point for that brand's next upload.
    // Write order: history, city view, product view, then the upload hash (see /api/upload).
    await appendCitySnapshot(cityAgg, date);
    const withTrend = attachTrend(cityAgg, date);

    // Replace only the brands in this file; every other brand stays.
    const previous = loadSalesLatest() || { cityRows: [], brandUploads: {} };
    const brandUploads = { ...previous.brandUploads };
    brands.forEach((b) => {
      brandUploads[b] = { date, fileName: req.file.originalname };
    });
    const cityRows = previous.cityRows.filter((r) => !brands.includes(r.brandName)).concat(withTrend);
    await saveSalesLatest({ date, fileName: req.file.originalname, brandUploads, cityRows });

    // Per-product breakdown (powers the feeder view); same replace-by-brand rule.
    const productAgg = aggregateByProduct(salesRows);
    const oldProducts = loadProductSalesLatest();
    const keptProducts = oldProducts ? oldProducts.productRows.filter((p) => !brands.some((b) => sameBrand(p.brandName, b))) : [];
    await saveProductSalesLatest(keptProducts.concat(productAgg), date, req.file.originalname);
    await recordUpload('sales', fileHash);

    res.json({
      ok: true,
      date,
      brands,
      cityCount: new Set(withTrend.map((r) => r.city)).size,
      totalCityCount: new Set(cityRows.map((r) => r.city)).size,
      orderRowCount: salesRows.length,
    });
  } catch (err) {
    if (err.kvError) throw err; // save failed -> 500 from mutating()
    res.status(400).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
}));

// ?brand= narrows the city table to one brand; brandSummaries always lists every brand.
app.get('/api/city-performance', requireAuth, (req, res) => {
  const latest = loadSalesLatest();
  if (!latest) return res.json({ date: null, brandUploads: {}, cityRows: [], brandSummaries: [] });
  const brand = typeof req.query.brand === 'string' ? req.query.brand.trim() : '';
  res.json({
    date: latest.date,
    brandUploads: latest.brandUploads,
    cityRows: combineCityRows(salesRowsForBrand(latest, brand)),
    brandSummaries: salesBrandSummaries(latest.cityRows),
  });
});

// Wipes sales data: one brand (?brand=) or everything. Trend history for the removed
// scope goes with it so it can't resurface as a stale "previous" comparison.
app.delete('/api/sales-history', requireAdmin, mutating(async (req, res) => {
  const brand = typeof req.query.brand === 'string' ? req.query.brand.trim() : '';
  const latest = brand ? loadSalesLatest() : null;

  if (brand && latest) {
    latest.cityRows = latest.cityRows.filter((r) => !sameBrand(r.brandName, brand));
    Object.keys(latest.brandUploads).forEach((b) => {
      if (sameBrand(b, brand)) delete latest.brandUploads[b];
    });
    const products = loadProductSalesLatest();
    if (products) {
      await saveProductSalesLatest(products.productRows.filter((p) => !sameBrand(p.brandName, brand)), products.date, products.fileName);
    }
    await removeBrandFromHistory(brand);
    if (latest.cityRows.length) {
      await saveSalesLatest(latest);
      await clearUploadHashes('sales');
      return res.json({ ok: true, brand });
    }
  }

  await clearHistory();
  await kv.delete(SALES_LATEST_KEY);
  await kv.delete(PRODUCT_SALES_KEY);
  await clearUploadHashes('sales');
  res.json({ ok: true });
}));

// Removes one city (all brands) from the current view and purges its history so it
// doesn't resurface as a "previous" comparison point later. Returns everything needed
// to fully undo the delete (Ctrl+Z), including the trend-history snapshots.
app.delete('/api/city-performance/:city', requireAdmin, mutating(async (req, res) => {
  const { city } = req.params;
  const latest = loadSalesLatest();
  if (!latest) return res.status(404).json({ error: 'No sales data to delete from.' });

  const removedRows = latest.cityRows.filter((c) => c.city === city);
  if (!removedRows.length) {
    return res.status(404).json({ error: `City "${city}" not found.` });
  }

  const removedHistorySnapshots = getSnapshotsForCity(city);
  latest.cityRows = latest.cityRows.filter((c) => c.city !== city);

  // History first: if the view save then fails, the city is still visible (nothing lost).
  await removeCityFromHistory(city);
  await saveSalesLatest(latest);
  await clearUploadHashes('sales');

  res.json({ ok: true, removedRows, removedHistorySnapshots });
}));

// Re-inserts a previously deleted city (Ctrl+Z / undo), including its trend-history snapshots.
app.post('/api/city-performance/restore', requireAdmin, mutating(async (req, res) => {
  const { cityRows, historySnapshots } = req.body || {};
  if (!Array.isArray(cityRows) || !cityRows.length) return res.status(400).json({ error: 'cityRows is required.' });

  const latest = loadSalesLatest();
  if (!latest) return res.status(404).json({ error: 'No sales data to restore into.' });

  // History first: it skips snapshots already present, so a retry after a failed view
  // save can't duplicate anything; the view concat runs last.
  await restoreSnapshotsForCity(historySnapshots);
  latest.cityRows = latest.cityRows.concat(cityRows);
  await saveSalesLatest(latest);

  res.json({ ok: true });
}));

// Product-focus: a single product's totals + per-city breakdown, drawn
// from the last uploaded sales report.
app.get('/api/product-sales', requireAuth, (req, res) => {
  const { product } = req.query;
  if (!product) return res.status(400).json({ error: 'product is required.' });

  const latest = loadProductSalesLatest();
  if (!latest) return res.json({ date: null, row: null });

  const row = latest.productRows.find((r) => r.productName === product) || null;
  res.json({ date: latest.date, row });
});

// Product-by-city breakdown used by feeder-scoped Sales Performance (?brand= narrows it).
app.get('/api/product-city-sales', requireAuth, (req, res) => {
  const latest = loadProductSalesLatest();
  if (!latest) return res.json({ date: null, productRows: [] });
  const brand = typeof req.query.brand === 'string' ? req.query.brand.trim() : '';
  const productRows = (latest.productRows || []).filter((p) => !brand || sameBrand(p.brandName, brand));
  res.json({ date: latest.date, productRows });
});

// Brand-focus: a single brand's totals + per-city breakdown, aggregated
// from the product sales data.
app.get('/api/brand-sales', requireAuth, (req, res) => {
  const { brand } = req.query;
  if (!brand) return res.status(400).json({ error: 'brand is required.' });

  const latest = loadProductSalesLatest();
  if (!latest) return res.json({ date: null, cityRows: [] });

  const brandProducts = latest.productRows.filter((r) => sameBrand(r.brandName, brand));
  const cityAgg = new Map();

  for (const p of brandProducts) {
    for (const c of p.cities) {
      if (!cityAgg.has(c.city)) {
        cityAgg.set(c.city, { city: c.city, revenue: 0, units: 0, orderCount: 0, topProduct: null, topProductRevenue: 0 });
      }
      const agg = cityAgg.get(c.city);
      agg.revenue += c.revenue;
      agg.units += c.units;
      if (c.revenue > agg.topProductRevenue) {
        agg.topProductRevenue = c.revenue;
        agg.topProduct = p.productName;
      }
    }
  }

  const cityRows = Array.from(cityAgg.values()).sort((a, b) => b.revenue - a.revenue);
  res.json({ date: latest.date, cityRows });
});

app.get('/api/sales-summary', requireAuth, (req, res) => {
  const latest = loadSalesLatest();
  const brand = typeof req.query.brand === 'string' ? req.query.brand.trim() : '';
  const rows = latest ? combineCityRows(salesRowsForBrand(latest, brand)) : [];
  if (!rows.length) {
    return res.json({ totalRevenue: 0, totalUnits: 0, totalOrders: 0, cityCount: 0, topCity: null });
  }

  const totalRevenue = rows.reduce((sum, c) => sum + c.revenue, 0);
  const totalUnits = rows.reduce((sum, c) => sum + c.units, 0);
  const totalOrders = rows.reduce((sum, c) => sum + c.orderCount, 0);

  res.json({
    date: latest.date,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalUnits,
    totalOrders,
    cityCount: rows.length,
    topCity: rows[0].city,
  });
});

/** Builds the Sales by City worksheet, or null if nothing has been uploaded. */
function buildSalesWorksheet(brand = '') {
  const latest = loadSalesLatest();
  if (!latest) return null;
  const cityRows = combineCityRows(salesRowsForBrand(latest, brand));

  const headers = [
    'City', 'Revenue', 'Units Sold', 'Order Count', 'Avg Order Value',
    'Best-Selling Product', 'Best-Selling Product Revenue',
    'Performance Tier', 'Revenue Change % (vs last upload)', 'Previous Revenue',
  ];

  const dataRows = cityRows.map((c) => [
    c.city,
    c.revenue,
    c.units,
    c.orderCount,
    c.avgOrderValue,
    c.topProduct || 'No data',
    c.topProductRevenue ?? 0,
    c.tier,
    c.revenueChangePct === null || c.revenueChangePct === undefined ? 'No prior data' : c.revenueChangePct,
    c.previousRevenue === null || c.previousRevenue === undefined ? 'No prior data' : c.previousRevenue,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 40 }, { wch: 22 }, { wch: 14 }, { wch: 22 }, { wch: 16 }];
  return { ws, date: latest.date };
}

app.get('/api/export-sales', requireAuth, (req, res) => {
  const built = buildSalesWorksheet(typeof req.query.brand === 'string' ? req.query.brand.trim() : '');
  if (!built) return res.status(400).json({ error: 'No sales report uploaded yet.' });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.ws, 'Sales by City');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="Sales_by_City_${built.date}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// --- Campaign Analysis ----------------------------------------------------
// Raw daily rows are stored as uploaded; every figure below is aggregated at
// request time (see parser/campaignStore.js).

const SHEET_TYPES = ['PRODUCT_BOOSTING', 'PRODUCT_RECOMMENDATION'];

// Rows removed by DELETE are held here so undo can restore them by token
// instead of the browser re-posting thousands of daily rows. Lost on restart.
const campaignTrash = new Map(); // undoToken -> { rows, expires }
const TRASH_LIMIT = 20;
const TRASH_TTL_MS = 10 * 60 * 1000;

function sweepCampaignTrash() {
  const now = Date.now();
  for (const [token, entry] of campaignTrash) {
    if (entry.expires <= now) campaignTrash.delete(token);
  }
}
setInterval(sweepCampaignTrash, 60 * 1000).unref();

function campaignFilters(req, store) {
  const periodKey = resolveCampaignPeriod(store, req.query.periodKey);
  const sheetType = SHEET_TYPES.includes(req.query.sheetType) ? req.query.sheetType : 'ALL';
  const brand = typeof req.query.brand === 'string' ? req.query.brand.trim() : '';
  return { periodKey, sheetType, brand };
}

app.post('/api/campaign-upload', requireAdmin, uploadReport, mutating(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    const parsed = parseCampaignFile(req.file.path, {
      fileName: req.file.originalname,
      defaultBrand: req.body && typeof req.body.defaultBrand === 'string' ? req.body.defaultBrand : '',
    });

    // Dry run: report what this upload would replace, write nothing.
    if (req.query.dryRun === '1') {
      return res.json({ ok: true, dryRun: true, plan: planCampaignUpload(parsed), rowCount: parsed.rows.length });
    }

    const fileHash = hashFile(req.file.path);
    if (req.query.force !== '1' && isDuplicateUpload('campaign', fileHash)) {
      return res.json({ ok: true, duplicate: true, skipped: true });
    }

    const store = await upsertCampaignUpload(parsed);
    await recordUpload('campaign', fileHash);
    res.json({
      ok: true,
      periodKeys: Array.from(new Set(parsed.uploads.map((u) => u.periodKey))),
      sheetTypes: Array.from(new Set(parsed.uploads.map((u) => u.sheetType))),
      rowCount: parsed.rows.length,
      latestPeriodKey: getLatestCampaignPeriodKey(store),
    });
  } catch (err) {
    if (err.kvError) throw err; // save failed -> 500 from mutating()
    res.status(400).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
}));

app.get('/api/campaign-analysis', requireAuth, (req, res) => {
  const store = loadCampaignStore();
  const periods = listCampaignPeriods(store);
  const latestPeriodKey = getLatestCampaignPeriodKey(store);
  const { periodKey, sheetType, brand } = campaignFilters(req, store);

  if (!periodKey) {
    return res.json({ date: null, periods: [], periodKey: null, latestPeriodKey: null, campaigns: [], brandSummaries: [], allBrands: [] });
  }

  // Brand summaries ignore the brand filter so the chip bar always lists every brand.
  const periodRows = selectCampaignRows(store, { periodKey, sheetType });
  const brandSummaries = aggregateCampaignsByBrand(periodRows);
  const rows = brand ? periodRows.filter((r) => r.brandName.toLowerCase() === brand.toLowerCase()) : periodRows;
  const campaigns = aggregateCampaigns(rows);

  res.json({ date: getCampaignUploadedDate(store, periodKey), periods, periodKey, latestPeriodKey, campaigns, brandSummaries, allBrands: listCampaignBrands(store).sort() });
});

app.get('/api/campaign-brands', requireAuth, (req, res) => {
  const store = loadCampaignStore();
  const periodKey = resolveCampaignPeriod(store, req.query.periodKey);
  if (!periodKey) return res.json({ periodKey: null, brands: [] });
  const sheetType = SHEET_TYPES.includes(req.query.sheetType) ? req.query.sheetType : 'ALL';
  const brands = aggregateCampaignsByBrand(selectCampaignRows(store, { periodKey, sheetType }));
  res.json({ periodKey, brands: brands.map((b) => ({ brandName: b.brandName, adSpend: b.adSpend, campaignCount: b.campaignCount })) });
});

app.get('/api/campaign-detail', requireAuth, (req, res) => {
  const { campaignId, sheetType } = req.query;
  if (!campaignId || !SHEET_TYPES.includes(sheetType)) {
    return res.status(400).json({ error: 'campaignId and a valid sheetType are required.' });
  }
  const store = loadCampaignStore();
  const periodKey = resolveCampaignPeriod(store, req.query.periodKey);
  if (!periodKey) return res.json({ periodKey: null, targeting: [], daily: [] });
  res.json({ periodKey, ...getCampaignDetail(store, { periodKey, sheetType, campaignId }) });
});

// Wipes stored campaign data: one brand across every period (?brand=), or everything.
app.delete('/api/campaign-data', requireAdmin, mutating(async (req, res) => {
  const brand = typeof req.query.brand === 'string' ? req.query.brand.trim() : '';
  if (brand) await removeCampaignBrandRows(brand);
  else await clearCampaignStore();
  await clearUploadHashes('campaign');
  campaignTrash.clear();
  res.json({ ok: true });
}));

// Removes every daily row of one campaign in a period. Returns an undo token.
app.delete('/api/campaign-analysis', requireAdmin, mutating(async (req, res) => {
  const { periodKey, sheetType, campaignId } = req.body || {};
  if (!periodKey || !SHEET_TYPES.includes(sheetType) || !campaignId) {
    return res.status(400).json({ error: 'periodKey, sheetType and campaignId are required.' });
  }

  const removed = await removeCampaignRows(periodKey, sheetType, campaignId);
  if (!removed.length) return res.status(404).json({ error: 'Campaign not found.' });
  await clearUploadHashes('campaign');

  const undoToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  campaignTrash.set(undoToken, { rows: removed, expires: Date.now() + TRASH_TTL_MS });
  while (campaignTrash.size > TRASH_LIMIT) campaignTrash.delete(campaignTrash.keys().next().value);

  res.json({ ok: true, removedRows: removed.length, undoToken });
}));

// Re-inserts a previously deleted campaign (Ctrl+Z / undo) using its token.
app.post('/api/campaign-analysis/restore', requireAdmin, mutating(async (req, res) => {
  const { undoToken } = req.body || {};
  sweepCampaignTrash();
  const entry = undoToken ? campaignTrash.get(undoToken) : null;
  const rows = entry ? entry.rows : null;
  if (!rows) return res.status(404).json({ error: 'Nothing to restore - the undo window has expired.' });

  await restoreCampaignRows(rows);
  campaignTrash.delete(undoToken);
  res.json({ ok: true, restoredRows: rows.length });
}));

app.get('/api/campaign-summary', requireAuth, (req, res) => {
  const store = loadCampaignStore();
  const { periodKey, sheetType, brand } = campaignFilters(req, store);

  const empty = {
    totalAdSpend: 0, totalSales: 0, overallRoas: null, directRoas: null, roiPct: null,
    totalUnits: 0, totalCampaigns: 0, bestCampaign: null, worstCampaign: null,
    totalImpressions: 0, totalAtc: 0, totalDirectAtc: 0, totalIndirectAtc: 0, totalNewUsers: 0,
  };
  if (!periodKey) return res.json(empty);

  const rows = selectCampaignRows(store, { periodKey, sheetType, brand });
  const totals = aggregateCampaignTotals(rows);
  const campaigns = aggregateCampaigns(rows);
  const ranked = campaigns.filter((c) => c.adSpend > 0 && c.roas !== null);
  const best = ranked.length ? ranked.reduce((a, b) => (b.roas > a.roas ? b : a)) : null;
  const worst = ranked.length ? ranked.reduce((a, b) => (b.roas < a.roas ? b : a)) : null;

  res.json({
    totalAdSpend: totals.adSpend,
    totalSales: totals.sales,
    overallRoas: totals.roas,
    directRoas: totals.directRoas,
    roiPct: totals.roiPct,
    totalUnits: totals.qtySold,
    totalCampaigns: campaigns.length,
    bestCampaign: best ? { name: best.campaignName, roas: best.roas } : null,
    worstCampaign: worst ? { name: worst.campaignName, roas: worst.roas } : null,
    totalImpressions: totals.impressions,
    totalAtc: totals.atc,
    totalDirectAtc: totals.directAtc,
    totalIndirectAtc: totals.indirectAtc,
    totalNewUsers: totals.newUsersAcquired,
  });
});

/** Builds the Campaign workbook sheets (summary + daily data) for a period, or null if nothing is stored. */
function buildCampaignWorksheets(requestedPeriodKey, brand, sheetType) {
  const store = loadCampaignStore();
  const periodKey = resolveCampaignPeriod(store, requestedPeriodKey);
  if (!periodKey) return null;

  const rows = selectCampaignRows(store, { periodKey, sheetType, brand });
  const campaigns = aggregateCampaigns(rows).sort((a, b) => b.adSpend - a.adSpend);

  const summaryHeaders = [
    'Campaign', 'Brand', 'Type', 'Targeting Types', 'Ad Spend', 'Sales', 'Direct Sales', 'Indirect Sales',
    'ROAS', 'Direct ROAS', 'ROI %', 'ROS / Unit', 'Impressions', 'Direct ATC', 'Indirect ATC',
    'Direct Qty Sold', 'Indirect Qty Sold', 'New Users',
  ];
  const summaryRows = campaigns.map((c) => [
    c.campaignName, c.brandName, c.sheetType, c.targetingTypes.join(', '), c.adSpend, c.sales, c.directSales, c.indirectSales,
    c.roas, c.directRoas, c.roiPct, c.rosPerUnit, c.impressions, c.directAtc, c.indirectAtc,
    c.directQtySold, c.indirectQtySold, c.newUsersAcquired,
  ]);
  const summaryWs = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
  summaryWs['!cols'] = [{ wch: 45 }, { wch: 14 }, { wch: 24 }, { wch: 30 }, ...Array(14).fill({ wch: 14 })];

  const dailyHeaders = [
    'Date', 'Campaign ID', 'Campaign', 'Brand', 'Type', 'Targeting Type', 'Targeting Value', 'Match Type',
    'Most Viewed Position', 'CPM', 'Impressions', 'Direct ATC', 'Indirect ATC', 'Direct Qty Sold', 'Indirect Qty Sold',
    'Direct Sales', 'Indirect Sales', 'New Users', 'Ad Spend', 'Direct RoAS', 'Total RoAS',
  ];
  const dailyRows = [...rows]
    .sort((a, b) => a.date.localeCompare(b.date) || a.campaignName.localeCompare(b.campaignName))
    .map((r) => [
      r.date, r.campaignId, r.campaignName, r.brandName, r.sheetType, r.targetingType, r.targetingValue, r.matchType,
      r.mostViewedPosition ?? '', r.cpm, r.impressions, r.directAtc, r.indirectAtc, r.directQtySold, r.indirectQtySold,
      r.directSales, r.indirectSales, r.newUsersAcquired, r.estimatedBudgetConsumed, r.directRoas, r.totalRoas,
    ]);
  const dailyWs = XLSX.utils.aoa_to_sheet([dailyHeaders, ...dailyRows]);
  dailyWs['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 45 }, { wch: 14 }, { wch: 24 }, { wch: 18 }, { wch: 28 }, ...Array(14).fill({ wch: 12 })];

  return { summaryWs, dailyWs, periodKey };
}

app.get('/api/export-campaign', requireAuth, (req, res) => {
  const sheetType = SHEET_TYPES.includes(req.query.sheetType) ? req.query.sheetType : 'ALL';
  const built = buildCampaignWorksheets(req.query.periodKey, req.query.brand, sheetType);
  if (!built) return res.status(400).json({ error: 'No campaign report uploaded yet.' });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.summaryWs, 'Campaign Summary');
  XLSX.utils.book_append_sheet(wb, built.dailyWs, 'Daily Data');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="Campaign_Analysis_${built.periodKey}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// --- Full report: all sheets in one workbook -------------------------------

app.get('/api/export-all', requireAuth, (req, res) => {
  const inventory = buildInventoryWorksheet();
  const sales = buildSalesWorksheet();
  const campaign = buildCampaignWorksheets(req.query.periodKey, '', 'ALL');

  if (!inventory && !sales && !campaign) {
    return res.status(400).json({ error: 'Nothing to export yet — upload at least one report first.' });
  }

  const wb = XLSX.utils.book_new();
  if (inventory) XLSX.utils.book_append_sheet(wb, inventory.ws, 'Inventory');
  if (sales) XLSX.utils.book_append_sheet(wb, sales.ws, 'Sales by City');
  if (campaign) {
    XLSX.utils.book_append_sheet(wb, campaign.summaryWs, 'Campaign Summary');
    XLSX.utils.book_append_sheet(wb, campaign.dailyWs, 'Campaign Daily Data');
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const dateStamp = inventory?.date || sales?.date || todayDateString();
  res.setHeader('Content-Disposition', `attachment; filename="Full_Report_${dateStamp}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// Report data must be loaded before serving; never start with an empty store.
kv.init()
  .then((count) => {
    console.log(`Loaded ${count} kv_store key(s).`);
    app.listen(PORT, () => {
      console.log(`Blinkit dashboard running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
