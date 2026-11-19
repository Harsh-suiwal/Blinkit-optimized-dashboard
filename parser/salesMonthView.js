// Rebuilds the Sales tab's rows for ONE chosen month from the stored monthly slots
// (parser/salesMonthly.js), in the same shape the "latest upload" view uses, so the page
// can show any uploaded month. Pure functions: no kv / Supabase, so console.js can import this too.

const round2 = (n) => Math.round(n * 100) / 100;
const brandKey = (b) => String(b || 'Unknown').trim().toLowerCase();

/** '2026-11' -> '2026-10', '2026-01' -> '2025-12'. */
function previousMonthKey(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * @param {object[]} slots      the month's slots (one per brand)
 * @param {object[]} prevSlots  the previous calendar month's slots, used only for the trend
 * @param {boolean} comparePrev true only when both months are complete (a partial month is never compared)
 * @returns {{ cityRows, productRows, brandUploads, date, from, to, fileNames }}
 *   cityRows: one row per (brand, city) with previousRevenue filled when comparePrev, ready for combineCityRows().
 */
function monthSalesView(slots, prevSlots = [], comparePrev = false) {
  const prevByBrandCity = new Map();
  if (comparePrev) {
    for (const s of prevSlots) {
      for (const c of s.cities) prevByBrandCity.set(`${brandKey(s.brandName)}|${c.city}`, c.revenue);
    }
  }

  const cityRows = [];
  const productRows = [];
  const brandUploads = {};
  let date = '';
  let from = '';
  let to = '';
  const fileNames = [];

  for (const s of slots) {
    // The best-selling product per city = the product with the most revenue in that city.
    const top = new Map();
    for (const p of s.products) {
      for (const c of p.cities || []) {
        const cur = top.get(c.city);
        if (!cur || c.revenue > cur.revenue) top.set(c.city, { name: p.productName, revenue: c.revenue });
      }
    }
    for (const c of s.cities) {
      const t = top.get(c.city);
      const prev = prevByBrandCity.get(`${brandKey(s.brandName)}|${c.city}`);
      cityRows.push({
        city: c.city,
        brandName: s.brandName,
        revenue: round2(c.revenue),
        units: c.units,
        orderCount: c.orderCount,
        avgOrderValue: c.orderCount > 0 ? round2(c.revenue / c.orderCount) : 0,
        topProduct: t ? t.name : null,
        topProductRevenue: t ? round2(t.revenue) : 0,
        brands: [s.brandName],
        previousRevenue: comparePrev && prev !== undefined ? prev : null,
      });
    }
    for (const p of s.products) {
      const cities = (p.cities || []).map((c) => ({
        city: c.city,
        revenue: c.revenue,
        units: c.units,
        orderCount: c.orderCount,
        avgOrderValue: c.orderCount > 0 ? round2(c.revenue / c.orderCount) : 0,
      }));
      productRows.push({
        productName: p.productName,
        brandName: s.brandName,
        revenue: p.revenue,
        units: p.units,
        orderCount: p.orderCount,
        avgOrderValue: p.orderCount > 0 ? round2(p.revenue / p.orderCount) : 0,
        topCity: cities[0] ? cities[0].city : null,
        cities,
      });
    }
    brandUploads[s.brandName] = { date: s.uploadedAt || '', fileName: s.fileName || '', from: s.from, to: s.to };
    if ((s.uploadedAt || '') > date) date = s.uploadedAt || '';
    if (!from || s.from < from) from = s.from;
    if (!to || s.to > to) to = s.to;
    if (s.fileName && !fileNames.includes(s.fileName)) fileNames.push(s.fileName);
  }
  productRows.sort((a, b) => b.revenue - a.revenue);
  return { cityRows, productRows, brandUploads, date: date || null, from: from || null, to: to || null, fileNames };
}

module.exports = { monthSalesView, previousMonthKey };