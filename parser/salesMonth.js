// Month filter for the Sales tab. Blinkit's dashboard shows ONE month at a time ("October 2026"),
// but its Excel export can carry spill-over rows from the next month (e.g. Nov 1 inside the October
// file). Sales numbers must only add up rows whose Order Date is inside the chosen month.
// Pure functions: no kv / Supabase, so console.js can import this file too.
const { parseOrderDate } = require('./orderDate');

const pad2 = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM' of a parsed sales row, or null when its Order Date can't be read. */
function monthKeyOf(row) {
  const d = parseOrderDate(row.orderDate);
  return d ? `${d.y}-${pad2(d.m)}` : null;
}

/** Map of monthKey -> { monthKey, rows, units, revenue, from, to } for every readable row. */
function monthSummary(salesRows) {
  const out = new Map();
  for (const row of salesRows) {
    const d = parseOrderDate(row.orderDate);
    if (!d) continue;
    const monthKey = `${d.y}-${pad2(d.m)}`;
    const day = `${monthKey}-${pad2(d.d)}`;
    if (!out.has(monthKey)) out.set(monthKey, { monthKey, rows: 0, units: 0, revenue: 0, from: day, to: day });
    const m = out.get(monthKey);
    m.rows += 1;
    m.units += row.quantity;
    m.revenue += row.revenue;
    if (day < m.from) m.from = day;
    if (day > m.to) m.to = day;
  }
  return out;
}

/**
 * Which month does this file belong to? An explicit request wins; otherwise the month with the
 * most rows (a tie goes to the later month). Returns '' when no row has a readable date.
 */
function pickMonth(salesRows, requested = '') {
  if (requested) return requested;
  let best = null;
  for (const m of monthSummary(salesRows).values()) {
    if (!best || m.rows > best.rows || (m.rows === best.rows && m.monthKey > best.monthKey)) best = m;
  }
  return best ? best.monthKey : '';
}

/**
 * Keeps only the rows dated inside monthKey. `dropped` says what was left out, per month,
 * so the upload can tell the user ("ignored 71 rows from 2026-11").
 */
function filterToMonth(salesRows, monthKey) {
  const rows = [];
  let unreadable = 0;
  for (const row of salesRows) {
    const k = monthKeyOf(row);
    if (k === null) unreadable += 1;
    else if (k === monthKey) rows.push(row);
  }
  const dropped = Array.from(monthSummary(salesRows).values())
    .filter((m) => m.monthKey !== monthKey)
    .map((m) => ({ ...m, revenue: Math.round(m.revenue * 100) / 100 }));
  return { monthKey, rows, dropped, unreadable };
}

module.exports = { monthKeyOf, monthSummary, pickMonth, filterToMonth };