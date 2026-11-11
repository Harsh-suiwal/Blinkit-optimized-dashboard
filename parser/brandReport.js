// Data behind the client Report (Reports page): one brand, a few months, everything the slides need.
// Pure: server.js passes in the stored sales months, the brand's daily campaign rows, its stock rows and
// (admins only, when asked) the profit figures, so this file never reads storage itself.
const { aggregateTotals, aggregateByCampaign } = require('./campaignStore');

const DAY_MS = 86400000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const TYPE_LABELS = { PRODUCT_BOOSTING: 'Product Booster', PRODUCT_RECOMMENDATION: 'Recommendation Ads' };
const MAX_MONTHS = 4;

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const ratio = (a, b) => (b > 0 ? a / b : null);
const pctChange = (from, to) => (from > 0 ? r1(((to - from) / from) * 100) : null);
const monthLabel = (key) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const utc = (day) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const daysBetween = (from, to) => Math.round((utc(to) - utc(from)) / DAY_MS) + 1;
const daysInMonth = (key) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).getUTCDate();
const weekdayOf = (day) => new Date(utc(day)).getUTCDay();
const key = (s) => String(s || '').trim().toLowerCase();

function salesSection(slots, selected) {
  const months = selected.map((monthKey) => {
    const slot = slots.find((s) => s.monthKey === monthKey);
    const days = daysBetween(slot.from, slot.to);
    const fullDays = daysInMonth(monthKey);
    return {
      monthKey,
      label: monthLabel(monthKey),
      from: slot.from,
      to: slot.to,
      days,
      fullDays,
      partial: days < fullDays || slot.from !== `${monthKey}-01`,
      units: slot.totals.units,
      revenue: r2(slot.totals.revenue),
      orders: slot.totals.orderCount,
      aov: slot.totals.orderCount > 0 ? r2(slot.totals.revenue / slot.totals.orderCount) : 0,
      unitsPerDay: r2(slot.totals.units / days),
      products: (slot.products || []).map((p) => ({ name: p.productName, units: p.units, revenue: r2(p.revenue), orders: p.orderCount })),
      cities: (slot.cities || []).slice(0, 5).map((c) => ({ city: c.city, revenue: r2(c.revenue), units: c.units })),
      cityCount: (slot.cities || []).length,
    };
  });
  const latest = months[months.length - 1];
  const previous = months.length > 1 ? months[months.length - 2] : null;
  const earlier = months.length > 2 ? months[months.length - 3] : null;
  const rateChangePct = previous ? pctChange(previous.units / previous.days, latest.units / latest.days) : null;
  const multiple = previous && earlier && earlier.units > 0 ? r1(previous.units / earlier.units) : null;
  const projection = latest.partial && latest.unitsPerDay > 0
    ? { units: Math.round((latest.units / latest.days) * latest.fullDays), perDay: latest.unitsPerDay, days: latest.fullDays }
    : null;

  // Products: units per selected month, daily rates for the last two months, mix and run-rate.
  const names = new Map();
  months.forEach((m) => m.products.forEach((p) => { if (!names.has(key(p.name))) names.set(key(p.name), p.name); }));
  const units = (m, name) => {
    const p = m && m.products.find((x) => key(x.name) === key(name));
    return p ? p.units : 0;
  };
  const rows = Array.from(names.values()).map((name) => {
    const perMonth = months.map((m) => units(m, name));
    const latestUnits = units(latest, name);
    const prevPerDay = previous ? units(previous, name) / previous.days : null;
    const latestPerDay = latestUnits / latest.days;
    return {
      name,
      perMonth,
      prevPerDay: prevPerDay === null ? null : r2(prevPerDay),
      latestPerDay: r2(latestPerDay),
      rateChangePct: prevPerDay ? pctChange(prevPerDay, latestPerDay) : null,
      mixPct: latest.units > 0 ? r1((latestUnits / latest.units) * 100) : 0,
      runRate: r1(latestPerDay * latest.fullDays),
      latestUnits,
    };
  }).sort((a, b) => b.latestUnits - a.latestUnits || b.perMonth.reduce((s, v) => s + v, 0) - a.perMonth.reduce((s, v) => s + v, 0));

  // Concentration: the two best sellers of the latest month against everything else.
  const top = rows.slice(0, 2).map((r) => r.name);
  const shareOf = (m, group) => (m && m.units > 0 ? r1((group(m) / m.units) * 100) : null);
  const topUnits = (m) => top.reduce((s, name) => s + units(m, name), 0);
  const split = (m) => ({
    label: m.label, units: m.units, topUnits: topUnits(m), restUnits: m.units - topUnits(m),
    top1: shareOf(m, (x) => units(x, top[0])), top2: shareOf(m, (x) => units(x, top[1])), rest: shareOf(m, (x) => x.units - topUnits(x)),
    topShare: shareOf(m, topUnits),
  });
  const concentration = rows.length >= 3 && previous ? (() => {
    const perDay = (m, group) => group(m) / m.days;
    const topChange = perDay(latest, topUnits) - perDay(previous, topUnits);
    const restChange = perDay(latest, (m) => m.units - topUnits(m)) - perDay(previous, (m) => m.units - topUnits(m));
    return {
      top,
      previous: split(previous),
      latest: split(latest),
      topPerDay: { previous: r2(perDay(previous, topUnits)), latest: r2(perDay(latest, topUnits)) },
      restPerDay: { previous: r2(perDay(previous, (m) => m.units - topUnits(m))), latest: r2(perDay(latest, (m) => m.units - topUnits(m))) },
      totalPerDay: { previous: r2(previous.units / previous.days), latest: r2(latest.units / latest.days) },
      topChange: r2(topChange), restChange: r2(restChange), netChange: r2(latest.units / latest.days - previous.units / previous.days),
    };
  })() : null;

  return { months, latest, previous, rows, rateChangePct, multiple, projection, concentration, productCount: names.size };
}

