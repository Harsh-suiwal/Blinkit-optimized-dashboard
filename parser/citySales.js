// City-level sales helpers shared by the server and console.js (no kv / Supabase imports).
const { assignPerformanceTiers } = require('./parseSales');

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

module.exports = { combineCityRows, salesBrandSummaries };