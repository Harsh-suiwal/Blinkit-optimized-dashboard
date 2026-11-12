// Stock status: does the stock we hold meet the demand? Pure functions (no kv / Supabase),
// shared by the server, the Stock page text and console.js.
//
// The report gives, per product and warehouse: stock (Total sellable), incoming stock, and units sold
// in the last 7 / 15 / 30 days. From that:
//   sales per day  = units sold in the last 30 days / 30
//   days of stock  = stock / sales per day
// and the status says what to do about it. Change the numbers below, nothing else.

const STOCK_SETTINGS = Object.freeze({
  // THE ORDER RULE (Sejal): order when stock is below double the last 30 days of sales, which is this
  // many days of stock. At or above it, stock is healthy and we do not order.
  HEALTHY_DAYS: 60,
  // Order, packing, transit and delivery take about this long (Sejal). It does NOT decide whether to order;
  // it only marks urgency: with fewer days of stock than this, the stock runs out before a new order arrives.
  LEAD_TIME_DAYS: 15,
  // A surge is only flagged by default. Set to true to make the status use the faster surge pace.
  SURGE_CHANGES_STATUS: false,
  // A surge needs at least this many units sold in the last 7 days...
  SURGE_MIN_UNITS_7D: 10,
  // ...and more than the earlier weeks predict plus this many "wobbles" (square roots) of normal randomness.
  SURGE_WIGGLE: 2,
});

const SALES_WINDOW_DAYS = 30; // the report's "Last 30 days" column
const RECENT_DAYS = 7;        // the report's "Last 7 days" column

