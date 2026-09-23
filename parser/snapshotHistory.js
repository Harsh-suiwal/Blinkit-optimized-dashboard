const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'history.json');

// How many days of slack we allow when looking for a snapshot uploaded
// "around 30 days ago". Uploads won't land on the exact day, so we search
// a small window instead of demanding an exact match.
const ANCHOR_TOLERANCE_DAYS = 5;

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
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA);
  const b = new Date(dateStrB);
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

/**
 * Appends today's parsed rows to the history log as one snapshot entry
 * per product-warehouse combination. If today's date already has entries
 * (re-uploaded same day), those are replaced rather than duplicated.
 */
function appendSnapshot(parsedRows, date = todayDateString()) {
  const history = loadHistory();

  // Drop any existing entries for this date (handles re-upload same day)
  history.snapshots = history.snapshots.filter((s) => s.date !== date);

  for (const row of parsedRows) {
    history.snapshots.push({
      date,
      itemId: row.itemId,
      warehouseId: row.warehouseId,
      productName: row.productName,
      warehouseName: row.warehouseName,
      totalStockAvailable: row.totalStockAvailable,
      incomingInventory: row.incomingInventory,
      unitsSold7: row.unitsSold7,
      unitsSold15: row.unitsSold15,
      unitsSold30: row.unitsSold30,
    });
  }

  saveHistory(history);
  return history;
}

/**
 * Finds the most recent snapshot for this product-warehouse that lands
 * within ANCHOR_TOLERANCE_DAYS of "latestDate minus 30 days". This
 * snapshot becomes the anchor we use to extend 30-day coverage out to
 * 45 and 60 days, since Blinkit's report never gives us those directly.
 */
function findAnchorSnapshot(history, itemId, warehouseId, latestDate) {
  const target = daysBetween(latestDate, '1970-01-01') - 30; // days-since-epoch of (latestDate - 30)

  const candidates = history.snapshots.filter(
    (s) => s.itemId === itemId && s.warehouseId === warehouseId && s.date !== latestDate
  );

  let best = null;
  let bestDiff = Infinity;
  for (const s of candidates) {
    const sDaysSinceEpoch = daysBetween(s.date, '1970-01-01');
    const diff = Math.abs(sDaysSinceEpoch - target);
    if (diff <= ANCHOR_TOLERANCE_DAYS && diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Computes 45-day and 60-day units sold for one product-warehouse,
 * using the current (latest) snapshot plus an anchor snapshot from
 * ~30 days earlier. Returns null for a window when there isn't enough
 * upload history yet to compute it.
 */
function computeExtendedWindows({ itemId, warehouseId, latestDate, latestUnitsSold30 }) {
  const history = loadHistory();
  const anchor = findAnchorSnapshot(history, itemId, warehouseId, latestDate);

  if (!anchor) {
    return { unitsSold45: null, unitsSold60: null };
  }

  return {
    // latest 30 days + anchor's 15-day window (covers ~day 31-45)
    unitsSold45: latestUnitsSold30 + anchor.unitsSold15,
    // latest 30 days + anchor's 30-day window (covers ~day 31-60)
    unitsSold60: latestUnitsSold30 + anchor.unitsSold30,
  };
}

module.exports = {
  appendSnapshot,
  computeExtendedWindows,
  loadHistory,
  todayDateString,
};
