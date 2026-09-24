require('dotenv').config();

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const { parseReport } = require('./parser/parseReport');
const { appendSnapshot, computeExtendedWindows, todayDateString } = require('./parser/snapshotHistory');
const { parseSalesRows, aggregateByCity, aggregateByProduct, assignPerformanceTiers } = require('./parser/parseSales');
const {
  appendCitySnapshot,
  attachTrend,
  clearHistory,
  removeCityFromHistory,
  getSnapshotsForCity,
  restoreSnapshotsForCity,
} = require('./parser/salesHistory');
const { parseCampaignSheet, assignPerformanceTiers: assignCampaignTiers } = require('./parser/parseCampaign');
const {
  loadStore: loadCampaignStore,
  upsertPeriods,
  getLatestPeriodKey,
  listPeriods,
  removeCampaignAt,
  restoreCampaignAt,
} = require('./parser/campaignStore');

const { requireAuth, requireAdmin } = require('./middleware/auth');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_PATH = path.join(__dirname, 'data', 'latest.json');
const SALES_DATA_PATH = path.join(__dirname, 'data', 'salesLatest.json');
const PRODUCT_SALES_PATH = path.join(__dirname, 'data', 'salesByProduct.json');
const LOW_STOCK_THRESHOLD = 10; // change this one number to adjust the "low stock" line

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });

// --- Session setup --------------------------------------------------------

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'blinkit-dashboard-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // set to true behind HTTPS in production
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

// Serve static files, but redirect to /login if not authenticated
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

  express.static(path.join(__dirname, 'public'))(req, res, next);
});

/**
 * Builds the full consolidated product list: today's parsed rows plus
 * the 45/60 day figures pulled from snapshot history.
 */
