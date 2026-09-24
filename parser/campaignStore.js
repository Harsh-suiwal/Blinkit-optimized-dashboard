const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'campaignData.json');

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return { periods: {}, fileName: null, uploadedDate: null };
  const raw = fs.readFileSync(STORE_PATH, 'utf-8');
  if (!raw.trim()) return { periods: {}, fileName: null, uploadedDate: null };
  return JSON.parse(raw);
}

function saveStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

/**
 * Adds or replaces each period found in this upload. Re-uploading a sheet
 * that includes a month we've already seen overwrites that month with the
 * newer numbers, rather than duplicating it.
 */
function upsertPeriods(parsedPeriods, fileName, uploadedDate) {
  const store = loadStore();
  parsedPeriods.forEach((p) => {
    store.periods[p.periodKey] = {
      periodKey: p.periodKey,
      periodLabel: p.periodLabel,
      campaigns: p.campaigns,
    };
  });
  store.fileName = fileName;
  store.uploadedDate = uploadedDate;
  saveStore(store);
  return store;
}

function getLatestPeriodKey(store) {
  const keys = Object.keys(store.periods);
  if (keys.length === 0) return null;
  return keys.sort().pop(); // "YYYY-MM" sorts correctly as a plain string
}

function listPeriods(store) {
  return Object.values(store.periods)
    .map((p) => ({ periodKey: p.periodKey, periodLabel: p.periodLabel }))
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey));
}

/**
 * Removes one campaign (by its position in the period's campaigns array)
 * from a period. Returns the removed campaign, or null if the period or
 * index doesn't exist. Position (rather than name) is used as the key
 * because campaign names aren't guaranteed unique within a period.
 */
function removeCampaignAt(periodKey, index) {
  const store = loadStore();
  const period = store.periods[periodKey];
  if (!period || index < 0 || index >= period.campaigns.length) return null;

  const [removed] = period.campaigns.splice(index, 1);
  saveStore(store);
  return removed;
}

/**
 * Re-inserts a previously-removed campaign back into its period at (as
 * close as possible to) its original position. Used by undo/Ctrl+Z.
 */
function restoreCampaignAt(periodKey, index, campaign) {
  const store = loadStore();
  if (!store.periods[periodKey]) return false;

  const campaigns = store.periods[periodKey].campaigns;
  const clampedIndex = Math.max(0, Math.min(index, campaigns.length));
  campaigns.splice(clampedIndex, 0, campaign);
  saveStore(store);
  return true;
}

module.exports = {
  loadStore,
  upsertPeriods,
  getLatestPeriodKey,
  listPeriods,
  removeCampaignAt,
  restoreCampaignAt,
};
