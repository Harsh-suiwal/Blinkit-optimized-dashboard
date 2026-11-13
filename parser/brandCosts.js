// Stored costs per brand for the Profit tab (kv `brandCosts`):
//   { brands: [ { brandName, fileName, uploadedAt, products: [...], otherCosts: { 'YYYY-MM': rupees },
//                 manual: { products: { <productKey>: { productName, cogs, taxPct, commissionPct } }, settings: {...} } } ] }
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
 * Sets one typed value of one product (field: cogs | taxPct | commissionPct); null clears it.
 * Throws a readable Error for a bad field or value.
 */
async function setProductField(brand, productName, field, value) {
  const name = String(productName || '').trim();
  if (!name || name.length > 300) throw new Error('productName is required.');
  if (!(field in PRODUCT_FIELD_LIMITS)) throw new Error('field must be cogs, taxPct or commissionPct.');
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
  const hasValue = ['cogs', 'taxPct', 'commissionPct'].some((f) => row[f] !== undefined);
  if (hasValue) entry.manual.products[key] = row; else delete entry.manual.products[key];
  await kv.set(KEY, { brands });
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

/** One summary line per brand that has stored costs (no product data). */
function listBrandCosts() {
  return peekBrands().map((b) => ({
    brandName: b.brandName,
    fileName: b.fileName || '',
    uploadedAt: b.uploadedAt || '',
    productCount: Array.isArray(b.products) ? b.products.length : 0,
  }));
}

module.exports = { getBrandCosts, saveBrandProducts, setOtherCost, setProductField, setProfitSettings, listBrandCosts };
