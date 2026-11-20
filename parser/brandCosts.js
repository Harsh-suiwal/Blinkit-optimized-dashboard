// Stored costs per brand for the Profit tab (kv `brandCosts`):
//   { brands: [ { brandName, fileName, uploadedAt, products: [...], otherCosts: { 'YYYY-MM': rupees },
//                 manual: { products: { <productKey>: { productName, cogs, taxPct, commissionPct, mrp, sellingPrice } }, settings: {...} } } ] }
// A cost-sheet upload replaces a brand's products and keeps its monthly "other costs" and everything typed
// into the Profit tab (`manual`). Typed values live apart from `products` on purpose: the old Profit maths and
// the report read `products` only, and a half-filled typed row must never look like a priced product to them.
const kv = require('../store/kv');
const { productKey } = require('./parseBrandCosts');
const { cleanSettingsPatch, PRODUCT_FIELD_LIMITS } = require('./profitView');

const KEY = 'brandCosts';
const brandKey = (brand) => String(brand || '').trim().toLowerCase();

/** READ-ONLY view of the store (never mutate). */
function peekBrands() {
  const store = kv.peek(KEY, null);
  return store && Array.isArray(store.brands) ? store.brands : [];
}

/** The stored costs of one brand (case-insensitive), or null. READ-ONLY. */
function getBrandCosts(brand) {
  return peekBrands().find((b) => brandKey(b.brandName) === brandKey(brand)) || null;
}

function loadForWrite() {
  const store = kv.get(KEY, null);
  return store && Array.isArray(store.brands) ? store.brands : [];
}

/** Replaces a brand's product costs (from parseCostFile) and keeps its other costs. */
async function saveBrandProducts(brand, products, fileName, uploadedAt) {
  const brands = loadForWrite();
  const index = brands.findIndex((b) => brandKey(b.brandName) === brandKey(brand));
  const existing = index >= 0 ? brands[index] : null;
  const entry = {
    brandName: existing ? existing.brandName : String(brand).trim(),
    fileName: fileName || '',
    uploadedAt: uploadedAt || '',
    products,
    otherCosts: existing && existing.otherCosts ? existing.otherCosts : {},
  };
  if (existing && existing.manual) entry.manual = existing.manual; // typed values survive a cost-sheet upload
  if (index >= 0) brands[index] = entry; else brands.push(entry);
  await kv.set(KEY, { brands });
  return entry;
}

/** Sets one month's other costs in rupees (0 removes it). Works before a cost sheet is uploaded. */
async function setOtherCost(brand, monthKey, amount) {
  const brands = loadForWrite();
  let entry = brands.find((b) => brandKey(b.brandName) === brandKey(brand));
  if (!entry) {
    entry = { brandName: String(brand).trim(), fileName: '', uploadedAt: '', products: [], otherCosts: {} };
    brands.push(entry);
  }
  entry.otherCosts = entry.otherCosts || {};
  if (amount > 0) entry.otherCosts[monthKey] = Math.round(amount * 100) / 100;
  else delete entry.otherCosts[monthKey];
  await kv.set(KEY, { brands });
}

/** The stored entry of a brand inside `brands`, created empty when it does not exist yet. */
function entryFor(brands, brand) {
  let entry = brands.find((b) => brandKey(b.brandName) === brandKey(brand));
  if (!entry) {
    entry = { brandName: String(brand).trim(), fileName: '', uploadedAt: '', products: [], otherCosts: {} };
    brands.push(entry);
  }
  return entry;
}

/**
 * Sets one typed value of one product (field: cogs | taxPct | commissionPct | mrp | sellingPrice); null clears it.
 * Throws a readable Error for a bad field or value.
 */
