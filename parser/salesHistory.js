const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'salesHistory.json');

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return { snapshots: [] };
  const raw = fs.readFileSync(HISTORY_PATH, 'utf-8');
  if (!raw.trim()) return { snapshots: [] };
  return JSON.parse(raw);
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Appends today's city-level aggregates to the history log, one entry
 * per city. Re-uploading on the same date replaces that date's entries
 * rather than duplicating them.
 */
function appendCitySnapshot(cityRows, date = todayDateString()) {
  const history = loadHistory();
  history.snapshots = history.snapshots.filter((s) => s.date !== date);

  for (const row of cityRows) {
    history.snapshots.push({ date, ...row });
  }

  saveHistory(history);
  return history;
}

/**
 * For a given city, finds the most recent snapshot BEFORE the given date.
 * This becomes the "previous period" we compare against to say whether
 * a city is trending up or down.
 */
function findPreviousSnapshot(history, city, beforeDate) {
  const candidates = history.snapshots
    .filter((s) => s.city === city && s.date < beforeDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // most recent first

  return candidates[0] || null;
}

/**
 * Adds a trend (% revenue change vs the previous upload) to each city
 * row. Returns null for cities with no earlier snapshot to compare to.
 */
function attachTrend(cityRows, date) {
  const history = loadHistory();

  return cityRows.map((row) => {
    const prev = findPreviousSnapshot(history, row.city, date);
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
function clearHistory() {
  saveHistory({ snapshots: [] });
}

/**
 * Removes every logged snapshot for one city, so a manually deleted
 * row doesn't linger and get picked up as a "previous" comparison
 * point on a future upload.
 */
function removeCityFromHistory(city) {
  const history = loadHistory();
  history.snapshots = history.snapshots.filter((s) => s.city !== city);
  saveHistory(history);
}

/**
 * Returns every logged snapshot for one city (used to snapshot the
 * "before" state right before a delete, so an undo/Ctrl+Z can restore
 * the full trend history, not just the visible row).
 */
function getSnapshotsForCity(city) {
  const history = loadHistory();
  return history.snapshots.filter((s) => s.city === city);
}

/**
 * Re-inserts previously-removed snapshots (from getSnapshotsForCity)
 * back into the history log, skipping any date+city pair that's
 * already present so an undo can't create duplicates.
 */
function restoreSnapshotsForCity(snapshots) {
  if (!snapshots || snapshots.length === 0) return;
  const history = loadHistory();
  const existingKeys = new Set(history.snapshots.map((s) => `${s.date}|${s.city}`));
  for (const snap of snapshots) {
    const key = `${snap.date}|${snap.city}`;
    if (!existingKeys.has(key)) {
      history.snapshots.push(snap);
      existingKeys.add(key);
    }
  }
  saveHistory(history);
}

module.exports = {
  appendCitySnapshot,
  attachTrend,
  loadHistory,
  todayDateString,
  clearHistory,
  removeCityFromHistory,
  getSnapshotsForCity,
  restoreSnapshotsForCity,
};
