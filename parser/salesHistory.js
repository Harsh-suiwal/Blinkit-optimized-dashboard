const kv = require('../store/kv');
const { todayDateString } = require('./snapshotHistory');

const HISTORY_KEY = 'salesHistory'; // kv key; { snapshots: [...] }

// readOnly: returns the cached object itself (no copy) - callers must not mutate it.
function loadHistory({ readOnly = false } = {}) {
  const history = readOnly ? kv.peek(HISTORY_KEY) : kv.get(HISTORY_KEY);
  if (!history || !Array.isArray(history.snapshots)) return { snapshots: [] };
  return history;
}

async function saveHistory(history) {
  await kv.set(HISTORY_KEY, history);
}


/**
 * Appends today's city-level aggregates to the history log, one entry per
 * (brand, city). Re-uploading on the same date replaces that date's entries for
 * the same brand + city only; other brands and other dates are kept.
 */
async function appendCitySnapshot(cityRows, date = todayDateString()) {
  const history = loadHistory();
  const uploaded = new Set(cityRows.map((r) => `${r.brandName || ''}|${r.city}`));
  history.snapshots = history.snapshots.filter(
    (s) => s.date !== date || !uploaded.has(`${snapshotBrand(s) || ''}|${s.city}`)
  );

  for (const row of cityRows) {
    history.snapshots.push({ date, ...row });
  }

  await saveHistory(history);
  return history;
}

/**
 * Brand a snapshot belongs to. Snapshots logged before uploads were per brand have no
 * brandName; they count as that brand only when they covered exactly one.
 */
function snapshotBrand(s) {
  if (s.brandName) return s.brandName;
  return Array.isArray(s.brands) && s.brands.length === 1 ? s.brands[0] : null;
}

/**
 * For a given brand + city, finds the most recent snapshot BEFORE the given date.
 * This becomes the "previous period" we compare against to say whether a city is
 * trending up or down. A snapshot of an unknown/mixed brand is only used when the
 * brand has no snapshot of its own.
 */
function findPreviousSnapshot(history, city, beforeDate, brand) {
  const newestFirst = (a, b) => (a.date < b.date ? 1 : -1);
  const earlier = history.snapshots.filter((s) => s.city === city && s.date < beforeDate);

  const own = earlier.filter((s) => snapshotBrand(s) === brand).sort(newestFirst);
  if (own.length) return own[0];
  return earlier.filter((s) => snapshotBrand(s) === null).sort(newestFirst)[0] || null;
}

/**
 * Adds a trend (% revenue change vs the previous upload) to each city
 * row. Returns null for cities with no earlier snapshot to compare to.
 */
function attachTrend(cityRows, date) {
  const history = loadHistory({ readOnly: true });

  return cityRows.map((row) => {
    const prev = findPreviousSnapshot(history, row.city, date, row.brandName || null);
    if (!prev || prev.revenue === 0) {
      return { ...row, revenueChangePct: null, previousRevenue: null };
    }
    const pct = ((row.revenue - prev.revenue) / prev.revenue) * 100;
    return { ...row, revenueChangePct: Math.round(pct * 10) / 10, previousRevenue: prev.revenue };
  });
}

/**
 * Wipes the entire trend history log (used for "clear all data").
 */
async function clearHistory() {
  await saveHistory({ snapshots: [] });
}

/**
 * Removes every logged snapshot for one brand (used when that brand's sales
 * data is deleted).
 */
async function removeBrandFromHistory(brand) {
  const history = loadHistory();
  const wanted = String(brand).toLowerCase();
  history.snapshots = history.snapshots.filter((s) => String(snapshotBrand(s) || '').toLowerCase() !== wanted);
  await saveHistory(history);
}

/**
 * Removes every logged snapshot for one city, so a manually deleted
 * row doesn't linger and get picked up as a "previous" comparison
 * point on a future upload.
 */
async function removeCityFromHistory(city) {
  const history = loadHistory();
  history.snapshots = history.snapshots.filter((s) => s.city !== city);
  await saveHistory(history);
}

/**
 * Returns every logged snapshot for one city (used to snapshot the
 * "before" state right before a delete, so an undo/Ctrl+Z can restore
 * the full trend history, not just the visible row).
 */
function getSnapshotsForCity(city) {
  const history = loadHistory({ readOnly: true });
  return history.snapshots.filter((s) => s.city === city);
}

/**
 * Re-inserts previously-removed snapshots (from getSnapshotsForCity)
 * back into the history log, skipping any date+city pair that's
 * already present so an undo can't create duplicates.
 */
async function restoreSnapshotsForCity(snapshots) {
  if (!snapshots || snapshots.length === 0) return;
  const history = loadHistory();
  const existingKeys = new Set(history.snapshots.map((s) => `${s.date}|${s.city}|${snapshotBrand(s) || ''}`));
  for (const snap of snapshots) {
    const key = `${snap.date}|${snap.city}|${snapshotBrand(snap) || ''}`;
    if (!existingKeys.has(key)) {
      history.snapshots.push(snap);
      existingKeys.add(key);
    }
  }
  await saveHistory(history);
}

module.exports = {
  appendCitySnapshot,
  attachTrend,
  loadHistory,
  todayDateString,
  clearHistory,
  removeBrandFromHistory,
  removeCityFromHistory,
  getSnapshotsForCity,
  restoreSnapshotsForCity,
};