function adsSection(rows, selected, periods) {
  const labelOf = new Map((periods || []).map((p) => [p.periodKey, p.periodLabel]));
  const periodKeys = Array.from(new Set(rows.map((r) => r.periodKey))).filter((k) => selected.includes(k)).sort();
  const months = periodKeys.map((periodKey) => {
    const own = rows.filter((r) => r.periodKey === periodKey);
    const t = aggregateTotals(own);
    const dates = Array.from(new Set(own.map((r) => r.date))).sort();
    const lastDate = dates[dates.length - 1];
    const byType = Object.keys(TYPE_LABELS).map((sheetType) => ({
      sheetType, label: TYPE_LABELS[sheetType], spend: aggregateTotals(own.filter((r) => r.sheetType === sheetType)).adSpend,
    })).filter((x) => x.spend > 0);
    const campaigns = aggregateByCampaign(own)
      .sort((a, b) => b.adSpend - a.adSpend)
      .slice(0, 6)
      .map((c) => {
        const days = own.filter((r) => r.sheetType === c.sheetType && String(r.campaignId) === String(c.campaignId)).map((r) => r.date).sort();
        const lastActive = days[days.length - 1];
        return {
          name: c.campaignName, type: TYPE_LABELS[c.sheetType] || c.sheetType, spend: c.adSpend, units: c.qtySold, sales: c.sales,
          roas: c.roas, spendPerUnit: c.qtySold > 0 ? r2(c.adSpend / c.qtySold) : null,
          status: lastActive && daysBetween(lastActive, lastDate) <= 1 ? 'Active' : `Ended ${lastActive ? lastActive.slice(8, 10) + '/' + lastActive.slice(5, 7) : ''}`.trim(),
        };
      });
    return {
      periodKey,
      label: labelOf.get(periodKey) || monthLabel(periodKey),
      from: dates[0], to: lastDate, days: daysBetween(dates[0], lastDate), activeDays: dates.length,
      spend: t.adSpend, sales: t.sales, units: t.qtySold, impressions: t.impressions, atc: t.atc, roas: t.roas,
      spendPerUnit: t.qtySold > 0 ? r2(t.adSpend / t.qtySold) : null,
      spendPerRupee: t.sales > 0 ? r2(t.adSpend / t.sales) : null,
      spendPer1000: t.impressions > 0 ? Math.round((t.adSpend / t.impressions) * 1000) : null,
      revenuePer1000: t.impressions > 0 ? Math.round((t.sales / t.impressions) * 1000) : null,
      salesPerUnit: t.qtySold > 0 ? r2(t.sales / t.qtySold) : null,
      byType, campaigns, campaignCount: aggregateByCampaign(own).length,
    };
  });
  const latest = months[months.length - 1] || null;
  const previous = months.length > 1 ? months[months.length - 2] : null;
  const change = previous && latest ? {
    spend: pctChange(previous.spend, latest.spend),
    impressions: pctChange(previous.impressions, latest.impressions),
    units: pctChange(previous.units, latest.units),
    sales: pctChange(previous.sales, latest.sales),
    roas: pctChange(previous.roas, latest.roas),
    spendPerUnit: pctChange(previous.spendPerUnit, latest.spendPerUnit),
    spendPerRupee: pctChange(previous.spendPerRupee, latest.spendPerRupee),
    spendPer1000: pctChange(previous.spendPer1000, latest.spendPer1000),
    revenuePer1000: pctChange(previous.revenuePer1000, latest.revenuePer1000),
  } : null;
  return { months, latest, previous, change };
}

