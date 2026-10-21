const kv = require('../store/kv');
const { periodLabelFor } = require('./parseCampaign');

const STORE_KEY = 'campaignData'; // kv key; { uploads: [...], rows: [...] }

const EMPTY_STORE = () => ({ uploads: [], rows: [] });

// A "slot" is one brand's data for one period + sheet type. An upload replaces only the slots it contains.
const brandKey = (brand) => String(brand || '').toLowerCase();
const slotKey = (x) => `${x.periodKey}|${x.sheetType}|${brandKey(x.brandName)}`;
const pairKey = (x) => `${x.periodKey}|${x.sheetType}`;

// --- Persistence -------------------------------------------------------------

let warnedBadShape = false;

// A stored value without a rows array (e.g. the pre-rewrite aggregated format) counts as empty.
function normalize(value) {
  if (!value) return EMPTY_STORE();
  if (!Array.isArray(value.rows)) {
    if (!warnedBadShape) {
      console.warn('campaignData in kv_store has an unexpected shape; treating it as empty.');
      warnedBadShape = true;
    }
    return EMPTY_STORE();
  }
  return { uploads: Array.isArray(value.uploads) ? value.uploads : [], rows: value.rows };
}

/**
 * The store for READ-ONLY use: no copy is made (this is the biggest document and every
 * campaign request reads it), so callers must never mutate the result or its rows.
 */
function loadStore() {
  return normalize(kv.peek(STORE_KEY));
}

/** A private copy for code that modifies the store before saving it. */
function loadStoreForWrite() {
  return normalize(kv.get(STORE_KEY));
}

async function saveStore(store) {
  await kv.set(STORE_KEY, store);
}

/** Deletes every campaign row of one brand (all periods / sheet types); returns how many. */
async function removeBrandRows(brand) {
  const store = loadStoreForWrite();
  const wanted = String(brand).toLowerCase();
  const kept = store.rows.filter((r) => r.brandName.toLowerCase() !== wanted);
  const removed = store.rows.length - kept.length;
  if (removed) {
    store.rows = kept;
    // Drop upload records whose slot no longer has any rows. Old records without a brandName
    // covered a whole period + sheet type, so they are judged by that pair instead.
    const aliveSlots = new Set(kept.map(slotKey));
    const alivePairs = new Set(kept.map(pairKey));
    store.uploads = store.uploads.filter((u) => (u.brandName ? aliveSlots.has(slotKey(u)) : alivePairs.has(pairKey(u))));
    await saveStore(store);
  }
  return removed;
}

/** Deletes every stored campaign row and upload record. */
async function clearStore() {
  await saveStore(EMPTY_STORE());
}

// --- Uploads -----------------------------------------------------------------

/**
 * Describes what an upload would replace, without writing anything: for each
 * (periodKey, sheetType, brandName) in the parsed file, the row count and date range
 * already stored versus the new one, plus that brand's stored campaigns that are not
 * in the new file (they disappear, because the whole brand slot is replaced).
 * Other brands in the same period / sheet type are not touched.
 */
function planUpload(parsed) {
  const store = loadStore();
  return parsed.uploads.map((u) => {
    const slot = slotKey(u);
    const existingUpload = store.uploads.find((e) => e.brandName && slotKey(e) === slot);
    const existingRows = store.rows.filter((r) => slotKey(r) === slot);
    const incomingIds = new Set(
      parsed.rows.filter((r) => slotKey(r) === slot).map((r) => String(r.campaignId))
    );
    const removedCampaigns = new Map();
    for (const r of existingRows) {
      if (!incomingIds.has(String(r.campaignId))) removedCampaigns.set(String(r.campaignId), r.campaignName);
    }
    return {
      periodKey: u.periodKey,
      periodLabel: u.periodLabel,
      sheetType: u.sheetType,
      brandName: u.brandName,
      incoming: { rowCount: u.rowCount, from: u.dateRange.from, to: u.dateRange.to },
      existing: existingRows.length
        ? {
            rowCount: existingRows.length,
            from: existingUpload?.dateRange.from ?? existingRows.reduce((m, r) => (r.date < m ? r.date : m), existingRows[0].date),
            to: existingUpload?.dateRange.to ?? existingRows.reduce((m, r) => (r.date > m ? r.date : m), existingRows[0].date),
          }
        : null,
      removedCampaigns: Array.from(removedCampaigns, ([campaignId, campaignName]) => ({ campaignId, campaignName })),
    };
  });
}

/** Campaigns in a parsed upload whose brand could not be resolved (brandName "Unknown"). */
function listUnresolvedCampaigns(parsed) {
  const seen = new Map();
  for (const r of parsed.rows) {
    if (r.brandName !== 'Unknown') continue;
    const key = `${r.sheetType}|${r.campaignId}`;
    if (!seen.has(key)) seen.set(key, { campaignId: r.campaignId, campaignName: r.campaignName, sheetType: r.sheetType });
  }
  return Array.from(seen.values());
}

