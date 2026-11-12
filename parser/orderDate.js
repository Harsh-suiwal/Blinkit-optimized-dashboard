// Pure order-date reading, shared by the server and console.js. No kv / Supabase imports here.

/**
 * Reads an order date as { y, m, d }. Accepts YYYY-MM-DD (optionally with a time),
 * DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY, and Excel date serial numbers.
 * Returns null when the value can't be read as a real date.
 */
function parseOrderDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  let y; let m; let d;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if (/^\d+(\.\d+)?$/.test(text) && Number(text) > 20000 && Number(text) < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86400000);
    [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else {
    return null;
  }
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

module.exports = { parseOrderDate };