function weekdaySection(rows) {
  if (!rows.length) return null;
  const groups = new Map();
  for (const row of rows) {
    const day = weekdayOf(row.date);
    if (!groups.has(day)) groups.set(day, { rows: [], dates: new Set() });
    groups.get(day).rows.push(row);
    groups.get(day).dates.add(row.date);
  }
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => groups.has(d)).map((d) => {
    const g = groups.get(d);
    const t = aggregateTotals(g.rows);
    return {
      weekday: WEEKDAYS[d], short: WEEKDAYS[d].slice(0, 3), daysWithData: g.dates.size,
      impressions: t.impressions, atc: t.atc, units: t.qtySold, revenue: t.sales, spend: t.adSpend, roas: t.roas,
      spendPerUnit: t.qtySold > 0 ? r2(t.adSpend / t.qtySold) : null,
    };
  });
  const total = aggregateTotals(rows);
  const totals = { daysWithData: new Set(rows.map((r) => r.date)).size, impressions: total.impressions, atc: total.atc, units: total.qtySold, revenue: total.sales, spend: total.adSpend, roas: total.roas };
  const share = (set, field) => (totals[field] > 0 ? Math.round((days.filter((d) => set.includes(d.short)).reduce((s, d) => s + d[field], 0) / totals[field]) * 100) : 0);
  const ranked = days.filter((d) => d.spend > 0 && d.roas !== null).sort((a, b) => b.roas - a.roas);
  const winners = days.length >= 5 ? ranked.slice(0, 2).map((d) => d.short) : [];
  const priorities = days.length >= 5 ? ranked.slice(-3).map((d) => d.short) : [];
  return {
    days, totals, winners, priorities,
    winnerShare: { spend: share(winners, 'spend'), units: share(winners, 'units') },
    priorityShare: { spend: share(priorities, 'spend'), units: share(priorities, 'units') },
  };
}

function funnelSection(rows) {
  if (!rows.length) return null;
  const t = aggregateTotals(rows);
  if (!(t.impressions > 0) && !(t.atc > 0)) return null;
  return {
    impressions: t.impressions, atc: t.atc, units: t.qtySold, spend: t.adSpend,
    atcRatePct: t.impressions > 0 ? Math.round((t.atc / t.impressions) * 100000) / 1000 : null,
    unitsPerAtcPct: t.atc > 0 ? r1((t.qtySold / t.atc) * 100) : null,
    spendPerAtc: t.atc > 0 ? r2(t.adSpend / t.atc) : null,
    spendPerUnit: t.qtySold > 0 ? r2(t.adSpend / t.qtySold) : null,
  };
}

function evidenceFor(units) {
  if (units === 0) return 'No sales reported';
  if (units === 1) return 'Low: one sale';
  if (units <= 4) return 'Low to medium';
  return 'Medium';
}

