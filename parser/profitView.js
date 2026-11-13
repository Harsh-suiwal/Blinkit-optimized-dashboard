// Profit tab view: net profit or loss for any mix of months, products and cities. Pure: the server
// passes in the stored monthly sales, the brand's costs and the campaign spend, so it is easy to test.
//
// Everything is worked out per FACT = one product, in one city, in one month (the finest grain the
// stored sales have), in exact rupees. Rows are plain sums of facts, and the grand total is the
// sum of every fact in the selection, so every grouping (by month, by product, by city) gives the
// same total for the same filters.
//
// Rounding: each column's total is rounded to the rupee ONCE, and the rows are rounded so that they
// add up to that total exactly (largest-remainder rounding). So on screen the rows add to the total,
// every row is within about Rs 1 of its true value (units x COGS checks out by hand), and the totals
// match the old Profit maths. GST, counted net sales and profit are worked out from the shown whole
// rupees, so each row's own arithmetic adds up too.
//
// Per fact (revenue = the sales sheet's gross bill amount, which includes GST):
//   net sales = gross / (1 + GST %);   GST = gross - net sales
//   COGS = units x COGS per unit;   commission = gross x commission %
//   inward, fulfilment, storage = units x the per-unit fee
//   ads and other expenses = the fact's share of that month's brand-wide amounts (see below)
//   profit = net sales - COGS - commission - inward - fulfilment - storage - ads - other
//
// Ads and other expenses belong to the whole brand, so each month's amount is shared across that
// month's facts by gross sales. The share base is ALWAYS the whole brand's month, never the
// filtered part, so a filter shows a slice of the same profit, not a different number.
//
// A product with no COGS cannot be priced: its sales are shown, but it is left out of profit and
// takes no share of ads or other expenses (the same rule the old Profit page used: "sold without a
// cost row is left out and listed").
const { productKey } = require('./parseBrandCosts');

const DEFAULT_SETTINGS = Object.freeze({
  defaultTaxPct: 18,
  defaultCommissionPct: 0,
  inwardFee: 5,
  fulfilmentFee: 50,
  storageFee: 30, // Blinkit charges Rs 1 per unit per day; 30 assumes a unit is stored 30 days
});
const SETTING_LIMITS = Object.freeze({
  defaultTaxPct: 100, defaultCommissionPct: 100, inwardFee: 100000, fulfilmentFee: 100000, storageFee: 100000,
});
const PRODUCT_FIELD_LIMITS = Object.freeze({ cogs: 10000000, taxPct: 100, commissionPct: 100 });
const GROUPS = ['month', 'product', 'city'];
const NO_CITY = 'City not recorded';
const MAX_MONTHS = 12;

// Rounds to the rupee; the tiny nudge keeps a total like 1600.4999999999 (a float wobble) from rounding the wrong way.
const rnd = (n) => Math.round(n + 1e-9);
const round1 = (n) => Math.round(n * 10) / 10;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sum = (list) => list.reduce((total, v) => total + v, 0);

/** Stored settings (maybe partial or missing) merged over the defaults. */
function resolveSettings(stored) {
  const out = { ...DEFAULT_SETTINGS };
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (isNum(stored[key]) && stored[key] >= 0 && stored[key] <= SETTING_LIMITS[key]) out[key] = stored[key];
    }
  }
  return out;
}

