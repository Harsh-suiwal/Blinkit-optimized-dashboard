// Data for Sales > Month by month: one product (or several ticked products added together), month by month,
// plus the brand's profit totals.
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

/**
 * The figures of the wanted products in one month, added together (`keys` is a Set of product keys; one key
 * = one product, exactly as before). Old slots have no product cities: that is "missing", never invented.
 */
function monthFigures(monthSlots, keys) {
  let revenue = 0;
  let units = 0;
  let orderCount = 0;
  let found = false;
  let allHaveCities = true;
  const byCity = new Map();
  for (const slot of monthSlots) {
    for (const p of slot.products || []) {
      if (!keys.has(productKey(p.productName))) continue;
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
function buildProductMonthDetail({ brand, product, products, monthInfo, slots, costs, brandProfit, profitVisible }) {
  if (Array.isArray(products) && products.length) {
    return buildProductSetDetail({ brand, products, monthInfo, slots, costs, brandProfit, profitVisible });
  }
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
    figures: monthFigures(slots.filter((s) => s.monthKey === info.monthKey), new Set([key])),
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

/**
 * Several ticked products added together, month by month. Same shape as one product, plus:
 *   productCount     how many of the asked products exist in the brand's monthly data
 *   ordersOverlap    true: "orders" is each product's orders added up, so an order holding two of the ticked
 *                    products is counted once per product (the stored months hold orders per product only)
 *   profitMissing    how many of those products have no cost-sheet row; their profit is NOT in the profit figures
 * One ticked product returns exactly what the single-product call returns (with productCount 1).
 */
function buildProductSetDetail({ brand, products, monthInfo, slots, costs, brandProfit, profitVisible }) {
  const known = listProductNames(slots || []);
  const wanted = new Set(products.map((name) => productKey(name)));
  const names = known.filter((name) => wanted.has(productKey(name)));
  if (names.length <= 1) {
    const single = buildProductMonthDetail({ brand, product: names[0] || products[0], monthInfo, slots, costs, brandProfit, profitVisible });
    return { ...single, productCount: names.length, ordersOverlap: false, profitMissing: 0 };
  }

  const visible = Boolean(profitVisible);
  const keys = new Set(names.map((name) => productKey(name)));
  const perProduct = names.map((name) => buildProductMonthProfit({ productName: name, monthInfo, slots, costs }));
  const priced = perProduct.filter((rows) => rows.some((r) => r.netSales !== null));
  const profitMissing = names.length - priced.length;

  const built = monthInfo.map((info, i) => {
    let netSales = 0;
    let productCost = 0;
    let fees = 0;
    let pricedUnits = 0;
    for (const rows of priced) {
      const r = rows[i];
      if (r.netSales === null) continue;
      netSales += r.netSales;
      productCost += r.productCost;
      fees += r.fees;
      pricedUnits += r.units;
    }
    const profit = netSales - productCost - fees;
    return {
      info,
      figures: monthFigures(slots.filter((s) => s.monthKey === info.monthKey), keys),
      profit: priced.length ? {
        netSales: round2(netSales),
        productCost: round2(productCost),
        fees: round2(fees),
        profitBeforeAds: round2(profit),
        profitPerUnit: pricedUnits > 0 ? round2(profit / pricedUnits) : null,
        marginPct: netSales > 0 ? round1((profit / netSales) * 100) : null,
      } : null,
    };
  });
  const firstSale = built.findIndex((b) => b.figures.revenue > 0 || b.figures.units > 0);
  const months = firstSale === -1 ? [] : built.slice(firstSale).map((b) => ({
    monthKey: b.info.monthKey,
    label: b.info.label,
    from: b.info.from,
    to: b.info.to,
    partial: b.info.partial,
    ...b.figures,
    profit: visible ? b.profit : null,
  }));

  // The brand strip is the same whichever products are ticked: take it from the single-product builder.
  const strip = buildProductMonthDetail({ brand, product: names[0], monthInfo, slots, costs, brandProfit, profitVisible });
  return {
    brand,
    product: names.length === known.length ? 'All products' : `${names.length} products`,
    profitVisible: visible,
    months,
    brandMonths: strip.brandMonths,
    brandTotals: strip.brandTotals,
    productCount: names.length,
    ordersOverlap: true,
    profitMissing: visible ? profitMissing : 0,
  };
}

module.exports = { buildProductMonthDetail, canSeeProductProfit, listProductNames };