function keywordsSection(rows) {
  const withKeyword = rows.filter((r) => String(r.targetingValue || '').trim());
  if (!withKeyword.length) return null;
  const groups = new Map();
  for (const row of withKeyword) {
    const k = key(row.targetingValue);
    if (!groups.has(k)) groups.set(k, { keyword: String(row.targetingValue).trim(), rows: [] });
    groups.get(k).rows.push(row);
  }
  const all = Array.from(groups.values()).map((g) => ({ keyword: g.keyword, ...aggregateTotals(g.rows) }));
  const totalSpend = all.reduce((s, k) => s + k.adSpend, 0);
  const bestRoas = Math.max(0, ...all.filter((k) => k.qtySold >= 1).map((k) => k.roas || 0));
  const list = all.sort((a, b) => b.adSpend - a.adSpend).slice(0, 8).map((k) => {
    let decision; let tone; let action;
    if (k.qtySold === 0) { decision = k.adSpend >= totalSpend * 0.03 ? 'Pause or sharply restrict' : 'Keep limited or pause'; tone = 'red'; action = 'Restrict until clicks, relevance and stock are checked'; }
    else if (k.roas !== null && k.roas === bestRoas && bestRoas > 0) { decision = 'Controlled test'; tone = 'amber'; action = 'Cap test spend; watch repeat sales and acquisition cost'; }
    else if (k.roas !== null && k.roas < 0.1) { decision = 'Reduce expenditure'; tone = 'red'; action = 'Find spend-driving placements; cut waste'; }
    else if (k.roas !== null && k.roas < 0.3) { decision = 'Test lower bid'; tone = 'amber'; action = 'Reduce the bid cautiously; compare volume and cost'; }
    else { decision = 'Monitor'; tone = 'grey'; action = 'Keep tracking; no change yet'; }
    return {
      keyword: k.keyword, spend: k.adSpend, units: k.qtySold, sales: k.sales, roas: k.roas, impressions: k.impressions,
      decision, tone, evidence: evidenceFor(k.qtySold),
      signal: k.qtySold === 0 ? `${Math.round(k.adSpend)} spend, no sales` : `${k.qtySold} sold at ${k.roas === null ? 'n/a' : k.roas + 'x'} ROAS`,
      action,
    };
  });
  return { list, total: all.length };
}

function stockSection(rows) {
  if (!rows.length) return null;
  const byProduct = new Map();
  for (const r of rows) {
    if (!byProduct.has(key(r.productName))) byProduct.set(key(r.productName), { name: r.productName, stock: 0, sold30: 0, lowOrOut: 0, rows: 0 });
    const p = byProduct.get(key(r.productName));
    p.stock += r.totalStockAvailable || 0;
    p.sold30 += r.unitsSold30 || 0;
    p.rows += 1;
    if (r.stockStatus && r.stockStatus !== 'ok') p.lowOrOut += 1;
  }
  const products = Array.from(byProduct.values()).sort((a, b) => b.sold30 - a.sold30);
  return {
    products: products.slice(0, 8),
    totals: {
      stock: products.reduce((s, p) => s + p.stock, 0), sold30: products.reduce((s, p) => s + p.sold30, 0),
      listings: rows.length, lowOrOut: products.reduce((s, p) => s + p.lowOrOut, 0), products: products.length,
    },
  };
}

function profitSection(profit, selected) {
  if (!profit || !profit.hasCosts) return null;
  const months = profit.months.filter((m) => selected.includes(m.monthKey) && m.status !== 'no-costs');
  if (!months.length) return null;
  const sum = (field) => months.reduce((s, m) => s + (m[field] || 0), 0);
  const netSales = sum('netSales');
  const contribution = netSales - sum('productCost') - sum('fees');
  return {
    months: months.map((m) => ({
      label: m.label, partial: m.partial, netSales: m.netSales, productCost: m.productCost, fees: m.fees, adSpend: m.adSpend,
      otherCosts: m.otherCosts, totalCosts: m.totalCosts, profit: m.profit, marginPct: m.marginPct, roiPct: m.roiPct, adDataMissing: m.adDataMissing,
    })),
    totals: { netSales: r2(netSales), totalCosts: r2(sum('totalCosts')), profit: r2(sum('profit')), adSpend: r2(sum('adSpend')) },
    contributionMarginPct: netSales > 0 ? r1((contribution / netSales) * 100) : null,
    breakEvenRoas: netSales > 0 && contribution > 0 ? r2(netSales / contribution) : null,
    products: profit.products.filter((p) => p.units > 0).slice(0, 8).map((p) => ({
      name: p.productName, units: p.units, profitPerUnit: p.profitPerUnit, listUnitProfit: p.listUnitProfit,
      marginPct: p.netSales > 0 ? r1((p.profitBeforeAds / p.netSales) * 100) : null,
    })),
  };
}