/**
 * Stores a parsed upload. Every (periodKey, sheetType, brandName) it contains replaces
 * what was stored for that slot, because Blinkit exports the whole month each time.
 * Other months, sheet types and other brands are untouched.
 */
async function upsertUpload(parsed) {
  const store = loadStoreForWrite();
  const replacedSlots = new Set(parsed.uploads.map(slotKey));
  const replacedPairs = new Set(parsed.uploads.map(pairKey));
  const keepRow = (r) => !replacedSlots.has(slotKey(r));
  // Old upload records (no brandName) only hold informational dates; drop them for any pair being replaced.
  const keepUpload = (u) => (u.brandName ? !replacedSlots.has(slotKey(u)) : !replacedPairs.has(pairKey(u)));

  store.uploads = store.uploads.filter(keepUpload).concat(parsed.uploads);
  store.rows = store.rows.filter(keepRow).concat(parsed.rows);
  await saveStore(store);
  return store;
}

// --- Periods -----------------------------------------------------------------

function listPeriods(store) {
  const keys = new Set(store.rows.map((r) => r.periodKey));
  return Array.from(keys)
    .sort()
    .map((periodKey) => ({ periodKey, periodLabel: periodLabelFor(periodKey) }));
}

function getLatestPeriodKey(store) {
  const periods = listPeriods(store);
  return periods.length ? periods[periods.length - 1].periodKey : null;
}

function resolvePeriodKey(store, requested) {
  const keys = new Set(store.rows.map((r) => r.periodKey));
  return requested && keys.has(requested) ? requested : getLatestPeriodKey(store);
}

function getLastUploadedDate(store, periodKey) {
  const dates = store.uploads.filter((u) => !periodKey || u.periodKey === periodKey).map((u) => u.uploadedDate);
  return dates.length ? dates.sort().pop() : null;
}

// --- Delete / restore (campaign level) ---------------------------------------

function sameCampaign(row, periodKey, sheetType, campaignId) {
  return row.periodKey === periodKey && row.sheetType === sheetType && String(row.campaignId) === String(campaignId);
}

/** Removes every daily row of one campaign in a period; returns the removed rows. */
async function removeCampaignRows(periodKey, sheetType, campaignId) {
  const store = loadStoreForWrite();
  const removed = store.rows.filter((r) => sameCampaign(r, periodKey, sheetType, campaignId));
  if (!removed.length) return [];
  store.rows = store.rows.filter((r) => !sameCampaign(r, periodKey, sheetType, campaignId));
  await saveStore(store);
  return removed;
}

/** Puts previously removed rows back (undo). Returns how many were restored. */
async function restoreCampaignRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const store = loadStoreForWrite();
  const first = rows[0];
  // Guard against double-restore: drop any rows already present for this campaign.
  store.rows = store.rows.filter((r) => !sameCampaign(r, first.periodKey, first.sheetType, first.campaignId));
  store.rows = store.rows.concat(rows);
  await saveStore(store);
  return rows.length;
}

// --- Aggregation -------------------------------------------------------------

const r2 = (n) => Math.round(n * 100) / 100;

function emptyTotals() {
  return {
    adSpend: 0, directSales: 0, indirectSales: 0, impressions: 0,
    directAtc: 0, indirectAtc: 0, directQtySold: 0, indirectQtySold: 0, newUsersAcquired: 0,
  };
}

function addRow(t, row) {
  t.adSpend += row.estimatedBudgetConsumed;
  t.directSales += row.directSales;
  t.indirectSales += row.indirectSales;
  t.impressions += row.impressions;
  t.directAtc += row.directAtc;
  t.indirectAtc += row.indirectAtc;
  t.directQtySold += row.directQtySold;
  t.indirectQtySold += row.indirectQtySold;
  t.newUsersAcquired += row.newUsersAcquired;
}

/**
 * Turns summed raw totals into display metrics. Ratios (ROAS, ROI, CPM) are
 * always recomputed from the sums - never averaged from per-row ratios.
 */
function finalizeTotals(t) {
  const sales = t.directSales + t.indirectSales;
  const qtySold = t.directQtySold + t.indirectQtySold;
  return {
    adSpend: r2(t.adSpend),
    sales: r2(sales),
    directSales: r2(t.directSales),
    indirectSales: r2(t.indirectSales),
    roas: t.adSpend > 0 ? r2(sales / t.adSpend) : null,
    directRoas: t.adSpend > 0 ? r2(t.directSales / t.adSpend) : null,
    roiPct: t.adSpend > 0 ? Math.round(((sales - t.adSpend) / t.adSpend) * 1000) / 10 : null,
    rosPerUnit: qtySold > 0 ? r2(sales / qtySold) : null,
    cpm: t.impressions > 0 ? r2((t.adSpend / t.impressions) * 1000) : null,
    impressions: t.impressions,
    directAtc: t.directAtc,
    indirectAtc: t.indirectAtc,
    atc: t.directAtc + t.indirectAtc,
    directQtySold: t.directQtySold,
    indirectQtySold: t.indirectQtySold,
    qtySold,
    newUsersAcquired: t.newUsersAcquired,
  };
}

