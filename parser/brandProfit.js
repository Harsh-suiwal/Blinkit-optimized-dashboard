// Monthly profit / loss and ROI for one brand (the Profit tab). Pure: the server passes in the
// stored monthly sales, the brand's cost sheet and the campaign spend, so it is easy to test.
//
// Per product and month (revenue = the sales sheet's gross bill amount, which includes tax):
//   net sales    = revenue / (1 + tax %)
//   product cost = units x COGS
//   commission   = revenue x commission %
//   inward, fulfilment, storage = units x the per-unit fee
// Per month:
//   costs  = product cost + all Blinkit fees + ad spend + other costs
//   profit = net sales - costs;   margin = profit / net sales;   ROI = profit / costs
// Products with no row in the cost sheet are left out of net sales and costs (and listed),
// so a month with some of them is "incomplete"; with none matched it is "no-costs".
const { productKey, unitEconomics } = require('./parseBrandCosts');

const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;
const ratioPct = (num, den) => (den > 0 ? round1((num / den) * 100) : null);

const emptySums = () => ({ net: 0, cogs: 0, commission: 0, inward: 0, fulfilment: 0, storage: 0 });

/**
 * brand: name. monthInfo: listMonths(brand, platform). slots: slotsFor(brand, platform).
 * costs: stored entry from brandCosts.js or null. adSpendByMonth: { 'YYYY-MM': rupees }.
 */
function buildBrandProfit({ brand, monthInfo, slots, costs, adSpendByMonth }) {
  const costProducts = costs && Array.isArray(costs.products) ? costs.products : [];
  const otherCosts = costs && costs.otherCosts ? costs.otherCosts : {};
  const adSpend = adSpendByMonth || {};
  const byKey = new Map(costProducts.map((p) => [productKey(p.productName), p]));

  const productSums = new Map(costProducts.map((p) => [productKey(p.productName), {
    cost: p, units: 0, gross: 0, net: 0, productCost: 0, fees: 0,
  }]));
  const unmatchedAll = new Map();

  const months = monthInfo.map((info) => {
    const sums = emptySums();
    let matchedGross = 0;
    let matchedUnits = 0;
    const unmatchedHere = new Map();

    for (const slot of slots.filter((s) => s.monthKey === info.monthKey)) {
      for (const p of slot.products || []) {
        const cost = byKey.get(productKey(p.productName));
        if (!cost) {
          for (const map of [unmatchedHere, unmatchedAll]) {
            const row = map.get(p.productName) || { productName: p.productName, revenue: 0, units: 0 };
            row.revenue += p.revenue;
            row.units += p.units;
            map.set(p.productName, row);
          }
          continue;
        }
        const net = p.revenue / (1 + cost.taxPct / 100);
        const productCost = p.units * cost.cogs;
        const commission = (p.revenue * cost.commissionPct) / 100;
        const inward = p.units * cost.inwardFee;
        const fulfilment = p.units * cost.fulfilmentFee;
        const storage = p.units * cost.storageFee;

        matchedGross += p.revenue;
        matchedUnits += p.units;
        sums.net += net;
        sums.cogs += productCost;
        sums.commission += commission;
        sums.inward += inward;
        sums.fulfilment += fulfilment;
        sums.storage += storage;

        const total = productSums.get(productKey(p.productName));
        total.units += p.units;
        total.gross += p.revenue;
        total.net += net;
        total.productCost += productCost;
        total.fees += commission + inward + fulfilment + storage;
      }
    }

    const hasMatch = matchedGross > 0;
    const status = !hasMatch ? 'no-costs' : (unmatchedHere.size ? 'incomplete' : 'ok');
    const fees = sums.commission + sums.inward + sums.fulfilment + sums.storage;
    const ad = adSpend[info.monthKey];
    const adValue = ad === undefined ? 0 : ad;
    const other = otherCosts[info.monthKey] || 0;
    const totalCosts = sums.cogs + fees + adValue + other;
    const profit = sums.net - totalCosts;

    return {
      monthKey: info.monthKey,
      label: info.label,
      from: info.from,
      to: info.to,
      partial: info.partial,
      status,
      grossSales: round2(info.revenue),
      units: info.units,
      matchedUnits,
      matchedRevenuePct: ratioPct(matchedGross, info.revenue),
      netSales: hasMatch ? round2(sums.net) : null,
      productCost: hasMatch ? round2(sums.cogs) : null,
      fees: hasMatch ? round2(fees) : null,
      adSpend: round2(adValue),
      adDataMissing: ad === undefined,
      otherCosts: round2(other),
      totalCosts: hasMatch ? round2(totalCosts) : null,
      profit: hasMatch ? round2(profit) : null,
      marginPct: hasMatch ? ratioPct(profit, sums.net) : null,
      roiPct: hasMatch ? ratioPct(profit, totalCosts) : null,
      unmatchedProducts: Array.from(unmatchedHere.values())
        .map((u) => ({ ...u, revenue: round2(u.revenue) }))
        .sort((a, b) => b.revenue - a.revenue),
    };
  });

  const counted = months.filter((m) => m.status !== 'no-costs');
  const sum = (key) => counted.reduce((total, m) => total + m[key], 0);
  const totals = counted.length ? (() => {
    const netSales = sum('netSales');
    const totalCosts = sum('totalCosts');
    const profit = sum('profit');
    return {
      months: counted.length,
      incompleteMonths: counted.filter((m) => m.status === 'incomplete').length,
      grossSales: round2(sum('grossSales')),
      units: sum('units'),
      netSales: round2(netSales),
      productCost: round2(sum('productCost')),
      fees: round2(sum('fees')),
      adSpend: round2(sum('adSpend')),
      otherCosts: round2(sum('otherCosts')),
      totalCosts: round2(totalCosts),
      profit: round2(profit),
      marginPct: ratioPct(profit, netSales),
      roiPct: ratioPct(profit, totalCosts),
    };
  })() : null;

  const products = Array.from(productSums.values()).map((t) => {
    const profitBeforeAds = t.net - t.productCost - t.fees;
    return {
      productName: t.cost.productName,
      units: t.units,
      grossSales: round2(t.gross),
      netSales: round2(t.net),
      productCost: round2(t.productCost),
      fees: round2(t.fees),
      profitBeforeAds: round2(profitBeforeAds),
      profitPerUnit: t.units > 0 ? round2(profitBeforeAds / t.units) : null,
      sellingPrice: t.cost.sellingPrice,
      taxPct: t.cost.taxPct,
      commissionPct: t.cost.commissionPct,
      listUnitProfit: unitEconomics(t.cost).profit,
    };
  }).sort((a, b) => (b.units > 0) - (a.units > 0)
    || b.profitBeforeAds - a.profitBeforeAds
    || a.productName.localeCompare(b.productName));

  return {
    brand,
    hasCosts: costProducts.length > 0,
    costsUpload: costProducts.length
      ? { fileName: costs.fileName || '', uploadedAt: costs.uploadedAt || '', productCount: costProducts.length }
      : null,
    months,
    totals,
    products,
    unmatchedProducts: Array.from(unmatchedAll.values())
      .map((u) => ({ ...u, revenue: round2(u.revenue) }))
      .sort((a, b) => b.revenue - a.revenue),
  };
}

module.exports = { buildBrandProfit };