// key doubles as the CSS class suffix on the Stock page (status-<key>).
// needsAction = an order is due (any reorder status or zero stock).
// urgentAction = the narrower set the "Products Needing Urgent Action" card counts: zero stock, or stock
// that runs out before a reorder can arrive. Reorder Now is NOT urgent (its stock lasts until delivery).
const STATUSES = {
  healthy: { label: 'Healthy', needsAction: false, urgentAction: false, legacy: 'ok' },
  covered: { label: 'Covered by Incoming', needsAction: false, urgentAction: false, legacy: 'ok' },
  now: { label: 'Reorder Now', needsAction: true, urgentAction: false, legacy: 'low' },       // below the healthy line: place an order
  urgent: { label: 'Reorder Urgently', needsAction: true, urgentAction: true, legacy: 'low' }, // below the lead time: runs out before delivery
  awaiting: { label: 'Awaiting Incoming', needsAction: true, urgentAction: true, legacy: 'out' },
  out: { label: 'Out of Stock', needsAction: true, urgentAction: true, legacy: 'out' },
  nosales: { label: 'No Recent Sales', needsAction: false, urgentAction: false, legacy: 'ok' },
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 4.43 -> "4.4", 12.5 -> "12.5", 36 -> "36", 0.27 -> "0.27" */
function fmt(n) {
  if (!Number.isFinite(n)) return '-';
  if (n >= 100) return String(Math.round(n));
  if (n >= 1) return String(Math.round(n * 10) / 10);
  return String(Math.round(n * 100) / 100);
}

/**
 * Is the last week higher than the earlier weeks explain? Sales counts wobble like coin tosses, so the last
 * 7 days is a surge only when it beats what days 8-30 predict by more than normal wobble, and enough
 * units sold for the comparison to mean something. The system only says THAT it happened, never why.
 */
function detectSurge(sold7, sold30, settings = STOCK_SETTINGS) {
  const earlierPerDay = Math.max(0, sold30 - sold7) / (SALES_WINDOW_DAYS - RECENT_DAYS);
  const expected7 = earlierPerDay * RECENT_DAYS;
  const surging = sold7 >= settings.SURGE_MIN_UNITS_7D && sold7 > expected7 + settings.SURGE_WIGGLE * Math.sqrt(expected7);
  return { surging, expected7, pace7: sold7 / RECENT_DAYS };
}

/**
 * Status of one stock row ({ totalStockAvailable, incomingInventory, unitsSold7, unitsSold30 }).
 * Returns { key, label, needsAction, legacyStatus, daysOfStock, pacePerDay, surge, line, surgeLine, surgeBadge, tip }.
 */
function computeStockHealth(row, settings = STOCK_SETTINGS) {
  const stock = num(row.totalStockAvailable);
  const incoming = num(row.incomingInventory);
  const sold7 = num(row.unitsSold7);
  const sold30 = num(row.unitsSold30);
  const lead = settings.LEAD_TIME_DAYS;
  const healthy = settings.HEALTHY_DAYS;

  const steadyPace = sold30 / SALES_WINDOW_DAYS;
  const surge = detectSurge(sold7, sold30, settings);
  const useSurgePace = surge.surging && settings.SURGE_CHANGES_STATUS && stock > 0;
  const pace = useSurgePace ? Math.max(steadyPace, surge.pace7) : steadyPace;
  const days = pace > 0 ? stock / pace : Infinity;
  const daysWithIncoming = pace > 0 ? (stock + incoming) / pace : Infinity;
  const selling = `Selling ${fmt(pace)}/day`;
  const outStart = sold30 > 0 ? `Was selling ${fmt(steadyPace)}/day · out of stock` : 'Out of stock';
  const incomingNote = incoming > 0 ? ` · ${incoming} incoming is not enough` : '';
  const target = `below the ${healthy}-day target`;

  let key;
  let line;
  if (stock <= 0) {
    if (incoming > 0) {
      key = 'awaiting';
      line = `${outStart} · ${incoming} incoming · follow up on delivery`;
    } else {
      key = 'out';
      line = `${outStart} · nothing incoming · reorder immediately`;
    }
  } else if (sold30 <= 0) {
    key = 'nosales';
    line = `No sales in the last ${SALES_WINDOW_DAYS} days · review before reordering`;
  } else if (days >= healthy) {
    key = 'healthy';
    line = `${selling} · ${fmt(days)} days of stock`;
  } else if (incoming > 0 && daysWithIncoming >= healthy) {
    key = 'covered';
    line = `${selling} · ${stock} in stock + ${incoming} incoming covers ${fmt(daysWithIncoming)} days`
      + (days < lead ? ` · stock alone lasts ${fmt(days)} days, confirm the delivery date` : '');
  } else if (days >= lead) {
    key = 'now';
    line = `${selling} · ${fmt(days)} days of stock, ${target} · order today${incomingNote}`;
  } else {
    key = 'urgent';
    line = `${selling} · ${fmt(days)} days of stock · runs out before a reorder arrives (${lead}-day lead time) · order today${incomingNote}`;
  }

  let surgeLine = null;
  let surgeBadge = null; // the short version shown under the pill
  if (surge.surging && stock > 0) {
    surgeBadge = useSurgePace ? '↑ Surge pace used' : `↑ Surge · ${fmt(stock / surge.pace7)} days left`;
    surgeLine = `↑ Demand surge: ${sold7} sold in the last ${RECENT_DAYS} days (about ${Math.round(surge.expected7)} expected)`
      + (useSurgePace ? ' · status uses the surge pace' : ` · ${fmt(stock / surge.pace7)} days left at ${fmt(surge.pace7)}/day`);
  }

  const tip = [
    STATUSES[key].label,
    `Stock (Total sellable): ${stock}`,
    `Incoming: ${incoming}`,
    sold30 > 0
      ? `Sold in last ${SALES_WINDOW_DAYS} days: ${sold30} → ${fmt(steadyPace)} per day`
      : `Sold in last ${SALES_WINDOW_DAYS} days: 0`,
    pace > 0 && stock > 0 ? `Days of stock: ${stock} ÷ ${fmt(pace)} = ${fmt(days)} days` : null,
    `Rules: ${healthy}+ days of stock (double the ${SALES_WINDOW_DAYS}-day sales) = Healthy, no order · below ${healthy} = order · below ${lead} (delivery takes ${lead} days) = Urgent`,
    `Last ${RECENT_DAYS} days: ${sold7} sold (${fmt(surge.pace7)} per day)`
      + (surge.surging ? `, demand surge (about ${Math.round(surge.expected7)} expected)` : ''),
    surgeLine,
    useSurgePace ? 'Status is using the surge pace.' : null,
  ].filter(Boolean).join('\n');

  return {
    key,
    label: STATUSES[key].label,
    needsAction: STATUSES[key].needsAction,
    urgentAction: STATUSES[key].urgentAction,
    legacyStatus: STATUSES[key].legacy,
    daysOfStock: Number.isFinite(days) ? Math.round(days * 10) / 10 : null,
    pacePerDay: Math.round(pace * 100) / 100,
    surge: surge.surging,
    line,
    surgeLine,
    surgeBadge,
    tip,
  };
}

/** Adds stockHealth to every row, and keeps the old stockStatus field ('ok' | 'low' | 'out') in step for older code. */
function decorateRows(rows, settings = STOCK_SETTINGS) {
  for (const r of rows || []) {
    const h = computeStockHealth(r, settings);
    r.stockHealth = h;
    r.stockStatus = h.legacyStatus;
  }
  return rows;
}

/** Rows without the computed stockHealth, for saving (it is always recomputed on read). */
function stripHealth(rows) {
  return (rows || []).map(({ stockHealth, ...rest }) => rest); // eslint-disable-line no-unused-vars
}

/**
 * How many different products have at least one warehouse that needs URGENT action (Reorder Urgently,
 * Awaiting Incoming or Out of Stock). A product is counted once however many warehouses it has. Rows must be decorated.
 */
function productsNeedingAction(rows) {
  return new Set((rows || []).filter((r) => r.stockHealth && r.stockHealth.urgentAction).map((r) => r.productName)).size;
}

module.exports = { STOCK_SETTINGS, STATUSES, computeStockHealth, detectSurge, decorateRows, stripHealth, productsNeedingAction };