/** Checks a settings patch from the browser; returns the clean values or throws a readable Error. */
function cleanSettingsPatch(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('settings are required.');
  const out = {};
  for (const key of Object.keys(patch)) {
    if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting "${key}".`);
    const value = Number(patch[key]);
    if (patch[key] === null || patch[key] === '' || !Number.isFinite(value) || value < 0 || value > SETTING_LIMITS[key]) {
      throw new Error(`${key} must be a number from 0 to ${SETTING_LIMITS[key]}.`);
    }
    out[key] = Math.round(value * 10000) / 10000;
  }
  if (!Object.keys(out).length) throw new Error('No settings were given.');
  return out;
}

/** One product's cost figures: a value typed in the Profit tab wins over the uploaded cost sheet, then the defaults. */
function resolveCost(sheetRow, manualRow, settings) {
  const sheet = sheetRow || {};
  const manual = manualRow || {};
  const pick = (m, s, d) => (isNum(m) ? m : isNum(s) ? s : d);
  const cogs = pick(manual.cogs, sheet.cogs, null);
  return {
    cogs,
    hasCogs: cogs !== null && cogs > 0, // 0 or blank means "not known yet", never "free"
    cogsSource: isNum(manual.cogs) ? 'typed' : (isNum(sheet.cogs) && sheet.cogs > 0 ? 'sheet' : null),
    taxPct: pick(manual.taxPct, sheet.taxPct, settings.defaultTaxPct),
    taxIsDefault: !isNum(manual.taxPct) && !isNum(sheet.taxPct),
    commissionPct: pick(manual.commissionPct, sheet.commissionPct, settings.defaultCommissionPct),
    commissionIsDefault: !isNum(manual.commissionPct) && !isNum(sheet.commissionPct),
    // Fees from an uploaded cost sheet are that sheet's own numbers; otherwise the editable defaults apply.
    inward: pick(null, sheet.inwardFee, settings.inwardFee),
    fulfilment: pick(null, sheet.fulfilmentFee, settings.fulfilmentFee),
    storage: pick(null, sheet.storageFee, settings.storageFee),
  };
}

/** Rounds `values` to whole numbers that add up to exactly `total` (itself a whole number). */
function apportion(values, total) {
  const floors = values.map((v) => Math.floor(v + 1e-7));
  const left = total - sum(floors);
  const order = values.map((v, i) => ({ i, frac: v - floors[i] })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < left && k < order.length; k += 1) floors[order[k].i] += 1;
  return floors;
}

/** Every product x city x month of the stored slots. A product stored without cities gets city null. */
function buildFacts(slots) {
  const facts = [];
  const cityMissingMonths = new Set();
  for (const slot of slots) {
    for (const p of slot.products || []) {
      const key = productKey(p.productName);
      if (!key) continue;
      if (Array.isArray(p.cities) && p.cities.length) {
        for (const c of p.cities) {
          facts.push({ monthKey: slot.monthKey, key, product: p.productName, city: String(c.city || 'Unknown'), revenue: c.revenue, units: c.units });
        }
      } else {
        cityMissingMonths.add(slot.monthKey);
        facts.push({ monthKey: slot.monthKey, key, product: p.productName, city: null, revenue: p.revenue, units: p.units });
      }
    }
  }
  return { facts, cityMissingMonths };
}

const emptyAcc = () => ({
  units: 0, gross: 0, net: 0, leftOut: 0, leftOutGross: 0, leftOutUnits: 0,
  cogs: 0, fees: 0, storage: 0, ads: 0, other: 0,
});

function addFact(acc, f) {
  acc.units += f.units;
  acc.gross += f.gross;
  acc.net += f.net;
  if (!f.costed) {
    acc.leftOut += f.net;
    acc.leftOutGross += f.gross;
    acc.leftOutUnits += f.units;
    return;
  }
  acc.cogs += f.cogs;
  acc.fees += f.commission + f.inward + f.fulfilment; // Blinkit fees without storage
  acc.storage += f.storage;
  acc.ads += f.ads;
  acc.other += f.other;
}

const MONEY_COLUMNS = ['gross', 'net', 'leftOut', 'leftOutGross', 'cogs', 'fees', 'storage', 'ads', 'other'];

/** One shown row from whole-rupee columns: GST, counted net sales and profit come from the shown numbers. */
function shownRow(units, leftOutUnits, c) {
  const countedNet = c.net - c.leftOut;
  const profit = countedNet - c.cogs - c.fees - c.storage - c.ads - c.other;
  return {
    units: Math.round(units),
    gross: c.gross,
    gst: c.gross - c.net,
    net: c.net,
    leftOut: c.leftOut,
    leftOutGross: c.leftOutGross,
    leftOutUnits: Math.round(leftOutUnits),
    cogs: c.cogs,
    fees: c.fees,
    storage: c.storage,
    ads: c.ads,
    other: c.other,
    profit,
    marginPct: countedNet > 0 ? round1((profit / countedNet) * 100) : null,
  };
}

/** Rounds every column once for the total, then rounds the rows to add up to it. Returns { rows, totals }. */
function finishTable(accs, totalAcc) {
  const totalCols = {};
  const rowCols = accs.map(() => ({}));
  for (const col of MONEY_COLUMNS) {
    const total = rnd(totalAcc[col]);
    totalCols[col] = total;
    apportion(accs.map((a) => a[col]), total).forEach((v, i) => { rowCols[i][col] = v; });
  }
  return {
    rows: accs.map((a, i) => shownRow(a.units, a.leftOutUnits, rowCols[i])),
    totals: shownRow(totalAcc.units, totalAcc.leftOutUnits, totalCols),
  };
}

function parseMonthList(months, monthKeys) {
  const valid = new Set(monthKeys);
  const out = [];
  for (const m of Array.isArray(months) ? months : []) {
    if (valid.has(m) && !out.includes(m)) out.push(m);
  }
  return out.sort().slice(-MAX_MONTHS);
}

/** Default month: the latest one that covers the whole month, else the latest one stored. */
function defaultMonths(monthInfo) {
  if (!monthInfo.length) return [];
  const full = monthInfo.filter((m) => !m.partial);
  const pool = full.length ? full : monthInfo;
  return [pool[pool.length - 1].monthKey];
}

/**
 * input: { brand, slots, monthInfo, costs, adSpendByMonth, groupBy, months, products, cities, includeAds }
 *   slots: slotsFor(brand, platform) · monthInfo: listMonths(brand, platform) · costs: stored brand costs or null
 *   adSpendByMonth: { 'YYYY-MM': rupees } · months: ['YYYY-MM'] (default: the latest full month)
 *   products / cities: arrays of names to keep, or undefined for "all" (an empty array keeps nothing)
 *   includeAds: false leaves ad spend out of the costs
 */
function buildProfitView(input) {
  const { brand, slots = [], monthInfo = [], costs = null, adSpendByMonth = {} } = input;
  const settings = resolveSettings(costs && costs.manual && costs.manual.settings);
  const groupBy = GROUPS.includes(input.groupBy) ? input.groupBy : 'month';
  const adsOn = input.includeAds !== false;

  const infoByMonth = new Map(monthInfo.map((m) => [m.monthKey, m]));
  const monthKeys = monthInfo.map((m) => m.monthKey);
  const sheetByKey = new Map(((costs && costs.products) || []).map((p) => [productKey(p.productName), p]));
  const manualByKey = (costs && costs.manual && costs.manual.products) || {};
  const otherByMonth = (costs && costs.otherCosts) || {};
  const costCache = new Map();
  const costFor = (key) => {
    if (!costCache.has(key)) costCache.set(key, resolveCost(sheetByKey.get(key), manualByKey[key], settings));
    return costCache.get(key);
  };

  // 1. Facts with their own figures (no filters yet: shares are based on the whole brand month).
  const { facts, cityMissingMonths } = buildFacts(slots);
  const productNames = new Map(); // key -> { productName, gross, units }
  for (const f of facts) {
    const c = costFor(f.key);
    f.gross = f.revenue;
    f.net = f.gross / (1 + c.taxPct / 100);
    f.costed = c.hasCogs;
    f.cogs = f.commission = f.inward = f.fulfilment = f.storage = f.ads = f.other = 0;
    if (c.hasCogs) {
      f.cogs = f.units * c.cogs;
      f.commission = (f.gross * c.commissionPct) / 100;
      f.inward = f.units * c.inward;
      f.fulfilment = f.units * c.fulfilment;
      f.storage = f.units * c.storage;
    }
    const p = productNames.get(f.key) || { productName: f.product, gross: 0, units: 0 };
    p.gross += f.gross;
    p.units += f.units;
    productNames.set(f.key, p);
  }

  // 2. Share each month's ads and other expenses across that month's priced facts, by gross sales.
  const brandCostByMonth = new Map();
  const unallocated = [];
  for (const monthKey of monthKeys) {
    const monthFacts = facts.filter((f) => f.monthKey === monthKey && f.costed)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : String(a.city).localeCompare(String(b.city))));
    const adExact = isNum(adSpendByMonth[monthKey]) ? adSpendByMonth[monthKey] : null;
    const adUsed = adsOn && adExact !== null ? adExact : 0;
    const otherUsed = isNum(otherByMonth[monthKey]) ? otherByMonth[monthKey] : 0;
    const base = sum(monthFacts.map((f) => f.gross));
    for (const f of monthFacts) {
      f.ads = base > 0 ? (adUsed * f.gross) / base : 0;
      f.other = base > 0 ? (otherUsed * f.gross) / base : 0;
    }
    if (!(base > 0) && (adUsed > 0 || otherUsed > 0)) unallocated.push({ monthKey, label: infoByMonth.get(monthKey).label, ads: rnd(adUsed), other: rnd(otherUsed) });
    brandCostByMonth.set(monthKey, { adExact, adUsed, otherUsed, adMissing: adsOn && adExact === null });
  }

  // 3. Filters.
  const requested = parseMonthList(input.months, monthKeys);
  const selectedMonths = requested.length ? requested : defaultMonths(monthInfo);
  const monthSet = new Set(selectedMonths);
  const productSet = Array.isArray(input.products) ? new Set(input.products.map(productKey)) : null;
  const citySet = Array.isArray(input.cities) ? new Set(input.cities.map(String)) : null;
  const picked = facts.filter((f) =>
    monthSet.has(f.monthKey)
    && (!productSet || productSet.has(f.key))
    && (!citySet || (f.city !== null && citySet.has(f.city))));
  const cityGapMonths = citySet ? selectedMonths.filter((m) => cityMissingMonths.has(m)) : [];

  // 4. Rows.
  const rowKeyOf = {
    month: (f) => f.monthKey,
    product: (f) => f.key,
    city: (f) => (f.city === null ? NO_CITY : f.city),
  };
  const groups = new Map();
  if (groupBy === 'month') selectedMonths.forEach((m) => groups.set(m, emptyAcc()));
  for (const f of picked) {
    const k = rowKeyOf[groupBy](f);
    if (!groups.has(k)) groups.set(k, emptyAcc());
    addFact(groups.get(k), f);
  }
  const makeLabel = (k) => {
    if (groupBy === 'month') return infoByMonth.get(k).label;
    if (groupBy === 'product') return productNames.get(k).productName;
    return k;
  };
  const entries = Array.from(groups, ([k, acc]) => ({
    key: k,
    label: makeLabel(k),
    partial: groupBy === 'month' ? Boolean(infoByMonth.get(k).partial) : false,
    adMissing: groupBy === 'month' ? brandCostByMonth.get(k).adMissing : false,
    acc,
  }));
  const totalAcc = emptyAcc();
  picked.forEach((f) => addFact(totalAcc, f));
  const table = finishTable(entries.map((e) => e.acc), totalAcc);
  let rows = entries.map((e, i) => ({ key: e.key, label: e.label, partial: e.partial, adMissing: e.adMissing, ...table.rows[i] }));
  const totals = table.totals;
  if (groupBy === 'month') rows.sort((a, b) => a.key.localeCompare(b.key));
  else rows.sort((a, b) => b.gross - a.gross || a.label.localeCompare(b.label));

  if (groupBy === 'month') {
    // Change vs the previous selected month: only between two full months, never from a zero base.
    const pct = (cur, prev) => round1(((cur - prev) / prev) * 100);
    rows = rows.map((r, i) => {
      const prev = i > 0 ? rows[i - 1] : null;
      const comparable = prev && !r.partial && !prev.partial;
      return {
        ...r,
        changeGrossPct: comparable && prev.gross > 0 ? pct(r.gross, prev.gross) : null,
        changeProfitPct: comparable && prev.profit > 0 ? pct(r.profit, prev.profit) : null,
      };
    });
  }

  // 5. What the brand-wide costs were, and how much of them this selection carries.
  const costMonths = selectedMonths.map((m) => {
    const b = brandCostByMonth.get(m);
    const mine = picked.filter((f) => f.monthKey === m && f.costed);
    return {
      monthKey: m,
      label: infoByMonth.get(m).label,
      partial: Boolean(infoByMonth.get(m).partial),
      adSpend: rnd(b.adUsed),
      adSpendExact: b.adExact,
      adMissing: b.adMissing,
      otherCosts: rnd(b.otherUsed),
      adShare: rnd(sum(mine.map((f) => f.ads))),
      otherShare: rnd(sum(mine.map((f) => f.other))),
    };
  });
  const brandAds = rnd(sum(selectedMonths.map((m) => brandCostByMonth.get(m).adUsed)));
  const brandOther = rnd(sum(selectedMonths.map((m) => brandCostByMonth.get(m).otherUsed)));
  const wholeBrand = !productSet && !citySet;
  const unallocatedHere = unallocated.filter((u) => monthSet.has(u.monthKey));

  // 6. Checks the page shows as ticks, each computed a second way.
  let slotGross = 0; // straight from the stored slots, not through facts
  for (const slot of slots) {
    if (!monthSet.has(slot.monthKey)) continue;
    for (const p of slot.products || []) {
      if (productSet && !productSet.has(productKey(p.productName))) continue;
      if (!citySet) { slotGross += p.revenue; continue; }
      for (const c of Array.isArray(p.cities) ? p.cities : []) if (citySet.has(String(c.city))) slotGross += c.revenue;
    }
  }
  const salesTabGross = wholeBrand ? sum(selectedMonths.map((m) => infoByMonth.get(m).revenue)) : null;
  const checks = [];
  const addCheck = (id, label, expected, actual, tolerance = 1) =>
    checks.push({ id, label, expected: Math.round(expected * 100) / 100, actual, ok: Math.abs(expected - actual) < tolerance });
  addCheck('gross-slots', 'Gross sales match the stored sales data', slotGross, totals.gross);
  if (salesTabGross !== null) addCheck('gross-sales-tab', 'Gross sales match the Sales tab', salesTabGross, totals.gross);
  const shareableMonths = selectedMonths.filter((m) => !unallocatedHere.some((u) => u.monthKey === m));
  if (wholeBrand && adsOn) {
    addCheck('ads-shared', 'Ad spend is fully shared out across the rows', rnd(sum(shareableMonths.map((m) => brandCostByMonth.get(m).adUsed))), totals.ads, 0.5);
  }
  if (wholeBrand) {
    addCheck('other-shared', 'Other expenses are fully shared out across the rows', rnd(sum(shareableMonths.map((m) => brandCostByMonth.get(m).otherUsed))), totals.other, 0.5);
  }
  addCheck('rows-total', 'Rows add up to the total profit', totals.profit, sum(rows.map((r) => r.profit)), 0.5);

  // 7. Lists for the filters and the inputs panel.
  const gross = (list) => sum(list.map((f) => f.gross));
  const cityTotals = new Map();
  facts.forEach((f) => { if (f.city !== null) cityTotals.set(f.city, (cityTotals.get(f.city) || 0) + f.gross); });
  const available = {
    months: monthInfo.map((m) => ({ monthKey: m.monthKey, label: m.label, partial: Boolean(m.partial), cityDataMissing: cityMissingMonths.has(m.monthKey), gross: gross(facts.filter((f) => f.monthKey === m.monthKey)) })),
    products: Array.from(productNames, ([key, p]) => ({ key, productName: p.productName, gross: p.gross, hasCogs: costFor(key).hasCogs })).sort((a, b) => b.gross - a.gross || a.productName.localeCompare(b.productName)),
    cities: Array.from(cityTotals, ([city, g]) => ({ city, gross: g })).sort((a, b) => b.gross - a.gross || a.city.localeCompare(b.city)),
  };
  const inputs = {
    settings,
    defaults: { ...DEFAULT_SETTINGS },
    products: available.products.map((p) => {
      const c = costFor(p.key);
      const units = productNames.get(p.key).units;
      return {
        productName: p.productName, units, gross: p.gross,
        cogs: c.cogs, cogsSource: c.cogsSource, hasCogs: c.hasCogs,
        taxPct: c.taxPct, taxIsDefault: c.taxIsDefault,
        commissionPct: c.commissionPct, commissionIsDefault: c.commissionIsDefault,
      };
    }),
    otherCosts: monthInfo.map((m) => ({ monthKey: m.monthKey, label: m.label, partial: Boolean(m.partial), amount: isNum(otherByMonth[m.monthKey]) ? otherByMonth[m.monthKey] : 0 })),
  };

  // Products in this selection that are left out because they have no COGS yet.
  const missingByKey = new Map();
  for (const f of picked) {
    if (f.costed) continue;
    const row = missingByKey.get(f.key) || { productName: productNames.get(f.key).productName, units: 0, gross: 0 };
    row.units += f.units;
    row.gross += f.gross;
    missingByKey.set(f.key, row);
  }

  return {
    brand,
    groupBy,
    includeAds: adsOn,
    filters: { months: selectedMonths, products: productSet ? input.products : null, cities: citySet ? input.cities : null },
    available,
    rows,
    totals,
    brandCosts: {
      adSpend: brandAds,
      adSpendExact: costMonths.every((m) => m.adSpendExact !== null) ? Math.round(sum(costMonths.map((m) => m.adSpendExact)) * 100) / 100 : null,
      otherCosts: brandOther,
      wholeBrand,
      months: costMonths,
    },
    notes: {
      leftOutProducts: Array.from(missingByKey.values()).sort((a, b) => b.gross - a.gross),
      partialMonths: costMonths.filter((m) => m.partial).map((m) => m.label),
      adMissingMonths: costMonths.filter((m) => m.adMissing).map((m) => m.label),
      cityGapMonths: cityGapMonths.map((m) => infoByMonth.get(m).label),
      unallocated: unallocatedHere,
    },
    checks,
    inputs,
  };
}

module.exports = {
  buildProfitView,
  resolveSettings,
  cleanSettingsPatch,
  apportion,
  DEFAULT_SETTINGS,
  PRODUCT_FIELD_LIMITS,
  GROUPS,
  NO_CITY,
};
