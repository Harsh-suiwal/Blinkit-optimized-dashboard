const kv = require('../store/kv');

const HISTORY_KEY = 'history'; // kv key; { snapshots: [...] }

// How many days of slack we allow when looking for a snapshot uploaded
// "around 30 days ago". Uploads won't land on the exact day, so we search
// a small window instead of demanding an exact match.
const ANCHOR_TOLERANCE_DAYS = 5;

// readOnly: returns the cached object itself (no copy) - callers must not mutate it.
function loadHistory({ readOnly = false } = {}) {
  const history = readOnly ? kv.peek(HISTORY_KEY) : kv.get(HISTORY_KEY);
  if (!history || !Array.isArray(history.snapshots)) return { snapshots: [] };
  return history;
}

async function saveHistory(history) {
  await kv.set(HISTORY_KEY, history);
}

// "Today" in the business timezone (Asia/Kolkata unless TZ names another IANA zone),
// not UTC, so an upload at 1 AM IST is not dated the previous day.
function todayDateString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ || 'Asia/Kolkata' }).format(new Date()); // YYYY-MM-DD
}

function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA);
  const b = new Date(dateStrB);
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

/**
 * Appends this upload's parsed rows to the history log as one snapshot entry
 * per product-warehouse combination. A same-day re-upload replaces the entries
 * for the items it contains; entries for other items (other brands uploaded
 * the same day) and for other dates are always kept.
 */
async function appendSnapshot(parsedRows, date = todayDateString()) {
  const history = loadHistory();

  const uploaded = new Set(parsedRows.map((row) => `${row.itemId}|${row.warehouseId}`));
  history.snapshots = history.snapshots.filter(
    (s) => s.date !== date || !uploaded.has(`${s.itemId}|${s.warehouseId}`)
  );

  for (const row of parsedRows) {
    history.snapshots.push({
      date,
      itemId: row.itemId,
      warehouseId: row.warehouseId,
      brandName: row.brandName || '',
      productName: row.productName,
      warehouseName: row.warehouseName,
      totalStockAvailable: row.totalStockAvailable,
      incomingInventory: row.incomingInventory,
      unitsSold7: row.unitsSold7,
      unitsSold15: row.unitsSold15,
      unitsSold30: row.unitsSold30,
    });
  }

  await saveHistory(history);
  return history;
}

/**
 * Finds the most recent snapshot for this product-warehouse that lands
 * within ANCHOR_TOLERANCE_DAYS of "latestDate minus 30 days". This
 * snapshot becomes the anchor we use to extend 30-day coverage out to
 * 45 and 60 days, since Blinkit's report never gives us those directly.
 */
function findAnchorSnapshot(history, itemId, warehouseId, latestDate, daysBack = 30) {
  const target = daysBetween(latestDate, '1970-01-01') - daysBack; // days-since-epoch of (latestDate - daysBack)

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
 * Computes 45-day and 60-day units sold for one product-warehouse from the
 * latest snapshot plus an earlier one. Blinkit only reports 7/15/30-day
 * windows, so windows are stitched together:
 *   - anchor ~30 days back: 45d = sold30(now) + sold15(anchor)
 *                           60d = sold30(now) + sold30(anchor)
 *   - anchor ~15 days back: 45d = sold15(now) + sold30(anchor)
 * 45d uses whichever anchor lands closest to its ideal date (ties prefer the
 * 30-day anchor). Returns null for a window when there isn't enough upload
 * history yet.
 */
function computeExtendedWindows({ itemId, warehouseId, latestDate, latestUnitsSold15 = null, latestUnitsSold30 }, history = loadHistory({ readOnly: true })) {
  const gap = (anchor, daysBack) =>
    Math.abs(daysBetween(latestDate, anchor.date) - daysBack);

  const anchor30 = findAnchorSnapshot(history, itemId, warehouseId, latestDate, 30);
  const anchor15 = latestUnitsSold15 === null ? null : findAnchorSnapshot(history, itemId, warehouseId, latestDate, 15);

  let unitsSold45 = null;
  if (anchor30 && (!anchor15 || gap(anchor30, 30) <= gap(anchor15, 15))) {
    unitsSold45 = latestUnitsSold30 + anchor30.unitsSold15;
  } else if (anchor15) {
    unitsSold45 = latestUnitsSold15 + anchor15.unitsSold30;
  }

  return {
    unitsSold45,
    unitsSold60: anchor30 ? latestUnitsSold30 + anchor30.unitsSold30 : null,
  };
}

module.exports = {
  appendSnapshot,
  computeExtendedWindows,
  loadHistory,
  todayDateString,
};