async function setProductField(brand, productName, field, value) {
  const name = String(productName || '').trim();
  if (!name || name.length > 300) throw new Error('productName is required.');
  if (!(field in PRODUCT_FIELD_LIMITS)) throw new Error('field must be cogs, taxPct, commissionPct, mrp or sellingPrice.');
  const number = value === null ? null : Number(value);
  if (number !== null && (value === '' || !Number.isFinite(number) || number < 0 || number > PRODUCT_FIELD_LIMITS[field])) {
    throw new Error(`${field} must be a number from 0 to ${PRODUCT_FIELD_LIMITS[field]}, or empty to clear it.`);
  }
  const brands = loadForWrite();
  const entry = entryFor(brands, brand);
  entry.manual = entry.manual || {};
  entry.manual.products = entry.manual.products || {};
  const key = productKey(name);
  const row = entry.manual.products[key] || { productName: name };
  if (number === null) delete row[field]; else row[field] = Math.round(number * 10000) / 10000;
  const hasValue = ['cogs', 'taxPct', 'commissionPct', 'mrp', 'sellingPrice'].some((f) => row[f] !== undefined);
  if (hasValue) entry.manual.products[key] = row; else delete entry.manual.products[key];
  await kv.set(KEY, { brands });
}

/**
 * Fills MRP, selling price and commission % of many products at once from a Blinkit Product Listing report.
 * They go into the typed values (`manual.products`), the same boxes as the Listing table, so the report
 * overwrites what was typed for those three fields and leaves COGS and GST % alone. The uploaded cost
 * sheet (`products`) is not touched. Returns how many products were filled.
 */
async function saveListingFigures(brand, products, fileName) {
  const brands = loadForWrite();
  const entry = entryFor(brands, brand);
  entry.manual = entry.manual || {};
  entry.manual.products = entry.manual.products || {};
  let filled = 0;
  for (const p of products) {
    const key = productKey(p.productName);
    if (!key) continue;
    const row = entry.manual.products[key] || { productName: p.productName };
    if (p.mrp > 0) row.mrp = p.mrp;
    if (p.sellingPrice > 0) row.sellingPrice = p.sellingPrice;
    if (p.commissionPct >= 0 && p.commissionPct <= 100) row.commissionPct = p.commissionPct;
    entry.manual.products[key] = row;
    filled += 1;
  }
  entry.manual.listingFile = { fileName: String(fileName || ''), uploadedAt: new Date().toISOString().slice(0, 10) };
  await kv.set(KEY, { brands });
  return filled;
}

/** Saves the Profit tab's default numbers (GST %, commission %, per-unit inward / fulfilment / storage fees). */
async function setProfitSettings(brand, patch) {
  const clean = cleanSettingsPatch(patch);
  const brands = loadForWrite();
  const entry = entryFor(brands, brand);
  entry.manual = entry.manual || {};
  entry.manual.settings = { ...(entry.manual.settings || {}), ...clean };
  await kv.set(KEY, { brands });
  return entry.manual.settings;
}

/** True when something was typed in by hand for this brand: COGS / GST / commission per product, Profit settings, or monthly other costs. */
function hasTypedData(entry) {
  const manual = entry.manual || {};
  return Object.keys(manual.products || {}).length > 0
    || Object.keys(manual.settings || {}).length > 0
    || Object.keys(entry.otherCosts || {}).length > 0;
}

/** One summary line per brand that has stored costs (no product data). */
function listBrandCosts() {
  return peekBrands().map((b) => ({
    brandName: b.brandName,
    fileName: b.fileName || '',
    uploadedAt: b.uploadedAt || '',
    productCount: Array.isArray(b.products) ? b.products.length : 0,
    hasTyped: hasTypedData(b),
  }));
}

/**
 * Removes a brand's uploaded cost sheet. With `typed` true the hand-typed data goes too (COGS, GST %,
 * commission %, Profit settings, monthly other costs); otherwise it is kept for when the brand is uploaded again.
 * Returns { costSheet, typed }: what was actually removed.
 */
async function removeBrandCosts(brand, { typed = false } = {}) {
  const brands = loadForWrite();
  const index = brands.findIndex((b) => brandKey(b.brandName) === brandKey(brand));
  if (index === -1) return { costSheet: false, typed: false };
  const entry = brands[index];
  const hadSheet = Array.isArray(entry.products) && entry.products.length > 0;
  const hadTyped = hasTypedData(entry);
  if (typed || !hadTyped) {
    brands.splice(index, 1);
  } else {
    brands[index] = { ...entry, fileName: '', uploadedAt: '', products: [] };
  }
  await kv.set(KEY, { brands });
  return { costSheet: hadSheet, typed: typed && hadTyped };
}

module.exports = { getBrandCosts, saveBrandProducts, saveListingFigures, setOtherCost, setProductField, setProfitSettings, listBrandCosts, removeBrandCosts };