function insights(data) {
  const { sales, ads, weekday, funnel, keywords, stock } = data;
  const out = { decisions: [], management: { continue: [], optimize: [], restrict: [], fix: [], measure: [] } };
  if (sales) {
    const l = sales.latest; const p = sales.previous;
    out.trajectory = p && sales.rateChangePct !== null
      ? `${l.label.split(' ')[0]} is running ${sales.rateChangePct >= 0 ? sales.rateChangePct + '% above' : Math.abs(sales.rateChangePct) + '% below'} ${p.label.split(' ')[0]} on units per day (${p.unitsPerDay} to ${l.unitsPerDay}).`
      : `${l.units} units sold in ${l.label}, ${l.unitsPerDay} per day.`;
    if (sales.rows.length >= 2 && p) {
      const up = sales.rows.filter((r) => (r.rateChangePct || 0) > 0).slice(0, 2).map((r) => r.name);
      out.products = up.length ? `Momentum sits with ${up.join(' and ')}.` : 'No product is growing on a daily basis.';
    }
    const c = sales.concentration;
    if (c) {
      const topNow = (c.latest.top1 || 0) + (c.latest.top2 || 0);
      const topBefore = (c.previous.top1 || 0) + (c.previous.top2 || 0);
      out.concentration = `${c.top.join(' + ')} moved from ${r1(topBefore)}% to ${r1(topNow)}% of units.`;
      if (topNow >= 60) out.management.continue.push(`Protecting stock and momentum of ${c.top.join(' and ')} (${r1(topNow)}% of ${c.latest.label.split(' ')[0]} units)`);
    }
  }
  if (ads && ads.latest) {
    const a = ads.latest;
    out.ads = {};
    ads.months.forEach((m) => {
      out.ads[m.periodKey] = m.roas === null ? `${m.label}: no attributed revenue is reported.`
        : `Each ₹1 of ads is credited with about ₹${m.roas.toFixed(2)} of revenue. ROAS is not profit.`;
    });
    if (ads.change && ads.change.roas !== null) {
      out.efficiency = `ROAS ${ads.change.roas < 0 ? 'fell ' + Math.abs(ads.change.roas) : 'rose ' + ads.change.roas}% from ${ads.previous.label.split(' ')[0]} to ${a.label.split(' ')[0]}${a.spendPer1000 && ads.previous.spendPer1000 ? `; cost per 1,000 impressions ${ads.change.spendPer1000 >= 0 ? 'rose' : 'fell'} ${Math.abs(ads.change.spendPer1000)}%` : ''}.`;
    }
    if (a.roas !== null && a.roas < 1) out.decisions.push('Reconcile reporting and set SKU-level break-even ROAS before scaling any spend.');
    out.decisions.push('Prove ads add total brand sales through controlled tests, not attributed sales alone.');
    const best = a.campaigns.filter((c) => c.roas !== null && c.spend > 0).sort((x, y) => y.roas - x.roas);
    if (best.length) out.management.continue.push(`Active campaigns only under tracked spend caps (best: ${best[0].name}, ${best[0].roas}x)`);
    const weak = a.campaigns.filter((c) => c.roas !== null && c.roas < 0.1 && c.spend > 0);
    weak.slice(0, 2).forEach((c) => out.management.restrict.push(`${c.name}: ${c.roas}x ROAS, diagnose before any relaunch`));
    out.management.measure.push('SKU break-even ROAS and contribution after ads');
    out.management.measure.push('Clicks, CTR, CPC, orders and the attribution window');
    out.management.measure.push('Incremental total brand units (hold-out test)');
  }
  if (weekday && weekday.priorities.length) {
    out.weekday = `${weekday.winners.join(' and ')} convert spend best; ${weekday.priorities.join(', ')} take ${weekday.priorityShare.spend}% of spend for ${weekday.priorityShare.units}% of units.`;
    out.management.optimize.push(`${weekday.priorities.join(', ')} spend: audit by campaign and keyword`);
  }
  if (funnel) out.funnel = `${funnel.atcRatePct === null ? 'Few' : funnel.atcRatePct + '%'} of impressions become add-to-carts; the step from add-to-cart to unit is directional only.`;
  if (keywords) {
    const zero = keywords.list.filter((k) => k.units === 0);
    if (zero.length) out.management.restrict.push(`${zero.slice(0, 3).map((k) => `"${k.keyword}"`).join(', ')}: pause or sharply restrict pending clicks and relevance checks`);
    const test = keywords.list.find((k) => k.decision === 'Controlled test');
    if (test) out.management.optimize.push(`"${test.keyword}": capped controlled test`);
  }
  if (stock && stock.totals.lowOrOut > 0) out.management.fix.push(`${stock.totals.lowOrOut} of ${stock.totals.listings} stock listings are low or out of stock: replenish first`);
  if (sales && sales.concentration) out.decisions.push(`Protect ${sales.concentration.top.join(' and ')} stock, then lift the rest of the range.`);
  out.decisions = out.decisions.slice(0, 3);
  return out;
}

