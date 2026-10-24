// Monthly sales history for the Monthly Comparison page and the Brand Overview trend.
// Every order row is filed under the calendar month of its Order Date, per brand, as
// pre-aggregated totals (overall, per city, per product). Stored in kv `salesMonthly`
// as { slots: [...] }, one slot per (brand, platform, month). An upload replaces only the
// (brand, platform, month) slots it contains; everything else stays. `platform` is
// 'blinkit' today; Zepto / Flipkart Minutes uploads will add their own slots later.
const kv = require('../store/kv');

const KEY = 'salesMonthly';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PLATFORM_RE = /^[a-z0-9-]{1,30}$/;
const DEFAULT_PLATFORM = 'blinkit';

const round2 = (n) => Math.round(n * 100) / 100;
const pad2 = (n) => String(n).padStart(2, '0');
const brandKey = (brand) => String(brand || 'Unknown').trim().toLowerCase();
const platformOf = (slot) => slot.platform || DEFAULT_PLATFORM;
const slotKey = (s) => `${brandKey(s.brandName)}|${platformOf(s)}|${s.monthKey}`;

/**
 * Reads an order date as { y, m, d }. Accepts YYYY-MM-DD (optionally with a time),
 * DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY, and Excel date serial numbers.
 * Returns null when the value can't be read as a real date.
 */
function parseOrderDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  let y; let m; let d;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if (/^\d+(\.\d+)?$/.test(text) && Number(text) > 20000 && Number(text) < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86400000);
    [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else {
    return null;
  }
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** True when the uploaded orders don't cover the month from its 1st to its last day. */
function isPartial(monthKey, from, to) {
  return from !== `${monthKey}-01` || to !== `${monthKey}-${pad2(daysInMonth(monthKey))}`;
}

function newTotals() {
  return { revenue: 0, units: 0, orderIds: new Set() };
}

function addTo(t, row) {
  t.revenue += row.revenue;
  t.units += row.quantity;
  t.orderIds.add(row.orderId);
}

function finishTotals(t) {
  const orderCount = t.orderIds.size;
  return {
    revenue: round2(t.revenue),
    units: t.units,
    orderCount,
    avgOrderValue: orderCount > 0 ? round2(t.revenue / orderCount) : 0,
  };
}

/**
 * Turns parsed sales rows (parseSalesRows output, brandName already filled in) into one
 * slot per (brand, month). Rows whose Order Date can't be read are counted in skippedRows.
 */
function buildMonthSlots(salesRows, fileName, uploadedAt, platform = DEFAULT_PLATFORM) {
  const groups = new Map();
  let skippedRows = 0;
  for (const row of salesRows) {
    const date = parseOrderDate(row.orderDate);
    if (!date) { skippedRows += 1; continue; }
    const monthKey = `${date.y}-${pad2(date.m)}`;
    const day = `${monthKey}-${pad2(date.d)}`;
    const brandName = row.brandName || 'Unknown';
    const key = `${brandKey(brandName)}|${monthKey}`;
    if (!groups.has(key)) {
      groups.set(key, { brandName, monthKey, from: day, to: day, totals: newTotals(), cities: new Map(), products: new Map() });
    }
    const g = groups.get(key);
    if (day < g.from) g.from = day;
    if (day > g.to) g.to = day;
    addTo(g.totals, row);
    const city = row.customerCity || 'Unknown';
    if (!g.cities.has(city)) g.cities.set(city, newTotals());
    addTo(g.cities.get(city), row);
    if (row.productName) {
      if (!g.products.has(row.productName)) g.products.set(row.productName, newTotals());
      addTo(g.products.get(row.productName), row);
    }
  }

  const slots = Array.from(groups.values()).map((g) => {
    const cities = Array.from(g.cities, ([city, t]) => {
      const f = finishTotals(t);
      return { city, revenue: f.revenue, units: f.units, orderCount: f.orderCount };
    }).sort((a, b) => b.revenue - a.revenue);
    const products = Array.from(g.products, ([productName, t]) => {
      const f = finishTotals(t);
      return { productName, revenue: f.revenue, units: f.units, orderCount: f.orderCount };
    }).sort((a, b) => b.revenue - a.revenue);
    return {
      brandName: g.brandName,
      platform,
      monthKey: g.monthKey,
      from: g.from,
      to: g.to,
      fileName: fileName || '',
      uploadedAt: uploadedAt || '',
      totals: { ...finishTotals(g.totals), cityCount: cities.length, productCount: products.length },
      cities,
      products,
    };
  }).sort((a, b) => a.monthKey.localeCompare(b.monthKey) || a.brandName.localeCompare(b.brandName));

  return { slots, skippedRows };
}

/** READ-ONLY view of the stored slots (never mutate). */
function peekSlots() {
  const store = kv.peek(KEY, null);
  return store && Array.isArray(store.slots) ? store.slots : [];
}

/** Stores slots; each replaces the stored slot for the same (brand, platform, month). */
async function upsertMonthSlots(newSlots) {
  const store = kv.get(KEY, null) || { slots: [] };
  const slots = Array.isArray(store.slots) ? store.slots : [];
  const replaced = new Set(newSlots.map(slotKey));
  const kept = slots.filter((s) => !replaced.has(slotKey(s)));
  await kv.set(KEY, { slots: kept.concat(newSlots) });
}

/** brand '' = every brand; platform '' = every platform. */
function slotsFor(brand, platform = '') {
  return peekSlots().filter((s) =>
    (!brand || brandKey(s.brandName) === brandKey(brand)) && (!platform || platformOf(s) === platform));
}

/** Platforms that have monthly data for a brand ('' = any brand), e.g. ['blinkit']. */
function listMonthlyPlatforms(brand) {
  return Array.from(new Set(slotsFor(brand).map(platformOf))).sort();
}

/** Brand names that have monthly data. */
function listMonthlyBrands() {
  const byKey = new Map();
  peekSlots().forEach((s) => byKey.set(brandKey(s.brandName), s.brandName));
  return Array.from(byKey.values());
}

/**
 * Months available for a brand ('' = all brands combined) on a platform ('' = all platforms
 * combined), oldest first, with headline totals.
 * With all brands, orders are summed per brand (an order with two brands counts once in each),
 * the same rule as the Sales tab.
 */
function listMonths(brand, platform = '') {
  const byMonth = new Map();
  for (const s of slotsFor(brand, platform)) {
    if (!byMonth.has(s.monthKey)) {
      byMonth.set(s.monthKey, { monthKey: s.monthKey, from: s.from, to: s.to, revenue: 0, units: 0, orderCount: 0, brands: [] });
    }
    const m = byMonth.get(s.monthKey);
    if (s.from < m.from) m.from = s.from;
    if (s.to > m.to) m.to = s.to;
    m.revenue += s.totals.revenue;
    m.units += s.totals.units;
    m.orderCount += s.totals.orderCount;
    if (!m.brands.includes(s.brandName)) m.brands.push(s.brandName);
  }
  return Array.from(byMonth.values())
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .map((m) => ({
      ...m,
      label: monthLabel(m.monthKey),
      partial: isPartial(m.monthKey, m.from, m.to),
      revenue: round2(m.revenue),
      avgOrderValue: m.orderCount > 0 ? round2(m.revenue / m.orderCount) : 0,
    }));
}

function addMetrics(target, src) {
  target.revenue += src.revenue;
  target.units += src.units;
  target.orderCount += src.orderCount;
}

function finishMetrics(m) {
  return {
    revenue: round2(m.revenue),
    units: m.units,
    orderCount: m.orderCount,
    avgOrderValue: m.orderCount > 0 ? round2(m.revenue / m.orderCount) : 0,
  };
}

/**
 * Side-by-side figures for the requested months (sorted oldest first; unknown months are
 * dropped). Cities and products carry one entry per month in `byMonth` (missing = no sales).
 */
function compareMonths(brand, monthKeys, platform = '') {
  const wanted = Array.from(new Set(monthKeys.filter((k) => MONTH_KEY_RE.test(k)))).sort();
  const available = new Map(listMonths(brand, platform).map((m) => [m.monthKey, m]));
  const months = wanted.filter((k) => available.has(k));
  const monthSet = new Set(months);
  const zero = () => ({ revenue: 0, units: 0, orderCount: 0 });

  const totals = new Map(months.map((k) => [k, zero()]));
  const cities = new Map();
  const products = new Map();
  for (const s of slotsFor(brand, platform)) {
    if (!monthSet.has(s.monthKey)) continue;
    addMetrics(totals.get(s.monthKey), s.totals);
    for (const c of s.cities) {
      if (!cities.has(c.city)) cities.set(c.city, { city: c.city, byMonth: {} });
      const entry = cities.get(c.city);
      entry.byMonth[s.monthKey] = entry.byMonth[s.monthKey] || zero();
      addMetrics(entry.byMonth[s.monthKey], c);
    }
    for (const p of s.products) {
      const key = `${p.productName}::${brandKey(s.brandName)}`;
      if (!products.has(key)) products.set(key, { productName: p.productName, brandName: s.brandName, byMonth: {} });
      const entry = products.get(key);
      entry.byMonth[s.monthKey] = entry.byMonth[s.monthKey] || zero();
      addMetrics(entry.byMonth[s.monthKey], p);
    }
  }

  const finishRow = (row) => ({
    ...row,
    byMonth: Object.fromEntries(Object.entries(row.byMonth).map(([k, v]) => [k, finishMetrics(v)])),
  });
  return {
    months: months.map((k) => {
      const m = available.get(k);
      return { monthKey: k, label: m.label, from: m.from, to: m.to, partial: m.partial, ...finishMetrics(totals.get(k)) };
    }),
    cities: Array.from(cities.values()).map(finishRow),
    products: Array.from(products.values()).map(finishRow),
  };
}

/** Removes one brand's month on one platform. Returns the removed slot (for undo) or null. */
async function removeMonth(brand, monthKey, platform = DEFAULT_PLATFORM) {
  const store = kv.get(KEY, null) || { slots: [] };
  const slots = Array.isArray(store.slots) ? store.slots : [];
  const index = slots.findIndex((s) =>
    brandKey(s.brandName) === brandKey(brand) && s.monthKey === monthKey && platformOf(s) === platform);
  if (index === -1) return null;
  const [removed] = slots.splice(index, 1);
  await kv.set(KEY, { slots });
  return removed;
}

/** Checks a slot sent back by the client for undo. Returns the cleaned slot or null. */
function validSlot(slot) {
  if (!slot || typeof slot !== 'object') return null;
  if (typeof slot.brandName !== 'string' || !slot.brandName.trim()) return null;
  if (typeof slot.monthKey !== 'string' || !MONTH_KEY_RE.test(slot.monthKey)) return null;
  if (!slot.totals || typeof slot.totals !== 'object') return null;
  if (!Array.isArray(slot.cities) || !Array.isArray(slot.products)) return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const metrics = (r) => ({ revenue: num(r.revenue), units: num(r.units), orderCount: num(r.orderCount) });
  return {
    brandName: slot.brandName.trim(),
    platform: typeof slot.platform === 'string' && PLATFORM_RE.test(slot.platform) ? slot.platform : DEFAULT_PLATFORM,
    monthKey: slot.monthKey,
    from: String(slot.from || `${slot.monthKey}-01`),
    to: String(slot.to || `${slot.monthKey}-01`),
    fileName: String(slot.fileName || ''),
    uploadedAt: String(slot.uploadedAt || ''),
    totals: {
      ...metrics(slot.totals),
      avgOrderValue: num(slot.totals.avgOrderValue),
      cityCount: num(slot.totals.cityCount),
      productCount: num(slot.totals.productCount),
    },
    cities: slot.cities.filter((c) => c && typeof c.city === 'string').map((c) => ({ city: c.city, ...metrics(c) })),
    products: slot.products.filter((p) => p && typeof p.productName === 'string').map((p) => ({ productName: p.productName, ...metrics(p) })),
  };
}

/** Puts an undone slot back (replacing any slot for the same brand, platform and month). */
async function restoreMonth(slot) {
  const clean = validSlot(slot);
  if (!clean) return false;
  await upsertMonthSlots([clean]);
  return true;
}

module.exports = {
  parseOrderDate,
  monthLabel,
  buildMonthSlots,
  upsertMonthSlots,
  listMonthlyBrands,
  listMonthlyPlatforms,
  listMonths,
  compareMonths,
  removeMonth,
  restoreMonth,
  MONTH_KEY_RE,
  PLATFORM_RE,
};
