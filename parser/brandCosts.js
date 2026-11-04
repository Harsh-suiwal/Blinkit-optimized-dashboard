// Stored costs per brand for the Profit tab (kv `brandCosts`):
//   { brands: [ { brandName, fileName, uploadedAt, products: [...], otherCosts: { 'YYYY-MM': rupees } } ] }
// A cost-sheet upload replaces a brand's products and keeps its monthly "other costs".
const kv = require('../store/kv');

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

module.exports = { getBrandCosts, saveBrandProducts, setOtherCost };