/**
 * @param {object} input
 * @param {string} input.brand
 * @param {string[]|null} input.monthKeys   months to include (YYYY-MM); null = the latest months that have data
 * @param {object[]} input.slots            salesMonthly slots of this brand (one platform)
 * @param {object[]} input.campaignRows     this brand's daily campaign rows
 * @param {{periodKey, periodLabel}[]} input.campaignPeriods
 * @param {object[]} input.inventoryRows    this brand's stock rows
 * @param {object|null} input.profit        buildBrandProfit output, only when the admin asked for it
 * @param {string} input.today              YYYY-MM-DD
 */
function buildBrandReport(input) {
  const slots = (input.slots || []).slice().sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const campaignRows = input.campaignRows || [];
  const salesKeys = slots.map((s) => s.monthKey);
  const adKeys = Array.from(new Set(campaignRows.map((r) => r.periodKey))).sort();
  const everyMonth = Array.from(new Set([...salesKeys, ...adKeys])).sort();
  const wanted = (input.monthKeys && input.monthKeys.length ? input.monthKeys : everyMonth.slice(-MAX_MONTHS))
    .filter((k) => everyMonth.includes(k)).sort();
  const selected = wanted.length ? wanted : everyMonth.slice(-MAX_MONTHS);
  const salesSelected = selected.filter((k) => salesKeys.includes(k));
  const adRows = campaignRows.filter((r) => selected.includes(r.periodKey));

  const sales = salesSelected.length ? salesSection(slots, salesSelected) : null;
  const ads = adRows.length ? adsSection(campaignRows, selected, input.campaignPeriods) : null;
  const weekday = adRows.length ? weekdaySection(adRows) : null;
  const funnel = adRows.length ? funnelSection(adRows) : null;
  const keywords = adRows.length ? keywordsSection(adRows) : null;
  const stock = stockSection(input.inventoryRows || []);
  const profit = profitSection(input.profit, selected);

  const data = {
    brand: input.brand,
    generatedOn: input.today,
    availableMonths: everyMonth.map((k) => {
      const slot = slots.find((s) => s.monthKey === k);
      return { monthKey: k, label: monthLabel(k), hasSales: salesKeys.includes(k), hasAds: adKeys.includes(k), units: slot ? slot.totals.units : null };
    }),
    selectedMonths: selected,
    sales, ads, weekday, funnel, keywords, stock, profit,
    coverage: {
      sales: sales ? { from: sales.months[0].from, to: sales.latest.to } : null,
      ads: ads ? ads.months.map((m) => ({ label: m.label, from: m.from, to: m.to })) : [],
      adDays: weekday ? weekday.totals.daysWithData : 0,
    },
  };
  data.insights = insights(data);
  data.available = {
    sales: Boolean(sales), trajectory: Boolean(sales), concentration: Boolean(sales && sales.concentration),
    ads: Boolean(ads), efficiency: Boolean(ads && ads.previous), weekday: Boolean(weekday && weekday.days.length >= 3), funnel: Boolean(funnel),
    keywords: Boolean(keywords), stock: Boolean(stock), profit: Boolean(profit),
  };
  return data;
}

module.exports = { buildBrandReport };