function buildConsolidatedRows(parsedRows, date) {
  return parsedRows.map((row) => {
    const { unitsSold45, unitsSold60 } = computeExtendedWindows({
      itemId: row.itemId,
      warehouseId: row.warehouseId,
      latestDate: date,
      latestUnitsSold30: row.unitsSold30,
    });

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

function saveLatest(rows, date, fileName) {
  fs.writeFileSync(DATA_PATH, JSON.stringify({ date, fileName, rows }, null, 2));
}

function loadLatest() {
  if (!fs.existsSync(DATA_PATH)) return null;
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
}

// --- Upload (admin only) --------------------------------------------------

app.post('/api/upload', requireAdmin, upload.single('report'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    const parsedRows = parseReport(req.file.path);
    const date = todayDateString();

    // Save this upload into the history log BEFORE computing 45/60 day
    // windows for it, so today's own snapshot is available for future uploads.
    appendSnapshot(parsedRows, date);

    const rows = buildConsolidatedRows(parsedRows, date);
    saveLatest(rows, date, req.file.originalname);

    res.json({ ok: true, date, rowCount: rows.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// --- Read APIs (any authenticated user) ------------------------------------

app.get('/api/products', requireAuth, (req, res) => {
  const latest = loadLatest();
  if (!latest) return res.json({ date: null, rows: [] });
  res.json(latest);
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

// Removes one product+warehouse row from the current inventory view.
// Kept intentionally simple: this only touches the current view (not the
// 45/60 day snapshot history), since that history is shared across
// products and warehouses and shouldn't be wiped by a single-row delete.
app.delete('/api/products', requireAdmin, (req, res) => {
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
  saveLatest(latest.rows, latest.date, latest.fileName);

  res.json({ ok: true, removedRow, index, rowCount: latest.rows.length });
});

// Re-inserts a previously deleted row (Ctrl+Z / undo) at its original
// position.
app.post('/api/products/restore', requireAdmin, (req, res) => {
  const { row, index } = req.body || {};
  if (!row) return res.status(400).json({ error: 'row is required.' });

  const latest = loadLatest();
  if (!latest) return res.status(404).json({ error: 'No inventory data to restore into.' });

  const clampedIndex = Math.max(0, Math.min(typeof index === 'number' ? index : latest.rows.length, latest.rows.length));
  latest.rows.splice(clampedIndex, 0, row);
  saveLatest(latest.rows, latest.date, latest.fileName);

  res.json({ ok: true, rowCount: latest.rows.length });
});

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

function extractBrand(name, explicitBrand) {
  if (explicitBrand && typeof explicitBrand === 'string' && explicitBrand.trim()) {
    return explicitBrand.trim();
  }
  if (!name || typeof name !== 'string') return '';
  const clean = name.trim();
  if (clean.toLowerCase().includes('oicia')) return 'Oicia';
  if (clean.toLowerCase().includes('smarteez')) return 'Smarteez';
  const match = clean.match(/^([A-Za-z0-9&'-]+)/);
  if (!match) return '';
  let b = match[1];
  if (b.includes('_')) b = b.split('_')[0];
  if (b.includes('-')) b = b.split('-')[0];
  return b.charAt(0).toUpperCase() + b.slice(1).toLowerCase();
}

// Distinct brand names across all uploaded data (inventory + sales).
app.get('/api/brand-names', requireAuth, (req, res) => {
  const brands = new Set();

  const inventory = loadLatest();
  if (inventory && Array.isArray(inventory.rows)) {
    inventory.rows.forEach((r) => {
      const b = extractBrand(r.productName, r.brandName);
      if (b) brands.add(b);
    });
  }

  const productSales = loadProductSalesLatest();
  if (productSales && Array.isArray(productSales.productRows)) {
    productSales.productRows.forEach((r) => {
      const b = extractBrand(r.productName, r.brandName);
      if (b) brands.add(b);
    });
  }

  const salesLatest = loadSalesLatest();
  if (salesLatest && Array.isArray(salesLatest.cityRows)) {
    salesLatest.cityRows.forEach((r) => {
      const b = extractBrand(r.topProduct, r.brandName);
      if (b) brands.add(b);
    });
  }

  res.json({ brands: Array.from(brands).sort((a, b) => a.localeCompare(b)) });
});

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

function saveSalesLatest(cityRows, date, fileName) {
  fs.writeFileSync(SALES_DATA_PATH, JSON.stringify({ date, fileName, cityRows }, null, 2));
}

function loadSalesLatest() {
  if (!fs.existsSync(SALES_DATA_PATH)) return null;
  return JSON.parse(fs.readFileSync(SALES_DATA_PATH, 'utf-8'));
}

function saveProductSalesLatest(productRows, date, fileName) {
  fs.writeFileSync(PRODUCT_SALES_PATH, JSON.stringify({ date, fileName, productRows }, null, 2));
}

function loadProductSalesLatest() {
  if (!fs.existsSync(PRODUCT_SALES_PATH)) return null;
  return JSON.parse(fs.readFileSync(PRODUCT_SALES_PATH, 'utf-8'));
}

app.post('/api/sales-upload', requireAdmin, upload.single('report'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    const salesRows = parseSalesRows(req.file.path);
    const date = todayDateString();

    const cityAgg = aggregateByCity(salesRows);

    // Log today's per-city totals BEFORE computing trend, so this
    // upload becomes available as a comparison point for the next one.
    appendCitySnapshot(cityAgg, date);

    const withTrend = attachTrend(cityAgg, date);
    const withTiers = assignPerformanceTiers(withTrend);

    // Highest revenue first by default
    withTiers.sort((a, b) => b.revenue - a.revenue);

    saveSalesLatest(withTiers, date, req.file.originalname);

    // Also aggregate per-product (across all cities), so the product
    // focus dropdown can show one product's performance everywhere.
    const productAgg = aggregateByProduct(salesRows);
    saveProductSalesLatest(productAgg, date, req.file.originalname);

    res.json({ ok: true, date, cityCount: withTiers.length, orderRowCount: salesRows.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

app.get('/api/city-performance', requireAuth, (req, res) => {
  const latest = loadSalesLatest();
  if (!latest) return res.json({ date: null, cityRows: [] });
  res.json(latest);
});

// Wipes the current sales snapshot AND the trend history log.
app.delete('/api/sales-history', requireAdmin, (req, res) => {
  if (fs.existsSync(SALES_DATA_PATH)) fs.unlinkSync(SALES_DATA_PATH);
  if (fs.existsSync(PRODUCT_SALES_PATH)) fs.unlinkSync(PRODUCT_SALES_PATH);
  clearHistory();
  res.json({ ok: true });
});

// Removes one city row from the current view and purges its history
// so it doesn't resurface as a "previous" comparison point later.
// Returns everything needed to fully undo the delete (Ctrl+Z), including
// the trend-history snapshots that would otherwise be lost.
app.delete('/api/city-performance/:city', requireAdmin, (req, res) => {
  const { city } = req.params;
  const latest = loadSalesLatest();
  if (!latest) return res.status(404).json({ error: 'No sales data to delete from.' });

  const index = latest.cityRows.findIndex((c) => c.city === city);
  if (index === -1) {
    return res.status(404).json({ error: `City "${city}" not found.` });
  }

  const removedHistorySnapshots = getSnapshotsForCity(city);
  const [removedRow] = latest.cityRows.splice(index, 1);

  saveSalesLatest(latest.cityRows, latest.date, latest.fileName);
  removeCityFromHistory(city);

  res.json({ ok: true, cityCount: latest.cityRows.length, removedRow, index, removedHistorySnapshots });
});

// Re-inserts a previously deleted city row (Ctrl+Z / undo), including its
// trend-history snapshots.
app.post('/api/city-performance/restore', requireAdmin, (req, res) => {
  const { cityRow, index, historySnapshots } = req.body || {};
  if (!cityRow) return res.status(400).json({ error: 'cityRow is required.' });

  const latest = loadSalesLatest();
  if (!latest) return res.status(404).json({ error: 'No sales data to restore into.' });

  const clampedIndex = Math.max(0, Math.min(typeof index === 'number' ? index : latest.cityRows.length, latest.cityRows.length));
  latest.cityRows.splice(clampedIndex, 0, cityRow);
  saveSalesLatest(latest.cityRows, latest.date, latest.fileName);

  restoreSnapshotsForCity(historySnapshots);

  res.json({ ok: true, cityCount: latest.cityRows.length });
});

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

// Brand-focus: a single brand's totals + per-city breakdown, aggregated
// from the product sales data.
app.get('/api/brand-sales', requireAuth, (req, res) => {
  const { brand } = req.query;
  if (!brand) return res.status(400).json({ error: 'brand is required.' });

  const latest = loadProductSalesLatest();
  if (!latest) return res.json({ date: null, cityRows: [] });

  const brandProducts = latest.productRows.filter((r) => {
    const b = extractBrand(r.productName, r.brandName);
    return b.toLowerCase() === brand.toLowerCase();
  });
  const cityAgg = new Map();

  for (const p of brandProducts) {
    for (const c of p.cities) {
      if (!cityAgg.has(c.city)) {
        cityAgg.set(c.city, { city: c.city, revenue: 0, units: 0, orderCount: 0, topProduct: null, topProductRevenue: 0 });
      }
      const agg = cityAgg.get(c.city);
      agg.revenue += c.revenue;
      agg.units += c.units;
      // We don't have accurate distinct order count per city across products here,
      // so we omit it or leave it as 0.
      
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
  if (!latest) {
    return res.json({ totalRevenue: 0, totalUnits: 0, totalOrders: 0, cityCount: 0, topCity: null });
  }

  const totalRevenue = latest.cityRows.reduce((sum, c) => sum + c.revenue, 0);
  const totalUnits = latest.cityRows.reduce((sum, c) => sum + c.units, 0);
  const totalOrders = latest.cityRows.reduce((sum, c) => sum + c.orderCount, 0);
  const topCity = latest.cityRows[0] ? latest.cityRows[0].city : null;

  res.json({
    date: latest.date,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalUnits,
    totalOrders,
    cityCount: latest.cityRows.length,
    topCity,
  });
});

/** Builds the Sales by City worksheet, or null if nothing has been uploaded. */
function buildSalesWorksheet() {
  const latest = loadSalesLatest();
  if (!latest) return null;

  const headers = [
    'City', 'Revenue', 'Units Sold', 'Order Count', 'Avg Order Value',
    'Best-Selling Product', 'Best-Selling Product Revenue',
    'Performance Tier', 'Revenue Change % (vs last upload)', 'Previous Revenue',
  ];

  const dataRows = latest.cityRows.map((c) => [
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

// --- Campaign Analysis ----------------------------------------------------

app.post('/api/campaign-upload', requireAdmin, upload.single('report'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    const parsedPeriods = parseCampaignSheet(req.file.path);
    if (parsedPeriods.length === 0) {
      throw new Error('No campaign period blocks were found in this file.');
    }

    const uploadedDate = todayDateString();
    const store = upsertPeriods(parsedPeriods, req.file.originalname, uploadedDate);
    const latestPeriodKey = getLatestPeriodKey(store);
    const latestCampaigns = store.periods[latestPeriodKey].campaigns;

    res.json({
      ok: true,
      periodCount: Object.keys(store.periods).length,
      campaignCount: latestCampaigns.length,
      latestPeriodKey,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

app.get('/api/campaign-analysis', requireAuth, (req, res) => {
  const store = loadCampaignStore();
  const periods = listPeriods(store);
  const latestPeriodKey = getLatestPeriodKey(store);
  const periodKey =
    req.query.periodKey && store.periods[req.query.periodKey] ? req.query.periodKey : latestPeriodKey;

  if (!periodKey) {
    return res.json({ date: null, periods: [], periodKey: null, latestPeriodKey: null, rows: [] });
  }

  // storeIndex records each campaign's position in the underlying store
  // array (independent of however the client sorts/filters for display)
  // so a delete or undo can target the exact right campaign.
  const rows = assignCampaignTiers(store.periods[periodKey].campaigns).map((c, i) => ({ ...c, storeIndex: i }));

  res.json({ date: store.uploadedDate, periods, periodKey, latestPeriodKey, rows });
});

// Removes one campaign from a period.
app.delete('/api/campaign-analysis', requireAdmin, (req, res) => {
  const { periodKey, storeIndex } = req.body || {};
  if (!periodKey || typeof storeIndex !== 'number') {
    return res.status(400).json({ error: 'periodKey and storeIndex are required.' });
  }

  const removed = removeCampaignAt(periodKey, storeIndex);
  if (!removed) return res.status(404).json({ error: 'Campaign not found.' });

  res.json({ ok: true, removed });
});

// Re-inserts a previously deleted campaign (Ctrl+Z / undo) at its
// original position within its period.
app.post('/api/campaign-analysis/restore', requireAdmin, (req, res) => {
  const { periodKey, storeIndex, campaign } = req.body || {};
  if (!periodKey || typeof storeIndex !== 'number' || !campaign) {
    return res.status(400).json({ error: 'periodKey, storeIndex and campaign are required.' });
  }

  // Strip display-only fields (tier, storeIndex) added by the read API
  // before writing the campaign back into the store.
  const { tier, storeIndex: _ignored, ...cleanCampaign } = campaign;

  const ok = restoreCampaignAt(periodKey, storeIndex, cleanCampaign);
  if (!ok) return res.status(404).json({ error: 'Period not found.' });

  res.json({ ok: true });
});

app.get('/api/campaign-summary', requireAuth, (req, res) => {
  const store = loadCampaignStore();
  const latestPeriodKey = getLatestPeriodKey(store);
  const periodKey =
    req.query.periodKey && store.periods[req.query.periodKey] ? req.query.periodKey : latestPeriodKey;

  if (!periodKey) {
    return res.json({
      totalAdSpend: 0,
      totalSales: 0,
      overallRoas: null,
      roiPct: null,
      totalUnits: 0,
      activeCampaigns: 0,
      totalCampaigns: 0,
      bestCampaign: null,
      worstCampaign: null,
      totalImpressions: 0,
      totalAtc: 0,
    });
  }

  const campaigns = store.periods[periodKey].campaigns;
  const totalAdSpend = campaigns.reduce((s, c) => s + c.adSpend, 0);
  const totalSales = campaigns.reduce((s, c) => s + c.sales, 0);
  const totalUnits = campaigns.reduce((s, c) => s + c.qtySold, 0);
  const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);
  const totalAtc = campaigns.reduce((s, c) => s + c.atc, 0);
  const activeCampaigns = campaigns.filter((c) => c.status.toLowerCase() === 'active').length;

  const ranked = campaigns.filter((c) => c.adSpend > 0 && c.roas !== null);
  const best = ranked.length ? ranked.reduce((a, b) => (b.roas > a.roas ? b : a)) : null;
  const worst = ranked.length ? ranked.reduce((a, b) => (b.roas < a.roas ? b : a)) : null;

  res.json({
    totalAdSpend: Math.round(totalAdSpend * 100) / 100,
    totalSales: Math.round(totalSales * 100) / 100,
    overallRoas: totalAdSpend > 0 ? Math.round((totalSales / totalAdSpend) * 100) / 100 : null,
    roiPct: totalAdSpend > 0 ? Math.round(((totalSales - totalAdSpend) / totalAdSpend) * 1000) / 10 : null,
    totalUnits,
    activeCampaigns,
    totalCampaigns: campaigns.length,
    bestCampaign: best ? { name: best.campaignName, roas: best.roas } : null,
    worstCampaign: worst ? { name: worst.campaignName, roas: worst.roas } : null,
    totalImpressions,
    totalAtc,
  });
});

/** Builds the Campaign Analysis worksheet for a period, or null if nothing has been uploaded. */
function buildCampaignWorksheet(requestedPeriodKey) {
  const store = loadCampaignStore();
  const latestPeriodKey = getLatestPeriodKey(store);
  const periodKey = requestedPeriodKey && store.periods[requestedPeriodKey] ? requestedPeriodKey : latestPeriodKey;
  if (!periodKey) return null;

  const campaigns = store.periods[periodKey].campaigns;
  const headers = [
    'Campaign', 'Type', 'Status', 'Ad Spend', 'Sales', 'ROAS', 'ROI %', 'ROS / Unit', 'Impressions', 'ATC', 'Qty Sold',
  ];
  const dataRows = campaigns.map((c) => [
    c.campaignName, c.campaignDetail, c.status, c.adSpend, c.sales, c.roas, c.roiPct, c.rosPerUnit, c.impressions, c.atc, c.qtySold,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  ws['!cols'] = [
    { wch: 45 }, { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 },
  ];
  return { ws, periodKey };
}

app.get('/api/export-campaign', requireAuth, (req, res) => {
  const built = buildCampaignWorksheet(req.query.periodKey);
  if (!built) return res.status(400).json({ error: 'No campaign report uploaded yet.' });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.ws, 'Campaign Analysis');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="Campaign_Analysis_${built.periodKey}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// --- Full report: all sheets in one workbook -------------------------------

app.get('/api/export-all', requireAuth, (req, res) => {
  const inventory = buildInventoryWorksheet();
  const sales = buildSalesWorksheet();
  const campaign = buildCampaignWorksheet(req.query.periodKey);

  if (!inventory && !sales && !campaign) {
    return res.status(400).json({ error: 'Nothing to export yet — upload at least one report first.' });
  }

  const wb = XLSX.utils.book_new();
  if (inventory) XLSX.utils.book_append_sheet(wb, inventory.ws, 'Inventory');
  if (sales) XLSX.utils.book_append_sheet(wb, sales.ws, 'Sales by City');
  if (campaign) XLSX.utils.book_append_sheet(wb, campaign.ws, 'Campaign Analysis');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const dateStamp = inventory?.date || sales?.date || todayDateString();
  res.setHeader('Content-Disposition', `attachment; filename="Full_Report_${dateStamp}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

app.listen(PORT, () => {
  console.log(`Blinkit dashboard running at http://localhost:${PORT}`);
});
