// The report's Profit data, worked out with the SAME maths as the Profit tab (parser/profitView.js), so it
// uses the numbers typed on the Profit tab (COGS, GST %, commission %, fees, other expenses) as well as an
// uploaded cost sheet. The old report profit (parser/brandProfit.js) only read an uploaded cost sheet, so a
// brand with typed-only costs had no profit in the report. Returns the shape parser/brandReport.js expects,
// or null when no product has a COGS yet.
const { buildProfitView } = require('./profitView');

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/** input: { brand, slots, monthInfo, costs, adSpendByMonth } (the same things the Profit tab gets). */
function buildReportProfit(input) {
  const monthKeys = (input.monthInfo || []).map((m) => m.monthKey);
  if (!monthKeys.length) return null;
  const base = {
    brand: input.brand, slots: input.slots, monthInfo: input.monthInfo, costs: input.costs,
    adSpendByMonth: input.adSpendByMonth, includeAds: true, months: monthKeys,
  };
  const byMonth = buildProfitView({ ...base, groupBy: 'month' });
  const byProduct = buildProfitView({ ...base, groupBy: 'product' });

  const months = byMonth.rows.map((r) => {
    const countedNet = r.net - r.leftOut; // net sales of products that have a COGS
    const status = countedNet > 0 ? (r.leftOut > 0 ? 'incomplete' : 'complete') : 'no-costs';
    const fees = r.fees + r.storage;
    const totalCosts = r.cogs + fees + r.ads + r.other;
    return {
      monthKey: r.key, label: r.label, partial: r.partial, status,
      netSales: countedNet, productCost: r.cogs, fees, adSpend: r.ads, adDataMissing: r.adMissing,
      otherCosts: r.other, totalCosts, profit: r.profit, marginPct: r.marginPct,
      roiPct: totalCosts > 0 ? round1((r.profit / totalCosts) * 100) : null,
    };
  });
  if (!months.some((m) => m.status !== 'no-costs')) return null;

  const products = byProduct.rows
    .filter((r) => r.leftOutUnits < r.units) // a product with no COGS has all its units left out
    .map((r) => {
      const net = r.net - r.leftOut;
      const beforeAds = net - r.cogs - r.fees - r.storage;
      const perUnit = r.units > 0 ? round2(beforeAds / r.units) : null;
      return { productName: r.label, units: r.units, netSales: net, profitBeforeAds: beforeAds, profitPerUnit: perUnit, listUnitProfit: perUnit === null ? 0 : perUnit };
    })
    .sort((a, b) => b.profitBeforeAds - a.profitBeforeAds || a.productName.localeCompare(b.productName));

  return { brand: input.brand, hasCosts: true, months, products };
}

module.exports = { buildReportProfit };