/** Rows for a period, narrowed by optional brand and sheet type ('ALL' / empty = no narrowing). */
function selectRows(store, { periodKey, brand, sheetType }) {
  const wantBrand = brand ? brand.toLowerCase() : '';
  const wantSheet = sheetType && sheetType !== 'ALL' ? sheetType : '';
  return store.rows.filter(
    (r) =>
      r.periodKey === periodKey &&
      (!wantSheet || r.sheetType === wantSheet) &&
      (!wantBrand || r.brandName.toLowerCase() === wantBrand)
  );
}

function aggregateTotals(rows) {
  const t = emptyTotals();
  rows.forEach((r) => addRow(t, r));
  return finalizeTotals(t);
}

/** One entry per campaign (sheetType + campaignId), tiered by ROAS. */
function aggregateByCampaign(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.sheetType}|${row.campaignId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        brandName: row.brandName,
        sheetType: row.sheetType,
        targetingTypes: new Set(),
        dates: new Set(),
        totals: emptyTotals(),
      });
    }
    const g = groups.get(key);
    g.targetingTypes.add(row.targetingType);
    g.dates.add(row.date);
    addRow(g.totals, row);
  }

  const campaigns = Array.from(groups.values()).map((g) => ({
    campaignId: g.campaignId,
    campaignName: g.campaignName,
    brandName: g.brandName,
    sheetType: g.sheetType,
    targetingTypes: Array.from(g.targetingTypes).filter(Boolean).sort(),
    activeDays: g.dates.size,
    ...finalizeTotals(g.totals),
  }));
  return assignPerformanceTiers(campaigns);
}

function aggregateByBrand(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.brandName)) {
      groups.set(row.brandName, { campaigns: new Set(), totals: emptyTotals() });
    }
    const g = groups.get(row.brandName);
    g.campaigns.add(`${row.sheetType}|${row.campaignId}`);
    addRow(g.totals, row);
  }
  return Array.from(groups.entries())
    .map(([brandName, g]) => ({ brandName, campaignCount: g.campaigns.size, ...finalizeTotals(g.totals) }))
    .sort((a, b) => b.adSpend - a.adSpend);
}

/** Drill-down for one campaign: per keyword/category totals plus a daily series. */
function getCampaignDetail(store, { periodKey, sheetType, campaignId }) {
  const rows = store.rows.filter((r) => sameCampaign(r, periodKey, sheetType, campaignId));

  const targeting = new Map();
  const daily = new Map();
  for (const row of rows) {
    const tKey = `${row.targetingType}|${row.targetingValue}`;
    if (!targeting.has(tKey)) {
      targeting.set(tKey, { targetingType: row.targetingType, targetingValue: row.targetingValue, totals: emptyTotals() });
    }
    addRow(targeting.get(tKey).totals, row);

    if (!daily.has(row.date)) daily.set(row.date, emptyTotals());
    addRow(daily.get(row.date), row);
  }

  return {
    targeting: Array.from(targeting.values())
      .map((g) => ({ targetingType: g.targetingType, targetingValue: g.targetingValue, ...finalizeTotals(g.totals) }))
      .sort((a, b) => b.adSpend - a.adSpend),
    daily: Array.from(daily.entries())
      .map(([date, t]) => ({ date, ...finalizeTotals(t) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * Tags campaigns 'top' (top 25% by ROAS), 'low' (bottom 25%) or 'mid'.
 * Campaigns with no spend have no real ROAS and are left out of the ranking.
 */
function assignPerformanceTiers(campaigns) {
  const ranked = campaigns.filter((c) => c.adSpend > 0 && c.roas !== null);
  const sorted = [...ranked].sort((a, b) => b.roas - a.roas);
  const n = sorted.length;
  const cutoff = Math.max(1, Math.ceil(n * 0.25));

  const tiers = new Map();
  sorted.forEach((c, idx) => {
    tiers.set(`${c.sheetType}|${c.campaignId}`, idx < cutoff ? 'top' : idx >= n - cutoff ? 'low' : 'mid');
  });
  return campaigns.map((c) => ({ ...c, tier: tiers.get(`${c.sheetType}|${c.campaignId}`) || 'mid' }));
}

/** Distinct brands across all stored campaign rows (any period). */
function listCampaignBrands(store) {
  return Array.from(new Set(store.rows.map((r) => r.brandName).filter(Boolean)));
}

module.exports = {
  loadStore,
  clearStore,
  removeBrandRows,
  planUpload,
  listUnresolvedCampaigns,
  upsertUpload,
  listPeriods,
  getLatestPeriodKey,
  resolvePeriodKey,
  getLastUploadedDate,
  removeCampaignRows,
  restoreCampaignRows,
  selectRows,
  aggregateTotals,
  aggregateByCampaign,
  aggregateByBrand,
  getCampaignDetail,
  listCampaignBrands,
};
