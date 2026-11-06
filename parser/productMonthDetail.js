// Data for Sales > Month by month: one product, month by month, plus the brand's profit totals.
// Pure: server.js passes in the stored monthly sales, the cost sheet and the brand profit figures,
// so this file never reads storage and is easy to test.
const { productKey } = require('./parseBrandCosts');
const { buildProductMonthProfit } = require('./brandProfit');

const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;

/** False only when the flag is on and the user is not an admin. */
function canSeeProductProfit(adminOnly, user) {
  return !adminOnly || Boolean(user && user.role === 'admin');
}

/** Product names that have monthly data, biggest revenue first (for the selector). */
function listProductNames(slots) {
  const totals = new Map();
  for (const slot of slots) {
    for (const p of slot.products || []) {
      const key = productKey(p.productName);
      const row = totals.get(key) || { productName: p.productName, revenue: 0 };
      row.revenue += p.revenue;
      totals.set(key, row);
    }
  }
  return Array.from(totals.values())
    .sort((a, b) => b.revenue - a.revenue || a.productName.localeCompare(b.productName))
    .map((r) => r.productName);
}

/** One product's figures in one month. Old slots have no product cities: that is "missing", never invented. */
function monthFigures(monthSlots, key) {
  let revenue = 0;
  let units = 0;
  let orderCount = 0;
  let found = false;
  let allHaveCities = true;
  const byCity = new Map();
  for (const slot of monthSlots) {
    for (const p of slot.products || []) {
      if (productKey(p.productName) !== key) continue;
      found = true;
      revenue += p.revenue;
      units += p.units;
      orderCount += p.orderCount;
      if (!Array.isArray(p.cities)) { allHaveCities = false; continue; }
      for (const c of p.cities) {
        const row = byCity.get(c.city) || { city: c.city, revenue: 0, units: 0, orderCount: 0 };
        row.revenue += c.revenue;
        row.units += c.units;
        row.orderCount += c.orderCount;
        byCity.set(c.city, row);
      }
    }
  }
  // A month the product did not sell in is "missing" only when the whole stored month predates city data.
  const wholeMonthOld = monthSlots.length > 0 && monthSlots.every((s) =>
    (s.products || []).length > 0 && (s.products || []).every((p) => !Array.isArray(p.cities)));
  const cityDataMissing = found ? !allHaveCities : wholeMonthOld;
  const cities = cityDataMissing ? [] : Array.from(byCity.values())
    .sort((a, b) => b.revenue - a.revenue || a.city.localeCompare(b.city))
    .map((c) => ({
      city: c.city,
      revenue: round2(c.revenue),
      units: c.units,
      orderCount: c.orderCount,
      avgOrderValue: c.orderCount > 0 ? round2(c.revenue / c.orderCount) : 0,
      sharePct: revenue > 0 ? round1((c.revenue / revenue) * 100) : 0,
    }));
  return {
    revenue: round2(revenue),
    units,
    orderCount,
    avgOrderValue: orderCount > 0 ? round2(revenue / orderCount) : 0,
    cityDataMissing,
    topCity: cities.length ? { city: cities[0].city, revenue: cities[0].revenue, sharePct: cities[0].sharePct } : null,
    cities,
  };
}

/**
 * Without `product`: { products: [names] }. With it: the product month by month (oldest first, starting
 * at its first month with sales) and the whole brand's profit per month. When profitVisible is false
 * every profit field is removed: months[].profit = null, brandMonths = [], brandTotals = null.
 * Ad spend is brand level: nothing is allocated to the product.
 */
function buildProductMonthDetail({ brand, product, monthInfo, slots, costs, brandProfit, profitVisible }) {
  if (!product) return { products: listProductNames(slots || []) };
  const key = productKey(product);
  const visible = Boolean(profitVisible);
  let canonical = product;
  outer: for (const slot of slots) {
    for (const p of slot.products || []) {
      if (productKey(p.productName) === key) { canonical = p.productName; break outer; }
    }
  }

  const profits = buildProductMonthProfit({ productName: product, monthInfo, slots, costs });
  const built = monthInfo.map((info, i) => ({
    info,
    figures: monthFigures(slots.filter((s) => s.monthKey === info.monthKey), key),
    profit: profits[i],
  }));
  const firstSale = built.findIndex((b) => b.figures.revenue > 0 || b.figures.units > 0);

  const months = firstSale === -1 ? [] : built.slice(firstSale).map((b) => ({
    monthKey: b.info.monthKey,
    label: b.info.label,
    from: b.info.from,
    to: b.info.to,
    partial: b.info.partial,
    ...b.figures,
    profit: visible && b.profit.netSales !== null ? {
      netSales: b.profit.netSales,
      productCost: b.profit.productCost,
      fees: b.profit.fees,
      profitBeforeAds: b.profit.profitBeforeAds,
      profitPerUnit: b.profit.profitPerUnit,
      marginPct: b.profit.marginPct,
    } : null,
  }));

  const brandMonths = visible && brandProfit ? brandProfit.months.map((m) => ({
    monthKey: m.monthKey,
    label: m.label,
    partial: m.partial,
    status: m.status,
    netSales: m.netSales,
    profitBeforeAds: m.status === 'no-costs' ? null : round2(m.netSales - m.productCost - m.fees),
    adSpend: m.adSpend,
    adDataMissing: m.adDataMissing,
    otherCosts: m.otherCosts,
    profitAfterAds: m.profit,
    marginPct: m.marginPct,
  })) : [];
  const t = visible && brandProfit ? brandProfit.totals : null;
  const brandTotals = t ? {
    months: t.months,
    incompleteMonths: t.incompleteMonths,
    netSales: t.netSales,
    profitBeforeAds: round2(t.netSales - t.productCost - t.fees),
    adSpend: t.adSpend,
    otherCosts: t.otherCosts,
    profitAfterAds: t.profit,
    marginPct: t.marginPct,
  } : null;

  return { brand, product: canonical, profitVisible: visible, months, brandMonths, brandTotals };
}

module.exports = { buildProductMonthDetail, canSeeProductProfit, listProductNames };
